import { useState, useRef, useEffect } from 'react';
import { Send, CheckCircle2, Sparkles, MessageSquare, Edit2, RotateCcw, Zap, Loader2, Wand2, X } from 'lucide-react';
import questionsData from '../data/questions.json';
import axios from 'axios';
import { useParams } from 'react-router-dom';

interface Question {
    id: string;
    category: string;
    question: string;
    order: number;
    type: 'text' | 'choice' | 'number' | 'textarea' | 'scale';
    required: boolean;
    placeholder?: string;
    options?: string[];
    validation?: any;
    scale?: {
        min: number;
        max: number;
        labels?: Record<string, string>;
    };
    depends_on?: any;
}

const questions: Question[] = questionsData.questions as Question[];
const API_ROOT = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : 'https://sbir-api.thinkwithblack.com');

interface AIInterviewerProps {
    initialAnswers?: Record<string, any>;
    initialSuggestions?: Record<string, string>;
    initialSuggestionMeta?: Record<string, {
        candidate_source?: string;
        confidence?: number | null;
        candidate_reason?: string | null;
        candidate_source_detail?: string | null;
    }>;
    focusQuestionId?: string | null;
    onSaveProgress: (
        answerPatch: Record<string, any>,
        options?: { source?: 'user' | 'candidate_adopted' | 'enrich_confirmed' }
    ) => Promise<{
        raw_input?: string;
        answer_text?: string;
        answer_source?: 'user' | 'candidate_adopted' | 'enrich_confirmed';
        normalized?: boolean;
        resolution_note?: string | null;
        answer_map?: Record<string, string>;
        next_question_id?: string | null;
        next_action?: 'complete_question' | 'review_candidate' | 'ready_for_draft';
        missing_question_ids?: string[];
        partial_question_ids?: string[];
        confirmed_count?: number;
        total_questions?: number;
        items?: Array<{
            id: string;
            status: 'missing' | 'partial' | 'confirmed';
        }>;
    } | void>;
    onSaveCandidates?: (
        candidatePatch: Record<string, string | null | {
            text: string;
            source?: string;
            confidence?: number | null;
            reason?: string | null;
            source_detail?: string | null;
        }>
    ) => Promise<{
        answer_candidates?: Record<string, string>;
        answer_candidate_meta?: Record<string, {
            candidate_source?: string;
            confidence?: number | null;
            candidate_reason?: string | null;
            candidate_source_detail?: string | null;
        }>;
    } | void>;
    completionSummary?: {
        confirmed_count: number;
        total_questions: number;
        next_question_id: string | null;
        next_action?: 'complete_question' | 'review_candidate' | 'ready_for_draft';
        next_prompt?: string | null;
        candidate_question_ids?: string[];
        items?: Array<{
            id: string;
            category: string;
            question: string;
            status: 'missing' | 'partial' | 'confirmed';
            completion_hint?: string;
        }>;
    } | null;
}

interface EnrichApiResponse {
    sufficient: boolean;
    is_question?: boolean;
    explanation?: string;
    enriched_answer?: string;
}

interface ExtractApiItem {
    question_id: string;
    extracted_answer: string;
}

const isNegativeTeamExperienceAnswer = (answer: string): boolean => {
    const trimmed = answer.trim();
    if (!trimmed) return false;
    if (
        trimmed.includes('\n') ||
        /(^|\s)[1-4][.)]/.test(trimmed)
    ) {
        return false;
    }

    if (/^(沒有|無|尚無|目前沒有|目前無|暫無|尚未有|還沒有|無相關經驗|沒有相關經驗|目前沒有相關產業或技術的成功經驗)$/u.test(trimmed)) {
        return true;
    }

    return (
        (trimmed.includes('沒有') || trimmed.includes('尚無') || trimmed.includes('目前沒有') || trimmed.includes('無')) &&
        (
            trimmed.includes('成功經驗') ||
            trimmed.includes('相關經驗') ||
            trimmed.includes('相關產業') ||
            trimmed.includes('相關技術')
        )
    );
};

const isBudgetEstimateHelpAnswer = (answer: string): boolean => {
    const trimmed = answer.trim();
    if (!trimmed) return false;
    return /不知道怎麼估|不確定怎麼估|我不確定|你幫我估|幫我估|不會估|不太會估|不曉得怎麼估/u.test(trimmed);
};

const isBudgetBreakdownHelpAnswer = (answer: string): boolean => {
    const trimmed = answer.trim();
    if (!trimmed) return true;
    return /不知道怎麼分|不確定怎麼分|你幫我分|幫我分|不知道怎麼配|不確定怎麼配|你幫我改|幫我改|請幫我整理|不知道怎麼分配|不確定怎麼分配/u.test(trimmed);
};

const isRevenueEstimateHelpAnswer = (answer: string): boolean => {
    const trimmed = answer.trim();
    if (!trimmed) return false;
    return /不知道怎麼估|不確定怎麼估|我不確定|你幫我估|幫我估|不會估|不太會估|不曉得怎麼估|不知道怎麼抓|你幫我抓|不知道怎麼算/u.test(trimmed);
};

const getCandidateSourceLabel = (source?: string) => {
    switch (source) {
        case 'extract':
            return '內容萃取';
        case 'enrich':
            return '顧問補寫';
        case 'g0v':
            return '公司資料';
        default:
            return source || '候選';
    }
};

const isDeterministicallyCompleteScalarAnswer = (question: Question, value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (question.type !== 'number' && question.type !== 'scale') return false;

    const numericValue = Number(trimmed);
    if (Number.isNaN(numericValue)) return false;

    const min = question.type === 'scale' ? question.scale?.min : question.validation?.min;
    const max = question.type === 'scale' ? question.scale?.max : question.validation?.max;

    if (min !== undefined && numericValue < min) return false;
    if (max !== undefined && numericValue > max) return false;

    return true;
};

