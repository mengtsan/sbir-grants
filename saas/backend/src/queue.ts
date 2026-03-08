import { Bindings } from './middleware'
import { decryptSecret } from './utils/secrets'

export interface DocProcessingMessage {
    documentId: string
    projectId: string
    r2Key: string
    fileName: string
    contentType: string
}

const SECTIONS = [
    { index: 1, name: '公司簡介' },
    { index: 2, name: '問題陳述' },
    { index: 3, name: '創新構想' },
    { index: 4, name: '可行性評估規劃' },
    { index: 5, name: '市場初步分析' },
    { index: 6, name: '預期營收與產值' },
    { index: 7, name: '團隊介紹與經費規劃' },
    { index: 8, name: '結語與附件清單' },
]

const EMBEDDING_BATCH_SIZE = 32
const VECTORIZE_BATCH_SIZE = 900
const D1_BATCH_SIZE = 50

interface PendingChunkRecord {
    chunkId: string
    chunkIndex: number
    chunkText: string
    sectionTags: number[]
}

async function replicateChunksToDuplicates(
    env: Bindings,
    sourceDocumentId: string,
    projectId: string
) {
    const duplicates = await env.DB.prepare(
        `SELECT id
         FROM documents
         WHERE duplicate_of_document_id = ? AND extraction_status IN ('pending', 'processing')`
    ).bind(sourceDocumentId).all<{ id: string }>()

    if (!duplicates.results || duplicates.results.length === 0) return

    const sourceChunks = await env.DB.prepare(
        'SELECT chunk_index, chunk_text, section_tags FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC'
    ).bind(sourceDocumentId).all<{
        chunk_index: number
        chunk_text: string
        section_tags: string
    }>()

    const baseChunks = sourceChunks.results || []
    for (const duplicate of duplicates.results) {
        if (baseChunks.length > 0) {
            const chunkInsertStatements = baseChunks.map((chunk) =>
                env.DB.prepare(
                    `INSERT INTO document_chunks (id, document_id, project_id, chunk_index, chunk_text, section_tags)
                     VALUES (?, ?, ?, ?, ?, ?)`
                ).bind(
                    crypto.randomUUID(),
                    duplicate.id,
                    projectId,
                    chunk.chunk_index,
                    chunk.chunk_text,
                    chunk.section_tags
                )
            )
            await env.DB.batch(chunkInsertStatements)
        }

        await env.DB.prepare(
            "UPDATE documents SET extraction_status = 'done', extraction_error = NULL WHERE id = ?"
        ).bind(duplicate.id).run()
    }

    console.log(`[DocQueue] Replicated ${baseChunks.length} chunks from ${sourceDocumentId} to ${duplicates.results.length} duplicate documents`)
}

async function markDuplicateFailures(
    env: Bindings,
    sourceDocumentId: string,
    errorMessage: string
) {
    await env.DB.prepare(
        `UPDATE documents
         SET extraction_status = 'failed', extraction_error = ?
         WHERE duplicate_of_document_id = ? AND extraction_status IN ('pending', 'processing')`
    ).bind(errorMessage, sourceDocumentId).run()
}

async function embedChunkBatch(
    env: Bindings,
    records: PendingChunkRecord[],
    projectId: string,
    documentId: string
) {
    const vectorsToInsert: Array<{
        id: string
        values: number[]
        metadata: {
            project_id: string
            document_id: string
            chunk_index: number
            chunk_text: string
        }
    }> = []

    for (let i = 0; i < records.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = records.slice(i, i + EMBEDDING_BATCH_SIZE)
        try {
            const embedResponse = await env.AI.run('@cf/qwen/qwen3-embedding-0.6b', {
                text: batch.map((record) => record.chunkText.substring(0, 512))
            }) as any

            const embeddedVectors = Array.isArray(embedResponse?.data) ? embedResponse.data : []
            embeddedVectors.forEach((values: number[] | undefined, index: number) => {
                const record = batch[index]
                if (!record || !Array.isArray(values)) return
                vectorsToInsert.push({
                    id: record.chunkId,
                    values,
                    metadata: {
                        project_id: projectId,
                        document_id: documentId,
                        chunk_index: record.chunkIndex,
                        chunk_text: record.chunkText.substring(0, 1000),
                    }
                })
            })
        } catch (batchError) {
            console.warn(`[DocQueue] Batch embedding failed for chunks ${i}-${i + batch.length - 1}, falling back to per-chunk mode`, batchError)
            for (const record of batch) {
                try {
                    const embedResponse = await env.AI.run('@cf/qwen/qwen3-embedding-0.6b', {
                        text: [record.chunkText.substring(0, 512)]
                    }) as any
                    const values = embedResponse?.data?.[0]
                    if (!Array.isArray(values)) continue
                    vectorsToInsert.push({
                        id: record.chunkId,
                        values,
                        metadata: {
                            project_id: projectId,
                            document_id: documentId,
                            chunk_index: record.chunkIndex,
                            chunk_text: record.chunkText.substring(0, 1000),
                        }
                    })
                } catch (singleError) {
                    console.warn(`[DocQueue] Embedding failed for chunk ${record.chunkIndex}`, singleError)
                }
            }
        }
    }

    return vectorsToInsert
}

