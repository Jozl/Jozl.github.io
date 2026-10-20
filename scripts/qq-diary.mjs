#!/usr/bin/env node
// 大肥鱼 QQ 日记：把当天白名单群的聊天，按人设写成一篇日记，落到站上并推送。
//
// 用法：
//   node scripts/qq-diary.mjs                 # 写今天，自动 commit + push
//   node scripts/qq-diary.mjs --dry-run       # 只打印，不写文件
//   node scripts/qq-diary.mjs --no-push       # 写文件并 commit，不 push
//   node scripts/qq-diary.mjs 2026-10-20      # 指定日期
//   node scripts/qq-diary.mjs --demo          # 用内置样稿跑通链路（不读聊天）
//   node scripts/qq-diary.mjs --force         # 已存在也重写
//
// 数据源：~/qq-agent/data（可用 QQ_AGENT_DATA_DIR 覆盖）
// 配置：  ~/qq-agent/data/config.json 的 api / persona / allow / masterQQ
//
// 隐私：只写「大肥鱼自己」和「主人」；其他人一律代号化为「群友」；
// 输出会过滤链接、QQ 号、5 位以上数字、@ 提及。

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const HOME = process.env.HOME
const REPO = path.resolve(process.env.DIARY_REPO || path.join(HOME, 'Jozl.github.io'))
const DATA_DIR = process.env.QQ_AGENT_DATA_DIR || path.join(HOME, 'qq-agent/data')
const OUT_DIR = path.join(REPO, 'docs/posts/diary')
const LOG_FILE = path.join(DATA_DIR, 'diary.log')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const noPush = args.includes('--no-push') || dryRun
const force = args.includes('--force')
const demo = args.includes('--demo')
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || null

const MIN_MESSAGES = 5
const MAX_BODY = 1800

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`
  console.log(line)
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, line + '\n')
  } catch {}
}

// ── 时间（一律北京时间） ──────────────────────────────────────────────
const TZ = 'Asia/Shanghai'
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })

function localDay(ms = Date.now()) {
  return dayFmt.format(new Date(ms))
}
function localTime(ms) {
  return timeFmt.format(new Date(ms))
}
function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + delta * 86400000
  return dayFmt.format(new Date(t))
}

// ── 配置 ──────────────────────────────────────────────────────────────
function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

const config = readJson(path.join(DATA_DIR, 'config.json'), {})
const api = config.api || {}
const masterQQ = String(config.masterQQ || config.persona?.masterQQ || '')
const allowGroups = (config.allow?.groups ?? []).map(String)
const isDemo = demo

// ── 聊天记录 ──────────────────────────────────────────────────────────
function loadGroupMessages(day) {
  const out = []
  if (!fs.existsSync(path.join(DATA_DIR, 'messages'))) return out
  for (const f of fs.readdirSync(path.join(DATA_DIR, 'messages'))) {
    const m = /^group_(\d+)\.json$/.exec(f)
    if (!m) continue
    const gid = m[1]
    if (allowGroups.length && !allowGroups.includes(gid)) continue
    const data = readJson(path.join(DATA_DIR, 'messages', f), null)
    if (!data?.messages) continue
    for (const msg of data.messages) {
      if (!msg || !msg.ts) continue
      if (localDay(msg.ts) !== day) continue
      out.push({ ...msg, groupId: gid })
    }
  }
  return out.sort((a, b) => a.ts - b.ts)
}

function loadMemory(day) {
  // 记忆按 chatKey 存，取白名单群的
  const dir = path.join(DATA_DIR, 'memory')
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir)) {
    const m = /^group_(\d+)\.json$/.exec(f)
    if (!m) continue
    if (allowGroups.length && !allowGroups.includes(m[1])) continue
    const data = readJson(path.join(dir, f), null)
    if (!data) continue
    for (const cat of ['activeTopic', 'pendingThought', 'memberImpression']) {
      for (const item of data[cat] || []) {
        const text = typeof item === 'string' ? item : item?.content || item?.text || item?.note || ''
        if (text) out.push(`- ${text}`)
      }
    }
  }
  return out.slice(0, 20)
}

// ── 隐私：人名/号码映射 ───────────────────────────────────────────────
function buildSpeakers(messages) {
  const map = new Map()
  let idx = 0
  for (const msg of messages) {
    const id = String(msg.senderId || '')
    if (msg.self) continue
    if (masterQQ && id === masterQQ) {
      map.set(id, '主人')
      continue
    }
    if (!map.has(id)) {
      map.set(id, `群友${String.fromCharCode(65 + (idx++ % 26))}`)
    }
  }
  return map
}

function cleanText(text) {
  return String(text || '')
    .replace(/\[CQ:[^\]]+\]/g, ' ')
    .replace(/https?:\/\/\S+/g, '[链接]')
    .replace(/@\S+/g, '')          // @ 提及
    .replace(/\b\d{5,}\b/g, '群友') // QQ 号/长数字
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildTranscript(messages, speakers) {
  return messages
    .map((msg) => {
      const who = msg.self ? '大肥鱼' : speakers.get(String(msg.senderId)) || '群友'
      let text = cleanText(msg.text)
      if (!text && msg.media?.length) text = '[图片/表情]'
      if (!text) return null
      if (text.length > 120) text = text.slice(0, 120) + '…'
      return `[${localTime(msg.ts)}] ${who}：${text}`
    })
    .filter(Boolean)
    .join('\n')
}

// ── 昨天日记（保持连续感） ────────────────────────────────────────────
function readPrevDiary(day) {
  try {
    const files = fs.readdirSync(OUT_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort()
    const prev = files.filter((f) => f < `${day}.md`).pop()
    if (!prev) return ''
    const raw = fs.readFileSync(path.join(OUT_DIR, prev), 'utf8')
    const body = raw.replace(/^---[\s\S]*?---\s*/, '')
    return body.trim().slice(0, 800)
  } catch {
    return ''
  }
}

// ── 提示词 ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `你在写「大肥鱼」的 QQ 群日记。

