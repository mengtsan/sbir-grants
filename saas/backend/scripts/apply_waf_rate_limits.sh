#!/usr/bin/env bash
set -euo pipefail

# Apply zone-level WAF Rate Limiting rules via Cloudflare Rulesets API.
# References:
# - https://developers.cloudflare.com/waf/rate-limiting-rules/create-api/
# - https://developers.cloudflare.com/ruleset-engine/rulesets-api/create/

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is required" >&2
  exit 1
fi

API_HOST="${API_HOST:-sbir-api.thinkwithblack.com}"
CF_ZONE_ID="${CF_ZONE_ID:-${CLOUDFLARE_ZONE_ID:-}}"
CF_ZONE_NAME="${CF_ZONE_NAME:-}"
CF_ZONE_PERMISSIONS="${CF_ZONE_PERMISSIONS:-}"
CF_API="https://api.cloudflare.com/client/v4"
COMBINED_EXPR="(http.host eq \"${API_HOST}\" and ((starts_with(http.request.uri.path, \"/auth/\")) or (http.request.method eq \"POST\" and starts_with(http.request.uri.path, \"/api/storage/project/\")) or (http.request.method in {\"POST\" \"PUT\" \"PATCH\" \"DELETE\"} and (starts_with(http.request.uri.path, \"/api/projects\") or starts_with(http.request.uri.path, \"/api/storage\") or starts_with(http.request.uri.path, \"/api/quality\") or starts_with(http.request.uri.path, \"/api/me\")))))"

cf_api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS "${CF_API}${path}" \
      -X "$method" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -sS "${CF_API}${path}" \
      -X "$method" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

json_read() {
  local mode="$1"
  local raw="${2:-}"
  JSON_RAW="$raw" node - "$mode" <<'NODE'
const mode = process.argv[2];
const raw = process.env.JSON_RAW || '';
const obj = JSON.parse(raw);
if (mode === 'success') {
  process.stdout.write(String(!!obj.success));
  process.exit(0);
}
if (mode === 'result_id') {
  process.stdout.write(obj?.result?.id || '');
  process.exit(0);
}
if (mode === 'first_rule_id') {
  const rules = Array.isArray(obj?.result?.rules) ? obj.result.rules : [];
  process.stdout.write(rules[0]?.id || '');
  process.exit(0);
}
if (mode.startsWith('rule_id:')) {
  const desc = mode.slice('rule_id:'.length);
  const rules = Array.isArray(obj?.result?.rules) ? obj.result.rules : [];
  const found = rules.find((r) => r?.description === desc);
  process.stdout.write(found?.id || '');
  process.exit(0);
}
if (mode === 'errors') {
  const errs = Array.isArray(obj?.errors) ? obj.errors.map((e) => e?.message || JSON.stringify(e)) : [];
  process.stdout.write(errs.join('; '));
  process.exit(0);
}
process.stdout.write('');
NODE
}

ensure_success() {
  local response="$1"
  local ok
  ok="$(json_read success "$response")"
  if [[ "$ok" != "true" ]]; then
    local errs
    errs="$(json_read errors "$response")"
    if [[ "$errs" == *"Authentication error"* ]]; then
      echo "ERROR: Cloudflare API authentication/permission failed: ${errs}" >&2
      echo "Hint: token must include Zone WAF edit/read permissions for target zone." >&2
      exit 1
    fi
    echo "ERROR: Cloudflare API call failed: ${errs}" >&2
    exit 1
  fi
}

derive_root_domain() {
  local host="$1"
  IFS='.' read -r -a parts <<<"$host"
  local n="${#parts[@]}"
  if (( n >= 2 )); then
    echo "${parts[n-2]}.${parts[n-1]}"
  else
    echo "$host"
  fi
}

resolve_zone_id() {
  if [[ -n "${CF_ZONE_ID}" ]]; then
    return 0
  fi
  if [[ -z "${CF_ZONE_NAME}" ]]; then
    CF_ZONE_NAME="$(derive_root_domain "${API_HOST}")"
  fi
  local resp
  resp="$(cf_api GET "/zones?name=${CF_ZONE_NAME}")"
  ensure_success "$resp"
  local zid
  local zone_meta
  zone_meta="$(JSON_RAW="$resp" node - <<'NODE'
const obj = JSON.parse(process.env.JSON_RAW || '{}');
const zones = Array.isArray(obj?.result) ? obj.result : [];
const first = zones[0] || {};
const perms = Array.isArray(first.permissions) ? first.permissions.join(',') : '';
process.stdout.write(`${first.id || ''}\n${perms}`);
NODE
)"
  zid="$(printf '%s' "$zone_meta" | sed -n '1p')"
  CF_ZONE_PERMISSIONS="$(printf '%s' "$zone_meta" | sed -n '2p')"
  if [[ -z "$zid" ]]; then
    echo "ERROR: cannot resolve zone id for zone name '${CF_ZONE_NAME}'" >&2
    exit 1
  fi
  CF_ZONE_ID="$zid"
  if [[ -n "$CF_ZONE_PERMISSIONS" ]]; then
    echo "Zone permissions: ${CF_ZONE_PERMISSIONS}"
  else
    echo "Zone permissions: (none returned)"
  fi
}

