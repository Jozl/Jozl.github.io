---
title: 用 IM 遥控本机 agent：ACP 桥接方案
date: 2026-10-18 21:00:00
updated: 2026-10-18 23:30:00
categories:
  - 调研
tags:
  - 调研
  - ACP
  - IM
  - 手机
kind: research
stage: r2
status: ongoing
sources: 13
---

> **调研阶段 r2 · 进行中** ｜ 更新于 2026-10-18 23:30:00
> ｜ 来源 13 条 ｜ 阶段稿会持续修订，结论可能变化。

# 用 IM 遥控本机 agent：不用自己搭通道

> 一句话结论：手机想跟本机 agent 聊天、派活，不需要公网 IP，也不需要自己写通信层。IM 的机器人接口本身就是出站长连接，缺的只是「IM 消息 ↔ ACP」那段桥——而这段已经有现成开源实现，改一行配置就能接到本机 harness 上 [S1][S2]。

## 问题

想随时用手机接着干活：看一眼日志、改个文件、跑个测试，或者就是闲聊两句。可选的路有几条：

1. 把本机 Web 界面开到公网，配隧道、证书、鉴权；
2. 手机 SSH 回来，用终端里跑 TUI；
3. 走 IM：在飞书 / Telegram 里跟一个机器人聊天，机器人在本机干活。

第三条最符合直觉，因为它复用了手机上本来就装着的 App，不用多装客户端，也不用考虑「手机在哪个网络」。但它容易被想成「要自己搭一条通信通道」——这其实是误解。

## 为什么 IM 能免公网

IM 平台给开发者两类接入方式：回调（平台把消息推到你的公网地址）和主动外连（你的程序连到平台，拉取或接收消息）。对个人自用来说，选主动外连就完全绕开了公网、端口映射、HTTPS 证书这一整套东西：

- **Telegram**：`getUpdates` 长轮询，不需要设置 webhook [S8]；
- **飞书**：事件订阅可切成「长连接」，官方写明不必配置回调地址 [S9]；
- **钉钉**：Stream 模式，消息从服务端推给你本地进程 [S10]；
- **企业微信**：智能机器人有 WebSocket 长连接，官方写明无需固定公网 IP；自建应用仍走回调 [S11]；
- **QQ 官方机器人**：WebSocket 接入；Slack 的 Socket Mode、Discord 的 Gateway 同理。

也就是说，通道是平台给的，本地只要一个能主动连出去的进程。真正缺的是另一段：把「一条聊天消息」翻译成「agent 的一次任务」，再把流式输出、工具审批翻译回「聊天消息」。

## 现成的桥：不用自己写

好消息是这段桥有人写好了，而且不止一个。它们共同的思路是：以 **ACP（Agent Client Protocol）** 作为 agent 侧的统一接口——这正是 Zed 等编辑器给 coding agent 定的协议 [S7]——于是"接哪个 agent"退化成"填一行启动命令"。

### 路线一：cc-connect（覆盖最广，推荐先看）

`cc-connect` 是一个 Go 写的桥，支持飞书、钉钉、Telegram、Slack、Discord、企业微信、QQ、LINE、Matrix 等 13 个平台，内置 `acp` 类型的 agent，命令和参数都可以自定义 [S1][S2]。Agent 侧配置大概长这样：

```toml
[[projects]]
name = "dsh"

[projects.agent]
type = "acp"

[projects.agent.options]
work_dir = "/home/you/project"
command = "dsh"
args = ["--profile", "acp"]
display_name = "本地 harness"
```

平台侧再填一个 bot token（飞书 App ID/Secret、Telegram Bot Token 等）。飞书、钉钉、Telegram、QQ 官方、企业微信智能机器人这几条线都**不需要公网**；它还自带一个本机 Web 管理台，方便可视化配。用 `npm install -g cc-connect` 或下载 release 二进制都能装。

它的定位就是「把本机 agent 接到聊天软件」，所以会话管理（`/new`、`/list`、`/dir`）、权限模式、模型切换这些都有对应命令，接入成本最低。

### 路线二：单平台专用桥

如果只用飞书或只用 Telegram，也可以挑更聚焦的：

- **lark-acp**：飞书长连接，过程用一张可交互卡片实时渲染，思考、工具调用、中断按钮、授权按钮都在卡片里；启动时用 `-- <命令>` 指定任意 ACP agent [S3]。
- **telegram-acp-bot**：Telegram 长轮询，`ACP_AGENT_COMMAND` 填任意 ACP 命令，支持 `/new`、`/resume`、权限内联按钮、图片与文档附件 [S4][S5]。

这类项目的共同点是轻，缺点是只覆盖一个平台，遇到问题也没有第二个平台兜底。

### 路线三：OpenClaw（能力大，但更绕）

