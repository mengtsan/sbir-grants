import { Hono } from 'hono'
import { apiRateLimitMiddleware, authMiddleware, Bindings, Variables } from './middleware'
import { processSemanticChunking } from './chunking';
import { fetchCompanyLookup } from './utils/company_lookup';
import questionsData from './data/questions.json';
import { buildProjectAnswerStatusSummary, loadProjectAnswerMap, loadProjectCandidateMap, loadProjectAnswerMetadataMap, loadProjectCandidateMetadataMap, normalizeProjectAnswerValue } from './utils/project_answer_status';
import { normalizeOfficialIndustry, splitOfficialIndustry } from './utils/industry_classification';
import { inferProjectTypeFromAnswers } from './utils/calculators';

const projectsApp = new Hono<{ Bindings: Bindings; Variables: Variables }>({ strict: false })
const VALID_QUESTION_IDS = new Set(
    (questionsData.questions as Array<{ id: string }>).map((question) => question.id)
)

const safeParseProgressData = (raw: unknown): Record<string, unknown> => {
    if (!raw) return {}
    if (typeof raw === 'object') return raw as Record<string, unknown>
    if (typeof raw !== 'string') return {}
    try {
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
    } catch {
        return {}
    }
}

const normalizeAnswerCandidates = (raw: unknown): Record<string, string> => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {}
    }

    const candidates = raw as Record<string, unknown>
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(candidates)) {
        if (!VALID_QUESTION_IDS.has(key)) continue
        if (value === null || value === undefined) continue
        if (typeof value === 'object') continue
        const text = String(value).trim()
        if (!text) continue
        normalized[key] = text
    }
    return normalized
}

const buildAnswerResolutionNote = (questionId: string, rawAnswer: string, normalizedAnswer: string): string | null => {
    const raw = rawAnswer.trim()
    const normalized = normalizedAnswer.trim()

    if (!raw || !normalized || raw === normalized) {
        return null
    }

    if (questionId === 'industry') {
        return `我已將您輸入的「${raw}」整理為官方行業統計分類「${normalized}」。若不符合，您可以直接改寫。`
    }

    return `我已將您輸入的「${raw}」整理為正式答案「${normalized}」。若不符合，您可以直接改寫。`
}

const buildDerivedFields = (
    answerMap: Record<string, string>,
    answerMetadata: Record<string, { answer_source: string; raw_answer_text?: string | null }>
) => {
    const industryRaw = answerMetadata.industry?.raw_answer_text ?? null
    const officialIndustry = splitOfficialIndustry(answerMap.industry || '')
    const projectType = inferProjectTypeFromAnswers(answerMap)

    return {
        project_type: answerMap.industry || answerMap.solution_description || answerMap.business_model
            ? {
                value: projectType.projectType,
                rationale: projectType.rationale,
            }
            : null,
        industry: answerMap.industry || industryRaw
            ? {
                raw_input: industryRaw,
                official_industry_code: officialIndustry?.code ?? null,
                official_industry_name: officialIndustry?.name ?? null,
                industry_source: answerMetadata.industry?.answer_source ?? null,
            }
            : null,
    }
}

// Apply auth middleware to all routes in this app
projectsApp.use('*', authMiddleware)
projectsApp.use('*', apiRateLimitMiddleware)

// Get all projects for the current user
projectsApp.get('/', async (c) => {
    const user = c.get('user')
    const { results } = await c.env.DB.prepare(
        'SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC'
    )
        .bind(user.sub)
        .all()

    return c.json(results)
})

// Get a specific project
projectsApp.get('/:id', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    console.log(`[projects/:id] Request for project ${id} by user ${user?.sub}`);

    const project = await c.env.DB.prepare(
        'SELECT * FROM projects WHERE id = ? AND user_id = ?'
    )
        .bind(id, user.sub)
        .first()

    if (!project) {
        console.log(`[projects/:id] Project ${id} NOT FOUND for user ${user?.sub}`);
        return c.json({ error: 'Project not found' }, 404)
    }

    // Reconstruct canonical answers from the relational project_answers table
    const answerMap = await loadProjectAnswerMap(c.env.DB, id)
    const answerCandidates = await loadProjectCandidateMap(c.env.DB, id)
    const answerCandidateMeta = await loadProjectCandidateMetadataMap(c.env.DB, id)
    const answerMetadata = await loadProjectAnswerMetadataMap(c.env.DB, id)

    // Embed them back into the project's payload for backwards compatibility with the frontend
    const parsedData = safeParseProgressData(project.progress_data)

    parsedData.answer_map = answerMap;
    parsedData.answer_candidates = answerCandidates;
    parsedData.answer_candidate_meta = answerCandidateMeta;
    parsedData.derived_fields = buildDerivedFields(answerMap, answerMetadata);
    project.progress_data = JSON.stringify(parsedData);

    return c.json(project)
})

