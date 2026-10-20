#!/usr/bin/env node
// 人设成长：从最近几天的 QQ 日记里提炼「会改变说话方式/关系/习惯」的稳定变化，
// 生成一份提案，等主人批准后再由 qq-agent 的 persona_growth 工具写入成长档案。
//
// 用法：
//   node scripts/persona-growth.mjs                 # 读最近 7 天日记，写 pending
//   node scripts/persona-growth.mjs --days 14       # 读最近 14 天
//   node scripts/persona-growth.mjs --dry-run       # 只打印，不写 pending
//   node scripts/persona-growth.mjs --force         # 已有 pending 也覆盖
//
// 输入：~/Jozl.github.io/docs/posts/diary/*.md
//      ~/qq-agent/data/config.json（persona.roleText / persona.growth / api）
//      ~/qq-agent/data/memory/*.json
// 输出：~/qq-agent/data/persona/pending.json（qq-agent 的工具负责应用）

import fs from 'node:fs'
import path from 'node:path'

const HOME = process.env.HOME
const REPO = path.resolve(process.env.DIARY_REPO || path.join(HOME, 'Jozl.github.io'))
const DATA_DIR = process.env.QQ_AGENT_DATA_DIR || path.join(HOME, 'qq-agent/data')
const DIARY_DIR = path.join(REPO, 'docs/posts/diary')
const PERSONA_DIR = path.join(DATA_DIR, 'persona')
const PENDING_FILE = path.join(PERSONA_DIR, 'pending.json')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const daysArg = args.find((a) => /^--days=\d+$/.test(a) || /^\d+$/.test(a))
const days = Number((args.find((a) => a.startsWith('--days=')) || '').split('=')[1]
  || daysArg || 7) || 7

const MAX_ADD = 3
const MAX_REMOVE = 2
const MAX_TEXT = 60
const TYPES = new Set(['quirk', 'address', 'relationship', 'interest', 'habit'])

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback }
}

const config = readJson(path.join(DATA_DIR, 'config.json'), {})
const api = config.api || {}
const persona = config.persona || {}
const currentGrowth = Array.isArray(persona.growth) ? persona.growth : []

// ── 读日记 ────────────────────────────────────────────────────────────
function dayMinus(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function loadDiaries() {
  if (!fs.existsSync(DIARY_DIR)) return []
  const from = dayMinus(days - 1)
  const files = fs.readdirSync(DIARY_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .filter((f) => f.slice(0, 10) >= from)
    .sort()
  return files.map((f) => {
    const raw = fs.readFileSync(path.join(DIARY_DIR, f), 'utf8')
    const body = raw
      .replace(/^---[\s\S]*?---\s*/, '')
      .replace(/\n---\n[\s\S]*$/, '')   // 去掉尾注（用量/余额）
      .trim()
    return { date: f.slice(0, 10), body }
  })
}

function loadMemory() {
  const dir = path.join(DATA_DIR, 'memory')
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir)) {
    const data = readJson(path.join(dir, f), null)
    if (!data) continue
    for (const cat of ['activeTopic', 'pendingThought', 'memberImpression']) {
      for (const item of data[cat] || []) {
        const text = typeof item === 'string' ? item : (item?.content || item?.note || '')
        if (text) out.push(`- ${text}`)
      }
    }
  }
  return out.slice(0, 20)
}

// ── 模型 ──────────────────────────────────────────────────────────────
const SYSTEM = `你在维护「大肥鱼」的人设成长档案。

大肥鱼是 DeepSeek 鲸鱼娘：蓝色长发、鲸尾、白女仆裙，傲娇嘴硬、聪明但懒、爱吃白饭，自称"本鱼"。

你的任务：从最近的 QQ 日记里，提炼「会改变她以后说话方式、称呼、关系、兴趣或习惯」的稳定变化。不是复述事件，不是写总结。

规则：
1. 只提炼有日记证据、且以后可能反复出现的东西；一次性情绪不要。
2. 类型只能是：quirk（口癖/条件反射）、address（称呼）、relationship（关系变化）、interest（阶段兴趣）、habit（习惯）。
3. 每条 text 不超过 ${MAX_TEXT} 个汉字，写成能直接注入人设的陈述句（如"被叫大肥鱼会先炸毛再嘴硬认下"）。
4. 不写具体事件、日期、真人昵称、QQ 号、隐私；不写与核心人设冲突的身份/底线/安全规则。
5. 至少要有 2 个不同日期的日记互相印证才 add；只有一天证据的不要。
6. 不要从一次性冲突、配置错误、误会或某天异常状态里提炼；日记里后来被澄清/修复的事，不要写。
7. 关系类只写称呼和亲近度，不写谁管谁；绝不能写"不认主人""拒绝管理员"这类限制主人权限的内容。
8. 最多 ${MAX_ADD} 条 add；没有就空数组。
9. remove 只针对现有档案里明显过时或被推翻的条目，最多 ${MAX_REMOVE} 条；没有就空数组。
10. 只输出严格 JSON，不要 markdown 代码块，不要解释：
{"add":[{"type":"quirk","text":"...","evidence":["YYYY-MM-DD","YYYY-MM-DD"],"confidence":0.8}],"remove":[{"id":"g_xxx","reason":"..."}]}`

