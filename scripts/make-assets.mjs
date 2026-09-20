/* 生成两件视觉资产（输出到 public/，结果入库，无需在 CI 反复生成）：
   1. og-banner.png   —— 1200×630 社交分享横幅（OG/Twitter 卡片用）
   2. icon-192/512.png —— PWA 安装图标（满幅和纸底 + 居中 Logo，同时声明 maskable）
   依赖 devDependency 的 Playwright Chromium 渲染。用法：node scripts/make-assets.mjs */
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const INK = '#1b1b26', PAPER = '#fff8ec', VERMILION = '#e8433a', POP = '#ffd23f';
const logoB64 = (await readFile('public/logo.svg')).toString('base64');
const logoDataUrl = `data:image/svg+xml;base64,${logoB64}`;

const HEAD = `<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@700;800&family=Noto+Sans+SC:wght@500;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body {
    background: ${PAPER};
    background-image: radial-gradient(rgba(27,27,38,.07) 1.6px, transparent 1.6px);
    background-size: 20px 20px;
    color: ${INK};
    font-family: 'M PLUS Rounded 1c', 'Noto Sans SC', sans-serif;
    overflow: hidden; position: relative;
  }
</style>`;

const browser = await chromium.launch();

/* ---------- OG 横幅 1200×630 ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(`<!DOCTYPE html><html><head>${HEAD}<style>
    body { width: 1200px; height: 630px; }
    .sun { position: absolute; left: 46px; top: 128px; width: 372px; height: 372px;
      background: ${VERMILION}; border: 6px solid ${INK}; border-radius: 50%;
      box-shadow: 14px 14px 0 rgba(27,27,38,.85); }
    .sun img { position: absolute; left: 50%; top: 50%; width: 296px; transform: translate(-50%, -50%) rotate(-4deg);
      filter: drop-shadow(10px 12px 0 rgba(27,27,38,.55)); }
    .col { position: absolute; left: 490px; top: 100px; width: 660px; }
    .sticker { display: inline-block; transform: rotate(-2deg); background: ${POP};
      border: 3px solid ${INK}; border-radius: 12px; box-shadow: 6px 6px 0 ${INK};
      padding: 9px 22px; font-size: 26px; font-weight: 800; }
    h1 { margin-top: 34px; font-size: 122px; font-weight: 800; line-height: 1.06; letter-spacing: 1px; display: inline-block;
      background: linear-gradient(transparent 64%, ${VERMILION} 64%, ${VERMILION} 94%, transparent 94%); }
    h2 { margin-top: 12px; font-size: 55px; font-weight: 800; }
    h2 em { font-style: normal; color: ${VERMILION}; }
    .badges { margin-top: 30px; display: flex; gap: 16px; }
    .badges span { background: #fff; border: 2.5px solid ${INK}; border-radius: 999px;
      box-shadow: 4px 4px 0 ${INK}; padding: 8px 20px; font-size: 21.5px; font-weight: 700; }
    .url { position: absolute; right: 36px; bottom: 26px; font-size: 20px; font-weight: 700; color: #5f6470; }
  </style></head><body>
    <div class="sun"><img src="${logoDataUrl}" alt=""></div>
    <div class="col">
      <span class="sticker">毎日10分、メキメキ上がる！</span><br>
      <h1>Yomitaku</h1>
      <h2>JLPT N1 <em>読解</em>特訓</h2>
      <div class="badges"><span>六大题型全覆盖</span><span>18 组原创模拟题</span><span>错题重练闭环</span></div>
    </div>
    <div class="url">mocas-12.github.io/jlpt-n1-Yomitaku</div>
  </body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'public/og-banner.png' });
  await page.close();
  console.log('[assets] public/og-banner.png 已生成');
}

/* ---------- PWA 图标 512 / 192 ---------- */
for (const size of [512, 192]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const logoSize = Math.round(size * 0.66);
  await page.setContent(`<!DOCTYPE html><html><head>${HEAD}<style>
    body { width: ${size}px; height: ${size}px; }
    img { position: absolute; left: 50%; top: 50%; width: ${logoSize}px;
      transform: translate(-50%, -50%); }
  </style></head><body><img src="${logoDataUrl}" alt=""></body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `public/icon-${size}.png` });
  await page.close();
  console.log(`[assets] public/icon-${size}.png 已生成`);
}

await browser.close();
