#!/usr/bin/env node
// 把材料库（~/research-archive/research/<slug>/）里的成品 report.md
// 同步成站上的 docs/research/<slug>/index.md。
//
// 用法：
//   npm run research:sync -- <slug>     # 同步一个
//   npm run research:sync -- --all      # 同步全部（跳过 _ 开头的目录）
//   npm run research:check -- <slug>    # 只校验，不写文件
//
// 材料库路径可用 RESEARCH_SRC 覆盖，默认 ../research-archive/research

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_ROOT =
  process.env.RESEARCH_SRC || path.resolve(ROOT, '../research-archive/research')
const OUT_ROOT = path.join(ROOT, 'docs/research')

const STAGES = ['r1', 'r2', 'r3', 'final']
const STATUSES = ['ongoing', 'paused', 'done']
const STATUS_LABEL = { ongoing: '进行中', paused: '暂停', done: '已完成' }
const REQUIRED = ['slug', 'title', 'category', 'started', 'updated', 'stage', 'status']

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const all = args.includes('--all')
const targets = args.filter((a) => !a.startsWith('--'))

// 扁平 YAML 解析：只支持 `key: value` 和 `key:` 后跟 `- item` 列表，够 meta.yml 用
function parseMeta(text) {
  const out = {}
  let key = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd()
    if (!line.trim() || line.trim().startsWith('#')) continue
    const item = line.match(/^\s*-\s+(.+)$/)
    if (item && key) {
      out[key].push(unquote(item[1]))
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    key = kv[1]
    const value = kv[2].trim()
    out[key] = value === '' ? [] : unquote(value)
  }
  return out
}

function unquote(s) {
  return s.replace(/^['"]|['"]$/g, '').trim()
}

// 数 sources/index.md 里表格的数据行（跳过表头、分隔线和空行）
function countSources(dir) {
  const file = path.join(dir, 'sources/index.md')
  if (!fs.existsSync(file)) return 0
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*\|\s*S\d+\s*\|/.test(l)).length
}

function loadProject(slug) {
  const dir = path.join(SRC_ROOT, slug)
  const errors = []

  if (!fs.existsSync(dir)) return { errors: [`目录不存在：${dir}`] }
  const metaFile = path.join(dir, 'meta.yml')
  if (!fs.existsSync(metaFile)) return { errors: [`缺 meta.yml：${metaFile}`] }

  const meta = parseMeta(fs.readFileSync(metaFile, 'utf8'))
  for (const key of REQUIRED) {
    if (!meta[key] || (Array.isArray(meta[key]) && meta[key].length === 0)) {
      errors.push(`meta.yml 缺必填字段：${key}`)
    }
  }
  if (meta.stage && !STAGES.includes(meta.stage)) {
    errors.push(`stage 只能是 ${STAGES.join(' / ')}，现在是：${meta.stage}`)
  }
  if (meta.status && !STATUSES.includes(meta.status)) {
    errors.push(`status 只能是 ${STATUSES.join(' / ')}，现在是：${meta.status}`)
  }
  if (meta.slug && meta.slug !== slug) {
    errors.push(`meta.yml 的 slug（${meta.slug}）和目录名（${slug}）不一致`)
  }

  const reportFile = path.join(dir, 'report.md')
  if (!fs.existsSync(reportFile)) {
    errors.push(`缺 report.md：${reportFile}`)
  } else if (!fs.readFileSync(reportFile, 'utf8').trim()) {
    errors.push('report.md 是空的')
  }

  return { dir, meta, reportFile, errors, sources: countSources(dir) }
}

function render({ meta, reportFile, sources }) {
  const body = fs.readFileSync(reportFile, 'utf8').trim()
  const tags = (Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : [])
    .map((t) => `  - ${t}`)
    .join('\n')
  const frontmatter = [
    '---',
    `title: ${meta.title}`,
    `date: ${meta.started}`,
    `updated: ${meta.updated}`,
    `categories:`,
    `  - ${meta.category}`,
    tags ? `tags:\n${tags}` : null,
    `kind: research`,
    `stage: ${meta.stage}`,
    `status: ${meta.status}`,
    `sources: ${sources}`,
    '---',
  ]
    .filter(Boolean)
    .join('\n')

  // 阶段状态卡：读者一眼知道这是会变的阶段稿
  const card = [
    `> **调研阶段 ${meta.stage} · ${STATUS_LABEL[meta.status]}** ｜ 更新于 ${meta.updated}`,
    `> ｜ 来源 ${sources} 条 ｜ 阶段稿会持续修订，结论可能变化。`,
  ].join('\n')

  return `${frontmatter}\n\n${card}\n\n${body}\n`
}

function sync(slug) {
  const project = loadProject(slug)
  if (project.errors.length) {
    console.error(`✗ ${slug}`)
    for (const e of project.errors) console.error(`  - ${e}`)
    return false
  }

  const outDir = path.join(OUT_ROOT, slug)
  const outFile = path.join(outDir, 'index.md')
  const content = render(project)

  if (checkOnly) {
    console.log(`✓ ${slug}（校验通过，未写入）`)
    return true
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outFile, content)
  console.log(`✓ ${slug} → docs/research/${slug}/index.md`)
  return true
}

function listSlugs() {
  if (!fs.existsSync(SRC_ROOT)) {
    console.error(`材料库不存在：${SRC_ROOT}`)
    process.exit(1)
  }
  return fs
    .readdirSync(SRC_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort()
}

const slugs = all ? listSlugs() : targets
if (!slugs.length) {
  console.error('用法：npm run research:sync -- <slug> ｜ --all')
  console.error(`材料库：${SRC_ROOT}`)
  console.error(`可用项目：${listSlugs().join('、') || '（无）'}`)
  process.exit(1)
}

const failed = slugs.filter((slug) => !sync(slug))
if (failed.length) {
  console.error(`\n失败：${failed.join('、')}`)
  process.exit(1)
}
