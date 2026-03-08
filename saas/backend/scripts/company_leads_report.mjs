#!/usr/bin/env node

import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const DEFAULT_DB_NAME = process.env.DB_NAME || 'sbir-saas-db'
const DEFAULT_OUTPUT_PATH = '/tmp/company-leads-report.md'
const DEFAULT_LIMIT = 100
const DEFAULT_MIN_SEARCHES = 1

const usage = () => {
  console.error(
    [
      'Usage:',
      '  CLOUDFLARE_API_TOKEN=... node scripts/company_leads_report.mjs [options]',
      '',
      'Options:',
      '  --output <path>         Output file path',
      '  --format <md|csv|json>  Output format (default: md)',
      '  --since <YYYY-MM-DD>    Include records on/after date',
      '  --until <YYYY-MM-DD>    Include records before next day of date',
      '  --user-id <id>          Filter by user id',
      '  --project-id <id>       Filter by project id',
      '  --min-searches <n>      Minimum aggregated search count (default: 1)',
      '  --limit <n>             Maximum lead rows (default: 100)',
      '  --db <name>             D1 database name (default: sbir-saas-db)',
    ].join('\n')
  )
}

const parseArgs = (argv) => {
  const options = {
    output: DEFAULT_OUTPUT_PATH,
    format: 'md',
    since: '',
    until: '',
    userId: '',
    projectId: '',
    minSearches: DEFAULT_MIN_SEARCHES,
    limit: DEFAULT_LIMIT,
    dbName: DEFAULT_DB_NAME,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--output' && next) {
      options.output = next
      i += 1
      continue
    }
    if (arg === '--format' && next) {
      options.format = next
      i += 1
      continue
    }
    if (arg === '--since' && next) {
      options.since = next
      i += 1
      continue
    }
    if (arg === '--until' && next) {
      options.until = next
      i += 1
      continue
    }
    if (arg === '--user-id' && next) {
      options.userId = next
      i += 1
      continue
    }
    if (arg === '--project-id' && next) {
      options.projectId = next
      i += 1
      continue
    }
    if (arg === '--min-searches' && next) {
      options.minSearches = Number.parseInt(next, 10)
      i += 1
      continue
    }
    if (arg === '--limit' && next) {
      options.limit = Number.parseInt(next, 10)
      i += 1
      continue
    }
    if (arg === '--db' && next) {
      options.dbName = next
      i += 1
      continue
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`)
  }

  return options
}

const assertValidDate = (value, label) => {
  if (!value) return
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format`)
  }
}

