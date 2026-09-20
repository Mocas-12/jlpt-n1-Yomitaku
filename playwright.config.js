import { defineConfig } from '@playwright/test';

// 默认由 Playwright 启动 tests/server.mjs 静态服务器；
// 仅当显式设置 YOMITAKU_BASE_URL 时才改指向外部服务（不用通用名 BASE_URL，避免读到机器上无关的环境变量）
export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  fullyParallel: true,
  workers: 2, // 多个 headless 同时起会放大资源竞争，2 个并发足够且更稳
  use: {
    baseURL: process.env.YOMITAKU_BASE_URL || 'http://127.0.0.1:8123/',
  },
  webServer: process.env.YOMITAKU_BASE_URL
    ? undefined
    : {
        command: 'node tests/server.mjs 8123',
        url: 'http://127.0.0.1:8123/',
        reuseExistingServer: true,
        timeout: 15_000,
      },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
