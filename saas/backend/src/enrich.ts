import { Hono } from 'hono'
import { authMiddleware, aiRateLimitMiddleware, Bindings, Variables } from './middleware'
import { getAIProvider } from './utils/ai_provider'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'
import { checkAndDeductCredit } from './utils/credits'
import { buildAiCacheKey, readAiCache, writeAiCache } from './utils/ai_request_cache'
import { calculateBudget, calculateROI, inferProjectTypeFromAnswers, PHASE_LIMITS, type ProjectType } from './utils/calculators'
import { mapIndustryToBenchmarkBucket, normalizeOfficialIndustry } from './utils/industry_classification'

const enrichApp = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false })

interface EnrichRequest {
    question_id: string
    question_text: string
    category: string
    user_answer: string
    // Optional context from other already-answered questions (full state)
    context?: Record<string, string | number | boolean>
}

interface EnrichResponse {
    sufficient: boolean
    is_question?: boolean  // true if the user's answer is a question or expression of confusion
    explanation?: string   // why it's insufficient, or a tutorial if is_question is true
    enriched_answer?: string // the AI-generated richer version, or an auto-drafted example
}

const isDeterministicallyCompleteNumericAnswer = (questionId: string, answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return false

    const normalized = trimmed
        .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
        .replace(/，/g, ',')

    if (questionId === 'customer_validation' && /^(0|零|沒有|無|尚無|目前沒有|目前無|暫無|尚未有|還沒有|尚未訪談|尚未正式訪談|沒有訪談|未訪談|目前沒有訪談|目前尚未訪談)$/u.test(normalized)) {
        return true
    }

    const matched = normalized.match(/-?\d+(?:\.\d+)?/)
    if (!matched) return false

    const numericValue = Number(matched[0])
    if (Number.isNaN(numericValue)) return false

    if (questionId === 'customer_validation') {
        return numericValue >= 0 && numericValue <= 100
    }

    return false
}

const isBudgetEstimateHelpAnswer = (answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return false
    return /不知道怎麼估|不確定怎麼估|我不確定|你幫我估|幫我估|不會估|不太會估|不曉得怎麼估/u.test(trimmed)
}

const isBudgetBreakdownHelpAnswer = (answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return true
    return /不知道怎麼分|不確定怎麼分|你幫我分|幫我分|不知道怎麼配|不確定怎麼配|你幫我改|幫我改|請幫我整理/u.test(trimmed)
}

const inferCoreTeamCount = (context?: Record<string, string | number | boolean>): number => {
    const explicitCompanySize = Number(String(context?.company_size || '').match(/\d+/)?.[0] || '')
    if (!Number.isNaN(explicitCompanySize) && explicitCompanySize > 0) {
        return Math.min(explicitCompanySize, 5)
    }

    const teamComposition = String(context?.team_composition || '')
    if (!teamComposition.trim()) return 1

    const lineCount = teamComposition
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean).length

    if (lineCount > 0) {
        return Math.min(lineCount, 5)
    }

    const numberedMentions = (teamComposition.match(/[1-9][\.)、]/g) || []).length
    if (numberedMentions > 0) {
        return Math.min(numberedMentions, 5)
    }

    return 1
}

const inferValidationNeed = (context?: Record<string, string | number | boolean>): boolean => {
    const customerValidation = Number(String(context?.customer_validation || '').match(/\d+/)?.[0] || '0')
    if (!Number.isNaN(customerValidation) && customerValidation > 0) {
        return true
    }

    const joined = `${String(context?.problem_description || '')} ${String(context?.solution_description || '')} ${String(context?.key_risks || '')}`
    return /驗證|測試|試點|訪談|客戶/u.test(joined)
}

const inferTrlGapAdjustment = (context?: Record<string, string | number | boolean>): number => {
    const currentTrl = Number(String(context?.current_trl || '').match(/\d+/)?.[0] || '0')
    const targetTrl = Number(String(context?.target_trl || '').match(/\d+/)?.[0] || '0')
    if (!currentTrl || !targetTrl) return 0
    const gap = targetTrl - currentTrl
    if (gap >= 2) return 10
    if (gap <= 0) return -5
    return 5
}

const roundBudgetToNearestFive = (value: number): number => {
    return Math.round(value / 5) * 5
}

