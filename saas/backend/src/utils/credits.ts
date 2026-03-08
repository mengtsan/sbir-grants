import { Context } from 'hono'
import { getAIProvider } from './ai_provider'

export class CreditError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'CreditError'
    }
}

/**
 * Checks if the user has enough credits or is using their own API key (BYOK).
 * If valid and using Cloudflare, deducts 1 credit atomically.
 * Throws CreditError if out of credits.
 */
export async function checkAndDeductCredit(
    c: Context<any>,
    userId: string,
    providerHint?: 'claude' | 'openai' | 'gemini' | 'cloudflare'
): Promise<void> {
    const provider = providerHint ?? (await getAIProvider(c, userId)).provider

    // BYOK flows (Claude, OpenAI, Gemini) are free, do not deduct credits.
    if (provider !== 'cloudflare') {
        return
    }

    // Atomic deduction to avoid race conditions under concurrent requests.
    const deductResult = await c.env.DB.prepare(
        'UPDATE users SET credits = credits - 1 WHERE id = ? AND credits > 0'
    ).bind(userId).run() as { meta?: { changes?: number } }

    if ((deductResult.meta?.changes ?? 0) > 0) {
        return
    }

    const userExists = await c.env.DB.prepare(
        'SELECT 1 FROM users WHERE id = ?'
    ).bind(userId).first() as { '1': number } | null

    if (!userExists) {
        throw new CreditError('USER_NOT_FOUND')
    }
    throw new CreditError('OUT_OF_CREDITS')
}
