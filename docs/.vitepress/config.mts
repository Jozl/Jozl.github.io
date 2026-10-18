import { defineConfig } from 'vitepress'
import { defineTeekConfig } from 'vitepress-theme-teek/config'

// Teek 主题配置（博客风格）
const teekConfig = defineTeekConfig({
  teekHome: true, // Teek 博客首页（Banner + 文章列表 + 卡片）
  vpHome: false, // 关掉 VitePress 自带的 hero/features
  sidebarTrigger: false,
  loading: false,

  author: { name: 'Jozl', link: 'https://github.com/Jozl' },

  // 首页 Banner：用原站那张海边照片
  banner: {
    enabled: true,
    name: 'Jozl',
    bgStyle: 'partImg',
    imgSrc: ['/imgs/beach.jpg'],
    mask: true,
    maskBg: 'rgba(0, 0, 0, 0.45)',
    descStyle: 'default',
    description: ['长风破浪会有时，直挂云帆济沧海'],
  },

  // 首页文章列表：卡片风格
  post: {
    postStyle: 'card',
    coverImgMode: 'full',
    showCapture: true,
    showMore: true,
    moreLabel: '阅读全文 >',
    splitSeparator: true,
  },

  // 首页右侧卡片栏：只留分类 + 站点分析，其余暂时关掉（没内容）
  homeCardSort: ['category', 'docAnalysis'],
  topArticle: { enabled: false },
  tag: { enabled: false },
  friendLink: { enabled: false },

  // 关掉主题增强面板和公告，站子干净点
  themeEnhance: { enabled: false },
  notice: { enabled: false },

  // 永久链接插件关掉：URL 沿用文件路径（/posts/xxx.html），GitHub Pages 直接可访问
  vitePlugins: { permalink: false },

  footerInfo: {
    theme: { name: 'Theme By Teek' },
    copyright: { createYear: 2025, suffix: 'Jozl' },
  },
})

export default defineConfig({
  extends: teekConfig,
  lang: 'zh-CN',
  title: 'Jozl',
  description: '长风破浪会有时，直挂云帆济沧海',
  cleanUrls: false, // GitHub Pages 不支持无扩展名路径
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'author', content: 'Jozl' }],
  ],
  markdown: {
    lineNumbers: true,
    image: { lazyLoading: true },
  },
  themeConfig: {
    darkModeSwitchLabel: '主题',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '返回顶部',
    lastUpdatedText: '上次更新',
    outline: { level: [2, 3], label: '本页导航' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    nav: [
      { text: '首页', link: '/' },
      { text: '文章', link: '/posts/' },
      { text: '调研', link: '/research/' },
      { text: '归档', link: '/archives/' },
      { text: '分类', link: '/categories/' },
      { text: '关于', link: '/about' },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/Jozl' }],
    search: { provider: 'local' },
  },
})