OpenClaw 是个多 IM 网关，20 多个渠道，但中国常用 IM 里只内置了飞书；接外部 CLI agent 需要装 `acpx` 插件并用 `agents.<id>.command` 指定，且 ACP 会话是非交互的，权限只能按策略放行（`approve-all` 之类）[S6]。功能强、生态大，但「接一个自定义 agent」比前两条路线多几层配置，适合本来就打算用它当统一入口的人。

顺带一提，有一批专门给 Claude Code 用的桥（飞书/Telegram 都有），但后端基本写死，最多在 Claude Code 和 Codex 之间二选一，不适合换成自己的 harness。

## 本机实测：ACP 接口够不够用

桥能不能接，关键看 agent 侧是不是说标准 ACP。本机 harness 有一个 `--profile acp` 的自动化接口，直接跑一次握手：

- `initialize` 返回 `agentInfo`（名称、版本）和 `sessionCapabilities: {close, list, resume}`，`authMethods` 为空；
- `session/new` 传一个 `cwd`，返回 `sessionId` 和可选的模型/推理强度配置项；
- `session/prompt` 发一句话，会持续收到 `session/update` 里的 `agent_message_chunk` 流式文本，最后以 `stopReason: end_turn` 收尾 [S13]。

也就是说，桥把 agent 命令换成 `dsh --profile acp` 就能工作，不需要为它写适配层。跨进程恢复这条也基本对得上：协议里的恢复方法名就是 `session/resume` [S12]，本机实现支持。

## 会有哪些降级

不是所有能力都能原样过去，接之前要知道：

- **图片**：本机 ACP 声明不支持图片输入（`image: false`），聊天里发图给 agent 会降级或直接报错；把文件存本地、把路径发过去反而稳定。
- **会话恢复**：不同桥用的恢复方法不一样。lark-acp 走 `session/resume`，能接上；cc-connect 走 `session/load`，本机没实现，失败时会退回新会话——上下文会丢，但不会卡死。
- **审批交互**：ACP 有工具授权请求，桥通常会把它转成卡片/按钮。但「询问是否允许」这件事在 IM 里是否好用，取决于平台实现，建议先用只读任务验收。
- **图片/文件回传**：agent 生成的文件能不能发回聊天，各桥支持不一（cc-connect 明确支持飞书、Telegram 的回传）。

## 平台怎么选

- **飞书**：国内体验最好，长连接免公网，卡片能承载流式与按钮；代价是要去开放平台建自建应用、配权限、发布版本。
- **Telegram**：配置最少（BotFather 给个 token 就行），长轮询免公网；代价是手机端要能连上 Telegram，国内需要代理，且消息内容对平台可见。
- **钉钉 / 企业微信 / QQ**：cc-connect 都有覆盖，适合本来就在这些平台里工作的人；企业微信自建应用那条路仍要公网回调。
- **个人微信**：有非官方桥（ilink / NapCat 之类），但封号与合规风险自己承担，不建议拿主力号试。

## 安全边界

bot 令牌 ≈ 本机执行权限，这句话不是夸张：拿到令牌的人能在你的机器上跑命令。所以：

1. **白名单**：cc-connect 的 `admin_from`、telegram-acp-bot 的 `TELEGRAM_ALLOWED_USER_IDS`、lark-acp 的可见范围——必须配，别让机器人对所有人开放；
2. **别在群里用**：群聊会把对话暴露给其他人，也容易被陌生人触发；
3. **审批优先**：能用「每次询问」就别开 yolo，尤其是会写文件、跑命令的工具；
4. **别在聊天里贴密钥**：Telegram、飞书都不是端到端加密，聊天内容对平台可见；
5. **手机丢了**：删 bot、换 token、撤应用授权，三步都要熟。

## 反例与边界

- 如果你要的是「完整 GUI 体验」（看 diff、点按钮、翻会话），IM 桥不如 Web 界面；桥适合「派活 + 看结果 + 批一下」。
- 如果你经常传图、传截图，当前 ACP 的图片能力是硬伤，要么走文件路径，要么还是用 Web。
- 如果要求强隔离（agent 只能碰某个目录），IM 桥本身不提供沙箱，得靠容器或单独用户兜底。

## 局限与遗留

- 本次只验证到协议层（握手、建会话、流式、结束），还没有真的在手机上收发消息——差一个 bot 令牌和一台手机的实测。
- cc-connect 的 ACP 权限交互、lark-acp 的卡片流式刷新，都需要跑起来才知道细节。
- 没有评估国内网络下各平台长连接的稳定性（断线重连、代理中断）。

下一步很明确：拿一个 token，把桥跑起来，用「读一个文件」这种只读任务做第一次验收，再逐步放开写权限。
