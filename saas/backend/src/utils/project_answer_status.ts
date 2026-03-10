import questionsData from '../data/questions.json'
import { normalizeOfficialIndustry, splitOfficialIndustry } from './industry_classification'
import { inferProjectTypeFromAnswers } from './calculators'

type RawAnswerMap = Record<string, string>
type CandidateAnswerMap = Record<string, string>
type AnswerMetadataMap = Record<string, {
    answer_source: string
    confirmed_by_user: boolean
    confirmed_at?: string | null
    raw_answer_text?: string | null
}>
type CandidateMetadataMap = Record<string, {
    candidate_source: string
    confidence?: number | null
    candidate_reason?: string | null
    candidate_source_detail?: string | null
}>

interface QuestionValidation {
    min_length?: number
    max_length?: number
    min?: number
    max?: number
}

interface QuestionDependency {
    question_id: string
    condition: string
}

interface QuestionDefinition {
    id: string
    category: string
    order: number
    question: string
    required: boolean
    type: 'text' | 'choice' | 'number' | 'textarea' | 'scale'
    options?: string[]
    validation?: QuestionValidation
    scale?: {
        min: number
        max: number
        labels?: Record<string, string>
    }
    depends_on?: QuestionDependency
}

export interface QuestionStatusItem {
    id: string
    category: string
    order: number
    question: string
    required: boolean
    active: boolean
    status: 'missing' | 'partial' | 'confirmed'
    answer: string
    reason?: string
    completion_hint?: string
    answer_source?: string
    confirmed_by_user?: boolean
    confirmed_at?: string | null
    raw_answer?: string | null
    candidate_text?: string
    candidate_source?: string
    candidate_confidence?: number | null
    candidate_reason?: string | null
    candidate_source_detail?: string | null
    official_option?: { code: string; name: string } | null
}

export interface ProjectAnswerStatusSummary {
    total_questions: number
    active_questions: number
    confirmed_count: number
    partial_count: number
    missing_count: number
    ready: boolean
    next_question_id: string | null
    next_action: 'complete_question' | 'review_candidate' | 'ready_for_draft'
    next_prompt: string | null
    missing_question_ids: string[]
    partial_question_ids: string[]
    candidate_question_ids: string[]
    derived_project_type?: {
        value: string
        rationale: string
    } | null
    industry_resolution?: {
        raw_input: string | null
        official_industry_code: string | null
        official_industry_name: string | null
        industry_source: string | null
    } | null
    items: QuestionStatusItem[]
}

const QUESTIONS = questionsData.questions as QuestionDefinition[]

const EXPLICIT_NEGATIVE_PATTERN = /^(沒有|無|尚無|目前沒有|目前無|暫無|尚未有|還沒有|無相關經驗|沒有相關經驗)$/u
const ZERO_EQUIVALENT_PATTERN = /^(0|零|沒有|無|尚無|目前沒有|目前無|暫無|尚未有|還沒有|尚未訪談|尚未正式訪談|沒有訪談|未訪談|目前沒有訪談|目前尚未訪談)$/u

const isStructuredTeamExperienceAnswer = (answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return false
    return (
        trimmed.includes('\n') ||
        /(^|\s)[1-4][\.\)]/.test(trimmed)
    )
}

