/* 冒烟测试：守护核心链路与历史 bug（筛选丢行 f953f7e、未答完提交、导入校验） */
import { test, expect } from '@playwright/test';
import { ALL_SETS, TANBUN } from './bank-meta.mjs';

// 「全部」视图的题组列表按题型折叠（默认收起）：点击卡片前先展开各组
const openGroups = (page) => page.evaluate(() =>
  document.querySelectorAll('#set-cards details.typegroup').forEach((d) => { d.open = true; }));

test.beforeEach(async ({ context }) => {
  // 拦截 Google Fonts：测试不验证排版，但 headless 下大体积 CJK 字体子集
  // 可能触发重复加载死循环卡住 load 事件；站点本身有系统字体回退，不受影响
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
});

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
  await openGroups(page);
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
  await openGroups(page);
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

test('PWA：Service Worker 接管后可完全离线访问', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready); // 等 SW 激活并 claim 页面
  await page.reload(); // 受 SW 接管的这次加载会把 css/js 写入运行时缓存
  await expect(page.locator('.hero h1')).toContainText('読解');

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.hero h1')).toContainText('読解');

  // 离线状态下完整功能可用（js 从缓存加载）
  await page.click('nav.tabs a[data-page="practice"]');
  await expect(page.locator('#page-practice.on')).toBeVisible();
  await expect(page.locator('#set-cards .setcard')).toHaveCount(ALL_SETS);
});

test('深色模式：切换、记忆、theme-color 同步', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // Playwright 默认 colorScheme=light
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-toggle')).toHaveText('☀️');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#171521');

  await page.reload(); // localStorage 记忆后仍为深色
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('键盘作答：1-4 选择当前题，Enter 提交', async ({ page }) => {
  await page.goto('/#practice');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#session-body .qblock.cur')).toHaveCount(1); // 当前题高亮
  await expect(page.locator('.kbd-hint')).toBeVisible();

  const qn = await page.locator('#session-body .qblock').count();
  for (let i = 0; i < qn; i++) {
    await page.keyboard.press('1'); // 每次按 1 选当前题的选项①，当前题自动推进
  }
  for (let i = 0; i < qn; i++) {
    await expect(page.locator('#session-body .qblock').nth(i).locator('.opt').first()).toHaveClass(/sel/);
  }
  await expect(page.locator('#session-body .qblock.cur')).toHaveCount(0); // 全部答完取消高亮

  await page.keyboard.press('Enter');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
});

test('键盘作用域：会话进行中切到其他页，数字/Enter 不暗中作答或交卷', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', async (d) => { dialogs++; await d.dismiss(); });

  await page.goto('/#practice');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  await page.locator('#session-body .qblock').first().locator('.opt').first().click(); // 只答第 1 题

  // 切到概览页（session 仍在后台存活）：按数字与 Enter 都不应影响它
  await page.click('nav.tabs a[data-page="home"]');
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');
  expect(dialogs).toBe(0); // 没有从后台触发提交确认

  // 回到训练页：会话原样保留，作答数仍是 1（数字键没有暗中写入第 2 题）
  await page.click('nav.tabs a[data-page="practice"]');
  await expect(page.locator('#session-view')).toBeVisible();
  const qn = await page.locator('#session-body .qblock').count();
  await expect(page.locator('#btn-submit')).toContainText(`（1/${qn}）`);
});

test('会话草稿：刷新后恢复未提交会话，提交后清除', async ({ page }) => {
  await page.goto('/#practice');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  await page.locator('#session-body .qblock').first().locator('.opt').first().click(); // 答第 1 题

  await page.reload(); // 模拟误刷新：草稿恢复
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('已恢复');
  const qn = await page.locator('#session-body .qblock').count();
  await expect(page.locator('#btn-submit')).toContainText(`（1/${qn}）`); // 已答进度保留
  await expect(page.locator('#timer')).toBeVisible(); // 计时恢复

  // 继续答完并提交 → 草稿清除
  for (let i = 1; i < qn; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }
  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
  expect(await page.evaluate(() => localStorage.getItem('yt_session_draft_v1'))).toBeNull();

  // 提交后刷新：不再恢复，显示组列表
  await page.reload();
  await expect(page.locator('#set-list')).toBeVisible();
});

