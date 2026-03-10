import { Hono } from 'hono'
import { authMiddleware, aiRateLimitMiddleware, Bindings, Variables } from './middleware'
import { getAIProvider } from './utils/ai_provider'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'
import { checkAndDeductCredit } from './utils/credits'
import { buildAiCacheKey, readAiCache, writeAiCache } from './utils/ai_request_cache'
import { normalizeProjectAnswerValue } from './utils/project_answer_status'

const extractApp = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false })

interface UnansweredQuestion {
    id: string
    question: string
    category: string
    type?: 'text' | 'choice' | 'number' | 'textarea' | 'scale'
    options?: string[]
    scale?: {
        min: number
        max: number
    }
}

interface ExtractedAnswer {
    question_id: string
    extracted_answer: string
}

const EXTRACT_CACHE_TTL_SECONDS = 60 * 30

extractApp.post('/', authMiddleware, aiRateLimitMiddleware, async (c) => {
    try {
        const body = await c.req.json<{
            user_input: string
            unanswered_questions: UnansweredQuestion[]
        }>()

        const { user_input, unanswered_questions } = body

        if (!user_input || !unanswered_questions || unanswered_questions.length === 0) {
            return c.json({ extracted: [] })
        }

        const user = c.get('user')
        const cacheKey = await buildAiCacheKey('extract', user.sub, {
            user_input,
            unanswered_questions,
        })
        const cachedResponse = await readAiCache<{ extracted: ExtractedAnswer[] }>(c.env, cacheKey)
        if (cachedResponse) {
            return c.json(cachedResponse)
        }

        // Build a terse questions list for the prompt
        const questionsList = unanswered_questions
            .map((q) => {
                const choiceHint = q.type === 'choice' && q.options?.length
                    ? ` | 可用選項: ${q.options.join('、')}`
                    : ''
                const numericHint = q.type === 'number'
                    ? ' | 答案型別: number（只能輸出數字）'
                    : q.type === 'scale'
                        ? ` | 答案型別: scale（只能輸出 ${q.scale?.min ?? 1}-${q.scale?.max ?? 10} 的數字）`
                        : ''
                return `- ID: "${q.id}" | 類別: ${q.category} | 題型: ${q.type ?? 'text'} | 問題: ${q.question}${choiceHint}${numericHint}`
            })
            .join('\n')

        const systemPrompt = `你是一個精準的 SBIR 計畫書資料萃取引擎。
你的任務：分析使用者說的一段話，判斷它是否隱含地回答了以下問題清單中的一題或多題。

問題清單 (請嚴格依照 ID 回傳結果)：
${questionsList}

規則：
1. 如果使用者的話「明確能推斷」某題的答案，就為該題擷取內容。
2. 題型若為 text 或 textarea，請根據使用者上下文整理成一句語意完整、專業順暢的正式段落。
3. 題型若為 number 或 scale，回傳值只能是數字字串，不可以寫成句子、說明或段落。
4. 題型若為 choice，回傳值必須是題目允許的正式選項之一；若無法明確對應，請不要回傳該題。
5. 【極度重要】若使用者的話「無法推斷」某題答案，您『絕對不可以』將該題號放入 JSON 陣列中！絕不允許回傳「無提及」、「未說明」、「不適用」等無效字眼。JSON 陣列中只能出現『真正有被回答』的題目。對於沒提到的題目，請完全忽略。
6. 你的回傳格式必須且只能是一個 JSON Array，格式如下：
   [{"question_id": "q1", "extracted_answer": "萃取出的答案"}]
7. 若沒有任何問題被回答，回傳空陣列 []。
8. 絕對不要輸出任何額外的文字、說明、markdown 格式或符號。只輸出 JSON。
9. 提取出的文字若需轉換或補齊，必須嚴格確保使用「繁體中文（正體中文, zh-TW）」，不可出現簡體字。`

        const messages: any[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `使用者說：「${user_input}」` },
        ]

        const { provider, apiKey } = await getAIProvider(c, user.sub)

        try {
            await checkAndDeductCredit(c, user.sub, provider)
        } catch (e: any) {
            if (e.message === 'OUT_OF_CREDITS') return c.json({ extracted: [], error: 'OUT_OF_CREDITS' }, 403)
            if (e.message === 'USER_NOT_FOUND') return c.json({ extracted: [], error: 'User not found' }, 404)
            return c.json({ extracted: [], error: 'Credit check failed' }, 500)
        }

        let rawText = '';

        if (provider === 'cloudflare') {
            // Call Qwen3 for structured output (locked model)
            const response = await c.env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
                messages,
                max_tokens: 1024,
                temperature: 0.1, // Low temperature for deterministic, structured output
            });

            // Support both OpenAI-style completions (Qwen) and flat response strings
            const aiResult = response as any;
            rawText = aiResult?.choices?.[0]?.message?.content || aiResult?.response || '';
            console.log('[extract] CF AI used.');
        } else {
            // BYOK Logic via Vercel AI SDK
            let model: any = null;
            if (provider === 'claude') {
                const anthropic = createAnthropic({ apiKey: apiKey! });
                model = anthropic('claude-3-5-sonnet-latest');
            } else if (provider === 'openai') {
                const openai = createOpenAI({ apiKey: apiKey! });
                model = openai('gpt-4o');
            } else if (provider === 'gemini') {
                const google = createGoogleGenerativeAI({ apiKey: apiKey! });
                model = google('gemini-1.5-pro');
            }

            console.log(`[extract] USING BYOK: ${provider}`);
            // Generate non-streaming text
            const { text } = await generateText({
                model,
                messages,
                temperature: 0.1,
            });
            rawText = text;
        }

        console.log('[extract] Extracted raw text:', rawText);

        // Robustly parse JSON from the response (strip any accidental markdown fences)
        const jsonMatch = rawText.match(/\[[\s\S]*\]/)
        if (!jsonMatch) {
            // Model returned nothing useful – treat as no matches
            return c.json({ extracted: [] })
        }

        let extracted: ExtractedAnswer[] = []
        try {
            extracted = JSON.parse(jsonMatch[0])
        } catch {
            // Parsing failed – safe fallback
            return c.json({ extracted: [] })
        }

        // Sanitise: only keep entries that reference valid question IDs we sent
        const validQuestions = new Map(unanswered_questions.map((q) => [q.id, q]))
        const validIds = new Set(unanswered_questions.map((q) => q.id))
        const invalidPhrases = ['無明確', '未提到', '未提供', '無提及', '未說明', '不適用', '無法推斷', '沒有提及', '沒有提供'];

        const sanitised = extracted.filter(
            (item) => {
                if (!item.question_id || typeof item.question_id !== 'string' || !validIds.has(item.question_id)) return false;
                if (!item.extracted_answer || typeof item.extracted_answer !== 'string') return false;

                const question = validQuestions.get(item.question_id)
                const answer = item.extracted_answer.trim();

                // Drop if it's too short to be a real answer
                if ((!question || question.type === 'text' || question.type === 'textarea') && answer.length < 5) return false;

                // Drop if the AI hallucinated a "not mentioned" response despite instructions
                for (const phrase of invalidPhrases) {
                    if (answer.includes(phrase)) {
                        console.log(`[extract] Dropped hallucinated answer for ${item.question_id}: "${answer}"`);
                        return false;
                    }
                }

                if (!question) return false

                if (question.type === 'number' || question.type === 'scale') {
                    const normalized = normalizeProjectAnswerValue(question.id, answer)
                    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
                        console.log(`[extract] Dropped non-numeric answer for ${item.question_id}: "${answer}"`)
                        return false
                    }
                    item.extracted_answer = normalized
                    return true
                }

                if (question.type === 'choice') {
                    const normalized = normalizeProjectAnswerValue(question.id, answer)
                    if (!question.options?.includes(normalized)) {
                        console.log(`[extract] Dropped invalid choice answer for ${item.question_id}: "${answer}"`)
                        return false
                    }
                    item.extracted_answer = normalized
                    return true
                }

                return true
            }
        )

        const responsePayload = { extracted: sanitised }
        await writeAiCache(c.env, {
            cacheKey,
            endpoint: 'extract',
            userId: user.sub,
            response: responsePayload,
            ttlSeconds: EXTRACT_CACHE_TTL_SECONDS,
        })

        return c.json(responsePayload)
    } catch (err) {
        console.error('[extract] error:', err)
        return c.json({ extracted: [], error: 'Extraction failed' }, 500)
    }
})

export default extractApp