const isTeamExperienceNegativeLike = (answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return false
    if (isStructuredTeamExperienceAnswer(trimmed)) return false
    if (EXPLICIT_NEGATIVE_PATTERN.test(trimmed)) return true
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

const isExplicitNegativeAnswer = (questionId: string, answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return false

    return questionId === 'team_experience' && isTeamExperienceNegativeLike(trimmed)
}

const isZeroEquivalentAnswer = (questionId: string, answer: string): boolean => {
    const trimmed = answer.trim()
    if (!trimmed) return false

    if (questionId !== 'customer_validation') return false

    if (ZERO_EQUIVALENT_PATTERN.test(trimmed)) return true

    return (
        (trimmed.includes('沒有') || trimmed.includes('尚未') || trimmed.includes('未')) &&
        trimmed.includes('訪談')
    )
}

const inferChoiceOption = (question: QuestionDefinition, answer: string): string | null => {
    const trimmed = answer.trim()
    if (!trimmed || !question.options?.length) return null
    if (question.options.includes(trimmed)) return trimmed

    const normalized = trimmed.toLowerCase()
    const directMatch = question.options.find((option) => normalized.includes(option.toLowerCase()))
    if (directMatch) return directMatch

    if (question.id === 'industry') {
        const normalizedOfficial = normalizeOfficialIndustry(trimmed)
        if (normalizedOfficial && question.options.includes(normalizedOfficial)) {
            return normalizedOfficial
        }
    }

    if (question.id === 'business_model') {
        const aliasGroups: Array<{ option: string; aliases: string[] }> = [
            { option: '一次性銷售（賣斷）', aliases: ['賣斷', '一次性', '專案制', '一次買斷', '單次收費', '一次收費', '單次付費', '一次付費', '每份收費', '按件收費', '按次收費', '企劃書收費', '接案收費', '課金', '付兩萬', '收兩萬'] },
            { option: '訂閱制（SaaS）', aliases: ['訂閱', 'saas', '月費', '年費', '租用'] },
            { option: '授權金', aliases: ['授權', 'royalty', '權利金'] },
            { option: '混合模式', aliases: ['混合', '都有', '搭配', '雙軌'] },
            { option: '其他', aliases: ['其他'] },
        ]
        const match = aliasGroups.find((group) => group.aliases.some((alias) => normalized.includes(alias)))
        if (match) return match.option

        if ((normalized.includes('收') || normalized.includes('費') || normalized.includes('報價') || normalized.includes('課金') || normalized.includes('付')) &&
            (normalized.includes('企劃書') || normalized.includes('提案') || normalized.includes('專案') || normalized.includes('一次') || normalized.includes('生成'))) {
            return '一次性銷售（賣斷）'
        }
    }

    if (question.id === 'current_trl') {
        const aliasGroups: Array<{ option: string; aliases: string[] }> = [
            { option: 'TRL 1-2：基礎研究', aliases: ['trl1', 'trl 1', 'trl2', 'trl 2', '基礎研究'] },
            { option: 'TRL 3-4：概念驗證', aliases: ['trl3', 'trl 3', 'trl4', 'trl 4', '概念驗證', 'poc'] },
            { option: 'TRL 5-6：原型開發', aliases: ['trl5', 'trl 5', 'trl6', 'trl 6', '原型', '原型開發', '試作'] },
            { option: 'TRL 7-8：系統測試', aliases: ['trl7', 'trl 7', 'trl8', 'trl 8', '系統測試', '場域測試'] },
            { option: 'TRL 9：商業化', aliases: ['trl9', 'trl 9', '商業化', '量產', '上市'] },
        ]
        const match = aliasGroups.find((group) => group.aliases.some((alias) => normalized.includes(alias)))
        if (match) return match.option
    }

    if (question.id === 'target_trl') {
        const aliasGroups: Array<{ option: string; aliases: string[] }> = [
            { option: 'TRL 4：實驗室驗證', aliases: ['trl4', 'trl 4', '實驗室驗證'] },
            { option: 'TRL 5：相關環境驗證', aliases: ['trl5', 'trl 5', '相關環境驗證'] },
            { option: 'TRL 6：原型展示', aliases: ['trl6', 'trl 6', '原型展示', '原型驗證'] },
        ]
        const match = aliasGroups.find((group) => group.aliases.some((alias) => normalized.includes(alias)))
        if (match) return match.option
    }

    return null
}

const QUESTION_HINTS: Record<string, { missing: string; partial?: string }> = {
    company_name: {
        missing: '請先確認公司正式全名，後續公司查核與基本資格都會用到這個名稱。',
    },
    industry: {
        missing: '請先確認公司的主要產業，系統會依官方行業統計分類整理成正式產業大類。',
    },
    project_leader: {
        missing: '請補上計畫主持人的姓名與職稱，讓提案角色與責任分工更清楚。',
    },
    business_model: {
        missing: '請直接說明您是怎麼收費的，例如一次收費、訂閱月費、授權金，或多種模式並行。',
        partial: '請把收費方式整理成正式商業模式，例如一次性銷售、訂閱制、授權金或混合模式。',
    },
    problem_description: {
        missing: '請先說明目前最想解決的問題是什麼、誰最受影響、為什麼現在一定要處理。',
        partial: '目前已提到問題方向，但還缺受影響對象、具體情境或問題後果，請再說得更具體一些。',
    },
    current_solutions: {
        missing: '請用簡單競品分析方式補充：先說市場現在怎麼做，再列 1 到 2 個代表方案，接著寫它們的缺點，最後說明您要切入的缺口。',
        partial: '目前已有部分替代方案，但還缺競品名稱、缺點或您要切入的缺口，請用「現有做法 / 代表方案 / 缺點 / 切入點」補完整。',
    },
    solution_description: {
        missing: '請先講清楚您的解法怎麼運作、服務誰，以及和現行作法相比最大的改善是什麼。',
        partial: '目前已有解法輪廓，但還缺運作方式、使用情境或實際改善效果，請再補充。',
    },
    innovation_points: {
        missing: '請整理出 3 到 5 個創新點，最好能講出哪些地方和既有市場做法明顯不同。',
        partial: '目前已有部分創新點，但還不夠獨立清楚。請把每一點拆開說，避免混在同一句裡。',
    },
    competitive_advantage: {
        missing: '請補上您和競爭對手相比的優勢，最好能說出更快、更省、更準，或更難被模仿的地方。',
        partial: '目前優勢描述還偏抽象，請補上對比基準，說清楚到底贏在哪裡。',
    },
    quantified_benefits: {
        missing: '請補上可量化的效益，例如時間、成本、良率、營收或導入速度等具體數字。',
        partial: '目前提到的效益還不夠量化，請盡量補上百分比、金額、件數或時間縮短幅度。',
    },
    technical_barriers: {
        missing: '請說明競爭對手為什麼不容易複製，例如資料、專利、演算法、Know-how 或導入經驗。',
        partial: '目前有提到技術門檻，但還缺為何難以模仿的原因，請再補具體證據。',
    },
    target_market: {
        missing: '請補上最主要的目標客群，包含產業、規模或導入情境。',
        partial: '目前市場描述還太廣，請再收斂成最想先拿下的一群客戶。',
    },
    market_size: {
        missing: '請補上市場規模的估法，至少先講可服務市場的大概範圍與判斷依據。',
        partial: '目前市場規模已有方向，但缺計算基礎或分母，請再補估算方式。',
    },
    go_to_market: {
        missing: '請說明產品要怎麼進市場，例如誰負責銷售、會先從哪個通路或客群切入。',
        partial: '目前已有初步市場策略，但還缺執行路徑，請再補先從哪一群客戶開始。',
    },
    team_composition: {
        missing: '請補上核心團隊成員與分工，讓執行能力更清楚。',
        partial: '目前有提到團隊，但角色分工還不夠完整，請再補誰負責技術、商務與執行。',
    },
    team_experience: {
        missing: '請補上團隊是否有相關產業或技術的成功經驗。若目前沒有，系統會先幫您整理成一版可接受的說法，再由您確認。',
        partial: '這題還需要補成正式說法。若目前沒有直接成功經驗，系統會依現有資料先整理出原因、旁證與執行可行性版本供您確認。',
    },
    customer_validation: {
        missing: '請補上是否已訪談過潛在客戶，以及實際訪談了幾家。若目前尚未訪談，請直接填 0。',
        partial: '若目前尚未正式訪談，請直接填 0；若已有接觸，請補上實際訪談家數與目前掌握到的需求線索。',
    },
    budget_breakdown: {
        missing: '請補上主要經費怎麼分配，至少先講最大的幾項支出會花在哪裡。',
        partial: '目前已有部分預算方向，但還缺結構，請再補哪幾類支出最重要。',
    },
    revenue_calculation_basis: {
        missing: '請說明營收推估是怎麼算出來的，包含客單價、客戶數或成交假設。',
        partial: '目前已有營收數字，但缺推算邏輯，請再補價格、數量或成交率。',
    },
}

const isQuestionActive = (question: QuestionDefinition, answers: RawAnswerMap): boolean => {
    if (!question.depends_on) return true

    const dependentValue = answers[question.depends_on.question_id]
    if (dependentValue === undefined || dependentValue === null || dependentValue === '') {
        return false
    }

    const condition = question.depends_on.condition
    if (condition === '> 0') {
        return Number(dependentValue) > 0
    }
    if (condition === 'true') {
        return !!dependentValue
    }
    if (condition.startsWith('=')) {
        return String(dependentValue) === condition.replace('=', '').trim()
    }
    return true
}

const buildMissingHint = (question: QuestionDefinition): string => {
    const questionHint = QUESTION_HINTS[question.id]?.missing
    if (questionHint) return questionHint
    if (question.type === 'number' || question.type === 'scale') {
        return `這題還沒補上，請直接提供「${question.category}」所需的數值。`
    }
    if (question.type === 'choice') {
        return `這題還沒確認，請直接選定最符合的「${question.category}」選項。`
    }
    return `這題還沒補齊，請用自己的話先說明「${question.category}」的核心內容。`
}

const buildPartialHint = (question: QuestionDefinition, reason: string, answer = ''): string => {
    const questionHint = QUESTION_HINTS[question.id]?.partial
    if (questionHint) return questionHint
    if (reason.includes('字數不足')) {
        return `目前這題已有初稿，但內容還不夠完整。請再補充「${question.category}」的具體背景、差異或量化細節。`
    }
    if (reason.includes('格式錯誤')) {
        return `這題目前格式不對，請直接提供可計算的數字，讓我能正確整理「${question.category}」。`
    }
    if (reason.includes('數值過小') || reason.includes('數值過大')) {
        return `這題的數值看起來不合理，請再確認一次「${question.category}」的數字。`
    }
    if (reason.includes('選項不合法')) {
        const inferredOption = inferChoiceOption(question, answer)
        const optionsText = question.options?.join('、')
        if (inferredOption) {
            return `您剛剛填的是「${answer.trim()}」，我判斷最接近的選項是「${inferredOption}」。如果判斷正確，請直接改選「${inferredOption}」；若不是，請從 ${optionsText} 中選最接近的一項。`
        }
        if (question.id === 'industry') {
            return `這題需要對應到官方行業統計分類大類。您剛剛填的是「${answer.trim()}」，請改成最接近的正式分類：${optionsText}。`
        }
        return `這題需要對應到固定選項。您剛剛填的是「${answer.trim()}」，請改成最接近的一項：${optionsText}。`
    }
    return `這題已有資料，但還需要再確認或補強，才能作為「${question.category}」的正式內容。`
}

const validateAnswer = (question: QuestionDefinition, answer: string): { status: 'missing' | 'partial' | 'confirmed'; reason?: string; completion_hint?: string } => {
    const trimmed = answer.trim()
    if (!trimmed) {
        return {
            status: question.required ? 'missing' : 'confirmed',
            reason: question.required ? '尚未填寫' : undefined,
            completion_hint: question.required ? buildMissingHint(question) : undefined,
        }
    }

    if (isExplicitNegativeAnswer(question.id, trimmed)) {
        const reason = '已明確表示目前沒有直接成功經驗'
        return { status: 'confirmed', reason }
    }

    if (isZeroEquivalentAnswer(question.id, trimmed)) {
        return { status: 'confirmed' }
    }

    if (question.type === 'text' || question.type === 'textarea') {
        if (question.validation?.min_length && trimmed.length < question.validation.min_length) {
            const reason = `字數不足（至少 ${question.validation.min_length} 字）`
            return { status: 'partial', reason, completion_hint: buildPartialHint(question, reason) }
        }
        if (question.validation?.max_length && trimmed.length > question.validation.max_length) {
            const reason = `字數過長（最多 ${question.validation.max_length} 字）`
            return { status: 'partial', reason, completion_hint: buildPartialHint(question, reason) }
        }
        return { status: 'confirmed' }
    }

    if (question.type === 'number' || question.type === 'scale') {
        const numericValue = Number(trimmed)
        if (Number.isNaN(numericValue)) {
            const reason = '格式錯誤，應為數字'
            return { status: 'partial', reason, completion_hint: buildPartialHint(question, reason) }
        }
        const min = question.type === 'scale' ? question.scale?.min : question.validation?.min
        const max = question.type === 'scale' ? question.scale?.max : question.validation?.max
        if (min !== undefined && numericValue < min) {
            const reason = `數值過小（至少 ${min}）`
            return { status: 'partial', reason, completion_hint: buildPartialHint(question, reason) }
        }
        if (max !== undefined && numericValue > max) {
            const reason = `數值過大（最多 ${max}）`
            return { status: 'partial', reason, completion_hint: buildPartialHint(question, reason) }
        }
        return { status: 'confirmed' }
    }

    if (question.type === 'choice') {
        if (question.options && question.options.length > 0 && !question.options.includes(trimmed)) {
            const inferredOption = inferChoiceOption(question, trimmed)
            if (inferredOption) {
                return { status: 'confirmed' }
            }
            const reason = '選項不合法'
            return { status: 'partial', reason, completion_hint: buildPartialHint(question, reason, trimmed) }
        }
        return { status: 'confirmed' }
    }

    return { status: 'confirmed' }
}

export const normalizeProjectAnswerValue = (questionId: string, rawAnswer: string): string => {
    const question = QUESTIONS.find((item) => item.id === questionId)
    if (!question) return rawAnswer.trim()

    const trimmed = rawAnswer.trim()
    if (!trimmed) return ''

    if (question.type === 'number' || question.type === 'scale') {
        const normalizedNumericText = trimmed
            .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
            .replace(/，/g, ',')
        if (isZeroEquivalentAnswer(question.id, normalizedNumericText)) {
            return '0'
        }
        const matched = normalizedNumericText.match(/-?\d+(?:\.\d+)?/)
        return matched ? matched[0] : trimmed
    }

    if (question.type === 'choice') {
        const inferredOption = inferChoiceOption(question, trimmed)
        return inferredOption || trimmed
    }

    if (question.id === 'team_experience' && isExplicitNegativeAnswer(question.id, trimmed)) {
        return '目前沒有相關產業或技術的成功經驗'
    }

    return trimmed
}

const buildNextPrompt = (
    nextPlan: { next_question_id: string | null; next_action: 'complete_question' | 'review_candidate' | 'ready_for_draft' },
    activeItems: QuestionStatusItem[],
    candidates: CandidateAnswerMap
): string | null => {
    if (!nextPlan.next_question_id) {
        return nextPlan.next_action === 'ready_for_draft'
            ? '29 題已補齊，可以開始生成草稿。'
            : null
    }

    const target = activeItems.find((item) => item.id === nextPlan.next_question_id)
    if (!target) return null

    if (nextPlan.next_action === 'review_candidate' && candidates[target.id]) {
        return `我先根據您前面的描述，整理出一版「${target.category}」候選答案。請確認是否符合，若不夠準再直接補述。`
    }

    if (target.status === 'partial') {
        return target.completion_hint || `「${target.category}」目前已有初稿，但還需要再補強後才能往下。`
    }

    return target.completion_hint || `接下來請先補齊「${target.category}」，我會再幫您整理成正式答案。`
}

const getNextQuestionId = (
    activeItems: QuestionStatusItem[],
    candidates: CandidateAnswerMap
): { next_question_id: string | null; next_action: 'complete_question' | 'review_candidate' | 'ready_for_draft' } => {
    const partialItems = activeItems.filter((item) => item.status === 'partial')
    const missingItems = activeItems.filter((item) => item.status === 'missing')
    const firstCandidatePartial = partialItems.find((item) => !!candidates[item.id])
    if (firstCandidatePartial) {
        return { next_question_id: firstCandidatePartial.id, next_action: 'review_candidate' }
    }
    const firstPartial = partialItems[0]
    if (firstPartial) {
        return { next_question_id: firstPartial.id, next_action: 'complete_question' }
    }
    const firstCandidateMissing = missingItems.find((item) => !!candidates[item.id])
    if (firstCandidateMissing) {
        return { next_question_id: firstCandidateMissing.id, next_action: 'review_candidate' }
    }
    const firstMissing = missingItems[0]
    if (firstMissing) {
        return { next_question_id: firstMissing.id, next_action: 'complete_question' }
    }
    return { next_question_id: null, next_action: 'ready_for_draft' }
}

export const buildProjectAnswerStatusSummary = (
    answers: RawAnswerMap,
    candidates: CandidateAnswerMap = {},
    answerMetadata: AnswerMetadataMap = {},
    candidateMetadata: CandidateMetadataMap = {}
): ProjectAnswerStatusSummary => {
    const items: QuestionStatusItem[] = QUESTIONS
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((question) => {
            const answer = answers[question.id] ?? ''
            const active = isQuestionActive(question, answers)

            if (!active) {
                return {
                    id: question.id,
                    category: question.category,
                    order: question.order,
                    question: question.question,
                    required: question.required,
                    active: false,
                    status: 'confirmed',
                    answer,
                }
            }

            const validation = validateAnswer(question, answer)
            const officialOption = question.id === 'industry' ? splitOfficialIndustry(answer) : null
            return {
                id: question.id,
                category: question.category,
                order: question.order,
                question: question.question,
                required: question.required,
                active: true,
                status: validation.status,
                answer,
                reason: validation.reason,
                completion_hint: validation.completion_hint,
                answer_source: answerMetadata[question.id]?.answer_source,
                confirmed_by_user: answerMetadata[question.id]?.confirmed_by_user,
                confirmed_at: answerMetadata[question.id]?.confirmed_at,
                raw_answer: answerMetadata[question.id]?.raw_answer_text ?? null,
                candidate_text: candidates[question.id],
                candidate_source: candidateMetadata[question.id]?.candidate_source,
                candidate_confidence: candidateMetadata[question.id]?.confidence ?? null,
                candidate_reason: candidateMetadata[question.id]?.candidate_reason ?? null,
                candidate_source_detail: candidateMetadata[question.id]?.candidate_source_detail ?? null,
                official_option: officialOption,
            }
        })

    const activeItems = items.filter((item) => item.active)
    const missingItems = activeItems.filter((item) => item.status === 'missing')
    const partialItems = activeItems.filter((item) => item.status === 'partial')
    const confirmedItems = activeItems.filter((item) => item.status === 'confirmed')
    const nextPlan = getNextQuestionId(activeItems, candidates)
    const industryRaw = answerMetadata.industry?.raw_answer_text ?? null
    const industryOfficial = splitOfficialIndustry(answers.industry || '')
    const projectTypeInference = inferProjectTypeFromAnswers(answers)

    return {
        total_questions: QUESTIONS.length,
        active_questions: activeItems.length,
        confirmed_count: confirmedItems.length,
        partial_count: partialItems.length,
        missing_count: missingItems.length,
        ready: missingItems.length === 0 && partialItems.length === 0,
        next_question_id: nextPlan.next_question_id,
        next_action: nextPlan.next_action,
        next_prompt: buildNextPrompt(nextPlan, activeItems, candidates),
        missing_question_ids: missingItems.map((item) => item.id),
        partial_question_ids: partialItems.map((item) => item.id),
        candidate_question_ids: Object.keys(candidates),
        derived_project_type: answers.industry || answers.solution_description || answers.business_model
            ? {
                value: projectTypeInference.projectType,
                rationale: projectTypeInference.rationale,
            }
            : null,
        industry_resolution: answers.industry || industryRaw
            ? {
                raw_input: industryRaw,
                official_industry_code: industryOfficial?.code ?? null,
                official_industry_name: industryOfficial?.name ?? null,
                industry_source: answerMetadata.industry?.answer_source ?? null,
            }
            : null,
        items,
    }
}

export const loadProjectAnswerMap = async (db: D1Database, projectId: string): Promise<RawAnswerMap> => {
    const answerRows = await db.prepare(
        "SELECT question_id, answer_text FROM project_answers WHERE project_id = ? AND question_id != 'g0v_company_data'"
    ).bind(projectId).all()

    const answers: RawAnswerMap = {}
    for (const row of answerRows.results || []) {
        answers[row.question_id as string] = String(row.answer_text ?? '')
    }
    return answers
}

export const loadProjectAnswerMetadataMap = async (db: D1Database, projectId: string): Promise<AnswerMetadataMap> => {
    const answerRows = await db.prepare(
        'SELECT question_id, answer_source, confirmed_by_user, confirmed_at, raw_answer_text FROM project_answers WHERE project_id = ?'
    ).bind(projectId).all()

    const metadata: AnswerMetadataMap = {}
    for (const row of answerRows.results || []) {
        metadata[row.question_id as string] = {
            answer_source: String(row.answer_source ?? 'user'),
            confirmed_by_user: Number(row.confirmed_by_user ?? 0) === 1,
            confirmed_at: row.confirmed_at ? String(row.confirmed_at) : null,
            raw_answer_text: row.raw_answer_text ? String(row.raw_answer_text) : null,
        }
    }
    return metadata
}

export const loadProjectCandidateMap = async (db: D1Database, projectId: string): Promise<CandidateAnswerMap> => {
    const candidateRows = await db.prepare(
        'SELECT question_id, candidate_text FROM project_answer_candidates WHERE project_id = ?'
    ).bind(projectId).all()

    const candidates: CandidateAnswerMap = {}
    for (const row of candidateRows.results || []) {
        candidates[row.question_id as string] = String(row.candidate_text ?? '')
    }
    return candidates
}

export const loadProjectCandidateMetadataMap = async (db: D1Database, projectId: string): Promise<CandidateMetadataMap> => {
    const candidateRows = await db.prepare(
        'SELECT question_id, candidate_source, confidence, candidate_reason, candidate_source_detail FROM project_answer_candidates WHERE project_id = ?'
    ).bind(projectId).all()

    const metadata: CandidateMetadataMap = {}
    for (const row of candidateRows.results || []) {
        metadata[row.question_id as string] = {
            candidate_source: String(row.candidate_source ?? 'extract'),
            confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
            candidate_reason: row.candidate_reason ? String(row.candidate_reason) : null,
            candidate_source_detail: row.candidate_source_detail ? String(row.candidate_source_detail) : null,
        }
    }
    return metadata
}