test('会话草稿加固：篡改的下标/答案被兜底，全非法时整份丢弃', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 部分非法：越界/重复/非整数下标 + 越界答案值 → 过滤后恢复且不崩
  await page.goto('/#practice');
  await page.evaluate(() => {
    localStorage.setItem('yt_session_draft_v1', JSON.stringify({
      mode: 'set', setId: 'sim-tan1', title: '被篡改的草稿', regen: null,
      groups: [{ setId: 'sim-tan1', qidx: [0, 99, 'x', 0] }],
      answers: { 'sim-tan1:0': 7, 'sim-tan1:1': 2 },
      qtimes: {}, startTs: Date.now(), budgetSec: 120,
    }));
  });
  await page.reload();
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#session-body .qblock')).toHaveCount(1); // 只剩合法下标
  await expect(page.locator('#btn-submit')).toContainText('（0/1）'); // 非法答案值与会话外的键都被剔除

  // 全非法：qidx 全部越界 → 整份草稿丢弃，回到组列表且草稿已清除
  await page.evaluate(() => {
    localStorage.setItem('yt_session_draft_v1', JSON.stringify({
      mode: 'set', setId: 'sim-tan1', title: '全非法', regen: null,
      groups: [{ setId: 'sim-tan1', qidx: [50] }],
      answers: {}, qtimes: {}, startTs: Date.now(), budgetSec: 120,
    }));
  });
  await page.reload();
  await expect(page.locator('#set-list')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('yt_session_draft_v1'))).toBeNull();
  expect(errors).toEqual([]);
});

test('信号词高亮开关：默认素卷，勾选后衬底高亮，取消后消失', async ({ page }) => {
  await page.goto('/#practice');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();

  // 默认未勾选：正文无信号词衬底（首组正文含「しかし」，回归看守：曾恒高亮）
  await expect(page.locator('#session-body mark.sig')).toHaveCount(0);

  await page.check('#sig-toggle');
  await expect(page.locator('#session-body mark.sig').first()).toContainText('しかし');

  await page.uncheck('#sig-toggle');
  await expect(page.locator('#session-body mark.sig')).toHaveCount(0);
});

test('练习记录备份：导入覆盖生效、非法 kind 拒绝、可导出', async ({ page }) => {
  page.on('dialog', (d) => d.accept()); // 覆盖确认框自动接受
  const rec = {
    kind: 'yomitaku-records', version: 1, exportedAt: '2026-09-20T00:00:00.000Z',
    data: {
      stats: { tanbun: { c: 5, t: 6 } },
      history: [{ ts: Date.now(), setId: 'sim-tan1', title: '导入的历史记录', c: 5, t: 6, seconds: 95 }],
      wrong: {},
    },
  };

  await page.goto('/#bank');
  await page.fill('#rec-text', JSON.stringify(rec));
  await page.click('#btn-rec-import');
  await expect(page.locator('#toast')).toContainText('练习记录已导入');
  await page.click('nav.tabs a[data-page="home"]');
  await expect(page.locator('#home-stats')).toContainText('5/6');

  await page.goto('/#bank');
  await page.fill('#rec-text', JSON.stringify({ kind: 'wrong-kind', data: {} }));
  await page.click('#btn-rec-import');
  await expect(page.locator('#toast')).toContainText('导入失败');

  await page.click('#btn-rec-export');
  await expect(page.locator('#rec-text')).toHaveValue(/yomitaku-records/);
});

test('数据养护：history 上限 200 条，失效错题自动清理', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const hist = [];
    for (let i = 0; i < 260; i++) hist.push({ ts: 1e12 + i, setId: 'sim-tan1', title: 'h' + i, c: 1, t: 2, seconds: 1 });
    localStorage.setItem('yt_n1_dokkai_v1', JSON.stringify({
      stats: {}, history: hist,
      wrong: { 'no-such-set:0': { setId: 'no-such-set', chosen: 0, ts: 1 } },
    }));
  });
  await page.reload(); // pruneData 在页面初始化时执行
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('yt_n1_dokkai_v1')));
  expect(d.history.length).toBe(200);
  expect(d.wrong['no-such-set:0']).toBeUndefined();
});

test('安全：sourceUrl 仅允许 http(s)，渲染侧兜底旧数据', async ({ page }) => {
  await page.goto('/#bank');
  const bad = [{
    id: 'bad-url', typeKey: 'tanbun', title: '坏链接', minutes: 2, passage: '正文',
    source: '来源', sourceUrl: 'javascript:alert(1)',
    questions: [{ q: '设问？', options: ['①', '②', '③', '④'], answer: 0 }],
  }];
  await page.fill('#bank-import-text', JSON.stringify(bad));
  await page.click('#btn-import');
  await expect(page.locator('#toast')).toContainText('sourceUrl');
  await expect(page.locator('#bank-count')).toContainText(`${ALL_SETS} 组题`);

  // 渲染侧兜底：绕过校验的遗留数据（如旧版导入）里 javascript: 链接替换为 #bank
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('yt_custom_sets_v1') || '[]');
    list.push({
      id: 'legacy-url', typeKey: 'tanbun', title: '旧数据坏链接', minutes: 2, source: '来源', sourceUrl: 'javascript:alert(1)',
      passage: '正文', questions: [{ q: '设问？', options: ['①', '②', '③', '④'], answer: 0 }],
    });
    localStorage.setItem('yt_custom_sets_v1', JSON.stringify(list));
  });
  await page.goto('/#practice');
  const badge = page.locator('#set-cards .setcard', { hasText: '旧数据坏链接' }).locator('a.badge').first();
  await expect(badge).toHaveAttribute('href', '#bank');
});