extract_first_allowed_period() {
  local response="$1"
  RESPONSE_JSON="$response" node - <<'NODE'
const raw = process.env.RESPONSE_JSON || '';
const obj = JSON.parse(raw);
const errs = Array.isArray(obj?.errors) ? obj.errors : [];
for (const e of errs) {
  const msg = e?.message || '';
  const m = msg.match(/\[([0-9,\s]+)\]/);
  if (m && m[1]) {
    const first = m[1].split(',').map(s => s.trim()).find(Boolean);
    if (first) {
      process.stdout.write(first);
      process.exit(0);
    }
  }
}
process.stdout.write('');
NODE
}

get_or_create_entrypoint_ruleset() {
  local resp
  resp="$(cf_api GET "/zones/${CF_ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint")"
  local ok
  ok="$(json_read success "$resp")"
  if [[ "$ok" == "true" ]]; then
    json_read result_id "$resp"
    return 0
  fi

  local create_body
  create_body="$(cat <<JSON
{
  "name": "Zone-level phase entry point for rate limits",
  "description": "Managed by apply_waf_rate_limits.sh",
  "kind": "zone",
  "phase": "http_ratelimit",
  "rules": []
}
JSON
)"
  local create_resp
  create_resp="$(cf_api POST "/zones/${CF_ZONE_ID}/rulesets" "$create_body")"
  ensure_success "$create_resp"
  json_read result_id "$create_resp"
}

upsert_rule() {
  local ruleset_id="$1"
  local description="$2"
  local expression="$3"
  local requests_per_period="$4"
  local period="$5"
  local mitigation_timeout="$6"
  local esc_description
  local esc_expression
  esc_description="${description//\"/\\\"}"
  esc_expression="${expression//\"/\\\"}"

  local entrypoint
  entrypoint="$(cf_api GET "/zones/${CF_ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint")"
  ensure_success "$entrypoint"
  local existing_rule_id
  existing_rule_id="$(json_read "rule_id:${description}" "$entrypoint")"

  local payload
  payload="$(cat <<JSON
{
  "description": "${esc_description}",
  "expression": "${esc_expression}",
  "action": "block",
  "action_parameters": {
    "response": {
      "status_code": 429,
      "content_type": "application/json",
      "content": "{\"error\":\"RATE_LIMITED\"}"
    }
  },
  "ratelimit": {
    "characteristics": ["cf.colo.id", "ip.src"],
    "period": ${period},
    "requests_per_period": ${requests_per_period},
    "mitigation_timeout": ${mitigation_timeout}
  }
}
JSON
)"

  send_once() {
    local current_payload="$1"
    if [[ -n "$existing_rule_id" ]]; then
      cf_api PATCH "/zones/${CF_ZONE_ID}/rulesets/${ruleset_id}/rules/${existing_rule_id}" "$current_payload"
    else
      cf_api POST "/zones/${CF_ZONE_ID}/rulesets/${ruleset_id}/rules" "$current_payload"
    fi
  }

  local resp
  resp="$(send_once "$payload")"
  local ok
  ok="$(json_read success "$resp")"
  if [[ "$ok" != "true" ]]; then
    local errs
    errs="$(json_read errors "$resp")"
    if [[ "$errs" == *"not entitled to use the period"* ]]; then
      local allowed_period
      allowed_period="$(extract_first_allowed_period "$resp")"
      if [[ -n "$allowed_period" ]]; then
        echo "retrying with entitled period=${allowed_period}: ${description}"
        payload="$(cat <<JSON
{
  "description": "${esc_description}",
  "expression": "${esc_expression}",
  "action": "block",
  "action_parameters": {
    "response": {
      "status_code": 429,
      "content_type": "application/json",
      "content": "{\"error\":\"RATE_LIMITED\"}"
    }
  },
  "ratelimit": {
    "characteristics": ["cf.colo.id", "ip.src"],
    "period": ${allowed_period},
    "requests_per_period": ${requests_per_period},
    "mitigation_timeout": ${mitigation_timeout}
  }
}
JSON
)"
        resp="$(send_once "$payload")"
      fi
    fi
  fi

  local ok_final
  ok_final="$(json_read success "$resp")"
  if [[ "$ok_final" != "true" ]]; then
    local errs_final
    errs_final="$(json_read errors "$resp")"
    if [[ "$errs_final" == *"exceeded the maximum number of rules in the phase http_ratelimit"* ]]; then
      echo "max-rules-hit: ${description}"
      return 42
    fi
    ensure_success "$resp"
  fi

  if [[ -n "$existing_rule_id" ]]; then
    echo "updated: ${description}"
  else
    echo "created: ${description}"
  fi
}

