import { Bindings } from '../middleware'

const COMPANY_LOOKUP_TTL_SECONDS = 60 * 60 * 24 * 30
const G0V_SEARCH_ENDPOINT = 'https://company.g0v.ronny.tw/api/search'

export interface CompanyLookupResult {
    fromCache: boolean
    normalizedQuery: string
    payload: any
    activeCompany: Record<string, any> | null
    officialName: string | null
    foundCount: number
}

const normalizeCompanyQuery = (query: string): string => {
    return query.trim().replace(/\s+/g, ' ').slice(0, 120)
}

const getActiveCompany = (payload: any): Record<string, any> | null => {
    const companies = Array.isArray(payload?.data) ? payload.data : []
    const active = companies.find((company: Record<string, any>) =>
        company['公司狀況'] === '核准設立' ||
        company['現況'] === '核准設立' ||
        company['登記現況'] === '核准設立'
    )
    return active || companies[0] || null
}

const getOfficialName = (company: Record<string, any> | null): string | null => {
    if (!company) return null
    return company['公司名稱'] || company['商業名稱'] || null
}

export const deriveCapitalTenThousands = (company: Record<string, any> | null): string | null => {
    if (!company) return null
    const capitalRaw = company['資本總額(元)'] || company['實收資本額(元)'] || company['資本額(元)']
    if (!capitalRaw) return null
    const capitalNum = parseInt(String(capitalRaw).replace(/,/g, ''), 10)
    if (Number.isNaN(capitalNum) || capitalNum <= 0) return null
    return String(Math.floor(capitalNum / 10000))
}

const parseCompanyPayload = (rawPayload: string | null): any | null => {
    if (!rawPayload) return null
    try {
        return JSON.parse(rawPayload)
    } catch (error) {
        console.warn('[company_lookup] Failed to parse cached payload', error)
        return null
    }
}

export async function logCompanySearchEvent(
    env: Bindings,
    input: {
        userId: string
        projectId?: string | null
        query: string
        source: string
        foundCount: number
        officialName?: string | null
    }
) {
    await env.DB.prepare(
        `INSERT INTO company_search_events (
            id, user_id, project_id, query, normalized_query, source, found_count, official_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        crypto.randomUUID(),
        input.userId,
        input.projectId || null,
        input.query,
        normalizeCompanyQuery(input.query),
        input.source,
        input.foundCount,
        input.officialName || null
    ).run()
}

export async function fetchCompanyLookup(
    env: Bindings,
    query: string
): Promise<CompanyLookupResult> {
    const normalizedQuery = normalizeCompanyQuery(query)
    if (!normalizedQuery || normalizedQuery.length < 2) {
        throw new Error('INVALID_COMPANY_QUERY')
    }

    const now = Math.floor(Date.now() / 1000)
    const cached = await env.DB.prepare(
        `SELECT response_json, found_count, official_name
         FROM company_search_cache
         WHERE normalized_query = ? AND expires_at > ?`
    ).bind(normalizedQuery, now).first<{
        response_json: string | null
        found_count: number | null
        official_name: string | null
    }>()

    if (cached?.response_json) {
        const payload = parseCompanyPayload(cached.response_json)
        if (payload) {
            const activeCompany = getActiveCompany(payload)
            return {
                fromCache: true,
                normalizedQuery,
                payload,
                activeCompany,
                officialName: cached.official_name || getOfficialName(activeCompany),
                foundCount: cached.found_count || (Array.isArray(payload?.data) ? payload.data.length : 0),
            }
        }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort('company lookup timeout'), 8000)
    try {
        const response = await fetch(`${G0V_SEARCH_ENDPOINT}?q=${encodeURIComponent(normalizedQuery)}&page=0`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'SBIR-Cloud/1.0'
            },
            signal: controller.signal,
        })

        if (!response.ok) {
            const bodyText = await response.text()
            throw new Error(`COMPANY_LOOKUP_FAILED:${response.status}:${bodyText}`)
        }

        const payload = await response.json() as any
        const activeCompany = getActiveCompany(payload)
        const officialName = getOfficialName(activeCompany)
        const foundCount = Array.isArray(payload?.data) ? payload.data.length : 0

        await env.DB.prepare(
            `INSERT INTO company_search_cache (
                normalized_query, response_json, found_count, official_name, fetched_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(normalized_query) DO UPDATE SET
                response_json = excluded.response_json,
                found_count = excluded.found_count,
                official_name = excluded.official_name,
                fetched_at = excluded.fetched_at,
                expires_at = excluded.expires_at`
        ).bind(
            normalizedQuery,
            JSON.stringify(payload),
            foundCount,
            officialName,
            now,
            now + COMPANY_LOOKUP_TTL_SECONDS
        ).run()

        return {
            fromCache: false,
            normalizedQuery,
            payload,
            activeCompany,
            officialName,
            foundCount,
        }
    } finally {
        clearTimeout(timeout)
    }
}