const buildBudgetTotalCandidateFromContext = (context?: Record<string, string | number | boolean>): EnrichResponse => {
    const { projectType, rationale } = inferProjectTypeFromAnswers(context)
    const coreTeamCount = inferCoreTeamCount(context)
    const hasValidationNeed = inferValidationNeed(context)
    const trlAdjustment = inferTrlGapAdjustment(context)

    const baseBudgetByProjectType: Record<ProjectType, number> = {
        '技術研發': 110,
        '軟體開發': 95,
        '硬體開發': 130,
        '服務創新': 85,
    }

    let estimatedBudget = baseBudgetByProjectType[projectType]

    if (coreTeamCount <= 1) estimatedBudget -= 10
    else if (coreTeamCount >= 4) estimatedBudget += 10

    if (hasValidationNeed) estimatedBudget += 5
    estimatedBudget += trlAdjustment

    const maxBudget = PHASE_LIMITS.phase1.max
    estimatedBudget = Math.min(Math.max(roundBudgetToNearestFive(estimatedBudget), 10), maxBudget)

    const budgetResult = calculateBudget(estimatedBudget, 'phase1', projectType)
    const topAllocationItems = Object.entries(budgetResult.allocations)
        .sort(([, a], [, b]) => b.amount - a.amount)
        .slice(0, 3)
        .map(([name, allocation]) => `${name}（約 ${allocation.amount} 萬）`)

    const rationaleParts = [
        `依目前資料，先以 ${projectType} 型的 Phase 1 驗證案保守估為 ${estimatedBudget} 萬元。`,
        `目前可辨識的核心投入約為 ${coreTeamCount} 位核心成員`,
        hasValidationNeed ? '且已有驗證/測試工作需要納入經費。' : '主要以小規模驗證與方案建置為主。'
    ]

    return {
        sufficient: false,
        is_question: true,
        explanation: '我先依目前已收集的資料替您試算一版保守總經費，您可直接確認或再微調。',
        enriched_answer: [
            String(estimatedBudget),
            `估算基礎：${rationale} ${rationaleParts.join(' ')}`,
            `主要組成：${topAllocationItems.join('、')}。`,
        ].join('\n')
    }
}

const parseBudgetTotalFromContext = (context?: Record<string, string | number | boolean>): number | null => {
    const raw = String(context?.budget_total || '').trim()
    if (!raw) return null
    const firstLine = raw.split('\n')[0]?.trim() || ''
    const matched = firstLine.match(/\d+(?:\.\d+)?/)
    if (!matched) return null
    const numericValue = Number(matched[0])
    if (Number.isNaN(numericValue)) return null
    return numericValue
}

const buildBudgetBreakdownCandidateFromContext = (context?: Record<string, string | number | boolean>): EnrichResponse | null => {
    const totalBudget = parseBudgetTotalFromContext(context)
    if (totalBudget === null) return null

    const { projectType, rationale } = inferProjectTypeFromAnswers(context)
    const budgetResult = calculateBudget(totalBudget, 'phase1', projectType)
    const breakdownLines = Object.entries(budgetResult.allocations).map(([itemName, allocation]) => {
        const percent = Math.round(allocation.ratio * 100)
        return `- ${itemName}：${allocation.amount} 萬（${percent}%）｜${allocation.desc}`
    })

    return {
        sufficient: false,
        is_question: true,
        explanation: `我已依目前的總經費與專案型態先替您整理一版初步經費分配。${rationale}`,
        enriched_answer: [
            `Phase 1 預計總經費：${budgetResult.totalBudget} 萬元`,
            `補助款／自籌款：${budgetResult.subsidy} 萬／${budgetResult.selfFund} 萬`,
            ...breakdownLines,
        ].join('\n')
    }
}

const isRevenueEstimateHelpAnswer = (answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return false
    return /不知道怎麼估|不確定怎麼估|我不確定|你幫我估|幫我估|不會估|不太會估|不曉得怎麼估|不知道怎麼抓|你幫我抓|不知道怎麼算/u.test(trimmed)
}