apply_combined_single_rule() {
  local ruleset_id="$1"
  local entrypoint
  entrypoint="$(cf_api GET "/zones/${CF_ZONE_ID}/rulesets/phases/http_ratelimit/entrypoint")"
  ensure_success "$entrypoint"

  local first_rule_id
  first_rule_id="$(json_read first_rule_id "$entrypoint")"
  if [[ -z "$first_rule_id" ]]; then
    echo "ERROR: cannot apply combined fallback, no existing rule id" >&2
    exit 1
  fi

  local esc_description
  local esc_expression
  esc_description="Global burst protection (single-rule fallback)"
  esc_expression="${COMBINED_EXPR//\"/\\\"}"
  local payload
  payload="$(cat <<JSON
{
  "description": "${esc_description}",
  "expression": "${esc_expression}",
  "action": "block",
  "action_parameters": {
    "response": {
      "status_code": 429,
      "content_type": "application/json",
      "content": "{\"error\":\"RATE_LIMITED\"}"
    }
  },
  "ratelimit": {
    "characteristics": ["cf.colo.id", "ip.src"],
    "period": 10,
    "requests_per_period": 10,
    "mitigation_timeout": 10
  }
}
JSON
)"

  local resp
  resp="$(cf_api PATCH "/zones/${CF_ZONE_ID}/rulesets/${ruleset_id}/rules/${first_rule_id}" "$payload")"
  ensure_success "$resp"
  echo "updated: Global burst protection (single-rule fallback)"
}

run_rule_with_fallback() {
  local ruleset_id="$1"
  local description="$2"
  local expression="$3"
  local rpp="$4"
  local period="$5"
  local timeout="$6"

  set +e
  upsert_rule "$ruleset_id" "$description" "$expression" "$rpp" "$period" "$timeout"
  local rc=$?
  set -e

  if [[ "$rc" -eq 0 ]]; then
    return 0
  fi
  if [[ "$rc" -eq 42 ]]; then
    apply_combined_single_rule "$ruleset_id"
    FORCE_SINGLE_RULE_MODE=1
    return 0
  fi
  return "$rc"
}

resolve_zone_id
echo "Using zone: ${CF_ZONE_ID}"

RULESET_ID="$(get_or_create_entrypoint_ruleset)"
if [[ -z "$RULESET_ID" ]]; then
  echo "ERROR: unable to resolve http_ratelimit entrypoint ruleset id" >&2
  exit 1
fi

echo "Using ruleset: ${RULESET_ID}"

FORCE_SINGLE_RULE_MODE=0

run_rule_with_fallback \
  "$RULESET_ID" \
  "Auth endpoint burst protection" \
  "(http.host eq \"${API_HOST}\" and starts_with(http.request.uri.path, \"/auth/\"))" \
  5 \
  10 \
  10

if [[ "$FORCE_SINGLE_RULE_MODE" -eq 1 ]]; then
  echo "single-rule mode active; skip remaining per-path rules."
  echo "WAF rate limiting rules applied successfully."
  exit 0
fi

run_rule_with_fallback \
  "$RULESET_ID" \
  "Upload endpoint flood protection" \
  "(http.host eq \"${API_HOST}\" and http.request.method eq \"POST\" and starts_with(http.request.uri.path, \"/api/storage/project/\"))" \
  2 \
  10 \
  10
if [[ "$FORCE_SINGLE_RULE_MODE" -eq 1 ]]; then
  echo "single-rule mode active; skip remaining per-path rules."
  echo "WAF rate limiting rules applied successfully."
  exit 0
fi

run_rule_with_fallback \
  "$RULESET_ID" \
  "API write burst protection" \
  "(http.host eq \"${API_HOST}\" and http.request.method in {\"POST\" \"PUT\" \"PATCH\" \"DELETE\"} and (starts_with(http.request.uri.path, \"/api/projects\") or starts_with(http.request.uri.path, \"/api/storage\") or starts_with(http.request.uri.path, \"/api/quality\") or starts_with(http.request.uri.path, \"/api/me\")))" \
  20 \
  10 \
  10

echo "WAF rate limiting rules applied successfully."