projectsApp.get('/:id/project-data-status', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    const project = await c.env.DB.prepare(
        'SELECT id FROM projects WHERE id = ? AND user_id = ?'
    ).bind(id, user.sub).first()

    if (!project) {
        return c.json({ error: 'Project not found' }, 404)
    }

    const answers = await loadProjectAnswerMap(c.env.DB, id)
    const candidates = await loadProjectCandidateMap(c.env.DB, id)
    const answerMetadata = await loadProjectAnswerMetadataMap(c.env.DB, id)
    const candidateMetadata = await loadProjectCandidateMetadataMap(c.env.DB, id)
    const summary = buildProjectAnswerStatusSummary(answers, candidates, answerMetadata, candidateMetadata)

    return c.json(summary)
})

// Create a new project
projectsApp.post('/', async (c) => {
    const user = c.get('user')
    const body = await c.req.json().catch(() => null)

    if (!body || typeof body !== 'object') {
        return c.json({ error: 'Invalid request body' }, 400)
    }

    if (!body.title) {
        return c.json({ error: 'Title is required' }, 400)
    }

    const id = crypto.randomUUID()
    const defaultProgress = JSON.stringify({
        setupPhase: false,
        draftingPhase: false,
        reviewPhase: false,
        answer_map: {},
        answer_candidates: {},
        answer_candidate_meta: {},
    })

    await c.env.DB.prepare(
        'INSERT INTO projects (id, user_id, title, county, status, progress_data) VALUES (?, ?, ?, ?, ?, ?)'
    )
        .bind(id, user.sub, body.title, body.county || null, 'Draft', defaultProgress)
        .run()

    const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()
    return c.json(project, 201)
})

projectsApp.patch('/:id/answers/:questionId', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')
    const questionId = c.req.param('questionId')
    const body = await c.req.json<{ answer?: unknown; source?: unknown }>().catch(() => null)

    if (!VALID_QUESTION_IDS.has(questionId)) {
        return c.json({ error: 'Invalid question id' }, 400)
    }

    if (!body || !Object.prototype.hasOwnProperty.call(body, 'answer')) {
        return c.json({ error: 'Invalid request body' }, 400)
    }

    const project = await c.env.DB.prepare('SELECT id, progress_data FROM projects WHERE id = ? AND user_id = ?')
        .bind(id, user.sub)
        .first<{ id: string; progress_data: string | null }>()

    if (!project) {
        return c.json({ error: 'Project not found' }, 404)
    }

    const rawAnswer = body.answer
    const normalizedSource = body.source === 'candidate_adopted'
        ? 'candidate_adopted'
        : body.source === 'enrich_confirmed'
            ? 'enrich_confirmed'
            : 'user'
    const inputAnswer = rawAnswer === null || rawAnswer === undefined
        ? ''
        : typeof rawAnswer === 'string'
            ? rawAnswer.trim()
            : String(rawAnswer).trim()
    const normalizedAnswer = normalizeProjectAnswerValue(questionId, inputAnswer)

    let shouldFetchG0v = false
    if (questionId === 'company_name' && normalizedAnswer) {
        const existingCompany = await c.env.DB.prepare(
            'SELECT answer_text FROM project_answers WHERE project_id = ? AND question_id = ?'
        ).bind(id, 'company_name').first<{ answer_text: string }>()
        shouldFetchG0v = !existingCompany || existingCompany.answer_text !== normalizedAnswer
    }

    if (questionId === 'industry' && normalizedAnswer && !normalizeOfficialIndustry(normalizedAnswer)) {
        return c.json({ error: 'Invalid official industry category' }, 400)
    }

    if (normalizedAnswer) {
        await c.env.DB.prepare(`
            INSERT INTO project_answers (project_id, question_id, answer_text, raw_answer_text, chunking_status, updated_at, confirmed_by_user, answer_source, confirmed_at)
            VALUES (?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, 1, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(project_id, question_id) DO UPDATE SET
            answer_text = excluded.answer_text,
            raw_answer_text = excluded.raw_answer_text,
            chunking_status = 'pending',
            confirmed_by_user = 1,
            answer_source = excluded.answer_source,
            confirmed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        `).bind(id, questionId, normalizedAnswer, inputAnswer || normalizedAnswer, normalizedSource).run()
    } else {
        await c.env.DB.prepare(
            'DELETE FROM project_answers WHERE project_id = ? AND question_id = ?'
        ).bind(id, questionId).run()
    }

    if (shouldFetchG0v) {
        const savedCompanyName = normalizedAnswer
        c.executionCtx.waitUntil((async () => {
            try {
                const lookup = await fetchCompanyLookup(c.env, savedCompanyName)
                await c.env.DB.prepare(`
                    INSERT INTO project_answers (project_id, question_id, answer_text, chunking_status, updated_at)
                    VALUES (?, 'g0v_company_data', ?, 'done', CURRENT_TIMESTAMP)
                    ON CONFLICT(project_id, question_id) DO UPDATE SET
                    answer_text = excluded.answer_text,
                    updated_at = CURRENT_TIMESTAMP
                `).bind(id, JSON.stringify(lookup.payload)).run()
            } catch (error) {
                console.error(`[PATCH /projects/${id}/answers/${questionId}] g0v pre-fetch failed:`, error)
            }
        })())
    }

    const answers = await c.env.DB.prepare(
        'SELECT question_id, answer_text FROM project_answers WHERE project_id = ?'
    ).bind(id).all()

    const answerMap: Record<string, string> = {}
    if (answers.results) {
        for (const row of answers.results) {
            answerMap[row.question_id as string] = row.answer_text as string
        }
    }

    const parsedProgressData = safeParseProgressData(project.progress_data)
    parsedProgressData.answer_map = answerMap
    parsedProgressData.derived_fields = buildDerivedFields(
        answerMap,
        await loadProjectAnswerMetadataMap(c.env.DB, id)
    )
    delete parsedProgressData.wizardAnswers

    await c.env.DB.prepare(
        'UPDATE projects SET progress_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
    ).bind(JSON.stringify(parsedProgressData), id, user.sub).run()

    return c.json({
        success: true,
        question_id: questionId,
        raw_input: inputAnswer,
        answer_text: normalizedAnswer,
        answer_source: normalizedSource,
        normalized: inputAnswer !== normalizedAnswer,
        resolution_note: buildAnswerResolutionNote(questionId, inputAnswer, normalizedAnswer),
        answer_map: answerMap,
        derived_fields: parsedProgressData.derived_fields,
    })
})