test('错题本闭环：收录 → 重练答对移出 → 单条删除与清空', async ({ page }) => {
  page.on('dialog', (d) => d.accept());

  // 制造错题：第一组全部选①（正解分布在其他选项，必产生错题）
  const answerAll = async () => {
    await openGroups(page);
    await page.locator('#set-cards .setcard h3').first().click();
    await expect(page.locator('#session-view')).toBeVisible();
    const n = await page.locator('#session-body .qblock').count();
    for (let i = 0; i < n; i++) {
      await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
    }
    await page.click('#btn-submit');
    await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
  };
  await page.goto('/#practice');
  await answerAll();
  const wrongCount = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('yt_n1_dokkai_v1')).wrong).length);
  expect(wrongCount).toBeGreaterThan(0);

  // 错题本收录
  await page.click('nav.tabs a[data-page="review"]');
  await expect(page.locator('#btn-wrong-session')).toBeVisible();
  await expect(page.locator('#review-body .wrongitem')).toHaveCount(wrongCount);

  // 重练全部错题：按正解作答（BANK 全局可读到答案）
  await page.click('#btn-wrong-session');
  await expect(page.locator('#page-practice.on')).toBeVisible(); // 回归看守：必须从错题本页切到训练页
  await expect(page.locator('#session-head-title')).toContainText('错题重练');
  const plan = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('yt_n1_dokkai_v1'));
    const bySet = {};
    Object.keys(d.wrong).forEach((k) => {
      const i = k.lastIndexOf(':');
      const sid = k.slice(0, i);
      (bySet[sid] = bySet[sid] || []).push(parseInt(k.slice(i + 1), 10));
    });
    return Object.keys(bySet).flatMap((sid) => {
      const s = BANK.find((x) => x.id === sid);
      return bySet[sid].sort((a, b) => a - b).map((qi) => s.questions[qi].answer);
    });
  });
  const qn = await page.locator('#session-body .qblock').count();
  expect(qn).toBe(plan.length);
  for (let i = 0; i < qn; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').nth(plan[i]).click();
  }
  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText(/^\d+\/\d+/);

  // 答对自动移出：错题本应为空
  await page.click('nav.tabs a[data-page="review"]');
  await expect(page.locator('#review-body .empty')).toBeVisible();
  await expect(page.locator('#btn-wrong-session')).toBeHidden();

  // 再造错题（前三组全部选①），测单条删除与清空错题本
  await page.click('nav.tabs a[data-page="practice"]');
  await page.click('#btn-back'); // 上次提交的会话视图还在，先回到组列表
  await openGroups(page);
  for (const idx of [0, 1, 2]) {
    await page.locator('#set-cards .setcard h3').nth(idx).click();
    await expect(page.locator('#session-view')).toBeVisible();
    const n = await page.locator('#session-body .qblock').count();
    for (let i = 0; i < n; i++) {
      await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
    }
    await page.click('#btn-submit');
    if (idx < 2) await page.click('#btn-back'); // 回列表再开下一组
  }
  const wrongCount2 = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('yt_n1_dokkai_v1')).wrong).length);
  expect(wrongCount2).toBeGreaterThanOrEqual(2);
  await page.click('nav.tabs a[data-page="review"]');
  await expect(page.locator('#review-body .wrongitem')).toHaveCount(wrongCount2); // 自动等待渲染完成
  await page.locator('#review-body [data-del]').first().click();
  await expect(page.locator('#review-body .wrongitem')).toHaveCount(wrongCount2 - 1);
  await expect(page.locator('#btn-clear-wrong')).toBeVisible();
  await page.click('#btn-clear-wrong');
  await expect(page.locator('#review-body .empty')).toBeVisible();
});

