import { defineConfig } from '@playwright/test';

// 默认由 Playwright 启动 tests/server.mjs 静态服务器；
// 仅当显式设置 YOMITAKU_BASE_URL 时才改指向外部服务（不用通用名 BASE_URL，避免读到机器上无关的环境变量）
// 端口用冷门的 8321：reuseExistingServer 的探活只看 URL 是否响应，8123 这类常用端口
// 被本机其他应用占住时会静默连上错误的服务，全部用例对着别人的页面跑（2026-09-22 踩坑）
export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  fullyParallel: true,
  workers: 2, // 多个 headless 同时起会放大资源竞争，2 个并发足够且更稳
  use: {
    baseURL: process.env.YOMITAKU_BASE_URL || 'http://127.0.0.1:8321/',
  },
  webServer: process.env.YOMITAKU_BASE_URL
    ? undefined
    : {
        command: 'node tests/server.mjs 8321',
        url: 'http://127.0.0.1:8321/',
        reuseExistingServer: !process.env.CI, // CI 强制新起，避免复用到意外服务
        timeout: 15_000,
      },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
