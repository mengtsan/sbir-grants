#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const DEFAULT_DB_NAME = process.env.DB_NAME || 'sbir-saas-db'

const usage = () => {
  console.error(
    [
      'Usage:',
      '  CLOUDFLARE_API_TOKEN=... node scripts/cleanup_project_progress_data.mjs [--db <name>] [--verify-only]',
      '',
      'Options:',
      '  --db <name>        D1 database name (default: sbir-saas-db)',
      '  --verify-only      Only verify whether progress_data still contains wizardAnswers',
      '  --assert-clean     Exit non-zero unless verify-only finds zero pending updates and zero legacy wizardAnswers',
    ].join('\n')
  )
}

const parseArgs = (argv) => {
  const options = {
    dbName: DEFAULT_DB_NAME,
    verifyOnly: false,
    assertClean: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--db' && next) {
      options.dbName = next
      i += 1
      continue
    }
    if (arg === '--verify-only') {
      options.verifyOnly = true
      continue
    }
    if (arg === '--assert-clean') {
      options.assertClean = true
      continue
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`)
  }

  return options
}

const escapeSqlLiteral = (value) => String(value).replace(/'/g, "''")

const runD1Query = (dbName, sql) => {
  const result = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', dbName, '--remote', '--json', '--command', sql],
    {
      env: process.env,
      encoding: 'utf8',
    }
  )

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'wrangler d1 execute failed')
  }

  const parsed = JSON.parse(result.stdout)
  return Array.isArray(parsed?.[0]?.results) ? parsed[0].results : []
}

const safeParseJson = (raw) => {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const sortJsonValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortJsonValue(value[key])
        return acc
      }, {})
  }
  return value
}

const groupRows = (rows, keyField, valueBuilder) => {
  const grouped = new Map()
  for (const row of rows) {
    const key = row[keyField]
    if (!grouped.has(key)) {
      grouped.set(key, {})
    }
    const container = grouped.get(key)
    Object.assign(container, valueBuilder(row))
  }
  return grouped
}

const main = () => {
  const options = parseArgs(process.argv.slice(2))

  const projects = runD1Query(
    options.dbName,
    'SELECT id, progress_data FROM projects ORDER BY created_at ASC;'
  )

  const answers = runD1Query(
    options.dbName,
    `SELECT project_id, question_id, answer_text
     FROM project_answers
     WHERE question_id != 'g0v_company_data'
     ORDER BY project_id, question_id;`
  )

  const candidates = runD1Query(
    options.dbName,
    `SELECT project_id, question_id, candidate_text, candidate_source, confidence, candidate_reason, candidate_source_detail
     FROM project_answer_candidates
     ORDER BY project_id, question_id;`
  )

  const answerMapByProject = groupRows(
    answers,
    'project_id',
    (row) => ({ [row.question_id]: row.answer_text })
  )

  const candidateMapByProject = groupRows(
    candidates,
    'project_id',
    (row) => ({ [row.question_id]: row.candidate_text })
  )

  const candidateMetaByProject = groupRows(
    candidates,
    'project_id',
    (row) => ({
      [row.question_id]: {
        candidate_source: row.candidate_source || 'extract',
        confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
        candidate_reason: row.candidate_reason || null,
        candidate_source_detail: row.candidate_source_detail || null,
      },
    })
  )

  let updatedCount = 0
  let unchangedCount = 0
  let lingeringWizardAnswers = 0
  const dirtyProjectIds = []

  for (const project of projects) {
    const parsed = safeParseJson(project.progress_data)
    if (Object.prototype.hasOwnProperty.call(parsed, 'wizardAnswers')) {
      lingeringWizardAnswers += 1
    }

    const nextProgress = {
      ...parsed,
      answer_map: answerMapByProject.get(project.id) || {},
      answer_candidates: candidateMapByProject.get(project.id) || {},
      answer_candidate_meta: candidateMetaByProject.get(project.id) || {},
    }

    delete nextProgress.wizardAnswers

    const currentJson = JSON.stringify(sortJsonValue(parsed))
    const nextJson = JSON.stringify(sortJsonValue(nextProgress))

    if (currentJson === nextJson) {
      unchangedCount += 1
      continue
    }

    dirtyProjectIds.push(project.id)

    if (!options.verifyOnly) {
      runD1Query(
        options.dbName,
        `UPDATE projects
         SET progress_data = '${escapeSqlLiteral(nextJson)}',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = '${escapeSqlLiteral(project.id)}';`
      )
    }

    updatedCount += 1
  }

  const summary = {
    verify_only: options.verifyOnly,
    project_count: projects.length,
    updated_count: updatedCount,
    unchanged_count: unchangedCount,
    projects_with_legacy_wizardAnswers: lingeringWizardAnswers,
    dirty_project_ids: dirtyProjectIds,
  }

  console.log(JSON.stringify(summary, null, 2))

  if (options.assertClean) {
    if (!options.verifyOnly) {
      throw new Error('--assert-clean requires --verify-only')
    }
    if (summary.updated_count !== 0 || summary.projects_with_legacy_wizardAnswers !== 0) {
      throw new Error(`progress_data cleanup verification failed: ${JSON.stringify(summary)}`)
    }
  }
}

try {
  main()
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error(String(error))
  }
  usage()
  process.exit(1)
}