test('随机混合 10 问：抽题计时、用时展示、旧分数不残留', async ({ page }) => {
  await page.goto('/#practice');
  await page.click('#btn-mix10');
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#session-head-title')).toContainText('随机混合 10 问');
  await expect(page.locator('#session-body .qblock')).toHaveCount(10);
  await expect(page.locator('#timer')).toContainText('目标 15:00');

  for (let i = 0; i < 10; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').nth(2).click();
  }
  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
  await expect(page.locator('#session-body .explain').first()).toContainText(/用时 \d+ 秒/);

  // mix 与 set 同等对待：统计与历史都入账
  const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('yt_n1_dokkai_v1')).stats);
  expect(Object.keys(stats).length).toBeGreaterThan(0);
  await page.click('nav.tabs a[data-page="home"]');
  await expect(page.locator('#home-stats')).toContainText('随机混合 10 问');

  // 旧分数不残留：回列表再开一组，头部应为空
  await page.click('nav.tabs a[data-page="practice"]');
  await page.click('#btn-back');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-result')).toHaveText('');
});

test('模拟卷：官方構成组卷、全局计时、满分交卷', async ({ page }) => {
  await page.goto('/#practice');
  await page.click('#btn-mock');
  await expect(page.locator('#session-head-title')).toContainText('模拟卷');
  const qn = await page.locator('#session-body .qblock').count();
  expect(qn).toBeGreaterThanOrEqual(18); // 蓝图抽题后 18~19 问（chobun 组 3 或 4 问）
  expect(qn).toBeLessThanOrEqual(19);
  await expect(page.locator('#timer')).toContainText('目标');

  // 按 BANK 正解逐题作答
  for (let i = 0; i < qn; i++) {
    const key = await page.locator('#session-body .qblock').nth(i).locator('.opt').first().getAttribute('data-key');
    const ans = await page.evaluate((k) => {
      const c = k.lastIndexOf(':');
      const sid = k.slice(0, c), qi = +k.slice(c + 1);
      return BANK.find((s) => s.id === sid).questions[qi].answer;
    }, key);
    await page.locator('#session-body .qblock').nth(i).locator('.opt').nth(ans).click();
  }
  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText('（100%');
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('yt_n1_dokkai_v1')).wrong).length)).toBe(0);
});

test('连续打卡：有练习记录后首页显示 streak', async ({ page }) => {
  await page.goto('/#practice');
  await page.click('#btn-mix10');
  for (let i = 0; i < 10; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }
  await page.click('#btn-submit');
  await page.click('nav.tabs a[data-page="home"]');
  await expect(page.locator('.streakline')).toContainText('连续打卡 1 天');
});

test('导入引导：两种做法卡片可见，示例题组可直接入库，AI 提示词可复制', async ({ page }) => {
  await page.goto('/#bank');
  await expect(page.locator('#page-bank')).toContainText('如何导入自己的题目');
  await expect(page.locator('#page-bank')).toContainText('两种做法');

  await page.click('#btn-example');
  await expect(page.locator('#bank-import-text')).toHaveValue(/示例题组 · 叱らない上司/);
  await page.click('#btn-import');
  await expect(page.locator('#toast')).toContainText('导入成功');
  await expect(page.locator('#bank-count')).toContainText(`${ALL_SETS + 1} 组题`);

  // AI 转录提示词：展开可见、复制有反馈
  await page.click('#ai-prompt-details summary');
  await expect(page.locator('#ai-prompt-text')).toContainText('typeKey');
  await expect(page.locator('#ai-prompt-text')).toContainText('不得自行改判');
  await page.click('#btn-copy-prompt');
  await expect(page.locator('#toast')).toContainText('提示词已复制');
});

test('题组列表折叠：默认收起、按题型分组、展开状态记忆', async ({ page }) => {
  await page.goto('/#practice');
  const groups = page.locator('#set-cards details.typegroup');
  await expect(groups).toHaveCount(6);
  // 收起只是折叠：卡片仍在 DOM，计数断言不受影响
  await expect(page.locator('#set-cards .setcard')).toHaveCount(ALL_SETS);
  expect(await page.evaluate(() =>
    [...document.querySelectorAll('#set-cards details.typegroup')].every((d) => !d.open))).toBe(true);

  // 展开第一组（短文）：组内卡片可见，其余组仍收起
  await groups.first().locator('summary').click();
  await expect(groups.first().locator('.setcard').first()).toBeVisible();
  expect(await page.evaluate(() =>
    document.querySelectorAll('#set-cards details.typegroup:not([open])').length)).toBe(5);

  // 展开状态记忆：刷新后 tanbun 仍展开，其余仍收起
  await page.reload();
  expect(await page.evaluate(() =>
    document.querySelector('#set-cards details.typegroup[data-type="tanbun"]').open)).toBe(true);
  expect(await page.evaluate(() =>
    document.querySelectorAll('#set-cards details.typegroup:not([open])').length)).toBe(5);

  // 题库管理页共用同一套分组
  await page.goto('/#bank');
  await expect(page.locator('#bank-list details.typegroup')).toHaveCount(6);
});
