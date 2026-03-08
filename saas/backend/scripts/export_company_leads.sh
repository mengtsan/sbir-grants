#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is required" >&2
  exit 1
fi

OUTPUT_PATH="${1:-/tmp/company-leads.csv}"

node "$(dirname "$0")/company_leads_report.mjs" \
  --output "${OUTPUT_PATH}" \
  --format csv \
  "${@:2}"
