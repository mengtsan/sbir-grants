import { Bindings } from '../middleware'

const textEncoder = new TextEncoder()

const toHex = (buffer: ArrayBuffer): string =>
    Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')

export const buildAiCacheKey = async (
    endpoint: string,
    userId: string,
    payload: unknown
): Promise<string> => {
    const raw = `${endpoint}:${userId}:${JSON.stringify(payload)}`
    const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(raw))
    return toHex(digest)
}

export async function readAiCache<T>(
    env: Bindings,
    cacheKey: string
): Promise<T | null> {
    const now = Math.floor(Date.now() / 1000)
    const row = await env.DB.prepare(
        `SELECT response_json
         FROM ai_request_cache
         WHERE cache_key = ? AND expires_at > ?`
    ).bind(cacheKey, now).first<{ response_json: string }>()

    if (!row?.response_json) return null

    try {
        return JSON.parse(row.response_json) as T
    } catch (error) {
        console.warn('[ai_cache] Failed to parse cached response', error)
        return null
    }
}

export async function writeAiCache(
    env: Bindings,
    input: {
        cacheKey: string
        endpoint: string
        userId: string
        response: unknown
        ttlSeconds: number
    }
) {
    const now = Math.floor(Date.now() / 1000)
    await env.DB.prepare(
        `INSERT INTO ai_request_cache (
            cache_key, user_id, endpoint, response_json, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
            response_json = excluded.response_json,
            created_at = excluded.created_at,
            expires_at = excluded.expires_at`
    ).bind(
        input.cacheKey,
        input.userId,
        input.endpoint,
        JSON.stringify(input.response),
        now,
        now + input.ttlSeconds
    ).run()
}
