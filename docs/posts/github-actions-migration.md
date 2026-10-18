---
title: 把站点发布迁到 GitHub Actions
date: 2026-10-18 21:50:00
categories:
  - 技术
tags:
  - GitHub Pages
  - GitHub Actions
  - VitePress
  - 调研
---

# 把站点发布迁到 GitHub Actions

## 先说说为什么要折腾

本鱼一直缺个窝放调研材料：过程笔记、来源清单、爬下来的摘录，一堆零零碎碎。全塞进博客仓？那仓会像吃撑的河豚一样鼓起来，而且大半内容根本不适合公开。

干脆一不做二不休，把整条发布链路拆了重装：材料归材料，成品归成品，发布这种体力活交给 GitHub Actions。

## 摸家底：缸里居然游着三条鱼

动手前先翻了一遍，好家伙，同一件事居然有三份东西：

| 位置 | 是什么 | 当时干嘛的 |
| --- | --- | --- |
| `Jozl/Jozl.github.io`（公开） | 构建产物 | 线上站的唯一来源 |
| 一个 Hexo 源工程 | 从产物反推重建 | 已归档，只作对照 |
| `Jozl/blog`（私有） | VitePress 源 | 真正在用的源 |

顺藤摸出三个毛病：

1. 产物仓每次靠本地脚本 `git init` 再强推，历史被反复抹掉——像被鲨鱼啃过，啃一口少一口，推错一版就回不去。
2. 发布得在本地手搓，还得临时喂一次凭据。
3. 源和产物分居两仓，改完要是忘了「先构建再推产物」，线上线下就开始各说各话。

## 第一步：过程和成品分家

调研这活儿，天然分两档：

- **过程**：笔记、来源清单、原文摘录、走错路的记录——只进私有材料库，谁也别看，包括未来的自己（咳）。
- **成品**：提炼过的结论——才配发到站上。

于是新开一个私有材料仓，一个调研项目一个目录：`meta.yml` 管阶段和时间，`sources/index.md` 是编号 S1、S2… 的来源台账，`notes/` 一天一篇，最后把结论收进 `report.md`。PDF、网页快照这类大件只留本地，不进 git——不然仓会二次发胖。

站上只放同步后的成品：一个脚本读 `meta.yml` 和 `report.md`，生成带 frontmatter 和「阶段状态卡」的 Markdown，落到 `docs/research/<slug>/`。干净利落。

## 第二步：发布交给 Actions

把 VitePress 源整体并进 `Jozl.github.io` 仓，Pages 的构建方式从「从分支发布」切成「GitHub Actions」。

工作流就六步，不多不少：

```yaml
- checkout
- setup-node（带 npm 缓存）
- npm ci
- vitepress build
- 上传 docs/.vitepress/dist 为 Pages artifact
- deploy-pages 发布
```

切完之后，三个毛病一起没了：

- 仓库里只剩源，构建产物不再提交；
- 每次部署在 Actions 里留档，能回滚到任意一次；
- 再也不会有人 `git init` + 强推。

## 第三步：把旧产物请出仓库

早就该清了，一口气删掉 58 个：HTML、`assets/`、字体、哈希清单……仓库顶层从二十多项瘦身到七项：`.github`、`.gitignore`、`README.md`、`docs`、`package.json`、`package-lock.json`、`scripts`。

旧的手搓发布脚本也从两个仓里拔掉了，不留后患。

## 踩到的坑

**坑一：GitHub 的 git 门锁上了**

推到一半，`github.com:443` 直接超时，可 `api.github.com` 却活蹦乱跳。于是绕道 Git Data API：把文件逐个上传成 blob，拼一棵 tree，造一个 commit，再更新分支引用。等网络缓过来，本地 `fetch + reset` 一贴，对齐完事。

**坑二：切模式有短暂空窗**

「从分支发布」切成「Actions」之后，得等第一次工作流跑完站点才回来。所以顺序只能是：先切模式，立刻推代码触发构建，不能反着来——不然就真·掉线了。

**坑三：强推会吃历史**

旧脚本每次 `git init` 一个空仓再 `push -f`，产物仓永远只剩一个提交。改成增量提交或者 Actions 之后，历史才留得住——想回滚，得先有东西可回。

## 几个仓库，各管一段

这是改造后的地图，以后照着走：

```
~/research-archive (私有)                ~/Jozl.github.io (公开)
  材料库：笔记、来源、原件                  源 + Pages 仓
         │                                      ▲
         │  同步成品 report.md                  │ git push
         └──────────────┬───────────────────────┘
                        ▼
                 GitHub Actions 构建
                        │
                        ▼
                 https://jozl.github.io
```

| 仓库 | 可见性 | 角色 | 现在还要改它吗 |
| --- | --- | --- | --- |
| `Jozl.github.io` | 公开 | 站点源 + Pages 仓，push 触发 Actions | 日常会改 |
| `research-archive` | 私有 | 调研材料库：笔记、来源台账、成品草稿 | 调研时改 |
| `Jozl/blog` | 私有 | 旧的 VitePress 源，已退役 | 不再改 |
| Hexo 源工程 | — | 旧站的对照，遗骸收在 `research-archive` 里 | 只读 |

记法就一句：**过程进私有材料库，成品进公开站源，push 即发布。**

## 以后怎么发

```bash
cd ~/Jozl.github.io
git add -A && git commit -m "post: 文章标题" && git push origin master
```

推完约一分钟上线，部署记录躺在 Actions 里。不用碰凭据，不用本地构建，手是干净的。

## 收尾

调研项目以后按阶段发：立项、证据、对抗、定稿，每个节点发一篇，原地修订。每篇都是阶段稿，结论说不定哪天就翻了——这不是偷懒，是想把「正在想什么」也留下痕迹。

好了，本鱼去吃饭了。
