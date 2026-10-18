# jozl.github.io 源工程

`https://jozl.github.io` 的源工程**兼 Pages 仓**：**VitePress + Teek 主题**，每篇文档就是一个 Markdown 文件。

push 到 `master` 后由 GitHub Actions 自动构建并部署。2026-10 起源与部署合一：构建产物不再提交进仓库，只作为 Pages artifact 上传；旧产物仍留在 git 历史和 `hexo-final` tag 里。

## 页面

| 地址 | 内容 |
| --- | --- |
| `/` | 首页：Banner + 文章卡片 + 分类 / 站点信息 |
| `/posts/` | 文章清单（按分类分组，自动统计字数与阅读时长） |
| `/posts/又是一个开始.html` | 原「又是一个开始」 |
| `/posts/hello-world.html` | 原 Hello World |
| `/archives/` | 归档（按年月） |
| `/categories/` | 分类 |
| `/about.html` | 关于 |
| `/2025/07/09/…/`、`/about/` | 旧 Hexo 链接的跳转页 |

## 结构

```
docs/
├── .vitepress/
│   ├── config.mts        # 站点配置 + Teek 主题配置（createTeekConfig 段）
│   └── theme/index.ts    # 引入 Teek 主题与样式
├── index.md              # 首页（layout: home，内容由 Teek 渲染）
├── posts/
│   ├── index.md          # 文章清单页（articleOverviewPage）
│   ├── 又是一个开始.md
│   └── hello-world.md
├── archives/index.md     # 归档页（archivesPage）
├── categories/index.md   # 分类页（categoriesPage）
├── about.md
└── public/               # 原样拷进产物根目录
    ├── .nojekyll
    ├── favicon.svg
    ├── imgs/beach.jpg    # Banner 背景
    ├── images/<文章名>/   # 文章配图
    └── 2025/…/index.html # 旧链接跳转
scripts/research-sync.mjs     # 调研材料 → 站上文档
.github/workflows/deploy.yml  # push master → 构建 → 部署 Pages
```

## 写文档

新建 `docs/posts/<文件名>.md`：

```markdown
---
title: 标题
date: 2025-07-09 12:00:00
categories:
  - 随笔
coverImg: /images/<文件名>/cover.jpg
---
```

- `date` 决定列表排序和归档分组；`categories` 决定分类页和清单分组
- 不想出现在首页 / 清单 / 统计里：加 `article: false`、`inHomePost: false`、`docAnalysis: false`
- 配图放 `docs/public/images/<文件名>/`，引用 `/images/<文件名>/xxx.jpg`
- 首页文章卡片、清单页、归档、分类都从 frontmatter 自动生成，不用手改列表

## 调研项目

长期调研不走 `docs/posts/` 手写，而是**材料在材料库、成品靠脚本同步**：

1. 材料与底稿在 `~/research-archive/research/<slug>/`（私有材料库），规范见那边的 `research/README.md`
2. 把结论写进 `report.md`，更新 `meta.yml` 的 `stage` / `updated`
3. 在本仓同步，然后 push（Actions 自动部署）：

```bash
npm run research:sync -- <slug>     # report.md → docs/research/<slug>/index.md
npm run research:check -- <slug>    # 只校验，不写文件
git add docs/research/<slug> && git commit -m "research: <slug> r2" && git push
git tag research/<slug>/r2          # 阶段节点打点
git push origin --tags
```

脚本会生成 frontmatter（含 `kind: research`、`stage`、`sources` 条数）和顶部阶段状态卡；缺字段、`stage` 非法、`slug` 与目录名不一致都会直接失败退出。
调研成品默认进「文章 / 归档 / 分类」，分类名取 `meta.yml` 的 `category`（默认 `调研`）。

## 本地预览

```bash
npm install
npm run docs:dev        # http://localhost:5173
npm run docs:build      # 产出 docs/.vitepress/dist
npm run docs:preview    # 预览构建结果
```

## 发布

```bash
git push origin master
```

push 到 `master` 触发 `.github/workflows/deploy.yml`：`npm ci` → `npm run build` → 上传 `docs/.vitepress/dist` 为 Pages artifact → `deploy-pages` 发布。约 1 分钟上线，每次部署在 Actions 里有记录、可回滚。

本地构建只用于预览：`npm run build`，产物在 `docs/.vitepress/dist`，**不要提交**（已在 `.gitignore`）。

## 主题说明

- 主题：`vitepress-theme-teek@1.6.2`（peer 要求 vitepress ^1.6.4，本工程 1.6.4）
- 关掉了：永久链接插件（URL 保持 `/posts/xxx.html`，GitHub Pages 必需）、主题增强面板、公告、精读文章 / 标签 / 友链卡片（没内容）
- 开了：首页 Banner（partImg + 打字机签名）、文章卡片列表、归档页、分类页、文章清单页、本地搜索、首页站点分析卡片
- 静态托管限制：`cleanUrls: false`，所有页面 URL 带 `.html`；中文文件名会被百分号编码
