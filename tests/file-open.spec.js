/* file:// 直开冒烟：核心设计约束（零依赖、双击 index.html 即用），HTTP 测试覆盖不到 */
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

const FILE_URL = pathToFileURL(resolve(__dirname, '..', 'index.html')).href;

test.beforeEach(async ({ context }) => {
  // 拦截 Google Fonts，理由同 smoke.spec.js
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
});

test('file:// 直开：作答链路、键盘、混合模式、本地持久化', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(FILE_URL + '#practice');
  await expect(page.locator('#page-practice.on')).toBeVisible();
  await expect(page.locator('#set-cards .setcard')).toHaveCount(80);

  // 题组列表按题型折叠（默认收起）：先展开再点卡片
  await page.evaluate(() =>
    document.querySelectorAll('#set-cards details.typegroup').forEach((d) => { d.open = true; }));

  // 键盘作答（验证 hash 路由 guard 在 file:// 下不误伤）
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  const qn = await page.locator('#session-body .qblock').count();
  for (let i = 0; i < qn; i++) await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);

  // 混合模式提交后，记录持久化到 file:// origin 的 localStorage
  await page.click('#btn-back');
  await page.click('#btn-mix10');
  await expect(page.locator('#session-body .qblock')).toHaveCount(10);
  for (let i = 0; i < 10; i++) await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
  await page.click('nav.tabs a[data-page="home"]');
  await expect(page.locator('#home-stats')).toContainText('随机混合');

  expect(errors).toEqual([]);
});