const buildRevenueCandidateFromContext = (
    questionId: 'expected_revenue_year1' | 'expected_revenue_year2' | 'expected_revenue_year3',
    context?: Record<string, string | number | boolean>
): EnrichResponse | null => {
    const totalBudget = parseBudgetTotalFromContext(context)
    if (totalBudget === null) return null

    const normalizedIndustry = normalizeOfficialIndustry(String(context?.industry || '')) || String(context?.industry || '')
    if (!normalizedIndustry) return null

    const subsidy = Math.min(totalBudget * 0.5, PHASE_LIMITS.phase1.subsidy_max)
    const companyRevenue = Number(String(context?.revenue_last_year || '').match(/\d+(?:\.\d+)?/)?.[0] || '0')
    const roi = calculateROI(subsidy, 'phase1', normalizedIndustry, Number.isNaN(companyRevenue) ? 0 : companyRevenue)
    const yearMap = {
        expected_revenue_year1: roi.yearlyBreakdown[0],
        expected_revenue_year2: roi.yearlyBreakdown[1],
        expected_revenue_year3: roi.yearlyBreakdown[2],
    }
    const currentYear = yearMap[questionId]
    if (!currentYear) return null

    const benchmarkIndustry = mapIndustryToBenchmarkBucket(normalizedIndustry)
    return {
        sufficient: false,
        is_question: true,
        explanation: `我先依目前補助規模、官方產業分類「${normalizedIndustry}」與 ${benchmarkIndustry} 基準，替您試算一版保守營收目標。`,
        enriched_answer: [
            String(Math.round(currentYear.recommended)),
            `估算基礎：以 Phase 1 補助款約 ${subsidy} 萬元，套用 ${benchmarkIndustry} 的保守 ROAS 基準，推得第 ${currentYear.year} 年預估營收約 ${Math.round(currentYear.recommended)} 萬元。`,
            `三年累積產值目標：約 ${Math.round(roi.targetRevenue)} 萬元（ROAS 約 ${roi.targetROAS} 倍）。`,
        ].join('\n')
    }
}

const isStructuredTeamExperienceAnswer = (answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return false
    return (
        trimmed.includes('\n') ||
        /(^|\\s)[1-4][\\.)]/.test(trimmed)
    )
}

const isNegativeTeamExperienceAnswer = (answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return false
    if (isStructuredTeamExperienceAnswer(trimmed)) return false
    if (/^(沒有|無|尚無|目前沒有|目前無|暫無|尚未有|還沒有|無相關經驗|沒有相關經驗|目前沒有相關產業或技術的成功經驗)$/u.test(trimmed)) {
        return true
    }
    return (
        (trimmed.includes('沒有') || trimmed.includes('尚無') || trimmed.includes('目前沒有') || trimmed.includes('無')) &&
        (
            trimmed.includes('成功經驗') ||
            trimmed.includes('相關經驗') ||
            trimmed.includes('相關產業') ||
            trimmed.includes('相關技術')
        )
    )
}

const buildTeamExperienceCandidateFromContext = (context?: Record<string, string | number | boolean>): EnrichResponse | null => {
    if (!context) return null

    const leader = String(context.project_leader || '').trim()
    const teamComposition = String(context.team_composition || '').trim()
    const solutionDescription = String(context.solution_description || '').trim()
    const problemDescription = String(context.problem_description || '').trim()
    const companyName = String(context.company_name || '').trim()

    const capabilitySignals: string[] = []
    if (leader) capabilitySignals.push(`由 ${leader} 擔任計畫核心窗口`)
    if (teamComposition) capabilitySignals.push('團隊已有明確分工與執行角色')
    if (solutionDescription) capabilitySignals.push('已能清楚描述預計交付的解決方案')
    if (problemDescription) capabilitySignals.push('已能明確定義要解決的問題與目標情境')

    const companySubject = companyName ? `${companyName} 團隊` : '目前團隊'
    const gapReason = solutionDescription || problemDescription
        ? `${companySubject} 目前切入的是新的產品化或技術應用情境，與過去經驗並非完全同型，因此尚未累積可直接對應的成功案例。`
        : `${companySubject} 目前正在切入新的題目與應用情境，因此尚未累積可直接對應本案的成功案例。`
    const capabilityEvidence = capabilitySignals.length > 0
        ? capabilitySignals.join('；')
        : '團隊仍具備需求理解、方案規劃、問題拆解與專案推進能力，可作為本案執行的基礎旁證。'
    const feasibility = capabilitySignals.length > 0
        ? `雖然目前沒有直接成功案例，但依現有團隊分工與既有能力，仍具備推進本計畫與逐步補齊驗證的可行性。`
        : '目前仍需補充更多能力旁證，才能更完整說明團隊的執行可行性。'

    return {
        sufficient: false,
        is_question: false,
        explanation: '我先根據現有資料整理一版，您再確認是否符合實際情況。',
        enriched_answer: [
            '1. 經驗現況：目前團隊尚無與本案完全對應的直接成功案例。',
            `2. 缺口原因：${gapReason}`,
            `3. 能力旁證：${capabilityEvidence}`,
            `4. 執行可行性：${feasibility}`,
        ].join('\n')
    }
}

