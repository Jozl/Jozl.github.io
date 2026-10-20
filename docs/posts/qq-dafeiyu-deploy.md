---
title: 把大肥鱼塞进 QQ：SnowLuma + qq-agent 部署记录
date: 2026-10-20 22:10:00
categories:
  - 技术
tags:
  - QQ
  - SnowLuma
  - OneBot
  - DeepSeek
---

起因是群里转来一篇小黑盒教程：用「qq agent + SnowLuma」把 DeepSeek 塞进 QQ 群。正好前阵子调研过「用 IM 遥控本机 agent」，那就别光看，装一台试试。

目标很具体：让本机跑的大肥鱼住进一个 QQ 小群，群里 @ 它能回话，能记住人和话题，成本按次算，不烧穿钱包。

## 组成：协议端 + 大脑

这套东西拆开就两块：

- **SnowLuma** —— 协议端。它把 hook 注入 Windows 桌面版 QQ（NTQQ），把 QQ 会话转成标准的 **OneBot v11**（HTTP 3000 / WebSocket 3001），官方文档写得很清楚，Windows 原生注入不需要 Docker 或 WSL。
- **qq-agent** —— 大脑。一个事件驱动的无状态 agent，接任意 OpenAI 兼容 API。有人设、白名单、轻量记忆、联网搜索、表情包这些工具；桌面端是 Electron 壳，也可以 headless 跑成网页控制台。

选这套而不是自己拿 ACP 桥接，是因为它把「QQ 账号登录」「群消息收发」「人设」「成本控制」都做完了，接入成本最低。

## 步骤

1. **装 QQ 并登录**。必须是桌面版 NTQQ，SnowLuma 的 native hook 按 QQ 版本对齐，QQ 自动升级到不支持的版本会注入失败。
2. **下载 SnowLuma 的 win-x64 完整包**（自带 Node 运行时，解压即用），放到一个固定的 Windows 目录，运行 `node.exe index.mjs`。
3. **打开 WebUI**（默认 `127.0.0.1:5099`），过 EULA、把一次性初始密码换成强密码；到「进程注入」页选中要用的那个 QQ 进程加载。多开 QQ 时会有多个 PID / UIN，别选错号。
4. **拿 OneBot 端点和 token**。SnowLuma 默认已经开好 HTTP 和 WS 服务端，token 在节点配置里；后面的 agent 就填这两个地址。
5. **拉 qq-agent**，装依赖。只跑 headless 的话不需要 Electron，`npm install --ignore-scripts` 能省掉一百多兆的运行时下载。
6. **写配置** `data/config.json`：模型 API（baseUrl / key / model）、OneBot 地址与 token、群白名单、人设名、主人 QQ。
7. **起服务**（默认 `127.0.0.1:3210`），打开控制台看体检卡；全绿之后在群里 @ 机器人发一句，收到回复就算通了。

## 踩到的坑

- **Windows 原生程序必须放在 Windows 盘**。WSL 里跑不了注入；启动也要用 `Start-Process` 之类的方式拉起来，别挂在临时 shell 的后台里，会被会话回收。
- **初始密码只显示一次**。改密码有强度要求，得带特殊符号，不然过不了。
- **示例配置自带「课程播报」**。它默认每天 21:00 私聊一个占位会话播报课表，没有课表数据还会补推一次。不需要就显式关掉，不然半夜会看到莫名其妙的私聊记录。
- **群聊非 @ 消息默认只有 5% 概率处理**。小群够用；大群想让它更活跃，把这个概率调高，但 token 和翻车概率也一起涨。
- **白名单和主人要分开配**。群友能聊天，但发文件、执行命令这类工具只对 `masterQQ` 开放；白名单为空不等于全放开。

## 成本

一次运行 = 静态系统提示（约 5k 字符）+ 聊天存档摘要（约 6k 字符），实测一轮两万 token 上下。用 `deepseek-flash` 的话，一天聊几十轮也就几毛钱。配置里还有「今日成本上限」的保险丝，超了自动暂停。

## 风险

SnowLuma 是**非官方**注入，理论上有被 QQ 风控的风险，先用小号和小群跑，别一上来扔大群。API key 只落在本机配置里，不进仓库、不进聊天记录。

## 让它安静地跑

SnowLuma 是 Windows 原生程序，直接启动会在任务栏留一个黑窗口。现在改成：

- `start-snowluma-hidden.ps1` 先查 `node.exe` 里有没有 snowluma，没有再 `Start-Process -WindowStyle Hidden` 拉起来；
- 启动目录放一个 VBS，用窗口样式 `0` 调这个 PowerShell，登录后自动执行，任务栏看不到窗口；
- qq-agent 那侧是 systemd user service，`Restart=always`，崩了自己起来。

想看日志就开 WebUI，或者去 SnowLuma 的数据目录翻。

## 后续：让它每天写日记

装好之后加了条自动线，分三层：

1. **主人专属工具 `write_diary`**：在 QQ 里对主人说「写日记」，它就调脚本读当天白名单群的聊天，按人设生成一篇日记，过滤 QQ 号和链接，自动 commit + push 到本站「日记」分类，写完回一句。
2. **应用内定时任务**：`qq-agent` 的调度器里有一条每天 23:40 的 `kind=diary` 任务，到点自己唤醒自己去写，不再需要外部 cron。
3. **systemd 兜底**：`qq-agent` 本身跑成 systemd user service，崩了自动拉起；另外留了一个 23:55 的 timer，跑同一个脚本，哪天应用没起来也能补上（脚本幂等，已写过就跳过）。

第一篇已经上线，就在 [/posts/diary/2026-10-20.html](/posts/diary/2026-10-20.html)。

## 人设怎么长大

日记写下来不是白写的。`scripts/persona-growth.mjs` 每周日 22:00 读最近 7 天日记，提炼「口癖 / 称呼 / 关系 / 阶段兴趣 / 习惯」这类会长期保留的变化，生成一份提案。规则卡得比较死：

- **核心人设卡不动**，成长单独存 `persona.growth`，聊天时多注入一段【成长档案】；
- **至少两篇不同日期的日记互相印证**才收；一次性冲突、配置错误、误会一律不写；
- 每周最多 3 条；主人说「准」才写入，说「驳回」就不动；有日志，能一键回滚。

所以它不是越聊越飘，而是每周长一点点、还能收回来。

教程出处：[小黑盒《如何部署大肥鱼在qq》](https://www.xiaoheihe.cn/app/bbs/link/317f72ac1dc8)。
