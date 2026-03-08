import { decryptSecret } from './secrets'

export async function getAIProvider(c: any, userId: string): Promise<{
    provider: 'claude' | 'openai' | 'gemini' | 'cloudflare';
    apiKey: string | null;
}> {
    // 1. Fetch user keys from DB
    const userKeys = await c.env.DB.prepare(
        'SELECT claude_key, openai_key, gemini_key FROM users WHERE id = ?'
    ).bind(userId).first()

    // 2. Prioritize BYOK (handle string "null" from SQLite)
    const claudeKey = await decryptSecret(userKeys?.claude_key as string | null | undefined, c.env)
    const openaiKey = await decryptSecret(userKeys?.openai_key as string | null | undefined, c.env)
    const geminiKey = await decryptSecret(userKeys?.gemini_key as string | null | undefined, c.env)

    if (claudeKey) return { provider: 'claude', apiKey: claudeKey }
    if (openaiKey) return { provider: 'openai', apiKey: openaiKey }
    if (geminiKey) return { provider: 'gemini', apiKey: geminiKey }

    // 3. Fallback to Cloudflare Workers AI
    return { provider: 'cloudflare', apiKey: null }
}
