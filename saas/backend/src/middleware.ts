import { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'

export type Bindings = {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  JWT_SECRET: string
  DATA_ENCRYPTION_KEY?: string
  TURNSTILE_SECRET_KEY: string
  FRONTEND_URL: string
  sbir_saas_bucket: R2Bucket
  AI: any
  VECTORIZE: any
  DOC_QUEUE: Queue
  TAVILY_API_KEY?: string
  AUTH_RATE_LIMITER?: RateLimit
  API_RATE_LIMITER?: RateLimit
  AI_RATE_LIMITER?: RateLimit
  UPLOAD_RATE_LIMITER?: RateLimit
}

export type Variables = {
  user: {
    sub: string;
    email: string;
    name: string;
    exp: number;
  }
}

export const authMiddleware = async (c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) => {
  const token = getCookie(c, 'auth_session')
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as Variables['user']
    c.set('user', payload)
    await next()
  } catch (e) {
    return c.json({ error: 'Invalid or expired session' }, 401)
  }
}

const applyRateLimit = async (
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  limiter: RateLimit | undefined,
  actor: string,
  scope: string,
  pathKey: string
) => {
  if (!limiter) return null
  try {
    const key = `${scope}:${actor}:${pathKey}`
    const result = await limiter.limit({ key })
    if (!result.success) {
      console.warn('[RATE_LIMIT] blocked', { actor, pathKey, scope })
      return c.json({ error: 'RATE_LIMITED' }, 429)
    }
  } catch (error) {
    // Fail-closed on limiter errors to avoid bypass under attack conditions.
    console.error('[RATE_LIMIT] failure (fail-closed):', { scope, actor, pathKey, error })
    return c.json({ error: 'RATE_LIMIT_UNAVAILABLE' }, 503)
  }
  return null
}

const normalizePathKey = (path: string): string => {
  if (path.startsWith('/auth/')) return '/auth/*'
  if (path.startsWith('/api/storage/project/')) return '/api/storage/project/*'
  if (path.startsWith('/api/projects')) return '/api/projects*'
  if (path.startsWith('/api/storage')) return '/api/storage*'
  if (path.startsWith('/api/quality')) return '/api/quality*'
  if (path.startsWith('/api/me')) return '/api/me*'
  return path
}

export const authRateLimitMiddleware = async (
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
) => {
  const ip = c.req.header('CF-Connecting-IP') || 'unknown-ip'
  const path = new URL(c.req.url).pathname
  const pathKey = normalizePathKey(path)
  const blocked = await applyRateLimit(c, c.env.AUTH_RATE_LIMITER, ip, 'auth', pathKey)
  if (blocked) return blocked
  await next()
}

export const apiRateLimitMiddleware = async (
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
) => {
  const user = c.get('user')
  const ip = c.req.header('CF-Connecting-IP') || 'unknown-ip'
  const actor = user?.sub || ip
  const path = new URL(c.req.url).pathname
  const pathKey = normalizePathKey(path)
  const blocked = await applyRateLimit(c, c.env.API_RATE_LIMITER, actor, 'api', pathKey)
  if (blocked) return blocked
  await next()
}

export const aiRateLimitMiddleware = async (
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
) => {
  const user = c.get('user')
  const ip = c.req.header('CF-Connecting-IP') || 'unknown-ip'
  const actor = user?.sub || ip
  const path = new URL(c.req.url).pathname
  const pathKey = normalizePathKey(path)
  const blocked = await applyRateLimit(c, c.env.AI_RATE_LIMITER, actor, 'ai', pathKey)
  if (blocked) return blocked

  await next()
}

export const uploadRateLimitMiddleware = async (
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next
) => {
  const user = c.get('user')
  const ip = c.req.header('CF-Connecting-IP') || 'unknown-ip'
  const actor = user?.sub || ip
  const path = new URL(c.req.url).pathname
  const pathKey = normalizePathKey(path)
  const blocked = await applyRateLimit(c, c.env.UPLOAD_RATE_LIMITER, actor, 'upload', pathKey)
  if (blocked) return blocked
  await next()
}