const escapeSqlLiteral = (value) => String(value).replace(/'/g, "''")

const buildWhereClause = (options) => {
  const conditions = []

  if (options.since) {
    conditions.push(`created_at >= '${escapeSqlLiteral(options.since)} 00:00:00'`)
  }

  if (options.until) {
    conditions.push(`created_at < datetime('${escapeSqlLiteral(options.until)} 00:00:00', '+1 day')`)
  }

  if (options.userId) {
    conditions.push(`user_id = '${escapeSqlLiteral(options.userId)}'`)
  }

  if (options.projectId) {
    conditions.push(`project_id = '${escapeSqlLiteral(options.projectId)}'`)
  }

  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
}

const buildSql = (options) => {
  const whereClause = buildWhereClause(options)
  const minSearches = Number.isFinite(options.minSearches) && options.minSearches > 0
    ? options.minSearches
    : DEFAULT_MIN_SEARCHES
  const limit = Number.isFinite(options.limit) && options.limit > 0
    ? options.limit
    : DEFAULT_LIMIT

  return `
WITH filtered_events AS (
  SELECT *
  FROM company_search_events
  ${whereClause}
),
aggregated AS (
  SELECT
    normalized_query AS company_query,
    MAX(COALESCE(NULLIF(official_name, ''), query)) AS display_name,
    COUNT(*) AS search_count,
    COUNT(DISTINCT user_id) AS unique_users,
    COUNT(DISTINCT CASE
      WHEN project_id IS NOT NULL AND project_id != '' THEN project_id
    END) AS project_count,
    MAX(found_count) AS max_found_count,
    MAX(created_at) AS last_searched_at,
    GROUP_CONCAT(DISTINCT user_id) AS user_ids,
    GROUP_CONCAT(DISTINCT CASE
      WHEN project_id IS NOT NULL AND project_id != '' THEN project_id
    END) AS project_ids
  FROM filtered_events
  GROUP BY normalized_query
  HAVING COUNT(*) >= ${minSearches}
)
SELECT
  company_query,
  display_name,
  search_count,
  unique_users,
  project_count,
  max_found_count,
  last_searched_at,
  user_ids,
  project_ids
FROM aggregated
ORDER BY search_count DESC, unique_users DESC, project_count DESC, last_searched_at DESC
LIMIT ${limit};
`.trim()
}

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

const scoreLead = (row) => {
  const searchCount = Number(row.search_count || 0)
  const uniqueUsers = Number(row.unique_users || 0)
  const projectCount = Number(row.project_count || 0)
  const foundCount = Number(row.max_found_count || 0)

  const leadScore = searchCount * 3 + uniqueUsers * 5 + projectCount * 4 + (foundCount > 0 ? 2 : 0)

  let priority = 'cold'
  if (leadScore >= 20 || searchCount >= 4 || uniqueUsers >= 2 || projectCount >= 2) {
    priority = 'hot'
  } else if (leadScore >= 10 || searchCount >= 2) {
    priority = 'warm'
  }

  return {
    ...row,
    search_count: searchCount,
    unique_users: uniqueUsers,
    project_count: projectCount,
    max_found_count: foundCount,
    lead_score: leadScore,
    priority,
    user_ids: row.user_ids ? String(row.user_ids).split(',').filter(Boolean) : [],
    project_ids: row.project_ids ? String(row.project_ids).split(',').filter(Boolean) : [],
  }
}

const escapeCsv = (value) => {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const formatCsv = (rows) => {
  const header = [
    'priority',
    'lead_score',
    'company_query',
    'display_name',
    'search_count',
    'unique_users',
    'project_count',
    'max_found_count',
    'last_searched_at',
    'user_ids',
    'project_ids',
  ]

  return [
    header.join(','),
    ...rows.map((row) => [
      row.priority,
      row.lead_score,
      row.company_query,
      row.display_name,
      row.search_count,
      row.unique_users,
      row.project_count,
      row.max_found_count,
      row.last_searched_at,
      row.user_ids.join('|'),
      row.project_ids.join('|'),
    ].map(escapeCsv).join(',')),
  ].join('\n')
}

const formatJson = (rows, options) => {
  const summary = {
    generated_at: new Date().toISOString(),
    filters: {
      since: options.since || null,
      until: options.until || null,
      user_id: options.userId || null,
      project_id: options.projectId || null,
      min_searches: options.minSearches,
      limit: options.limit,
    },
    totals: {
      lead_count: rows.length,
      hot_count: rows.filter((row) => row.priority === 'hot').length,
      warm_count: rows.filter((row) => row.priority === 'warm').length,
      cold_count: rows.filter((row) => row.priority === 'cold').length,
      total_search_events: rows.reduce((sum, row) => sum + row.search_count, 0),
    },
    leads: rows,
  }

  return JSON.stringify(summary, null, 2)
}

const formatMarkdown = (rows, options) => {
  const hot = rows.filter((row) => row.priority === 'hot')
  const warm = rows.filter((row) => row.priority === 'warm')
  const cold = rows.filter((row) => row.priority === 'cold')
  const totalEvents = rows.reduce((sum, row) => sum + row.search_count, 0)

  const filterLines = [
    `- since: ${options.since || 'ALL'}`,
    `- until: ${options.until || 'ALL'}`,
    `- user_id: ${options.userId || 'ALL'}`,
    `- project_id: ${options.projectId || 'ALL'}`,
    `- min_searches: ${options.minSearches}`,
    `- limit: ${options.limit}`,
  ]

  const topTableHeader = '| Priority | Score | Company | Searches | Users | Projects | Last Seen |'
  const topTableDivider = '|---|---:|---|---:|---:|---:|---|'
  const topTableRows = rows.slice(0, 20).map((row) => (
    `| ${row.priority.toUpperCase()} | ${row.lead_score} | ${row.display_name || row.company_query} | ${row.search_count} | ${row.unique_users} | ${row.project_count} | ${row.last_searched_at || ''} |`
  ))

  const detailSections = rows.slice(0, 30).map((row, index) => (
    [
      `### ${index + 1}. ${row.display_name || row.company_query}`,
      `- priority: ${row.priority}`,
      `- lead_score: ${row.lead_score}`,
      `- normalized_query: ${row.company_query}`,
      `- search_count: ${row.search_count}`,
      `- unique_users: ${row.unique_users}`,
      `- project_count: ${row.project_count}`,
      `- max_found_count: ${row.max_found_count}`,
      `- last_searched_at: ${row.last_searched_at || ''}`,
      `- user_ids: ${row.user_ids.join(', ') || 'N/A'}`,
      `- project_ids: ${row.project_ids.join(', ') || 'N/A'}`,
    ].join('\n')
  ))

  return [
    '# Company Leads Report',
    '',
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Filters',
    ...filterLines,
    '',
    '## Summary',
    `- total_leads: ${rows.length}`,
    `- total_search_events: ${totalEvents}`,
    `- hot: ${hot.length}`,
    `- warm: ${warm.length}`,
    `- cold: ${cold.length}`,
    '',
    '## Top Leads',
    topTableHeader,
    topTableDivider,
    ...topTableRows,
    '',
    '## Lead Details',
    ...detailSections,
    '',
  ].join('\n')
}

const main = () => {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('CLOUDFLARE_API_TOKEN is required')
  }

  const options = parseArgs(process.argv.slice(2))
  assertValidDate(options.since, 'since')
  assertValidDate(options.until, 'until')

  if (!['md', 'csv', 'json'].includes(options.format)) {
    throw new Error('format must be one of: md, csv, json')
  }

  const sql = buildSql(options)
  const rows = runD1Query(options.dbName, sql).map(scoreLead)

  let output = ''
  if (options.format === 'csv') {
    output = formatCsv(rows)
  } else if (options.format === 'json') {
    output = formatJson(rows, options)
  } else {
    output = formatMarkdown(rows, options)
  }

  writeFileSync(options.output, output)
  console.log(`Wrote ${rows.length} leads to ${options.output} (${options.format})`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  usage()
  process.exit(1)
}