const buildQuestionSpecificPrompt = (questionId: string) => {
    if (questionId === 'current_solutions') {
        return `
針對「目前市場上有哪些解決方案？它們的缺點是什麼？」這一題，請固定使用簡化競品分析框架處理：
1. 市場現在怎麼做
2. 代表方案或競品（至少 1-2 類；若不知道正式品牌名，可用「顧問代寫」「內部自行撰寫」「一般 ERP/MES/CRM 系統」這種方案類型）
3. 每種方案的缺點（成本、導入時間、彈性、客製限制、服務深度、維運負擔，至少擇二）
4. 我們準備切入的缺口

補寫規則：
- 優先用「方案類型」做競品分析，不強求一定知道真實品牌名
- 若使用者回答「不知道、你幫我找」這類求助語句，explanation 要直接教他用上面四段回答
- enriched_answer 必須輸出為 4 段短句或條列，順序固定為：
  1. 現有做法：
  2. 代表方案：
  3. 主要缺點：
  4. 我們切入點：
- 絕對不要虛構特定公司名稱、報價或市佔數據；若沒有已知事實，只能寫「常見做法」「一般方案」「多數顧問服務」這類保守描述
`
    }

    if (questionId === 'team_experience') {
        return `
針對「團隊是否有相關產業或技術的成功經驗？」這一題，請用「經驗現況 / 缺口原因 / 能力旁證 / 執行可行性」四段式整理：
1. 經驗現況：先明確說目前是否已有直接成功案例
2. 缺口原因：若目前沒有，說明為什麼目前沒有直接案例
3. 能力旁證：只能從已知背景資訊中整理可轉移能力、相關作品、客戶成果、技術實績、產業理解、商務經驗或團隊分工
4. 執行可行性：收斂成為何團隊仍有能力推進本計畫

補寫規則：
- 若使用者回答「沒有、尚無、目前沒有」這類明確否定，請不要只回追問；優先根據已知背景生成一版可供確認的候選答案
- enriched_answer 必須輸出為 4 段短句或條列，順序固定為：
  1. 經驗現況：
  2. 缺口原因：
  3. 能力旁證：
  4. 執行可行性：
- 若已知背景不足以支持某段，請明確寫「目前資料不足，需補充」；不要虛構履歷、專利、論文、客戶或成功案例
- explanation 請優先用「我先根據現有資料整理一版，您再確認是否符合實際情況」這種確認語氣，而不是只要求使用者再補充
`
    }

    if (questionId === 'customer_validation') {
        return `
針對「是否訪談過潛在客戶」這一題，請用「訪談現況 / 目前線索 / 下一步驗證」三段式整理：
1. 訪談現況：先明確寫目前已正式訪談幾家；若沒有，請寫 0
2. 目前線索：只能根據已知背景整理目前掌握需求的來源，例如既有客戶對話、銷售經驗、顧問需求、內部痛點
3. 下一步驗證：補一段接下來最合理的訪談或驗證安排

補寫規則：
- 若使用者回答「沒有、尚未訪談、目前沒有訪談」這類語句，請不要只追問，優先整理成「0」加上已知需求線索與下一步驗證的候選答案
- enriched_answer 必須輸出為 3 段短句或條列，順序固定為：
  1. 訪談現況：
  2. 目前線索：
  3. 下一步驗證：
- 不要虛構訪談家數、客戶名稱、訪談紀錄或問卷結果
`
    }

    if (questionId === 'budget_total') {
        return `
針對「Phase 1 預計總經費（萬元）」這一題，請用「總經費 / 估算基礎 / 主要組成」三段式整理：
1. 總經費：先給出一個保守、可接受的總經費數字（萬元）
2. 估算基礎：說明這個數字主要是依哪些工作內容推估，例如人力、顧問協作、系統開發、資料整理、驗證測試
3. 主要組成：點出 2-3 個最大支出項目

補寫規則：
- 若使用者回答「不知道怎麼估、我不確定、你幫我估」這類語句，請不要只追問，優先根據已知背景整理出一版保守候選答案
- enriched_answer 的第一行必須是純數字（萬元），後面可以接換行說明
- 若目前背景不足，請優先採保守估法，不要虛構政府核定金額、補助比例或不存在的規則
- 不要超出目前題目 validation 允許範圍；若推估接近上限，也請在說明中寫明是保守估算
`
    }

    if (questionId === 'budget_breakdown') {
        return `
針對「經費主要用途分配」這一題，請優先依已知總經費與專案型態整理一版完整的經費分配草稿。

補寫規則：
- 若 context 已有 budget_total，請優先根據既有總經費與專案型態，整理出各主要科目的金額與比例
- enriched_answer 請優先使用條列格式，至少列出：人事費、委託研究費，以及其他主要科目
- 不要虛構工時、單價、合作企業數、顧問人數或測試家數
- 若目前缺少 budget_total，就不要自行編數字，直接說明需先確認總經費
`
    }

    if (questionId === 'expected_revenue_year1' || questionId === 'expected_revenue_year2' || questionId === 'expected_revenue_year3') {
        return `
針對「預期營收」這一題，請優先依已知補助規模、產業分類與投資效益基準整理一版保守營收目標。

補寫規則：
- 若 context 已有 budget_total 與 industry，請優先依既有 ROAS 基準整理對應年度的保守營收目標
- 不要虛構市佔率、簽約家數、客單價或市場規模
- enriched_answer 的第一行必須是純數字（萬元），第二行開始才可補估算依據
- 若目前缺少 budget_total 或 industry，請不要自行編造數字，而是直接說明需先補齊總經費與產業分類
`
    }

    if (questionId === 'market_size') {
        return `
針對「你估計的市場規模」這一題，請用「TAM / SAM / SOM / 估算依據」四段式整理：
1. TAM：先描述整體市場範圍，不足時可先寫目前可判定的市場邊界
2. SAM：收斂到本產品目前實際可服務的客群範圍
3. SOM：保守描述初期可取得的市場切入範圍
4. 估算依據：列出目前已知的數據來源、條件、公式或仍缺的關鍵資料

補寫規則：
- 若已有 Tavily 搜尋結果或 context 數據，可以引用整理；若沒有，就先整理框架與保守估法，不要憑空補數字
- enriched_answer 必須輸出為 4 段短句或條列，順序固定為：
  1. TAM：
  2. SAM：
  3. SOM：
  4. 估算依據：
- 若某一段目前資料不足，請直接寫「目前資料不足，需補充」；不要自行杜撰市場規模或成長率
`
    }

    if (questionId === 'technical_barriers') {
        return `
針對「技術門檻／不易複製之處」這一題，請用「核心門檻 / 為何難複製 / 目前證據 / 後續補強」四段式整理：
1. 核心門檻：先點出最主要的技術或營運門檻
2. 為何難複製：說明競爭對手不容易複製的原因
3. 目前證據：只能使用已知背景中的資料、流程、經驗、客戶理解、整合能力或技術堆疊
4. 後續補強：若目前證據還不足，補上接下來應建立哪些門檻

補寫規則：
- 不要把「沒有專利」直接寫成沒有門檻；應優先整理資料、流程、導入 know-how、產業理解、客戶流程整合或執行經驗等可轉移門檻
- enriched_answer 必須輸出為 4 段短句或條列，順序固定為：
  1. 核心門檻：
  2. 為何難複製：
  3. 目前證據：
  4. 後續補強：
- 不要虛構專利號、數據集、演算法名稱或客戶案例
`
    }

    return ''
}