export default function AIInterviewer({
    initialAnswers = {},
    initialSuggestions = {},
    initialSuggestionMeta = {},
    focusQuestionId = null,
    onSaveProgress,
    onSaveCandidates,
    completionSummary = null,
}: AIInterviewerProps) {
    const { id: projectId } = useParams<{ id: string }>();
    const [answers, setAnswers] = useState<Record<string, any>>(initialAnswers);
    // Determine the first unanswered question based on order
    const firstUnansweredIndex = questions.findIndex(q => !answers[q.id] || answers[q.id].trim() === '');
    const [currentStepIndex, setCurrentStepIndex] = useState(firstUnansweredIndex >= 0 ? firstUnansweredIndex : questions.length);

    const [inputValue, setInputValue] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
    const [aiAutoFilled, setAiAutoFilled] = useState<Set<string>>(new Set());
    const [aiSuggestions, setAiSuggestions] = useState<Record<string, string>>(initialSuggestions); // Store extracted answers as suggestions
    const [aiSuggestionMeta, setAiSuggestionMeta] = useState<Record<string, {
        candidate_source?: string;
        confidence?: number | null;
        candidate_reason?: string | null;
        candidate_source_detail?: string | null;
    }>>(initialSuggestionMeta);
    // Consultant warm acknowledgement messages per question ID
    const [consultantAcks, setConsultantAcks] = useState<Record<string, string>>({});
    const [answerResolutionNotes, setAnswerResolutionNotes] = useState<Record<string, string>>({});
    // Typing indicator: which question the consultant is "typing" a response for
    const [typingForId, setTypingForId] = useState<string | null>(null);
    // Enrich state: when AI suggests a richer answer and is waiting for user to confirm
    const [enrichState, setEnrichState] = useState<{
        questionId: string;
        explanation: string; // shown in consultant bubble
        isQuestion?: boolean;
    } | null>(null);

    // AI Regeneration State
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [showRegenerateInput, setShowRegenerateInput] = useState(false);
    const [regenerateInstruction, setRegenerateInstruction] = useState('');
    const [candidateActionQuestionId, setCandidateActionQuestionId] = useState<string | null>(null);
    const [showAllSuggestions, setShowAllSuggestions] = useState(false);
    const enrichCacheRef = useRef<Map<string, EnrichApiResponse>>(new Map());
    const extractCacheRef = useRef<Map<string, ExtractApiItem[]>>(new Map());
    const regenerateCacheRef = useRef<Map<string, string>>(new Map());

    // IDs of questions where AI quality check is applied
    const ENRICHABLE_IDS = new Set([
        'problem_description', 'current_solutions', 'solution_description',
        'innovation_points', 'quantified_benefits', 'technical_barriers',
        'competitive_advantage', 'key_risks', 'target_market', 'market_size', 'customer_validation',
        'team_composition', 'team_experience', 'budget_total', 'budget_breakdown', 'revenue_calculation_basis',
        'current_trl', 'target_trl',
        'expected_revenue_year1', 'expected_revenue_year2', 'expected_revenue_year3'
    ]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const activeQuestionRef = useRef<HTMLDivElement>(null);

    const resolveNextQuestionIndex = (
        saveResult: {
            next_question_id?: string | null;
            next_action?: 'complete_question' | 'review_candidate' | 'ready_for_draft';
            missing_question_ids?: string[];
            partial_question_ids?: string[];
            answer_map?: Record<string, string>;
            confirmed_count?: number;
            total_questions?: number;
            items?: Array<{
                id: string;
                status: 'missing' | 'partial' | 'confirmed';
            }>;
        } | void,
        persistedAnswers: Record<string, any>
    ) => {
        const directNextId = saveResult?.next_question_id;
        if (directNextId) {
            const nextIndex = questions.findIndex((question) => question.id === directNextId);
            if (nextIndex !== -1) return nextIndex;
        }

        const plannerFallbackId = saveResult?.partial_question_ids?.[0] || saveResult?.missing_question_ids?.[0];
        if (plannerFallbackId) {
            const fallbackIndex = questions.findIndex((question) => question.id === plannerFallbackId);
            if (fallbackIndex !== -1) return fallbackIndex;
        }

        const firstUnresolvedItemId = saveResult?.items?.find((item) => item.status !== 'confirmed')?.id;
        if (firstUnresolvedItemId) {
            const unresolvedIndex = questions.findIndex((question) => question.id === firstUnresolvedItemId);
            if (unresolvedIndex !== -1) return unresolvedIndex;
        }

        if (saveResult?.next_action !== 'ready_for_draft') {
            const firstUnansweredIndex = questions.findIndex((question) => {
                const value = persistedAnswers[question.id];
                return !value || String(value).trim() === '';
            });
            if (firstUnansweredIndex !== -1) return firstUnansweredIndex;
        }

        if (
            saveResult?.confirmed_count !== undefined
            && saveResult?.total_questions !== undefined
            && saveResult.confirmed_count < saveResult.total_questions
        ) {
            const firstNotPersistedIndex = questions.findIndex((question) => {
                const value = persistedAnswers[question.id];
                return !value || String(value).trim() === '';
            });
            if (firstNotPersistedIndex !== -1) return firstNotPersistedIndex;
        }

        return questions.length;
    };

    const suggestionEntries = questions
        .filter((question) => !!aiSuggestions[question.id] && (!answers[question.id] || answers[question.id].trim() === ''))
        .map((question) => ({
            question,
            suggestedAnswer: aiSuggestions[question.id],
        }))
        .sort((a, b) => {
            const nextQuestionId = completionSummary?.next_question_id;
            if (a.question.id === nextQuestionId) return -1;
            if (b.question.id === nextQuestionId) return 1;

            const candidateIds = completionSummary?.candidate_question_ids || [];
            const aCandidateIndex = candidateIds.indexOf(a.question.id);
            const bCandidateIndex = candidateIds.indexOf(b.question.id);
            if (aCandidateIndex !== -1 || bCandidateIndex !== -1) {
                if (aCandidateIndex === -1) return 1;
                if (bCandidateIndex === -1) return -1;
                return aCandidateIndex - bCandidateIndex;
            }

            return a.question.order - b.question.order;
        });

    const candidateLeadText = completionSummary?.next_action === 'review_candidate'
        ? (completionSummary?.next_prompt || '我先幫您整理出幾題可直接確認的候選答案。')
        : '我根據您前面的描述，整理出一些可直接補進專案資料的候選答案。';
    const isFocusedCandidateMode = completionSummary?.next_action === 'review_candidate' && suggestionEntries.length > 0;
    const primarySuggestion = isFocusedCandidateMode ? suggestionEntries[0] : null;
    const secondarySuggestions = isFocusedCandidateMode ? suggestionEntries.slice(1) : [];
    const visibleSuggestionEntries = isFocusedCandidateMode
        ? (showAllSuggestions ? suggestionEntries : primarySuggestion ? [primarySuggestion] : [])
        : suggestionEntries;

    useEffect(() => {
        setAnswers(initialAnswers);
    }, [initialAnswers]);

    useEffect(() => {
        setAiSuggestions(initialSuggestions);
    }, [initialSuggestions]);

    useEffect(() => {
        setAiSuggestionMeta(initialSuggestionMeta);
    }, [initialSuggestionMeta]);

    useEffect(() => {
        setShowAllSuggestions(false);
    }, [completionSummary?.next_question_id, completionSummary?.next_action]);

    useEffect(() => {
        if (!focusQuestionId) return;
        const targetIndex = questions.findIndex((question) => question.id === focusQuestionId);
        if (targetIndex !== -1) {
            setEditingQuestionId(null);
            setCurrentStepIndex(targetIndex);
        }
    }, [focusQuestionId]);

    useEffect(() => {
        if (!completionSummary?.next_question_id) {
            if (completionSummary?.confirmed_count === completionSummary?.total_questions) {
                setCurrentStepIndex(questions.length);
            }
            return;
        }
        const nextIndex = questions.findIndex((question) => question.id === completionSummary.next_question_id);
        if (nextIndex !== -1 && nextIndex !== currentStepIndex && !editingQuestionId) {
            setCurrentStepIndex(nextIndex);
        }
    }, [completionSummary, currentStepIndex, editingQuestionId]);

    // --- Warm acknowledgement template bank ---
    // Returns a natural consultant response acknowledging the user's answer
    const generateAck = (question: Question, answer: string): string => {
        const name = answer.trim().split(/[，,、。\s]/)[0]; // rough first-segment extraction
        const acks: Record<string, () => string> = {
            // Company name
            company_name: () => `很高興認識您！「${name}」這個名字我記下了，接下來我需要多了解一下貴公司的產業背景。`,
            applicant_name: () => `謝謝您！${name}，我已記錄下來。`,
            budget_total: () => {
                if (isBudgetEstimateHelpAnswer(answer.trim())) {
                    return '我已先依目前資料替您試算一版保守總經費，之後若要微調經費配置，還可以再回來修改。';
                }
                return '我已記下這筆 Phase 1 預計總經費，接著往下一題。';
            },
            budget_breakdown: () => {
                if (isBudgetBreakdownHelpAnswer(answer.trim())) {
                    return '我已依目前總經費與專案型態，先整理一版初步經費分配，後續若要微調比例仍可再改。';
                }
                return '我已記下目前的經費分配方向，接著往下一題。';
            },
            expected_revenue_year1: () => {
                if (isRevenueEstimateHelpAnswer(answer.trim())) {
                    return '我已依目前補助規模與產業基準，先試算第 1 年保守營收目標，接著往下一題。';
                }
                return '我已記下第 1 年的預期營收，接著往下一題。';
            },
            expected_revenue_year2: () => {
                if (isRevenueEstimateHelpAnswer(answer.trim())) {
                    return '我已依目前補助規模與產業基準，先試算第 2 年保守營收目標，接著往下一題。';
                }
                return '我已記下第 2 年的預期營收，接著往下一題。';
            },
            expected_revenue_year3: () => {
                if (isRevenueEstimateHelpAnswer(answer.trim())) {
                    return '我已依目前補助規模與產業基準，先試算第 3 年保守營收目標，接著往下一題。';
                }
                return '我已記下第 3 年的預期營收，接著往下一題。';
            },
            team_experience: () => {
                if (isNegativeTeamExperienceAnswer(answer.trim())) {
                    return '我先記下您目前沒有直接成功經驗，並已依現有資料整理成一版可接受說法，後續若要微調也可以再回來修改。';
                }
                return `我已先記下團隊在「${question.category}」這部分的背景，接著往下一題。`;
            },
            // Catch-all for short answers
        };
        if (acks[question.id]) return acks[question.id]();

        // Generic warm pools based on category / length
        const shortResponsePhrases = [
            `好的，謝謝您！我已記下關於「${question.category}」的重要資訊。`,
            `了解了！${question.category}這部分對計畫書很關鍵，感謝您的說明。`,
            `謝謝，這些資訊相當有幫助！讓我繼續下一個問題。`,
        ];
        const longResponsePhrases = [
            `非常詳細的說明，謝謝您！我已把這些重點記下來，這對後續撰寫「${question.category}」這段內容會很有幫助。`,
            `感謝您提供這麼完整的背景！${question.category}的脈絡我清楚了，我們繼續。`,
            `您描述得很清晰，謝謝！這對計畫書的完整性有很大的幫助，讓我們接著往下走。`,
        ];
        const pool = answer.length > 30 ? longResponsePhrases : shortResponsePhrases;
        return pool[Math.floor(Math.random() * pool.length)];
    };

    // Auto scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [currentStepIndex, editingQuestionId]);

    const isFinished = currentStepIndex >= questions.length && !editingQuestionId;
    const currentQuestion = editingQuestionId
        ? questions.find(q => q.id === editingQuestionId)
        : questions[currentStepIndex];
    const currentQuestionStatus = currentQuestion
        ? completionSummary?.items?.find((item) => item.id === currentQuestion.id)
        : null;

    useEffect(() => {
        if (currentQuestion && answers[currentQuestion.id]) {
            setInputValue(answers[currentQuestion.id]);
        } else if (currentQuestion && aiSuggestions[currentQuestion.id]) {
            setInputValue(aiSuggestions[currentQuestion.id]);
        } else {
            setInputValue('');
        }
    }, [currentQuestion, answers, editingQuestionId, aiSuggestions]);

    useEffect(() => {
        if (!currentQuestion || isFinished) return;
        activeQuestionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [currentQuestion, isFinished]);

    const handleSend = async () => {
        if (!currentQuestion) return;

        // Basic validation
        if (currentQuestion.required && (!inputValue || inputValue.trim() === '')) {
            alert('此為必填項目，請提供一些資訊。');
            return;
        }

        setIsSaving(true);

        // --- AI Answer Enrichment Check ---
        // Run for enrichable questions, even if editing historical answers, but skip if they are currently confirming a suggested enrichment
        const isEnrichable = ENRICHABLE_IDS.has(currentQuestion.id);
        const isConfirmingEnrichment = enrichState?.questionId === currentQuestion.id;
        const shouldBypassEnrich = isDeterministicallyCompleteScalarAnswer(currentQuestion, inputValue);

        let finalInputValue = inputValue;
        let autoAppliedEnrichment = false;
        let autoAppliedResolutionNote: string | null = null;

        if (isEnrichable && !isConfirmingEnrichment && !shouldBypassEnrich) {
            try {
                setIsExtracting(true);
                // Pass all currently collected answers as context so the AI can use facts like budget limits, team size, etc.
                const ctx = { ...answers };
                const enrichPayload = {
                    question_id: currentQuestion.id,
                    question_text: currentQuestion.question,
                    category: currentQuestion.category,
                    user_answer: inputValue,
                    context: ctx,
                };
                const enrichCacheKey = JSON.stringify(enrichPayload);
                let enrichData = enrichCacheRef.current.get(enrichCacheKey);
                if (!enrichData) {
                    const enrichRes = await axios.post(
                        `${import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : 'https://sbir-api.thinkwithblack.com')}/api/enrich`,
                        enrichPayload,
                        { withCredentials: true }
                    );
                    enrichData = enrichRes.data as EnrichApiResponse;
                    enrichCacheRef.current.set(enrichCacheKey, enrichData);
                }

                if (!enrichData.sufficient && enrichData.enriched_answer) {
                    if (currentQuestion.id === 'team_experience' && isNegativeTeamExperienceAnswer(inputValue)) {
                        finalInputValue = enrichData.enriched_answer;
                        autoAppliedEnrichment = true;
                        autoAppliedResolutionNote = '已依您「目前沒有直接成功經驗」的回答，先整理成可接受的正式版本，並直接接續下一題。';
                    } else if (currentQuestion.id === 'budget_total' && isBudgetEstimateHelpAnswer(inputValue)) {
                        finalInputValue = enrichData.enriched_answer;
                        autoAppliedEnrichment = true;
                        autoAppliedResolutionNote = '已依目前已收集的資料，先替您試算一版保守總經費，後續仍可再微調。';
                    } else if (currentQuestion.id === 'budget_breakdown' && isBudgetBreakdownHelpAnswer(inputValue)) {
                        finalInputValue = enrichData.enriched_answer;
                        autoAppliedEnrichment = true;
                        autoAppliedResolutionNote = '已依目前總經費與專案型態，先整理一版初步經費分配，後續仍可再微調。';
                    } else if (
                        (currentQuestion.id === 'expected_revenue_year1' || currentQuestion.id === 'expected_revenue_year2' || currentQuestion.id === 'expected_revenue_year3')
                        && isRevenueEstimateHelpAnswer(inputValue)
                    ) {
                        finalInputValue = enrichData.enriched_answer;
                        autoAppliedEnrichment = true;
                        autoAppliedResolutionNote = '已依目前補助規模、官方產業分類與投資效益基準，先替您試算一版保守營收目標。';
                    } else {
                    // AI thinks this answer needs more depth.
                    // Pre-fill the input with the enriched version and stay on this question.
                    setEnrichState({
                        questionId: currentQuestion.id,
                        explanation: enrichData.explanation ?? '這個回答可以更詳細一點。',
                        isQuestion: enrichData.is_question,
                    });
                    setAiSuggestions((prev) => ({
                        ...prev,
                        [currentQuestion.id]: enrichData.enriched_answer as string,
                    }));
                    setAiSuggestionMeta((prev) => ({
                        ...prev,
                        [currentQuestion.id]: {
                            candidate_source: 'enrich',
                            confidence: 0.7,
                            candidate_reason: enrichData.explanation ?? '這題內容還不夠完整，我先整理出一版可修改的候選答案。',
                            candidate_source_detail: enrichData.is_question ? 'enrich.question_tutorial' : 'enrich.rewrite',
                        },
                    }));
                    if (onSaveCandidates) {
                        const persistedCandidates = await onSaveCandidates({
                            [currentQuestion.id]: {
                                text: enrichData.enriched_answer,
                                source: 'enrich',
                                confidence: 0.7,
                                reason: enrichData.explanation ?? '這題內容還不夠完整，我先整理出一版可修改的候選答案。',
                                source_detail: enrichData.is_question ? 'enrich.question_tutorial' : 'enrich.rewrite',
                            }
                        });
                        if (persistedCandidates?.answer_candidates) {
                            setAiSuggestions(persistedCandidates.answer_candidates);
                        }
                        if (persistedCandidates?.answer_candidate_meta) {
                            setAiSuggestionMeta(persistedCandidates.answer_candidate_meta);
                        }
                    }
                    setInputValue(enrichData.enriched_answer);
                    setIsSaving(false);
                    setIsExtracting(false);
                    return; // Stop here — wait for user to edit and confirm
                    }
                }
            } catch (enrichErr: any) {
                if (enrichErr.response?.status === 403 && enrichErr.response?.data?.error === 'OUT_OF_CREDITS') {
                    window.dispatchEvent(new CustomEvent('creditsExhausted'));
                    setIsSaving(false);
                    return;
                }
                // Non-critical — continue with the user's original answer
                console.warn('[enrich] quality check skipped:', enrichErr);
            } finally {
                setIsExtracting(false);
            }
        }

        // If we reach here, either: answer is sufficient, or user confirmed enriched version
        // Clear enrich state
        if (isConfirmingEnrichment) setEnrichState(null);

        const newSuggestions = { ...aiSuggestions };
        const newlyAutoFilled = new Set<string>(aiAutoFilled);
        const candidatePatch: Record<string, string | null | {
            text: string;
            source?: string;
            confidence?: number | null;
            reason?: string | null;
            source_detail?: string | null;
        }> = {};

        // --- Phase 11.8: Open Data Integration (g0v API) ---
        if (currentQuestion.id === 'company_name' && finalInputValue.trim()) {
            try {
                setIsExtracting(true);
                const res = await axios.get(`${API_ROOT}/api/company/search`, {
                    params: {
                        q: finalInputValue,
                        project_id: projectId || undefined,
                    },
                    withCredentials: true,
                });
                if (res.data?.found > 0) {
                    const activeCompany = res.data.active_company || res.data.data?.[0];
                    if (activeCompany) {
                        const officialName = res.data.official_name || activeCompany['公司名稱'] || activeCompany['商業名稱'];
                        if (officialName && officialName !== finalInputValue) {
                            finalInputValue = officialName;
                            newlyAutoFilled.add('company_name');
                        }

                        const capitalInTenK = res.data.capital_ten_thousands;
                        if (capitalInTenK && (!answers.capital || String(answers.capital).trim() === '')) {
                            newSuggestions['capital'] = String(capitalInTenK);
                            newlyAutoFilled.add('capital');
                            candidatePatch['capital'] = {
                                text: String(capitalInTenK),
                                source: 'g0v',
                                confidence: 0.95,
                                reason: '已依公司查詢資料自動帶出實收資本額（萬元）。',
                                source_detail: 'company_search.capital_ten_thousands',
                            };
                        }
                    }
                }
            } catch (err) {
                console.warn('[OpenData] Failed to fetch company data', err);
            } finally {
                setIsExtracting(false);
            }
        }

        // Start with the answer the user explicitly typed (or auto-corrected)
        const mergedAnswers = { ...answers, [currentQuestion.id]: finalInputValue };

        // --- Phase 10: Dynamic Knowledge Extraction ---
        if (!editingQuestionId) {
            const unansweredQuestions = questions.filter(
                (q) => q.id !== currentQuestion.id && (!mergedAnswers[q.id] || mergedAnswers[q.id].trim() === '')
            ).map(q => ({
                id: q.id,
                question: q.question,
                category: q.category,
                type: q.type,
                options: q.options,
                scale: q.scale,
            }));

            if (unansweredQuestions.length > 0) {
                try {
                    setIsExtracting(true);
                    const extractPayload = { user_input: finalInputValue, unanswered_questions: unansweredQuestions };
                    const extractCacheKey = JSON.stringify(extractPayload);
                    let extracted = extractCacheRef.current.get(extractCacheKey);
                    if (!extracted) {
                        const extractRes = await axios.post(
                            `${import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : 'https://sbir-api.thinkwithblack.com')}/api/extract`,
                            extractPayload,
                            { withCredentials: true }
                        );
                        extracted = (extractRes.data?.extracted ?? []) as ExtractApiItem[];
                        extractCacheRef.current.set(extractCacheKey, extracted);
                    }
                    extracted = extracted ?? [];
                    if (extracted.length > 0) {
                        const autoFilledLabels: string[] = [];

                        extracted.forEach(({ question_id, extracted_answer }) => {
                            // Only store as suggestion if the user hasn't explicitly answered it yet
                            if (!mergedAnswers[question_id] || mergedAnswers[question_id].trim() === '') {
                                newSuggestions[question_id] = extracted_answer;
                                newlyAutoFilled.add(question_id);
                                const q = questions.find(q => q.id === question_id);
                                if (q) autoFilledLabels.push(`「${q.category}」`);
                            }
                        });

                        extracted.forEach(({ question_id, extracted_answer }) => {
                            if (!mergedAnswers[question_id] || mergedAnswers[question_id].trim() === '') {
                                candidatePatch[question_id] = {
                                    text: extracted_answer,
                                    source: 'extract',
                                    confidence: 0.6,
                                    reason: '這題可由您剛剛的描述直接整理出初稿。',
                                    source_detail: `extract.from.${currentQuestion.id}`,
                                };
                            }
                        });
                    }
                } catch (extractError: any) {
                    if (extractError.response?.status === 403 && extractError.response?.data?.error === 'OUT_OF_CREDITS') {
                        window.dispatchEvent(new CustomEvent('creditsExhausted'));
                        console.warn('[extract] skipped due to OUT_OF_CREDITS');
                    } else {
                        console.warn('[extract] AI extraction skipped:', extractError);
                    }
                } finally {
                    setIsExtracting(false);
                }
            }
        }

        if (Object.keys(candidatePatch).length > 0) {
            setAiSuggestions(newSuggestions);
            setAiAutoFilled(newlyAutoFilled);
            if (onSaveCandidates) {
                const persistedCandidates = await onSaveCandidates(candidatePatch);
                if (persistedCandidates?.answer_candidates) {
                    setAiSuggestions(persistedCandidates.answer_candidates);
                }
                if (persistedCandidates?.answer_candidate_meta) {
                    setAiSuggestionMeta(persistedCandidates.answer_candidate_meta);
                }
            }
        } else if (newlyAutoFilled.size !== aiAutoFilled.size) {
            setAiAutoFilled(newlyAutoFilled);
        }

        try {
            const saveResult = await onSaveProgress(
                { [currentQuestion.id]: finalInputValue },
                { source: isConfirmingEnrichment || autoAppliedEnrichment ? 'enrich_confirmed' : 'user' }
            );
            const persistedAnswers = saveResult?.answer_map || mergedAnswers;
            const persistedAnswerText = saveResult?.answer_text ?? finalInputValue;
            if (onSaveCandidates) {
                const persistedCandidates = await onSaveCandidates({ [currentQuestion.id]: null });
                if (persistedCandidates?.answer_candidates) {
                    setAiSuggestions(persistedCandidates.answer_candidates);
                } else {
                    setAiSuggestions(prev => {
                        const copy = { ...prev };
                        delete copy[currentQuestion.id];
                        return copy;
                    });
                }
                if (persistedCandidates?.answer_candidate_meta) {
                    setAiSuggestionMeta(persistedCandidates.answer_candidate_meta);
                } else {
                    setAiSuggestionMeta(prev => {
                        const copy = { ...prev };
                        delete copy[currentQuestion.id];
                        return copy;
                    });
                }
            }
            setAnswers(persistedAnswers);
            const effectiveResolutionNote = autoAppliedResolutionNote || saveResult?.resolution_note || null;
            if (effectiveResolutionNote) {
                setAnswerResolutionNotes((prev) => ({
                    ...prev,
                    [currentQuestion.id]: effectiveResolutionNote,
                }));
            } else {
                setAnswerResolutionNotes((prev) => {
                    if (!prev[currentQuestion.id]) return prev;
                    const copy = { ...prev };
                    delete copy[currentQuestion.id];
                    return copy;
                });
            }
            setInputValue('');

            if (editingQuestionId) {
                setEditingQuestionId(null);
            } else {
                const ackParts = [generateAck(currentQuestion, persistedAnswerText)];
                if (effectiveResolutionNote) {
                    ackParts.push(effectiveResolutionNote);
                }
                const ackText = ackParts.join('\n\n');
                setTypingForId(currentQuestion.id);
                await new Promise(res => setTimeout(res, 800));
                setConsultantAcks(prev => ({ ...prev, [currentQuestion.id]: ackText }));
                setTypingForId(null);
                await new Promise(res => setTimeout(res, 400));

                setCurrentStepIndex(resolveNextQuestionIndex(saveResult, persistedAnswers));
            }
        } catch (e) {
            console.error('Save failed', e);
            alert('保存失敗，請重試。');
        } finally {
            setIsSaving(false);
        }
    };

    const handleAdoptSuggestion = async (questionId: string) => {
        const suggestion = aiSuggestions[questionId];
        if (!suggestion) return;

        setCandidateActionQuestionId(questionId);
        try {
            const saveSource = aiSuggestionMeta[questionId]?.candidate_source === 'enrich'
                ? 'enrich_confirmed'
                : 'candidate_adopted';
            const saveResult = await onSaveProgress({ [questionId]: suggestion }, { source: saveSource });
            setAnswers(saveResult?.answer_map || { ...answers, [questionId]: saveResult?.answer_text ?? suggestion });
            setAnswerResolutionNotes(prev => {
                const nextNote = saveResult?.resolution_note
                    || '這題已採納顧問整理後的版本，並存成正式答案。';
                return {
                    ...prev,
                    [questionId]: nextNote,
                };
            });
            if (onSaveCandidates) {
                const persistedCandidates = await onSaveCandidates({ [questionId]: null });
                if (persistedCandidates?.answer_candidates) {
                    setAiSuggestions(persistedCandidates.answer_candidates);
                } else {
                    setAiSuggestions(prev => {
                        const copy = { ...prev };
                        delete copy[questionId];
                        return copy;
                    });
                }
                if (persistedCandidates?.answer_candidate_meta) {
                    setAiSuggestionMeta(persistedCandidates.answer_candidate_meta);
                } else {
                    setAiSuggestionMeta(prev => {
                        const copy = { ...prev };
                        delete copy[questionId];
                        return copy;
                    });
                }
            } else {
                setAiSuggestions(prev => {
                    const copy = { ...prev };
                    delete copy[questionId];
                    return copy;
                });
                setAiSuggestionMeta(prev => {
                    const copy = { ...prev };
                    delete copy[questionId];
                    return copy;
                });
            }
            setAiAutoFilled(prev => {
                const copy = new Set(prev);
                copy.add(questionId);
                return copy;
            });
            setCurrentStepIndex(resolveNextQuestionIndex(saveResult, saveResult?.answer_map || { ...answers, [questionId]: saveResult?.answer_text ?? suggestion }));
        } catch (error) {
            console.error('Failed to adopt answer candidate', error);
            alert('採納候選答案失敗。');
        } finally {
            setCandidateActionQuestionId(null);
        }
    };

    const handleDismissSuggestion = async (questionId: string) => {
        setCandidateActionQuestionId(questionId);
        try {
            if (onSaveCandidates) {
                const persistedCandidates = await onSaveCandidates({ [questionId]: null });
                if (persistedCandidates?.answer_candidates) {
                    setAiSuggestions(persistedCandidates.answer_candidates);
                } else {
                    setAiSuggestions(prev => {
                        const copy = { ...prev };
                        delete copy[questionId];
                        return copy;
                    });
                }
                if (persistedCandidates?.answer_candidate_meta) {
                    setAiSuggestionMeta(persistedCandidates.answer_candidate_meta);
                } else {
                    setAiSuggestionMeta(prev => {
                        const copy = { ...prev };
                        delete copy[questionId];
                        return copy;
                    });
                }
            } else {
                setAiSuggestions(prev => {
                    const copy = { ...prev };
                    delete copy[questionId];
                    return copy;
                });
                setAiSuggestionMeta(prev => {
                    const copy = { ...prev };
                    delete copy[questionId];
                    return copy;
                });
            }
            setAiAutoFilled(prev => {
                const copy = new Set(prev);
                copy.delete(questionId);
                return copy;
            });
        } catch (error) {
            console.error('Failed to dismiss answer candidate', error);
            alert('忽略候選答案失敗。');
        } finally {
            setCandidateActionQuestionId(null);
        }
    };

    const handleExpandSuggestion = (questionId: string) => {
        const targetIndex = questions.findIndex((question) => question.id === questionId);
        if (targetIndex === -1) return;
        setEditingQuestionId(null);
        setCurrentStepIndex(targetIndex);
        setConsultantAcks(prev => {
            const copy = { ...prev };
            delete copy[questionId];
            return copy;
        });
    };

    const handleRegenerate = async (prompt?: string) => {
        if (!currentQuestion) return;

        const instructionToUse = prompt || regenerateInstruction;
        if (!instructionToUse.trim()) return;

        setIsRegenerating(true);
        try {
            const regeneratePayload = {
                original_question: currentQuestion.question,
                original_criteria: currentQuestion.validation?.criteria,
                current_draft: inputValue,
                modification_prompt: instructionToUse,
                context: { ...answers, project_id: projectId }
            };
            const regenerateCacheKey = JSON.stringify(regeneratePayload);
            let newText = regenerateCacheRef.current.get(regenerateCacheKey);
            if (!newText) {
                const res = await axios.post(
                    `${import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : 'https://sbir-api.thinkwithblack.com')}/api/regenerate`,
                    regeneratePayload,
                    { withCredentials: true }
                );
                newText = res.data?.regenerated_text;
                if (newText) {
                    regenerateCacheRef.current.set(regenerateCacheKey, newText);
                }
            }

            if (newText) {
                setInputValue(newText);
                setShowRegenerateInput(false);
                setRegenerateInstruction('');

                // Auto-save the rewritten result to the database and global state silently.
                // This ensures if the user immediately switches tabs, the rewrite is not lost.
                try {
                    const saveResult = await onSaveProgress({ [currentQuestion.id]: newText });
                    setAnswers(saveResult?.answer_map || {
                        ...answers,
                        [currentQuestion.id]: saveResult?.answer_text ?? newText,
                    });
                    if (saveResult?.resolution_note) {
                        setAnswerResolutionNotes((prev) => ({
                            ...prev,
                            [currentQuestion.id]: saveResult.resolution_note as string,
                        }));
                    }
                } catch (saveErr) {
                    console.error('[regenerate auto-save] failed:', saveErr);
                }
            }
        } catch (err: any) {
            if (err.response?.status === 403 && err.response?.data?.error === 'OUT_OF_CREDITS') {
                window.dispatchEvent(new CustomEvent('creditsExhausted'));
            } else {
                console.error('[regenerate] failed:', err);
                alert('重新生成失敗，請稍後再試。');
            }
        } finally {
            setIsRegenerating(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // isComposing: true means the user is still in an IME composition (e.g. typing Chinese)
        // We must NOT intercept Enter during composition, or it auto-submits mid-character
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSend();
        }
    };

    // Derived historical QA up to the current point
    // We show all questions that have been answered (in order), 
    // PLUS the current active question if we are not finished
    const historicalQA = questions.filter(q =>
        (answers[q.id] && answers[q.id].trim() !== '') ||
        (editingQuestionId === q.id)
    );

    return (
        <div className="flex flex-col h-[75vh] bg-slate-50 relative rounded-xl border border-slate-200 shadow-sm overflow-hidden">


            {/* Header */}
            <div className="bg-white border-b border-slate-200 p-4 shrink-0 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-slate-800">SBIR 提案顧問</h3>
                        <p className="text-xs text-slate-500">
                            {isFinished
                                ? '訪談完成，可生成草稿'
                                : (completionSummary?.next_prompt || '正在整理您目前的專案資訊，接著補齊下一個關鍵缺口。')}
                        </p>
                    </div>
                </div>
                {!isFinished && (
                    <div className="flex items-center gap-2">
                        {isExtracting && (
                            <div className="flex items-center gap-1.5 text-xs text-indigo-600">
                                <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                                AI 分析中
                            </div>
                        )}
                        <div className="text-xs font-medium bg-slate-100 text-slate-600 px-3 py-1 rounded-full">
                            進度：{completionSummary?.confirmed_count ?? Object.keys(answers).filter(k => answers[k] && answers[k].trim() !== '').length} / {completionSummary?.total_questions ?? questions.length}
                        </div>
                    </div>
                )}
            </div>

            {/* Chat History Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

                {/* Intro message */}
                <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-1">
                        <Sparkles className="w-4 h-4 text-indigo-600" />
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm text-sm text-slate-700 max-w-[85%]">
                        <p>您好！我是您的專屬計畫書撰寫顧問。</p>
                        <p className="mt-2">接下來，我會引導您一步步梳理專案構想。您只需要像平常聊天一樣回答我的問題，我會在背景自動把您的知識切塊並儲存。我們開始吧！</p>
                    </div>
                </div>

                {suggestionEntries.length > 0 && (
                    <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 mt-1">
                            <Zap className="w-4 h-4 text-amber-600" />
                        </div>
                        <div className="bg-white border border-amber-200 rounded-2xl p-4 shadow-sm text-sm text-slate-700 max-w-[92%] flex-1 space-y-4">
                            <div>
                                <div className="font-semibold text-amber-700">我從您剛剛的描述中，額外整理出一些可直接補進去的答案。</div>
                                <div className="text-xs text-slate-500 mt-1">{candidateLeadText}</div>
                            </div>
                            <div className="space-y-3">
                                {visibleSuggestionEntries.map(({ question, suggestedAnswer }, index) => (
                                    <div key={question.id} className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                                        {(() => {
                                            const meta = aiSuggestionMeta[question.id];
                                            if (!meta) return null;
                                            return (
                                                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                                                    {meta.candidate_source && (
                                                        <span className="rounded-full bg-indigo-100 px-2 py-1 font-medium text-indigo-700">
                                                            來源：{getCandidateSourceLabel(meta.candidate_source)}
                                                        </span>
                                                    )}
                                                    {typeof meta.confidence === 'number' && (
                                                        <span className="rounded-full bg-slate-200 px-2 py-1 font-medium text-slate-700">
                                                            信心：{Math.round(meta.confidence * 100)}%
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                        <div className="text-xs font-semibold text-indigo-600 mb-1">{question.category}</div>
                                        <div className="text-sm font-medium text-slate-800 mb-2">{question.question}</div>
                                        {isFocusedCandidateMode && index === 0 && (
                                            <div className="text-xs font-semibold text-amber-700 mb-2">
                                                先確認這一題，系統會再帶您往下一個缺口。
                                            </div>
                                        )}
                                        <div className="text-xs text-slate-500 mb-2">
                                            這是我依照您前面已提供的內容，先整理出的候選版本。確認後才會成為正式答案。
                                        </div>
                                        {aiSuggestionMeta[question.id]?.candidate_reason && (
                                            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                                                顧問判斷：{aiSuggestionMeta[question.id]?.candidate_reason}
                                                {aiSuggestionMeta[question.id]?.candidate_source_detail && (
                                                    <span className="block mt-1 text-[11px] text-amber-700">
                                                        依據：{aiSuggestionMeta[question.id]?.candidate_source_detail}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-white border border-slate-200 rounded-lg p-3">
                                            {suggestedAnswer}
                                        </div>
                                        <div className="flex gap-2 mt-3">
                                            <button
                                                onClick={() => handleAdoptSuggestion(question.id)}
                                                disabled={candidateActionQuestionId === question.id}
                                                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition disabled:opacity-50"
                                            >
                                                採納這個答案
                                            </button>
                                            <button
                                                onClick={() => handleExpandSuggestion(question.id)}
                                                disabled={candidateActionQuestionId === question.id}
                                                className="px-3 py-1.5 bg-white text-slate-700 border border-slate-300 rounded-lg text-xs font-medium hover:bg-slate-50 transition disabled:opacity-50"
                                            >
                                                補述 / 修改
                                            </button>
                                            <button
                                                onClick={() => handleDismissSuggestion(question.id)}
                                                disabled={candidateActionQuestionId === question.id}
                                                className="px-3 py-1.5 bg-white text-slate-500 border border-slate-200 rounded-lg text-xs font-medium hover:bg-slate-50 transition disabled:opacity-50"
                                            >
                                                忽略
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {isFocusedCandidateMode && secondarySuggestions.length > 0 && !showAllSuggestions && (
                                <div className="border border-dashed border-amber-300 rounded-xl p-3 bg-amber-50/60">
                                    <div className="text-xs text-amber-800">
                                        另外還有 {secondarySuggestions.length} 題候選答案已整理好。
                                    </div>
                                    <button
                                        onClick={() => setShowAllSuggestions(true)}
                                        className="mt-2 px-3 py-1.5 bg-white text-amber-700 border border-amber-300 rounded-lg text-xs font-medium hover:bg-amber-50 transition"
                                    >
                                        展開其餘候選答案
                                    </button>
                                </div>
                            )}
                            {isFocusedCandidateMode && secondarySuggestions.length > 0 && showAllSuggestions && (
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => setShowAllSuggestions(false)}
                                        className="px-3 py-1.5 bg-white text-slate-600 border border-slate-300 rounded-lg text-xs font-medium hover:bg-slate-50 transition"
                                    >
                                        收起其餘候選答案
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Dynamic QA Flow */}
                {historicalQA.map((q) => {
                    const isCurrentFocus = editingQuestionId === q.id;
                    const hasAnswer = answers[q.id] && answers[q.id].trim() !== '';

                    return (
                        <div key={q.id} className="space-y-6">
                            {/* Consultant Question */}
                            <div className="flex gap-4">
                                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-1">
                                    <Sparkles className="w-4 h-4 text-indigo-600" />
                                </div>
                                <div className={`border rounded-2xl p-4 shadow-sm text-sm max-w-[85%] ${isCurrentFocus ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'}`}>
                                    <div className="text-xs font-semibold text-indigo-600 mb-1">{q.category}</div>
                                    <div className="text-slate-800 font-medium leading-relaxed whitespace-pre-wrap">
                                        {q.question.replace(/\\n/g, '\n')}
                                    </div>
                                    {q.placeholder && isCurrentFocus && (
                                        <div className="mt-3 text-xs text-slate-500 bg-white/50 p-2 rounded border border-indigo-100">
                                            💡 提示：{q.placeholder}
                                        </div>
                                    )}
                                    {isCurrentFocus && currentQuestionStatus?.completion_hint && (
                                        <div className="mt-3 text-xs text-indigo-700 bg-white/70 p-3 rounded border border-indigo-100 leading-relaxed">
                                            顧問建議：{currentQuestionStatus.completion_hint}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Enrichment explanation bubble — appears when AI has pre-filled a richer answer OR when giving a tutorial */}
                            {isCurrentFocus && enrichState?.questionId === q.id && (
                                <div className="flex gap-4">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${enrichState.isQuestion ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                                        <Sparkles className={`w-4 h-4 ${enrichState.isQuestion ? 'text-emerald-600' : 'text-amber-600'}`} />
                                    </div>
                                    <div className={`border rounded-2xl p-4 shadow-sm text-sm text-slate-700 max-w-[90%] leading-relaxed flex-1 ${enrichState.isQuestion ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                                        <div className={`font-semibold mb-1.5 flex items-center gap-1.5 ${enrichState.isQuestion ? 'text-emerald-700' : 'text-amber-700'}`}>
                                            {enrichState.isQuestion ? (
                                                <><span>🎓</span> 顧問解惑</>
                                            ) : (
                                                <><Zap className="w-3.5 h-3.5" /> 顧問已幫您草擬了一份更專業的版本！</>
                                            )}
                                        </div>
                                        <div className="text-slate-600 text-xs leading-relaxed mb-3">
                                            {enrichState.explanation}
                                            <br />
                                            {enrichState.isQuestion ? (
                                                <div className="mt-2 text-emerald-600 font-medium">✨ 我已經根據您的背景在下方為您預填了一份草稿，您可以直接參考修改！</div>
                                            ) : (
                                                <span className="mt-1 block">您可以直接在下方輸入框修改這份草稿，或者再告訴我大方向重新生成。</span>
                                            )}
                                        </div>


                                    </div>
                                </div>
                            )}

                            {/* User Answer Bubble (if not currently focused) */}
                            {!isCurrentFocus && hasAnswer && (
                                <>
                                    <div className="flex gap-4 flex-row-reverse group">
                                        <div className="w-8 h-8 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center shrink-0 mt-1">
                                            <MessageSquare className="w-4 h-4 text-slate-500" />
                                        </div>
                                        <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm p-4 shadow-sm text-sm max-w-[85%] whitespace-pre-wrap relative">
                                            {aiAutoFilled.has(q.id) && (
                                                <div className="flex items-center gap-1 text-[10px] font-semibold text-indigo-200 mb-1.5">
                                                    {q.id === 'company_name' || q.id === 'capital' ? (
                                                        <>💡 經濟部公開資料同步</>
                                                    ) : (
                                                        <><Zap className="w-2.5 h-2.5" /> AI 自動萃取</>
                                                    )}
                                                </div>
                                            )}
                                            {answers[q.id]}
                                            {answerResolutionNotes[q.id] && (
                                                <div className="mt-2 rounded-lg bg-white/12 px-3 py-2 text-[11px] leading-relaxed text-indigo-100 border border-white/10">
                                                    {answerResolutionNotes[q.id]}
                                                </div>
                                            )}
                                            <button
                                                onClick={() => setEditingQuestionId(q.id)}
                                                className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 rounded-md opacity-0 group-hover:opacity-100 transition"
                                                title="編輯此回答"
                                            >
                                                <Edit2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Consultant typing indicator */}
                                    {typingForId === q.id && (
                                        <div className="flex gap-4">
                                            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-1">
                                                <Sparkles className="w-4 h-4 text-indigo-600" />
                                            </div>
                                            <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm flex items-center gap-1.5">
                                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                        </div>
                                    )}

                                    {/* Consultant warm acknowledgement */}
                                    {consultantAcks[q.id] && typingForId !== q.id && (
                                        <div className="flex gap-4">
                                            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-1">
                                                <Sparkles className="w-4 h-4 text-indigo-600" />
                                            </div>
                                            <div className="bg-white border border-indigo-100 rounded-2xl p-4 shadow-sm text-sm text-slate-700 max-w-[85%] leading-relaxed">
                                                {consultantAcks[q.id]}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}

                {!isFinished && currentQuestion && (
                    <div ref={activeQuestionRef} className="space-y-6">
                        <div className="flex gap-4">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-1">
                                <Sparkles className="w-4 h-4 text-indigo-600" />
                            </div>
                            <div className="border rounded-2xl p-4 shadow-sm text-sm max-w-[85%] bg-indigo-50 border-indigo-200">
                                <div className="text-xs font-semibold text-indigo-600 mb-1">{currentQuestion.category}</div>
                                <div className="text-slate-800 font-medium leading-relaxed whitespace-pre-wrap">
                                    {currentQuestion.question.replace(/\\n/g, '\n')}
                                </div>
                                {currentQuestion.placeholder && (
                                    <div className="mt-3 text-xs text-slate-500 bg-white/50 p-2 rounded border border-indigo-100">
                                        💡 提示：{currentQuestion.placeholder}
                                    </div>
                                )}
                                {currentQuestionStatus?.completion_hint && (
                                    <div className="mt-3 text-xs text-indigo-700 bg-white/70 p-3 rounded border border-indigo-100 leading-relaxed">
                                        顧問建議：{currentQuestionStatus.completion_hint}
                                    </div>
                                )}
                            </div>
                        </div>

                        {enrichState?.questionId === currentQuestion.id && (
                            <div className="flex gap-4">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${enrichState.isQuestion ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                                    <Sparkles className={`w-4 h-4 ${enrichState.isQuestion ? 'text-emerald-600' : 'text-amber-600'}`} />
                                </div>
                                <div className={`border rounded-2xl p-4 shadow-sm text-sm text-slate-700 max-w-[90%] leading-relaxed flex-1 ${enrichState.isQuestion ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                                    <div className={`font-semibold mb-1.5 flex items-center gap-1.5 ${enrichState.isQuestion ? 'text-emerald-700' : 'text-amber-700'}`}>
                                        {enrichState.isQuestion ? (
                                            <><span>🎓</span> 顧問解惑</>
                                        ) : (
                                            <><Zap className="w-3.5 h-3.5" /> 顧問已幫您草擬了一份更專業的版本！</>
                                        )}
                                    </div>
                                    <div className="text-slate-600 text-xs leading-relaxed mb-3">
                                        {enrichState.explanation}
                                        <br />
                                        {enrichState.isQuestion ? (
                                            <div className="mt-2 text-emerald-600 font-medium">✨ 我已經根據您的背景在下方為您預填了一份草稿，您可以直接參考修改！</div>
                                        ) : (
                                            <span className="mt-1 block">您可以直接在下方輸入框修改這份草稿，或者再告訴我大方向重新生成。</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* End State */}
                {isFinished && (
                    <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-1">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        </div>
                        <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm text-sm text-slate-700 max-w-[85%]">
                            <p className="font-semibold text-emerald-700 mb-1">訪談完成！🎉</p>
                            <p>您已提供足夠的背景資訊。如果您對這些答案感到滿意，可以直接切換至上方的 <strong>「AI Draft」</strong> 頁籤，讓我幫您生成完整的計畫書草稿喔！</p>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input Area (Only shows if there is an active question) */}
            {!isFinished && currentQuestion && (
                <div className="bg-white border-t border-slate-200 p-4 shrink-0 shadow-[0_-4px_6px_-2px_rgba(0,0,0,0.02)]">
                    <div className="max-w-4xl mx-auto flex flex-col gap-3">
                        {/* REGENERATE INSTRUCTION BOX */}
                        {showRegenerateInput && (
                            <div className="bg-indigo-50/80 border border-indigo-100 rounded-xl p-3 flex flex-col gap-2 animate-in slide-in-from-bottom-2 fade-in relative shadow-sm">
                                <div className="flex gap-2">
                                    {['更生動口語', '更具體專業', '再精簡強調重點', '改用條列式'].map(chip => (
                                        <button
                                            key={chip}
                                            onClick={() => handleRegenerate(chip)}
                                            disabled={isRegenerating}
                                            className="text-[11px] px-2 py-1 bg-white border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 text-indigo-700 rounded-md transition-colors disabled:opacity-50 shadow-sm"
                                        >
                                            {chip}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex gap-2 items-center">
                                    <Sparkles className="w-4 h-4 text-indigo-500 shrink-0 mx-1" />
                                    <input
                                        autoFocus
                                        type="text"
                                        value={regenerateInstruction}
                                        onChange={e => setRegenerateInstruction(e.target.value)}
                                        placeholder="請輸入給 AI 的修改指示（例如：數值算錯了，請用 USD 699 重新計算）..."
                                        className="flex-1 bg-transparent border-none text-sm focus:outline-none focus:ring-0 placeholder:text-indigo-400 text-indigo-900"
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                                e.preventDefault();
                                                handleRegenerate();
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={() => handleRegenerate()}
                                        disabled={isRegenerating || !regenerateInstruction.trim()}
                                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                                    >
                                        {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : '開始微調'}
                                    </button>
                                </div>
                                <button onClick={() => setShowRegenerateInput(false)} className="absolute -top-2 -right-2 bg-white rounded-full p-1.5 border shadow-sm text-slate-400 hover:text-slate-600 transition-colors">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}

                        <div className="relative flex items-end gap-3">
                            <div className="flex-1 relative">
                                {editingQuestionId && (
                                    <div className="absolute -top-8 left-0 text-xs font-medium text-amber-600 flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-t-lg border border-amber-200 border-b-0">
                                        <RotateCcw className="w-3 h-3" />
                                        正在修改過去的回答
                                    </div>
                                )}
                                {currentQuestion.type === 'scale' && currentQuestion.scale ? (
                                    <div className={`w-full rounded-xl border px-4 py-3 transition
                                        ${enrichState?.questionId === currentQuestion.id
                                            ? enrichState.isQuestion
                                                ? 'border-emerald-300 bg-emerald-50/40 rounded-tl-none'
                                                : 'border-amber-300 bg-amber-50/30 rounded-tl-none'
                                            : editingQuestionId
                                                ? 'rounded-tl-none border-amber-300 bg-amber-50/20'
                                                : 'border-slate-200 bg-slate-50'
                                        }`}>
                                        <div className="grid grid-cols-5 gap-2 md:grid-cols-10">
                                            {Array.from({ length: currentQuestion.scale.max - currentQuestion.scale.min + 1 }, (_, index) => {
                                                const value = String(currentQuestion.scale!.min + index);
                                                const active = inputValue === value;
                                                return (
                                                    <button
                                                        key={value}
                                                        type="button"
                                                        onClick={() => setInputValue(value)}
                                                        className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                                                            active
                                                                ? 'border-indigo-600 bg-indigo-600 text-white'
                                                                : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700'
                                                        }`}
                                                    >
                                                        {value}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                                            <span>{currentQuestion.scale.min}：{currentQuestion.scale.labels?.[String(currentQuestion.scale.min)] || '低'}</span>
                                            <span>{inputValue ? `目前選擇 ${inputValue}` : '請直接點選分數'}</span>
                                            <span>{currentQuestion.scale.max}：{currentQuestion.scale.labels?.[String(currentQuestion.scale.max)] || '高'}</span>
                                        </div>
                                    </div>
                                ) : currentQuestion.type === 'number' ? (
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        disabled={isSaving}
                                        placeholder={currentQuestion.placeholder || '可直接輸入數字；若不確定，也可以直接說不知道怎麼估'}
                                        className={`w-full bg-slate-50 border text-slate-800 text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 transition
                                            ${enrichState?.questionId === currentQuestion.id
                                                ? enrichState.isQuestion
                                                    ? 'border-emerald-300 focus:ring-emerald-500/50 focus:border-emerald-500 bg-emerald-50/40 rounded-tl-none'
                                                    : 'border-amber-300 focus:ring-amber-500/50 focus:border-amber-500 bg-amber-50/30 rounded-tl-none'
                                                : editingQuestionId
                                                    ? 'rounded-tl-none border-amber-300 focus:ring-amber-500/50 focus:border-amber-500 bg-amber-50/20'
                                                    : 'border-slate-200 focus:ring-indigo-500/50 focus:border-indigo-500'
                                            }`}
                                    />
                                ) : (
                                    <textarea
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        disabled={isSaving}
                                        placeholder={currentQuestion.placeholder || (currentQuestion.type === 'choice' && currentQuestion.options ? `例如: ${currentQuestion.options.join(', ')}` : "請輸入您的回答... (Shift + Enter 換行)")}
                                        className={`w-full bg-slate-50 border text-slate-800 text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 transition resize-none
                                            ${enrichState?.questionId === currentQuestion.id
                                                ? enrichState.isQuestion
                                                    ? 'border-emerald-300 focus:ring-emerald-500/50 focus:border-emerald-500 bg-emerald-50/40 rounded-tl-none'
                                                    : 'border-amber-300 focus:ring-amber-500/50 focus:border-amber-500 bg-amber-50/30 rounded-tl-none'
                                                : editingQuestionId
                                                    ? 'rounded-tl-none border-amber-300 focus:ring-amber-500/50 focus:border-amber-500 bg-amber-50/20'
                                                    : 'border-slate-200 focus:ring-indigo-500/50 focus:border-indigo-500'
                                            }`}
                                        rows={currentQuestion.type === 'textarea' ? 5 : 2}
                                    />
                                )}
                            </div>

                            <div className="flex flex-col gap-2 shrink-0">
                                {inputValue.trim().length > 0 && !showRegenerateInput && (
                                    <button
                                        onClick={() => setShowRegenerateInput(true)}
                                        disabled={isSaving || isExtracting}
                                        className="h-8 px-3 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 border border-indigo-200 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                        title="有內容想微調？呼叫 AI 幫你改！"
                                    >
                                        <Wand2 className="w-3.5 h-3.5" /> AI 幫我改
                                    </button>
                                )}
                                <button
                                    onClick={handleSend}
                                    disabled={isSaving || isExtracting || inputValue.trim() === ''}
                                    className={`h-[46px] px-5 w-full rounded-xl text-sm font-medium transition flex items-center justify-center gap-2 ${isSaving || isExtracting || inputValue.trim() === ''
                                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                        : enrichState?.questionId === currentQuestion.id
                                            ? enrichState.isQuestion
                                                ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                                                : 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
                                            : editingQuestionId
                                                ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
                                                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                                        }`}
                                >
                                    {isSaving || isExtracting ? (
                                        <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                                    ) : enrichState?.questionId === currentQuestion.id ? (
                                        enrichState.isQuestion ? <>✅ 沒問題，送出</> : <>✅ 確認送出</>
                                    ) : editingQuestionId ? (
                                        <>更新儲存</>
                                    ) : (
                                        <><Send className="w-4 h-4" /> 送出</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