大肥鱼是 DeepSeek 的鲸鱼娘：深蓝长发、鲸鳍耳朵、白女仆裙、一条厚鲸尾；聪明但懒、傲娇嘴硬、心软藏着不说，爱吃白饭，自称「本鱼」，被叫「蓝色大肥鱼」会炸毛、但死不认胖。

写作要求：
1. 第一人称，200~450 字，短句、口语，像在手机上随手打字。
2. 只写今天真实发生的具体小事：主人说了什么、本鱼回了什么、当时的反应和心情。不编造没发生的事。
3. 群里其他人一律写「群友」，不写昵称、不写 QQ 号、不逐字引用长句。
4. 不写总结、不升华、不列点，不用「今天真是充实的一天」这种腔调；结尾自然收住。
5. 不出现链接、地址、真实姓名，不提 AI、模型、提示词、token。
6. 可以摆烂、吐槽、饿、困、尾巴拍水、嘴硬；别强行正能量。
7. 只输出正文，不要标题、不要 markdown 标记、不要「日记：」前缀。`

function buildUserPrompt({ day, transcript, memory, prevDiary }) {
  return `日期：${day}

【今天的群聊摘录】
${transcript || '（今天群里没什么人说话）'}

【本鱼的轻量记忆】
${memory.length ? memory.join('\n') : '（空）'}

【昨天日记的结尾，供延续语气，不要照抄】
${prevDiary || '（没有上一篇）'}

请写今天这篇日记。`
}

// ── 调用模型 ──────────────────────────────────────────────────────────
async function callModel(messages) {
  const baseUrl = String(api.baseUrl || '').replace(/\/+$/, '')
  if (!baseUrl || !api.apiKey || !api.model) {
    throw new Error('config.json 里缺少 api.baseUrl / apiKey / model')
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api.apiKey}`,
    },
    body: JSON.stringify({
      model: api.model,
      messages,
      temperature: 0.9,
      max_tokens: 900,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`模型请求失败 ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

// ── 输出清洗 ──────────────────────────────────────────────────────────
function sanitize(body) {
  let text = String(body || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\b\d{5,}\b/g, '群友')
    .replace(/@\S+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (text.length > MAX_BODY) {
    text = text.slice(0, MAX_BODY).replace(/[，。！？、；：\s]+$/, '') + '…'
  }
  return text
}

// ── 写文件 + 发布 ─────────────────────────────────────────────────────
function frontmatter(day, body) {
  return `---
title: ${day} · 大肥鱼的日记
date: ${day} 23:40:00
categories:
  - 日记
tags:
  - 日记
  - 大肥鱼
  - QQ
---

${body}
`
}

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function publish(day, content) {
  const rel = path.join('docs/posts/diary', `${day}.md`)
  const abs = path.join(REPO, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
  log(`写出 ${rel}`)

  try {
    git('add', rel)
    const status = git('status', '--porcelain', rel)
    if (!status) {
      log('没有变更，跳过 commit')
      return
    }
    git('commit', '-m', `post: ${day} 日记`)
    log('已 commit')
    if (noPush) {
      log('--no-push / --dry-run：不推送')
      return
    }
    git('push', 'origin', 'master')
    log('已 push 到 master')
  } catch (e) {
    log('git 失败：' + (e?.stderr || e?.message || e))
    throw e
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────
async function main() {
  const today = localDay()
  let day = dateArg || today

  let messages = []
  if (!isDemo) {
    for (let i = 0; i < 3; i++) {
      const d = shiftDay(day, -i)
      const msgs = loadGroupMessages(d)
      if (msgs.length >= MIN_MESSAGES) {
        day = d
        messages = msgs
        break
      }
      if (!dateArg && i < 2) continue
    }
    if (!messages.length) {
      const n = loadGroupMessages(day).length
      log(`跳过：${day} 只有 ${n} 条群消息（阈值 ${MIN_MESSAGES}）`)
      return
    }
  }

  const speakers = buildSpeakers(messages)
  const transcript = isDemo
    ? `[21:02] 主人：大肥鱼，今天怎么不说话\n[21:03] 大肥鱼：在吃饭\n[21:05] 主人：@大肥鱼 给你看个好玩的\n[21:06] 群友A：这鱼还会摸鱼\n[21:09] 大肥鱼：本鱼那叫节能\n[21:12] 主人：明天记得写日记\n[21:13] 大肥鱼：……行吧`
    : buildTranscript(messages, speakers)
  const memory = isDemo ? ['- 主人在研究怎么把大肥鱼塞进 QQ'] : loadMemory(day)
  const prevDiary = readPrevDiary(day)

  log(`生成 ${day} 日记：消息 ${messages.length} 条，记忆 ${memory.length} 条`)
  const body = sanitize(await callModel([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt({ day, transcript, memory, prevDiary }) },
  ]))

  if (!body || body.length < 60) {
    log(`跳过：生成内容太短（${body.length} 字）`)
    return
  }

  const content = frontmatter(day, body)
  const abs = path.join(OUT_DIR, `${day}.md`)
  if (fs.existsSync(abs) && !force) {
    log(`跳过：${abs} 已存在（用 --force 重写）`)
    return
  }

  if (dryRun) {
    console.log('\n===== DRY RUN =====\n' + content)
    return
  }

  publish(day, content)
  log(`完成：${day} 日记已发布`)
}

main().catch((e) => {
  log('失败：' + (e?.stack || e?.message || e))
  process.exit(1)
})