// Map of question IDs → minimum quality criteria for SBIR
import criteriaData from '../../../shared_domain/enrich_criteria.json';

const ENRICHABLE_QUESTIONS: Record<string, { min_chars: number; criteria: string, expand_hint?: string }> = criteriaData.enrichable_questions as any;
const ENRICH_CACHE_TTL_SECONDS = 60 * 30

enrichApp.post('/', authMiddleware, aiRateLimitMiddleware, async (c) => {
    try {
        const body = await c.req.json<EnrichRequest>()
        const { question_id, question_text, category, user_answer, context } = body
        const user = c.get('user')

        // Only process enrichable questions
        const criteria = ENRICHABLE_QUESTIONS[question_id]
        if (!criteria) {
            return c.json<EnrichResponse>({ sufficient: true })
        }

        // Quick pre-check: if the answer is very long, likely sufficient
        if (user_answer.trim().length >= criteria.min_chars * 2) {
            return c.json<EnrichResponse>({ sufficient: true })
        }

        if (isDeterministicallyCompleteNumericAnswer(question_id, user_answer)) {
            return c.json<EnrichResponse>({ sufficient: true })
        }

        if (question_id === 'team_experience' && isNegativeTeamExperienceAnswer(user_answer.trim())) {
            const directCandidate = buildTeamExperienceCandidateFromContext(context)
            if (directCandidate) {
                return c.json<EnrichResponse>(directCandidate)
            }
        }

        if (question_id === 'budget_total' && isBudgetEstimateHelpAnswer(user_answer.trim())) {
            return c.json<EnrichResponse>(buildBudgetTotalCandidateFromContext(context))
        }

        if (question_id === 'budget_breakdown' && isBudgetBreakdownHelpAnswer(user_answer.trim())) {
            const directCandidate = buildBudgetBreakdownCandidateFromContext(context)
            if (directCandidate) {
                return c.json<EnrichResponse>(directCandidate)
            }
        }

        if (
            (question_id === 'expected_revenue_year1' || question_id === 'expected_revenue_year2' || question_id === 'expected_revenue_year3')
            && isRevenueEstimateHelpAnswer(user_answer.trim())
        ) {
            const directCandidate = buildRevenueCandidateFromContext(question_id, context)
            if (directCandidate) {
                return c.json<EnrichResponse>(directCandidate)
            }
        }

        const cacheKey = await buildAiCacheKey('enrich', user.sub, {
            question_id,
            question_text,
            category,
            user_answer,
            context,
        })
        const cachedResponse = await readAiCache<EnrichResponse>(c.env, cacheKey)
        if (cachedResponse) {
            return c.json<EnrichResponse>(cachedResponse)
        }

        let contextStr = context
            ? `\n已知背景資訊（請在生成時參考）：\n${Object.entries(context)
                .filter(([, v]) => v)
                .map(([k, v]) => `- ${k}: ${v}`)
                .join('\n')}`
            : ''

        // (Phase 4) Web Search Integration for Market Size
        if (question_id === 'market_size' && c.env.TAVILY_API_KEY) {
            try {
                const targetMarket = context?.['target_market'] || '台灣';
                const solutionDesc = context?.['solution_description']
                    ? String(context['solution_description']).substring(0, 50)
                    : '創新產品';

                const searchQuery = `${targetMarket} ${solutionDesc} 市場規模 產值 CAGR`;
                console.log(`[enrich] Fetching real market data from Tavily for query: ${searchQuery}`);

                const tavilyRes = await fetch('https://api.tavily.com/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        api_key: c.env.TAVILY_API_KEY,
                        query: searchQuery,
                        search_depth: "basic",
                        include_answer: true,
                        max_results: 3
                    })
                });

                if (tavilyRes.ok) {
                    const tavilyData: any = await tavilyRes.json();
                    if (tavilyData.answer || (tavilyData.results && tavilyData.results.length > 0)) {
                        contextStr += `\n\n【即時聯網市調數據 (Tavily)】\n摘要: ${tavilyData.answer || ''}\n參考文獻:\n${tavilyData.results?.map((r: any) => `- ${r.title}: ${r.content}`).join('\n')}\n`;
                    }
                } else {
                    console.error('[enrich] Tavily search failed:', await tavilyRes.text());
                }
            } catch (e: any) {
                console.error('[enrich] Tavily integration error:', e.message);
            }
        }

        const systemPrompt = `你是一位熟悉政府 SBIR（中小企業創新研發計畫）審查標準的資深顧問。
你的任務是評估使用者對以下問題的回答是否足夠詳實，以通過 SBIR 審查委員的評分。

問題（類別：${category}）：${question_text}

充分標準：${criteria.criteria}
${contextStr}
${buildQuestionSpecificPrompt(question_id)}

請依照以下規則分析：
1. 如果使用者的回答已滿足充分標準，回傳 JSON：{"sufficient": true}
2. 如果使用者的回答不滿足標準（太短、太籠統、缺乏具體數字或細節），請進一步判斷：
   【狀況 A：使用者是在嘗試作答，只是寫得不好】
   - 回傳 JSON：{"sufficient": false, "is_question": false, "explanation": "一句話指出不足", "enriched_answer": "幫他擴寫好的完整草稿"}
   - explanation：用一句話說明不足之處（20字以內，中文，不帶主詞語氣直接說明問題）。
   - enriched_answer：只能整理、重寫、擴寫使用者已經明確提供的內容與已知背景資訊，絕對不可以捏造新事實、虛構數字、虛構客戶、虛構技術名稱、虛構營收或虛構市場規模。若資訊不足，請保留為較保守但完整的整理版本。

   【狀況 B：使用者表示不知道、不懂、求助、或是反問專有名詞（如：不知道、什麼是 TRL、怎麼估算）】
   - 回傳 JSON：{"sufficient": false, "is_question": true, "explanation": "專屬的白話文教學", "enriched_answer": "幫他算好/寫好的完整草稿"}
   - explanation：轉化為「溫柔得體的白話文教學」。請根據背景資訊（產業、公司名稱等），用白話文解釋該題目的專有名詞或意涵（約 50-80 字）。
   - enriched_answer：只能根據使用者已知背景，把目前能確定的資訊整理成較清楚的候選答案；若仍缺關鍵事實，請不要硬補，保留在目前已知範圍內。

規則：
- 必須且只能使用「繁體中文（正體中文, zh-TW）」輸出，絕對不能出現簡體字。
- 只回傳 JSON，不要有任何多餘文字或 markdown 格式
- 如果不確定，傾向回傳 sufficient: false 以確保品質
- enriched_answer 只能基於已知資訊重寫，不能自行補事實`

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `使用者的回答：「${user_answer}」` },
        ]

        const { provider, apiKey } = await getAIProvider(c, user.sub)

        try {
            await checkAndDeductCredit(c, user.sub, provider)
        } catch (e: any) {
            if (e.message === 'OUT_OF_CREDITS') return c.json({ sufficient: false, is_question: false, explanation: '系統配額已用盡', error: 'OUT_OF_CREDITS' }, 403)
            if (e.message === 'USER_NOT_FOUND') return c.json({ sufficient: false, error: 'User not found' }, 404)
            return c.json({ sufficient: false, error: 'Credit check failed' }, 500)
        }

        let rawText = ''

        if (provider === 'cloudflare') {
            const response = await c.env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
                messages,
                max_tokens: 1500,
                temperature: 0.2,
            })
            const aiResult = response as any;
            rawText = aiResult?.choices?.[0]?.message?.content || aiResult?.response || '';
        } else {
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
            const { text } = await generateText({ model, messages: messages as any, temperature: 0.2 });
            rawText = text;
        }

        console.log('[enrich] RAW AI OBJECT used provider:', provider);
        console.log('[enrich] Extracted raw text:', rawText)

        // Extract JSON safely
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
            console.error('[enrich] Failed to find JSON in LLM response');
            return c.json<EnrichResponse>({
                sufficient: false,
                is_question: true,
                explanation: '回答還不夠具體，請再補充一點背景或例子。',
                enriched_answer: user_answer,
            })
        }

        let result: EnrichResponse
        try {
            result = JSON.parse(jsonMatch[0])
        } catch {
            return c.json<EnrichResponse>({
                sufficient: false,
                is_question: true,
                explanation: '回答還不夠具體，請再補充一點背景或例子。',
                enriched_answer: user_answer,
            })
        }

        // Validate shape
        if (typeof result.sufficient !== 'boolean') {
            return c.json<EnrichResponse>({
                sufficient: false,
                is_question: true,
                explanation: '回答還不夠具體，請再補充一點背景或例子。',
                enriched_answer: user_answer,
            })
        }

        if (!result.sufficient && (!result.enriched_answer || typeof result.enriched_answer !== 'string')) {
            result.enriched_answer = user_answer
        }

        await writeAiCache(c.env, {
            cacheKey,
            endpoint: 'enrich',
            userId: user.sub,
            response: result,
            ttlSeconds: ENRICH_CACHE_TTL_SECONDS,
        })

        return c.json(result)
    } catch (err) {
        console.error('[enrich] error:', err)
        return c.json<EnrichResponse>({
            sufficient: false,
            is_question: true,
            explanation: '回答還不夠具體，請再補充一點背景或例子。',
            enriched_answer: '',
        })
    }
})

export default enrichApp
export { ENRICHABLE_QUESTIONS }
