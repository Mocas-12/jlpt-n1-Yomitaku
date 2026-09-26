/* 生成 README 界面截图（输出到 docs/，浅色 3 张 + 深色 1 张）。
   与 make-assets.mjs 同理：用 Playwright Chromium 渲染，可随时重新生成。
   用法：node tests/server.mjs（默认 8321，与测试同端口）后 node scripts/make-screenshots.mjs */
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:8321/'; // 8123 是本机易撞车端口（曾跑过别的应用），统一用测试端口 8321
const browser = await chromium.launch();

async function newPage(theme) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 2 });
  await page.addInitScript((t) => localStorage.setItem('yt_theme', t), theme);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/* 1. 概览 hero（浅色） */
{
  const page = await newPage('light');
  await page.screenshot({ path: 'docs/shot-home.png', clip: { x: 0, y: 0, width: 1200, height: 660 } });
  await page.close();
  console.log('[shots] docs/shot-home.png');
}

/* 2. 专项训练入口（题组列表 + 混合/模拟卷按钮） */
{
  const page = await newPage('light');
  await page.click('nav.tabs a[data-page="practice"]');
  await page.locator('#set-cards .setcard').first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/shot-list.png', clip: { x: 0, y: 0, width: 1200, height: 780 } });
  await page.close();
  console.log('[shots] docs/shot-list.png');
}

/* 3. 专项训练中（浅色，信号词高亮开启） */
{
  const page = await newPage('light');
  await page.click('nav.tabs a[data-page="practice"]');
  await page.locator('#set-cards .setcard h3').first().click();
  await page.locator('#sig-toggle').check();
  await page.locator('#session-body .qblock').first().locator('.opt').first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/shot-practice.png' });
  await page.close();
  console.log('[shots] docs/shot-practice.png');
}

/* 4. 模拟卷（官方構成组卷 · 全局计时） */
{
  const page = await newPage('light');
  await page.click('nav.tabs a[data-page="practice"]');
  await page.click('#btn-mock');
  await page.locator('#session-body .qblock').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/shot-mock.png' });
  await page.close();
  console.log('[shots] docs/shot-mock.png');
}

/* 5. 提交后逐选项解析（浅色） */
{
  const page = await newPage('light');
  await page.click('nav.tabs a[data-page="practice"]');
  await page.locator('#set-cards .setcard h3').first().click();
  const qn = await page.locator('#session-body .qblock').count();
  for (let i = 0; i < qn; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }
  await page.click('#btn-submit');
  await page.locator('#session-body .explain').first().waitFor();
  await page.screenshot({ path: 'docs/shot-explain.png' });
  await page.close();
  console.log('[shots] docs/shot-explain.png');
}

/* 6. 专项训练中（深色，展示夜の和紙主题） */
{
  const page = await newPage('dark');
  await page.click('nav.tabs a[data-page="practice"]');
  await page.locator('#set-cards .setcard h3').first().click();
  await page.locator('#sig-toggle').check();
  await page.locator('#session-body .qblock').first().locator('.opt').nth(1).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/shot-dark.png' });
  await page.close();
  console.log('[shots] docs/shot-dark.png');
}

await browser.close();