/**
 * Queue consumer: process a single uploaded document
 * 1. Fetch from R2
 * 2. AI.toMarkdown → Markdown text
 * 3. Semantic chunk (LLM)
 * 4. AI classify → which sections
 * 5. Embed → Vectorize
 * 6. INSERT INTO document_chunks
 * 7. UPDATE documents SET extraction_status = 'done'
 */
export async function processDocumentQueue(
    batch: MessageBatch<DocProcessingMessage>,
    env: Bindings
): Promise<void> {
    for (const msg of batch.messages) {
        const { documentId, projectId, r2Key, fileName, contentType } = msg.body
        console.log(`[DocQueue] Processing document ${documentId} (${fileName})`)

        try {
            // --- Mark as processing ---
            await env.DB.prepare(
                "UPDATE documents SET extraction_status = 'processing' WHERE id = ?"
            ).bind(documentId).run()

            // Clean up any previous partial run so queue retries remain idempotent.
            const existingChunks = await env.DB.prepare(
                'SELECT id FROM document_chunks WHERE document_id = ?'
            ).bind(documentId).all()
            if (existingChunks.results && existingChunks.results.length > 0) {
                const existingChunkIds = existingChunks.results.map((row) => row.id as string)
                try {
                    await env.VECTORIZE.deleteByIds(existingChunkIds)
                } catch (vectorErr) {
                    console.warn(`[DocQueue] Failed to cleanup stale vectors for ${documentId}`, vectorErr)
                }
                await env.DB.prepare('DELETE FROM document_chunks WHERE document_id = ?').bind(documentId).run()
            }

            // --- 1. Fetch binary from R2 ---
            const r2Object = await env.sbir_saas_bucket.get(r2Key)
            if (!r2Object) throw new Error(`R2 object not found: ${r2Key}`)
            const arrayBuffer = await r2Object.arrayBuffer()

            // --- 2. Convert to Markdown via Gemini 1.5 Flash (BYOK) ---
            // Bug EE1 fix: env.AI.toMarkdown() was completely hallucinated. Cloudflare AI has no file parsing API.
            // Using the user's Gemini key to perform multimodal extraction.
            const userKeys = await env.DB.prepare(
                'SELECT u.gemini_key FROM documents d JOIN projects p ON d.project_id = p.id JOIN users u ON p.user_id = u.id WHERE d.id = ?'
            ).bind(documentId).first<{ gemini_key: string | null }>()

            let markdown = ''

            const geminiKey = await decryptSecret(userKeys?.gemini_key || null, env)
            if (geminiKey) {
                // Convert arrayBuffer to base64 safely in chunks to avoid call stack overflow
                let binary = '';
                const bytes = new Uint8Array(arrayBuffer);
                const len = bytes.byteLength;
                const chunkSize = 8192;
                for (let i = 0; i < len; i += chunkSize) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as unknown as number[]);
                }
                const base64Data = btoa(binary);

                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
                const apiRes = await fetch(geminiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: "請精確地將這份文件的文字內容擷取出來，並格式化為乾淨的 Markdown 格式。請保留原始的層級結構。不要加入任何對話、問候或說明文字，只輸出文件的內容。" },
                                { inlineData: { mimeType: contentType, data: base64Data } }
                            ]
                        }]
                    })
                });

                if (!apiRes.ok) {
                    const errText = await apiRes.text();
                    throw new Error(`Gemini API 檔案解析失敗: ${errText}`);
                }
                const data = await apiRes.json() as any;
                markdown = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } else {
                throw new Error('解析文件需要 Gemini API 金鑰 (BYOK)。請至「設定」頁面綁定您的 Gemini 參數，因 Cloudflare 本機 AI 不支援直接解析 PDF/Word。');
            }

            if (!markdown || markdown.trim().length < 30) {
                throw new Error('Gemini 回傳的內容過短或無法解析文本。')
            }
            console.log(`[DocQueue] Markdown extracted, length=${markdown.length}`)

            // --- 3. Semantic chunking via LLM ---
            let semanticChunks: string[] = []
            try {
                const chunkPrompt = `You are a professional editor. Analyze the following document text and break it into a JSON array of distinct, semantically complete paragraphs or concepts. DO NOT change the original wording, just split it. Output ONLY a valid JSON array of strings, nothing else.

Document text:
${markdown.substring(0, 8000)}`

                const aiResponse = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
                    messages: [
                        { role: 'system', content: 'You are a JSON chunking assistant. Only output a valid JSON array of strings.' },
                        { role: 'user', content: chunkPrompt }
                    ]
                }) as any

                const rawContent: string = aiResponse?.choices?.[0]?.message?.content || (aiResponse?.response as string) || '[]'
                const jsonStr = rawContent.match(/\[[\s\S]*\]/)?.[0] || '[]'
                const parsed: string[] = JSON.parse(jsonStr)
                semanticChunks = parsed.filter(c => c && c.trim().length > 30)
            } catch (err) {
                console.warn(`[DocQueue] LLM chunking failed, falling back to paragraph split`, err)
                semanticChunks = markdown.split(/\n\n+/).filter(c => c.trim().length > 30)
            }

            if (semanticChunks.length === 0) {
                semanticChunks = [markdown.substring(0, 2000)]
            }

            console.log(`[DocQueue] Got ${semanticChunks.length} chunks`)

            // --- 4. For each chunk: AI classify + Embed + store ---
            const sectionList = SECTIONS.map(s => `${s.index}.${s.name}`).join('、')
            const pendingChunkRecords: PendingChunkRecord[] = []

            for (let i = 0; i < semanticChunks.length; i++) {
                const chunkText = semanticChunks[i].trim()
                if (!chunkText) continue

                // AI section classification
                let sectionTags: number[] = []
                try {
                    const classifyResult = await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
                        messages: [
                            { role: 'system', content: '/no_think你是 SBIR 文件分類專家，只輸出 JSON 數字陣列。' },
                            { role: 'user', content: `以下是 SBIR 計畫書的八個區塊：${sectionList}\n\n請判斷下面這段文字最適合用在哪些區塊（可多選，最多3個），只輸出數字陣列 JSON，例如 [1,3]：\n\n${chunkText.substring(0, 500)}` }
                        ],
                        max_tokens: 30,
                        temperature: 0.1,
                    }) as any
                    const raw = classifyResult?.choices?.[0]?.message?.content || classifyResult?.response || '[]'
                    const matched = raw.match(/\[[\d,\s]*\]/)
                    if (matched) {
                        sectionTags = JSON.parse(matched[0]).filter((n: number) => n >= 1 && n <= 8)
                    }
                } catch {
                    sectionTags = []
                }

                const chunkId = crypto.randomUUID()
                pendingChunkRecords.push({
                    chunkId,
                    chunkIndex: i,
                    chunkText,
                    sectionTags,
                })
            }

            if (pendingChunkRecords.length > 0) {
                const insertStatements = pendingChunkRecords.map((record) =>
                    env.DB.prepare(
                        `INSERT INTO document_chunks (id, document_id, project_id, chunk_index, chunk_text, section_tags)
                         VALUES (?, ?, ?, ?, ?, ?)`
                    ).bind(
                        record.chunkId,
                        documentId,
                        projectId,
                        record.chunkIndex,
                        record.chunkText,
                        JSON.stringify(record.sectionTags)
                    )
                )

                for (let i = 0; i < insertStatements.length; i += D1_BATCH_SIZE) {
                    await env.DB.batch(insertStatements.slice(i, i + D1_BATCH_SIZE))
                }
            }

            const vectorsToInsert = await embedChunkBatch(env, pendingChunkRecords, projectId, documentId)

            if (vectorsToInsert.length > 0) {
                for (let i = 0; i < vectorsToInsert.length; i += VECTORIZE_BATCH_SIZE) {
                    const batch = vectorsToInsert.slice(i, i + VECTORIZE_BATCH_SIZE);
                    await env.VECTORIZE.insert(batch);
                }
                console.log(`[DocQueue] Inserted ${vectorsToInsert.length} vectors into Vectorize`)
            }

            // --- 5. Mark as done ---
            await env.DB.prepare(
                "UPDATE documents SET extraction_status = 'done' WHERE id = ?"
            ).bind(documentId).run()
            await replicateChunksToDuplicates(env, documentId, projectId)

            console.log(`[DocQueue] Done: document ${documentId}, ${semanticChunks.length} chunks`)
            msg.ack()

        } catch (err: any) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            console.error(`[DocQueue] Failed for document ${documentId}:`, errorMessage)
            await env.DB.prepare(
                "UPDATE documents SET extraction_status = 'failed', extraction_error = ? WHERE id = ?"
            ).bind(errorMessage, documentId).run()
            await markDuplicateFailures(env, documentId, errorMessage)

            const isFatal =
                errorMessage.includes('Gemini API 金鑰') ||
                errorMessage.includes('R2 object not found') ||
                errorMessage.includes('檔案內容與副檔名不符') ||
                errorMessage.includes('無法解析文本')

            if (isFatal || msg.attempts >= 5) {
                msg.ack()
                continue
            }

            await env.DB.prepare(
                "UPDATE documents SET extraction_status = 'pending' WHERE id = ?"
            ).bind(documentId).run()
            msg.retry({ delaySeconds: 30 })
        }
    }
}