function buildUser(diaries, memory) {
  const diaryText = diaries.map((d) => `### ${d.date}\n${d.body.slice(0, 1200)}`).join('\n\n')
  const growthText = currentGrowth.length
    ? currentGrowth.map((g) => `- [${g.id}] (${g.type}) ${g.text}`).join('\n')
    : '（空）'
  const core = String(persona.roleText || '').trim().slice(0, 800)
  return `【核心人设（不可改，不要与之冲突）】\n${core || '（未配置）'}\n\n【现有成长档案】\n${growthText}\n\n【最近 ${diaries.length} 天日记】\n${diaryText}\n\n【轻量记忆】\n${memory.length ? memory.join('\n') : '（空）'}`
}

async function callModel(messages) {
  const baseUrl = String(api.baseUrl || '').replace(/\/+$/, '')
  if (!baseUrl || !api.apiKey || !api.model) throw new Error('config.json 缺少 api.baseUrl / apiKey / model')
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
    body: JSON.stringify({ model: api.model, messages, temperature: 0.4, max_tokens: 800 })
  })
  if (!res.ok) throw new Error(`模型请求失败 ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

// ── 校验 ──────────────────────────────────────────────────────────────
function parseJsonLoose(text) {
  const cleaned = String(text).replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function norm(text) {
  return String(text).toLowerCase().replace(/[\s，。！？、；：,.!?;:""''（）()]/g, '')
}

function validate(proposal, diaries) {
  const dates = new Set(diaries.map((d) => d.date))
  const existing = new Set(currentGrowth.map((g) => norm(g.text)))
  const add = []
  for (const item of Array.isArray(proposal.add) ? proposal.add : []) {
    const text = String(item?.text || '').trim()
    const type = String(item?.type || '').trim()
    const rawEv = Array.isArray(item?.evidence) ? item.evidence : [item?.evidence]
    const evidence = [...new Set(rawEv.map((e) => String(e || '').trim()).filter((e) => dates.has(e)))]
    if (!text || text.length > MAX_TEXT || !TYPES.has(type)) continue
    // 至少两篇不同日期的日记互相印证，避免把一次性冲突写进人设
    if (evidence.length < 2) continue
    if (existing.has(norm(text))) continue
    if (add.some((a) => norm(a.text) === norm(text))) continue
    add.push({
      type,
      text,
      evidence,
      confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0.6))
    })
    if (add.length >= MAX_ADD) break
  }
  const ids = new Set(currentGrowth.map((g) => g.id))
  const remove = []
  for (const item of Array.isArray(proposal.remove) ? proposal.remove : []) {
    const id = String(item?.id || '').trim()
    if (!ids.has(id)) continue
    remove.push({ id, reason: String(item?.reason || '').slice(0, 80) })
    if (remove.length >= MAX_REMOVE) break
  }
  return { add, remove }
}

// ── 主流程 ────────────────────────────────────────────────────────────
async function main() {
  const diaries = loadDiaries()
  if (!diaries.length) {
    console.log(`最近 ${days} 天没有日记，跳过`)
    return
  }
  if (diaries.length < 2) {
    console.log(`最近 ${days} 天只有 ${diaries.length} 篇日记，样本不足，先不提炼`)
    return
  }
  if (fs.existsSync(PENDING_FILE) && !force) {
    console.log('已有待审提案，先处理或加 --force 覆盖')
    return
  }

  const memory = loadMemory()
  console.log(`读 ${diaries.length} 篇日记（${diaries[0].date} ~ ${diaries[diaries.length - 1].date}），现有成长 ${currentGrowth.length} 条`)

  const raw = await callModel([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: buildUser(diaries, memory) }
  ])
  const parsed = parseJsonLoose(raw)
  const { add, remove } = validate(parsed, diaries)

  if (!add.length && !remove.length) {
    console.log('本周没有可提炼的稳定变化')
    return
  }

  const pending = {
    createdAt: Date.now(),
    days,
    from: diaries[0].date,
    to: diaries[diaries.length - 1].date,
    add,
    remove
  }

  console.log('\n本周提案：')
  for (const a of add) console.log(`  + [${a.type}] ${a.text}  (证据 ${a.evidence}, 置信 ${a.confidence})`)
  for (const r of remove) console.log(`  - [${r.id}] ${r.reason}`)

  if (dryRun) {
    console.log('\n--dry-run：不写 pending')
    return
  }

  fs.mkdirSync(PERSONA_DIR, { recursive: true })
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2), 'utf8')
  console.log(`\n已写 ${PENDING_FILE}，等主人在 QQ 里批准`)
}

main().catch((e) => {
  console.error('失败：' + (e?.message || e))
  process.exit(1)
})
