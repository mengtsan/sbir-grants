import { Hono } from 'hono'
import { authMiddleware, apiRateLimitMiddleware, Bindings, Variables } from './middleware'
import { deriveCapitalTenThousands, fetchCompanyLookup, logCompanySearchEvent } from './utils/company_lookup'

const companyApp = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false })

companyApp.use('*', authMiddleware)
companyApp.use('*', apiRateLimitMiddleware)

companyApp.get('/search', async (c) => {
    const user = c.get('user')
    const query = c.req.query('q')?.trim() || ''
    const projectId = c.req.query('project_id')?.trim() || null

    if (query.length < 2) {
        return c.json({ error: 'Company query is too short' }, 400)
    }

    try {
        const lookup = await fetchCompanyLookup(c.env, query)
        await logCompanySearchEvent(c.env, {
            userId: user.sub,
            projectId,
            query,
            source: 'wizard_autofill',
            foundCount: lookup.foundCount,
            officialName: lookup.officialName,
        })

        return c.json({
            found: lookup.foundCount,
            from_cache: lookup.fromCache,
            official_name: lookup.officialName,
            capital_ten_thousands: deriveCapitalTenThousands(lookup.activeCompany),
            active_company: lookup.activeCompany,
            data: lookup.payload?.data || [],
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === 'INVALID_COMPANY_QUERY') {
            return c.json({ error: 'Invalid company query' }, 400)
        }
        console.error('[company/search] lookup failed:', message)
        return c.json({ error: 'Company lookup failed' }, 502)
    }
})

export default companyApp