projectsApp.patch('/:id/answer-candidates', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')
    const body = await c.req.json<{ candidates?: Record<string, unknown> }>().catch(() => null)

    if (!body || !body.candidates || typeof body.candidates !== 'object' || Array.isArray(body.candidates)) {
        return c.json({ error: 'Invalid request body' }, 400)
    }

    const project = await c.env.DB.prepare('SELECT progress_data FROM projects WHERE id = ? AND user_id = ?')
        .bind(id, user.sub)
        .first<{ progress_data: string | null }>()

    if (!project) {
        return c.json({ error: 'Project not found' }, 404)
    }

    const existingProgressData = safeParseProgressData(project.progress_data)
    const currentCandidates = await loadProjectCandidateMap(c.env.DB, id)
    const currentCandidateMeta = await loadProjectCandidateMetadataMap(c.env.DB, id)
    const incomingCandidates = body.candidates as Record<string, unknown>

    for (const [questionId, value] of Object.entries(incomingCandidates)) {
        if (!VALID_QUESTION_IDS.has(questionId)) continue
        if (value === null || value === undefined) {
            delete currentCandidates[questionId]
            delete currentCandidateMeta[questionId]
            continue
        }
        const candidateObject = typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
        const text = candidateObject
            ? String(candidateObject.text ?? '').trim()
            : String(value).trim()
        if (!text) {
            delete currentCandidates[questionId]
            delete currentCandidateMeta[questionId]
            continue
        }
        currentCandidates[questionId] = text
        currentCandidateMeta[questionId] = {
            candidate_source: candidateObject?.source ? String(candidateObject.source) : 'extract',
            confidence: candidateObject?.confidence === undefined || candidateObject?.confidence === null ? null : Number(candidateObject.confidence),
            candidate_reason: candidateObject?.reason ? String(candidateObject.reason) : null,
            candidate_source_detail: candidateObject?.source_detail ? String(candidateObject.source_detail) : null,
        }
    }

    const stmts = []
    for (const [questionId, candidateText] of Object.entries(currentCandidates)) {
        const meta = currentCandidateMeta[questionId]
        stmts.push(c.env.DB.prepare(`
            INSERT INTO project_answer_candidates (project_id, question_id, candidate_text, candidate_source, confidence, candidate_reason, candidate_source_detail, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(project_id, question_id) DO UPDATE SET
            candidate_text = excluded.candidate_text,
            candidate_source = excluded.candidate_source,
            confidence = excluded.confidence,
            candidate_reason = excluded.candidate_reason,
            candidate_source_detail = excluded.candidate_source_detail,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
            id,
            questionId,
            candidateText,
            meta?.candidate_source || 'extract',
            meta?.confidence ?? null,
            meta?.candidate_reason ?? null,
            meta?.candidate_source_detail ?? null
        ))
    }

    for (const [questionId, value] of Object.entries(incomingCandidates)) {
        if (!VALID_QUESTION_IDS.has(questionId)) continue
        if (value === null || value === undefined || String(value).trim() === '') {
            stmts.push(c.env.DB.prepare(
                'DELETE FROM project_answer_candidates WHERE project_id = ? AND question_id = ?'
            ).bind(id, questionId))
        }
    }

    if (stmts.length > 0) {
        await c.env.DB.batch(stmts)
    }

    existingProgressData.answer_map = await loadProjectAnswerMap(c.env.DB, id)
    existingProgressData.answer_candidates = await loadProjectCandidateMap(c.env.DB, id)
    existingProgressData.answer_candidate_meta = await loadProjectCandidateMetadataMap(c.env.DB, id)
    existingProgressData.derived_fields = buildDerivedFields(
        existingProgressData.answer_map as Record<string, string>,
        await loadProjectAnswerMetadataMap(c.env.DB, id)
    )
    delete existingProgressData.wizardAnswers
    await c.env.DB.prepare(
        'UPDATE projects SET progress_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
    ).bind(JSON.stringify(existingProgressData), id, user.sub).run()

    return c.json({
        success: true,
        answer_candidates: existingProgressData.answer_candidates,
        answer_candidate_meta: existingProgressData.answer_candidate_meta,
    })
})



// Update project progress/status
projectsApp.put('/:id', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => null)

    if (!body || typeof body !== 'object') {
        return c.json({ error: 'Invalid request body' }, 400)
    }

    console.log(`[PUT /projects/${id}] User:`, user.sub)
    // Fetch existing details for merging progress_data
    const existing = await c.env.DB.prepare('SELECT id, progress_data FROM projects WHERE id = ? AND user_id = ?')
        .bind(id, user.sub)
        .first()

    if (!existing) {
        console.warn(`[PUT /projects/${id}] Project not found`)
        return c.json({ error: 'Project not found' }, 404)
    }

    console.log(`[PUT /projects/${id}] Existing data found, parsing body...`)
    let updateQuery = 'UPDATE projects SET updated_at = CURRENT_TIMESTAMP'
    const params: any[] = []

    if (body.title !== undefined) {
        updateQuery += ', title = ?'
        params.push(body.title)
    }
    if (body.county !== undefined) {
        updateQuery += ', county = ?'
        params.push(body.county)
    }
    if (body.status !== undefined) {
        updateQuery += ', status = ?'
        params.push(body.status)
    }
    let hasProgressDataToUpdate = false;
    let newProgressData: any = {};

    if (body.progress_data !== undefined) {
        let incomingProgressData: any = {};
        try {
            incomingProgressData = typeof body.progress_data === 'string'
                ? JSON.parse(body.progress_data)
                : body.progress_data;
        } catch (e) {
            console.error('Failed to parse incoming progress_data', e);
            incomingProgressData = {};
        }

        if (!incomingProgressData || typeof incomingProgressData !== 'object') {
            incomingProgressData = {};
        }

        if (incomingProgressData.wizardAnswers !== undefined) {
            console.warn(`[PUT /projects/${id}] Ignoring legacy wizardAnswers write path; use PATCH /answers/:questionId instead`)
        }
        if (incomingProgressData.answer_map !== undefined) {
            console.warn(`[PUT /projects/${id}] Ignoring legacy answer_map write path; use PATCH /answers/:questionId instead`)
        }

        // Isolate the remaining progress data (phases / checklists / candidate answers)
        newProgressData = { ...incomingProgressData };
        delete newProgressData.wizardAnswers;
        delete newProgressData.answer_map;

        if (Object.keys(newProgressData).length > 0) {
            hasProgressDataToUpdate = true;
        }
    }

    if (hasProgressDataToUpdate) {
        // Atomic Deep Merge for remaining progress_data (like setupPhase, etc)
        const existingData: Record<string, any> = safeParseProgressData(existing.progress_data)

        // Delete wizardAnswers from legacy existingData just in case to clean it up
        delete existingData.wizardAnswers;

        const mergedData = { ...existingData, ...newProgressData };
        mergedData.answer_map = await loadProjectAnswerMap(c.env.DB, id)
        mergedData.answer_candidates = await loadProjectCandidateMap(c.env.DB, id)
        mergedData.answer_candidate_meta = await loadProjectCandidateMetadataMap(c.env.DB, id)
        mergedData.derived_fields = buildDerivedFields(
            mergedData.answer_map as Record<string, string>,
            await loadProjectAnswerMetadataMap(c.env.DB, id)
        )
        updateQuery += ', progress_data = ?';
        params.push(JSON.stringify(mergedData));
    }

    updateQuery += ' WHERE id = ? AND user_id = ?'
    params.push(id, user.sub)

    console.log(`[PUT /projects/${id}] Executing DB update for project metadata...`)
    try {
        await c.env.DB.prepare(updateQuery).bind(...params).run()
        console.log(`[PUT /projects/${id}] DB metadata update successful`)
    } catch (dbErr) {
        console.error(`[PUT /projects/${id}] DB metadata update FAILED:`, dbErr)
        throw dbErr;
    }

    const updatedProject = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()

    return c.json(updatedProject)
})

// Get all sections for a project
projectsApp.get('/:id/sections', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    // Verify ownership
    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(id, user.sub).first()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const { results } = await c.env.DB.prepare(
        'SELECT * FROM project_sections WHERE project_id = ? ORDER BY section_index ASC'
    ).bind(id).all()

    return c.json(results || [])
})

// Delete project
projectsApp.delete('/:id', async (c) => {
    const user = c.get('user')
    const id = c.req.param('id')

    // First verify ownership
    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
        .bind(id, user.sub).first()

    if (!project) {
        return c.json({ error: 'Project not found or unauthorized' }, 404)
    }

    // Cascade delete vectors from Vectorize (Document Vectors)
    try {
        const docChunks = await c.env.DB.prepare('SELECT id FROM document_chunks WHERE project_id = ?').bind(id).all()
        if (docChunks.results && docChunks.results.length > 0) {
            const docChunkIds = docChunks.results.map(r => r.id as string)
            await c.env.VECTORIZE.deleteByIds(docChunkIds)
            console.log(`[DELETE /projects/${id}] Deleted ${docChunkIds.length} document vectors from Vectorize`)
        }
    } catch (e) {
        console.error(`[DELETE /projects/${id}] Failed to cleanup document vectors:`, e)
    }

    // Cascade delete vectors from Vectorize (Project Answers)
    try {
        const answerVectors = await c.env.DB.prepare('SELECT vector_id FROM project_answer_vectors WHERE project_id = ?').bind(id).all()
        if (answerVectors.results && answerVectors.results.length > 0) {
            const answerVectorIds = answerVectors.results.map(r => r.vector_id as string)
            await c.env.VECTORIZE.deleteByIds(answerVectorIds)
            console.log(`[DELETE /projects/${id}] Deleted ${answerVectorIds.length} answer vectors from Vectorize`)
        }
    } catch (e) {
        console.error(`[DELETE /projects/${id}] Failed to cleanup answer vectors:`, e)
    }

    // Cascade delete all related records
    await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM project_answers WHERE project_id = ?').bind(id),
        c.env.DB.prepare('DELETE FROM project_sections WHERE project_id = ?').bind(id),
        c.env.DB.prepare('DELETE FROM project_answer_vectors WHERE project_id = ?').bind(id),
        c.env.DB.prepare('DELETE FROM documents WHERE project_id = ?').bind(id),
        c.env.DB.prepare('DELETE FROM document_chunks WHERE project_id = ?').bind(id),
        c.env.DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(id, user.sub),
    ])

    // Delete associated R2 files (uploaded documents)
    try {
        const prefix = 'projects/' + user.sub + '/' + id + '/'
        const listResult = await c.env.sbir_saas_bucket.list({ prefix })
        if (listResult.objects.length > 0) {
            const keysToDelete = listResult.objects.map(obj => obj.key)
            await c.env.sbir_saas_bucket.delete(keysToDelete)
            console.log('[DELETE /projects/' + id + '] Deleted ' + keysToDelete.length + ' files from R2')
        }
    } catch (r2Err) {
        console.error('[DELETE /projects/' + id + '] R2 Cleanup failed:', r2Err)
        // We log but don't fail the request since DB is already wiped
    }

    return c.json({ success: true })
})

export default projectsApp
