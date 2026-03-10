import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { buildProjectAnswerStatusSummary, normalizeProjectAnswerValue } from '../src/utils/project_answer_status'
import { normalizeOfficialIndustry, splitOfficialIndustry } from '../src/utils/industry_classification'
import { inferProjectTypeFromAnswers } from '../src/utils/calculators'

const run = () => {
    const normalizedIndustry = normalizeProjectAnswerValue('industry', '行銷顧問')
    assert.equal(normalizedIndustry, 'M 專業、科學及技術服務業', 'industry should normalize to official major category')

    const normalizedBusinessModel = normalizeProjectAnswerValue('business_model', 'saas 訂閱制')
    assert.equal(normalizedBusinessModel, '訂閱制（SaaS）', 'business_model should normalize natural language to canonical option')

    const normalizedProjectFeeModel = normalizeProjectAnswerValue('business_model', '生成企劃書的時候收 20,000')
    assert.equal(
        normalizedProjectFeeModel,
        '一次性銷售（賣斷）',
        'business_model should normalize project-based pricing language to one-time sale'
    )

    const normalizedGamifiedFeeModel = normalizeProjectAnswerValue('business_model', '要生成完整企劃書的時候要課金兩萬')
    assert.equal(
        normalizedGamifiedFeeModel,
        '一次性銷售（賣斷）',
        'business_model should normalize colloquial paywall language to one-time sale'
    )

    const normalizedCurrentTrl = normalizeProjectAnswerValue('current_trl', '我們現在大概 trl5，已有原型')
    assert.equal(normalizedCurrentTrl, 'TRL 5-6：原型開發', 'current_trl should normalize natural language to canonical option')

    const normalizedNoTeamExperience = normalizeProjectAnswerValue('team_experience', '沒有')
    assert.equal(
        normalizedNoTeamExperience,
        '目前沒有相關產業或技術的成功經驗',
        'team_experience should normalize explicit negative answers to a stable confirmed value'
    )
    const normalizedNoCustomerValidation = normalizeProjectAnswerValue('customer_validation', '目前尚未訪談')
    assert.equal(
        normalizedNoCustomerValidation,
        '0',
        'customer_validation should normalize explicit no-interview responses to zero'
    )

    const officialIndustry = splitOfficialIndustry(normalizedIndustry)
    assert.deepEqual(officialIndustry, { code: 'M', name: '專業、科學及技術服務業' }, 'official industry split should be stable')
    const projectTypeInference = inferProjectTypeFromAnswers({
        industry: normalizedIndustry,
        solution_description: '我們提供 AI 企劃書平台與顧問工作流系統',
        business_model: '訂閱制（SaaS）',
    })
    assert.equal(projectTypeInference.projectType, '軟體開發', 'project type inference should classify AI/SaaS platform projects as 軟體開發')

    const incompleteSummary = buildProjectAnswerStatusSummary(
        {
            company_name: '煜言顧問有限公司',
            industry: 'M 專業、科學及技術服務業',
        },
        {
            capital: '50',
        },
        {
            company_name: { answer_source: 'user', confirmed_by_user: true, raw_answer_text: '煜言顧問有限公司' },
            industry: { answer_source: 'user', confirmed_by_user: true, raw_answer_text: '行銷顧問' },
        },
        {
            capital: {
                candidate_source: 'g0v',
                confidence: 0.95,
                candidate_reason: '已依公司查詢資料自動帶出實收資本額（萬元）。',
                candidate_source_detail: 'company_search.capital_ten_thousands',
            },
        }
    )

    assert.equal(incompleteSummary.ready, false, 'incomplete summary should not be ready for draft')
    assert.equal(incompleteSummary.next_action, 'review_candidate', 'planner should prioritize candidate review when candidate exists')
    assert.equal(incompleteSummary.next_question_id, 'capital', 'planner should direct to capital candidate first')

    const makeLongText = (minLength: number, seed: string) => {
        const base = `${seed}，包含問題背景、受影響對象、具體情境、執行方法、量化效益與推估依據，讓這題可以通過完整性驗證。`
        let output = base
        while (output.length < minLength + 12) {
            output += ` ${base}`
        }
        return output
    }

    const questions = JSON.parse(
        fs.readFileSync(
            path.resolve(process.cwd(), 'src/data/questions.json'),
            'utf8'
        )
    ).questions as Array<{
        id: string
        type: string
        options?: string[]
        validation?: { min?: number; max?: number; min_length?: number }
    }>

    const completeAnswers: Record<string, string> = questions.reduce((acc: Record<string, string>, question) => {
        switch (question.id) {
            case 'company_name':
                acc[question.id] = '煜言顧問有限公司'
                break
            case 'industry':
                acc[question.id] = 'M 專業、科學及技術服務業'
                break
            case 'company_size':
                acc[question.id] = '12'
                break
            case 'capital':
                acc[question.id] = '50'
                break
            case 'project_leader':
                acc[question.id] = '邱煜庭／執行長'
                break
            case 'problem_severity':
            case 'customer_pain_score':
                acc[question.id] = '8'
                break
            case 'customer_validation':
                acc[question.id] = '5'
                break
            case 'budget_total':
                acc[question.id] = '80'
                break
            case 'expected_revenue_year1':
                acc[question.id] = '120'
                break
            case 'expected_revenue_year2':
                acc[question.id] = '240'
                break
            case 'expected_revenue_year3':
                acc[question.id] = '360'
                break
            case 'business_model':
                acc[question.id] = '訂閱制（SaaS）'
                break
            case 'current_trl':
                acc[question.id] = 'TRL 5-6：原型開發'
                break
            case 'target_trl':
                acc[question.id] = 'TRL 6：原型展示'
                break
            default:
                if (question.type === 'number' || question.type === 'scale') {
                    const minValue = question.validation?.min ?? 1
                    acc[question.id] = String(Math.max(minValue, 1))
                } else if (question.type === 'choice' && question.options?.length) {
                    acc[question.id] = question.options[0]
                } else {
                    const minLength = question.validation?.min_length ?? 20
                    acc[question.id] = makeLongText(minLength, `這是 ${question.id} 的正式答案`)
                }
                break
        }
        return acc
    }, {})

    const completeMetadata = Object.fromEntries(
        Object.keys(completeAnswers).map((questionId) => [
            questionId,
            {
                answer_source: 'user',
                confirmed_by_user: true,
                raw_answer_text: completeAnswers[questionId],
            },
        ])
    )

    const completeSummary = buildProjectAnswerStatusSummary(completeAnswers, {}, completeMetadata, {})
    assert.equal(completeSummary.ready, true, 'complete summary should be ready for draft')
    assert.equal(completeSummary.next_action, 'ready_for_draft', 'planner should open draft when all questions are complete')
    assert.equal(completeSummary.derived_project_type?.value, '軟體開發', 'complete summary should expose derived project type')
    assert.deepEqual(
        completeSummary.industry_resolution,
        {
            raw_input: completeAnswers.industry,
            official_industry_code: 'M',
            official_industry_name: '專業、科學及技術服務業',
            industry_source: 'user',
        },
        'complete summary should expose industry raw/code/name/source resolution'
    )

    const explicitNegativeSummary = buildProjectAnswerStatusSummary({
        team_experience: '沒有',
    })
    const explicitNegativeItem = explicitNegativeSummary.items.find((item) => item.id === 'team_experience')
    assert.equal(
        explicitNegativeItem?.status,
        'confirmed',
        'explicit negative team_experience answers should be treated as a valid completion path'
    )
    const expandedNegativeSummary = buildProjectAnswerStatusSummary({
        team_experience: '目前沒有相關產業或技術的成功經驗，也沒有缺口原因與能力旁證細節',
    })
    const expandedNegativeItem = expandedNegativeSummary.items.find((item) => item.id === 'team_experience')
    assert.equal(
        expandedNegativeItem?.status,
        'confirmed',
        'negative-like team_experience answers with trailing explanation should still be treated as a valid completion path'
    )
    const structuredTeamExperienceSummary = buildProjectAnswerStatusSummary({
        team_experience: '1. 經驗現況：目前團隊尚無與本案完全對應的直接成功案例。\n2. 缺口原因：目前切入新的產品化情境。\n3. 能力旁證：團隊已有需求分析與方案規劃經驗。\n4. 執行可行性：仍具備推進本計畫的能力。',
    })
    const structuredTeamExperienceItem = structuredTeamExperienceSummary.items.find((item) => item.id === 'team_experience')
    assert.equal(
        structuredTeamExperienceItem?.status,
        'confirmed',
        'structured team_experience answers should remain confirmed and must not be collapsed back into a negative placeholder'
    )
    const zeroEquivalentSummary = buildProjectAnswerStatusSummary({
        customer_validation: '目前尚未訪談',
    })
    const zeroEquivalentItem = zeroEquivalentSummary.items.find((item) => item.id === 'customer_validation')
    assert.equal(
        zeroEquivalentItem?.status,
        'confirmed',
        'explicit no-interview customer_validation answers should be normalized as zero and confirmed'
    )

    const unansweredMarketSummary = buildProjectAnswerStatusSummary({})
    const customerValidationItem = unansweredMarketSummary.items.find((item) => item.id === 'customer_validation')
    const marketSizeItem = unansweredMarketSummary.items.find((item) => item.id === 'market_size')
    assert.equal(
        customerValidationItem?.status,
        'missing',
        'customer_validation should no longer be auto-confirmed when unanswered'
    )
    assert.equal(
        marketSizeItem?.status,
        'missing',
        'market_size should no longer be auto-confirmed when unanswered'
    )

    const aiReviewFile = fs.readFileSync(path.resolve(process.cwd(), 'src/ai.ts'), 'utf8')
    const projectsFile = fs.readFileSync(path.resolve(process.cwd(), 'src/projects.ts'), 'utf8')
    const enrichFile = fs.readFileSync(path.resolve(process.cwd(), 'src/enrich.ts'), 'utf8')
    assert.ok(
        !aiReviewFile.includes('parsed.wizardAnswers'),
        'AI review path should no longer read legacy progress_data.wizardAnswers'
    )
    assert.ok(
        !aiReviewFile.includes("import { phase1Template } from './templates/sbir_phase1'"),
        'runtime ai flow should not import the legacy sbir_phase1 placeholder template'
    )
    assert.ok(
        !aiReviewFile.includes("answers.company_name || '未填'"),
        'pitch deck generation should not inject 未填 placeholders into prompts'
    )
    assert.ok(
        !aiReviewFile.includes("const budgetTotalStr = answers['budget_total'] || '150'"),
        'section generation should not default budget_total to 150'
    )
    assert.ok(
        !aiReviewFile.includes("answers['industry'] || 'C 製造業'"),
        'section generation should not default industry to 製造業'
    )
    assert.ok(
        !aiReviewFile.includes('允許合理推估的範圍'),
        'section generation prompt should not allow reasonable extrapolation for missing market facts'
    )
    assert.ok(
        !aiReviewFile.includes('const capitalOk = effectiveCapital > 0 ? effectiveCapital < 100_000_000 : true'),
        'company verification should not treat missing capital data as auto-pass'
    )
    assert.ok(
        !aiReviewFile.includes('const employeeOk = employeeCount !== null ? employeeCount < 200 : true'),
        'company verification should not treat missing employee data as auto-pass'
    )
    assert.ok(
        !aiReviewFile.includes("ch3 = true\n            ch3Reason = 'g0v 無股東結構資料，建議申請前自行確認外資比例'"),
        'company verification should not treat missing shareholder structure as auto-pass'
    )
    assert.ok(
        enrichFile.includes("buildRevenueCandidateFromContext"),
        'revenue helper answers should use a deterministic revenue candidate builder'
    )
    assert.ok(
        enrichFile.includes("calculateROI("),
        'revenue helper answers should reuse calculateROI instead of free-form LLM estimates'
    )
    assert.ok(
        enrichFile.includes("inferProjectTypeFromAnswers(context)"),
        'budget and revenue deterministic helpers should share the same project type inference helper'
    )
    assert.ok(
        projectsFile.includes('derived_fields = buildDerivedFields'),
        'project routes should sync derived_fields projection together with answer_map'
    )
    assert.ok(
        projectsFile.includes('official_industry_code'),
        'projects projection should expose split official industry fields'
    )
    assert.ok(
        projectsFile.includes('parsedProgressData.answer_map = answerMap'),
        'answer patch route should sync progress_data.answer_map after each confirmed answer write'
    )
    assert.ok(
        projectsFile.includes('existingProgressData.answer_map = await loadProjectAnswerMap(c.env.DB, id)') &&
        projectsFile.includes('existingProgressData.answer_candidates = await loadProjectCandidateMap(c.env.DB, id)') &&
        projectsFile.includes('existingProgressData.answer_candidate_meta = await loadProjectCandidateMetadataMap(c.env.DB, id)'),
        'answer candidate patch route should also rebuild all progress_data projections from canonical tables'
    )
    const statusFile = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/project_answer_status.ts'), 'utf8')
    assert.ok(
        statusFile.includes("question_id != 'g0v_company_data'"),
        'answer_map projection should exclude g0v_company_data so compat progress_data stays aligned with the 29 canonical questions'
    )
    assert.ok(
        projectsFile.includes('mergedData.answer_map = await loadProjectAnswerMap(c.env.DB, id)') &&
        projectsFile.includes('mergedData.answer_candidates = await loadProjectCandidateMap(c.env.DB, id)') &&
        projectsFile.includes('mergedData.answer_candidate_meta = await loadProjectCandidateMetadataMap(c.env.DB, id)'),
        'project metadata PUT route should rebuild answer projections from canonical tables instead of dropping them'
    )
    assert.ok(
        projectsFile.includes('answer_map: {}') &&
        projectsFile.includes('answer_candidates: {}') &&
        projectsFile.includes('answer_candidate_meta: {}'),
        'new project default progress_data should initialize empty answer projection maps'
    )

    assert.ok(
        enrichFile.includes('簡化競品分析框架'),
        'enrich prompt should include the simplified competitor analysis framework for current_solutions'
    )
    assert.ok(
        enrichFile.includes('1. 現有做法：'),
        'enrich prompt should require a structured 4-part answer for current_solutions'
    )
    assert.ok(
        enrichFile.includes('經驗現況 / 缺口原因 / 能力旁證 / 執行可行性'),
        'enrich prompt should include the structured team experience framework'
    )
    assert.ok(
        enrichFile.includes('若使用者回答「沒有、尚無、目前沒有」這類明確否定，請不要只回追問'),
        'enrich prompt should draft a candidate answer for explicit negative team_experience responses'
    )
    assert.ok(
        enrichFile.includes('1. 經驗現況：'),
        'enrich prompt should require a structured 4-part answer for team_experience'
    )
    assert.ok(
        enrichFile.includes('buildTeamExperienceCandidateFromContext'),
        'explicit negative team_experience answers should have a deterministic candidate builder'
    )
    assert.ok(
        enrichFile.includes('目前團隊尚無與本案完全對應的直接成功案例'),
        'deterministic team_experience candidate should anchor to a stable explicit-negative statement'
    )
    assert.ok(
        enrichFile.includes('isNegativeTeamExperienceAnswer'),
        'team_experience enrich flow should use semantic negative detection instead of exact-string matching'
    )
    assert.ok(
        enrichFile.includes('訪談現況 / 目前線索 / 下一步驗證'),
        'enrich prompt should include the structured customer validation framework'
    )
    assert.ok(
        enrichFile.includes("if (questionId === 'budget_total')"),
        'enrich prompt should include the budget_total helper flow'
    )
    assert.ok(
        enrichFile.includes('總經費 / 估算基礎 / 主要組成'),
        'budget_total enrich flow should use a structured estimate framework'
    )
    assert.ok(
        enrichFile.includes('buildBudgetTotalCandidateFromContext'),
        'budget_total uncertainty answers should use a deterministic candidate builder instead of free-form LLM estimation'
    )
    assert.ok(
        enrichFile.includes('calculateBudget('),
        'budget_total deterministic helper should reuse the budget calculator instead of inventing arbitrary line items'
    )
    assert.ok(
        enrichFile.includes('isBudgetEstimateHelpAnswer'),
        'budget_total enrich flow should detect uncertainty/help-seeking answers semantically'
    )
    assert.ok(
        enrichFile.includes('buildBudgetBreakdownCandidateFromContext'),
        'budget_breakdown uncertainty answers should use a deterministic candidate builder'
    )
    assert.ok(
        enrichFile.includes("if (question_id === 'budget_breakdown' && isBudgetBreakdownHelpAnswer(user_answer.trim()))"),
        'budget_breakdown should bypass free-form LLM rewriting when the user asks for help splitting the budget'
    )
    assert.ok(
        enrichFile.includes('TAM / SAM / SOM / 估算依據'),
        'enrich prompt should include the structured market size framework'
    )
    assert.ok(
        enrichFile.includes('核心門檻 / 為何難複製 / 目前證據 / 後續補強'),
        'enrich prompt should include the structured technical barrier framework'
    )

    const interviewerFile = fs.readFileSync(path.resolve(process.cwd(), '../frontend/src/components/AIInterviewer.tsx'), 'utf8')
    assert.ok(
        interviewerFile.includes("'team_experience'"),
        'AI interviewer should treat team_experience as enrichable so it can draft a candidate answer from context'
    )
    assert.ok(
        interviewerFile.includes("saveResult?.items?.find((item) => item.status !== 'confirmed')?.id"),
        'AI interviewer should fall back to the first unresolved item when next_question_id is missing'
    )
    assert.ok(
        interviewerFile.includes('我先記下您目前沒有直接成功經驗'),
        'team_experience acknowledgement should not use the generic generic-success phrasing for explicit negative answers'
    )
    assert.ok(
        interviewerFile.includes('autoAppliedEnrichment = true') &&
        interviewerFile.includes('已依您「目前沒有直接成功經驗」的回答'),
        'team_experience negative answers should auto-apply the AI drafted acceptable version and continue'
    )
    assert.ok(
        interviewerFile.includes("'customer_validation'"),
        'AI interviewer should treat customer_validation as enrichable so it can draft a candidate answer from context'
    )
    assert.ok(
        interviewerFile.includes("'budget_total'"),
        'AI interviewer should treat budget_total as enrichable so users can answer with uncertainty and still get help'
    )
    assert.ok(
        interviewerFile.includes("'budget_breakdown'"),
        'AI interviewer should treat budget_breakdown as enrichable so users can ask for an initial budget split'
    )
    assert.ok(
        interviewerFile.includes("currentQuestion.id === 'budget_total' && isBudgetEstimateHelpAnswer(inputValue)"),
        'budget_total uncertainty answers should auto-apply the deterministic estimate and continue'
    )
    assert.ok(
        interviewerFile.includes('已依目前已收集的資料，先替您試算一版保守總經費'),
        'budget_total auto-apply path should explain that the estimate comes from collected project data'
    )
    assert.ok(
        interviewerFile.includes("currentQuestion.id === 'budget_breakdown' && isBudgetBreakdownHelpAnswer(inputValue)"),
        'budget_breakdown uncertainty answers should auto-apply the deterministic split and continue'
    )
    assert.ok(
        interviewerFile.includes('已依目前總經費與專案型態，先整理一版初步經費分配'),
        'budget_breakdown auto-apply path should explain that the split comes from budget_total and project type'
    )
    assert.ok(
        interviewerFile.includes('const shouldBypassEnrich = isDeterministicallyCompleteScalarAnswer(currentQuestion, inputValue);'),
        'AI interviewer should detect deterministically complete numeric answers before calling enrich'
    )
    assert.ok(
        interviewerFile.includes('if (isEnrichable && !isConfirmingEnrichment && !shouldBypassEnrich)'),
        'AI interviewer should bypass enrich for valid numeric answers like customer_validation=0'
    )
    assert.ok(
        interviewerFile.includes('type="text"') &&
        interviewerFile.includes('inputMode="decimal"'),
        'number questions should use text input with decimal keypad so users can still type uncertainty in natural language'
    )
    assert.ok(
        enrichFile.includes("if (questionId === 'customer_validation' && /^(0|零|沒有|無|尚無|目前沒有|目前無|暫無|尚未有|還沒有|尚未訪談|尚未正式訪談|沒有訪談|未訪談|目前沒有訪談|目前尚未訪談)$/u.test(normalized))"),
        'enrich should deterministically accept customer_validation zero-equivalent answers'
    )

    const backendQuestions = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'src/data/questions.json'), 'utf8')
    ).questions as Array<{ id: string; placeholder?: string }>
    const currentSolutionsQuestion = backendQuestions.find((question) => question.id === 'current_solutions')
    assert.equal(
        currentSolutionsQuestion?.placeholder,
        '可用四段簡單回答：1. 市場現在怎麼做 2. 代表方案或競品 3. 它們的缺點 4. 我們準備切入的缺口',
        'current_solutions placeholder should guide the user with the simplified competitor analysis structure'
    )
    const marketSizeQuestion = backendQuestions.find((question) => question.id === 'market_size')
    assert.equal(
        marketSizeQuestion?.placeholder,
        '例如：TAM 500 億、SAM 100 億、SOM 5 億...\n請提供您掌握的市場數據、估算方式或引用來源，若暫時沒有請先說明目前掌握到哪一步。',
        'market_size placeholder should request evidence instead of telling the user to skip'
    )
    const budgetTotalQuestion = backendQuestions.find((question) => question.id === 'budget_total')
    assert.equal(
        budgetTotalQuestion?.placeholder,
        '可直接輸入數字；若目前不確定，也可以直接說不知道怎麼估。',
        'budget_total placeholder should allow uncertainty instead of forcing digits only'
    )
    const enrichCriteriaFile = fs.readFileSync(path.resolve(process.cwd(), '../../shared_domain/enrich_criteria.json'), 'utf8')
    assert.ok(
        !enrichCriteriaFile.includes('假定的數字草稿'),
        'market_size enrich criteria should no longer tell the model to invent assumed market-size figures'
    )

    assert.ok(
        statusFile.includes("if (question.id === 'industry')"),
        'choice fallback hint should special-case industry instead of treating all choice questions as official industry classification'
    )

    const phase1Chunks = fs.readFileSync(path.resolve(process.cwd(), 'src/templates/phase1_chunks.ts'), 'utf8')
    assert.ok(
        !phase1Chunks.includes('自行合理推估'),
        'phase1 chunk templates should not tell the model to make up SOM or market figures'
    )
    assert.ok(
        !phase1Chunks.includes('自行推演最合理的市面現有競品'),
        'phase1 chunk templates should not instruct the model to fabricate competitors'
    )
    assert.ok(
        !phase1Chunks.includes('[待填寫'),
        'runtime phase1 chunk templates should not contain open fill-in placeholders'
    )
    assert.ok(
        !phase1Chunks.includes('請由專家代筆包裝'),
        'runtime phase1 chunk templates should not instruct the model to package up missing experience'
    )

    const frontendProjectDetailsFile = fs.readFileSync(
        path.resolve(process.cwd(), '../frontend/src/pages/ProjectDetails.tsx'),
        'utf8'
    )
    assert.ok(
        !frontendProjectDetailsFile.includes('wizardAnswers'),
        'frontend ProjectDetails should no longer depend on legacy wizardAnswers'
    )

    const frontendInterviewerFile = fs.readFileSync(
        path.resolve(process.cwd(), '../frontend/src/components/AIInterviewer.tsx'),
        'utf8'
    )
    assert.ok(
        !frontendInterviewerFile.includes('wizardAnswers'),
        'frontend AIInterviewer should no longer depend on legacy wizardAnswers'
    )

    assert.ok(
        !projectsFile.includes('wizardAnswers: answerMap'),
        'backend should no longer return legacy wizardAnswers in project answer save responses'
    )
    const sectionCardFile = fs.readFileSync(
        path.resolve(process.cwd(), '../frontend/src/components/SectionCard.tsx'),
        'utf8'
    )
    assert.ok(
        !sectionCardFile.includes('【建議加入】'),
        'section review accept flow should not append unmatched revisions to the end of content'
    )

    console.log('project-data-regression: PASS')
}

run()
