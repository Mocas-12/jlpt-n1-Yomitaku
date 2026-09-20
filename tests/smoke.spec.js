/* 冒烟测试：守护核心链路与历史 bug（筛选丢行 f953f7e、未答完提交、导入校验） */
import { test, expect } from '@playwright/test';

const ALL_SETS = 18;   // bank.js 内置题组数
const TANBUN = 6;      // 其中内容理解（短文）题组数

test('完整链路：筛选 → 作答 → 提交出分 → 列表显示最好成绩', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hero h1')).toContainText('読解');

  await page.click('nav.tabs a[data-page="practice"]');
  await expect(page.locator('#page-practice.on')).toBeVisible();

  const cards = page.locator('#set-cards .setcard');
  await expect(cards).toHaveCount(ALL_SETS);

  // 筛选回归：只显示短文题组（f953f7e 曾因重构丢行失效）
  await page.click('#filterbar .fbtn[data-f="tanbun"]');
  const filtered = page.locator('#set-cards .setcard');
  await expect(filtered).toHaveCount(TANBUN);
  for (let i = 0; i < TANBUN; i++) {
    await expect(filtered.nth(i).locator('.badge').first()).toContainText('短文');
  }

  await page.click('#filterbar .fbtn[data-f="all"]');
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#timer')).toBeVisible();

  const qn = await page.locator('#session-body .qblock').count();
  expect(qn).toBeGreaterThan(0);
  for (let i = 0; i < qn; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }

  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
  await expect(page.locator('#session-body .explain')).toHaveCount(qn);

  // 返回列表：刚练过的组应显示「最好成绩」（曾错误显示最早一次成绩）
  await page.click('#btn-back');
  await expect(page.locator('#set-cards .setcard .best').first()).toContainText(/最好成绩 \d+\/\d+/);
});

test('未答完提交先确认，取消后不判分', async ({ page }) => {
  let dialogMsg = null;
  page.on('dialog', async (d) => { dialogMsg = d.message(); await d.dismiss(); });

  await page.goto('/#practice');
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();

  await page.click('#btn-submit');
  expect(dialogMsg).toContain('未作答');
  await expect(page.locator('#session-body .explain')).toHaveCount(0);
  await expect(page.locator('#session-result')).toHaveText('');

  // 全部作答后可直接提交，不再弹确认
  const qn = await page.locator('#session-body .qblock').count();
  for (let i = 0; i < qn; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }
  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
});

test('导入校验：缺少 q 字段报错且不入库', async ({ page }) => {
  await page.goto('/#bank');
  await expect(page.locator('#bank-count')).toContainText(`${ALL_SETS} 组题`);

  const bad = [{
    id: 'bad-1', typeKey: 'tanbun', title: '缺 q 的题组', minutes: 2, passage: '正文',
    questions: [{ label: '主旨把握', options: ['①', '②', '③', '④'], answer: 0 }],
  }];
  await page.fill('#bank-import-text', JSON.stringify(bad));
  await page.click('#btn-import');
  await expect(page.locator('#toast')).toContainText('缺少 q');
  await expect(page.locator('#bank-count')).toContainText(`${ALL_SETS} 组题`);
});

test('导入校验：合法题组正常入库', async ({ page }) => {
  await page.goto('/#bank');
  const good = [{
    id: 'test-import-1', typeKey: 'joho', title: '冒烟测试题组', minutes: 2, passage: '正文',
    questions: [{ q: '设问原文？', label: '条件筛选', options: ['①', '②', '③', '④'], answer: 2 }],
  }];
  await page.fill('#bank-import-text', JSON.stringify(good));
  await page.click('#btn-import');
  await expect(page.locator('#toast')).toContainText('导入成功');
  await expect(page.locator('#bank-count')).toContainText(`${ALL_SETS + 1} 组题`);
});
