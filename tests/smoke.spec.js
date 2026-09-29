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

  // 间隔重复：答对不再直接移出，而是推进到下一轮（1→3→7 天），错题本仍在、全部排到未来
  await page.click('nav.tabs a[data-page="review"]');
  await expect(page.locator('#review-body .wrongitem')).toHaveCount(wrongCount);
  await expect(page.locator('#review-body .badge.red')).toHaveCount(0); // 无今日到期
  await expect(page.locator('#btn-review-due')).toBeHidden();
  const stages = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('yt_n1_dokkai_v1'));
    return Object.keys(d.wrong).map((k) => d.wrong[k].stage);
  });
  expect(stages.every((s) => s === 1)).toBe(true); // 全部从第 1 轮推进到第 2 轮

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

test('错题间隔重复：到期复习推进轮次，第三关毕业移出', async ({ page }) => {
  // 种入同一题组的三道到期错题（stage 0/1/2 各一），一轮复习看遍推进与毕业
  // （用长篇题组：每组 4 问，短文每组仅 1 问）
  await page.goto('/');
  await page.evaluate(() => {
    const s = BANK.find((x) => x.typeKey === 'chobun');
    const d = { stats: {}, history: [], days: [], wrong: {} };
    [0, 1, 2].forEach((stage, i) => {
      d.wrong[s.id + ':' + i] = { setId: s.id, chosen: 0, ts: Date.now() - 86400000, stage: stage, next: Date.now() - 3600000 };
    });
    localStorage.setItem('yt_n1_dokkai_v1', JSON.stringify(d));
  });
  await page.goto('/#review');
  await expect(page.locator('#btn-review-due')).toContainText('（3 题）');
  await expect(page.locator('#review-body .badge.red')).toHaveCount(3);

  // 首页也应有待复习入口
  await page.goto('/#home');
  await expect(page.locator('#btn-home-review')).toBeVisible();

  await page.goto('/#review');
  await page.click('#btn-review-due');
  await expect(page.locator('#session-head-title')).toContainText('到期复习（3 题）');
  const plan = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('yt_n1_dokkai_v1'));
    const sid = Object.keys(d.wrong)[0].split(':')[0];
    const s = BANK.find((x) => x.id === sid);
    return [0, 1, 2].map((qi) => s.questions[qi].answer);
  });
  for (let i = 0; i < 3; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').nth(plan[i]).click();
  }
  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText('3/3');

  // stage0→1（+3 天）、stage1→2（+7 天）、stage2→毕业删除
  const after = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('yt_n1_dokkai_v1'));
    const keys = Object.keys(d.wrong);
    return {
      n: keys.length,
      stages: keys.map((k) => d.wrong[k].stage).sort(),
      gaps: keys.map((k) => Math.round((d.wrong[k].next - Date.now()) / 86400000)).sort(),
    };
  });
  expect(after.n).toBe(2);
  expect(after.stages).toEqual([1, 2]);
  expect(after.gaps).toEqual([3, 7]);

  // 复习页面：无今日到期，按钮隐藏
  await page.goto('/#review');
  await expect(page.locator('#review-body .badge.red')).toHaveCount(0);
  await expect(page.locator('#btn-review-due')).toBeHidden();
});

test('定向训练：考点筛选与标题搜索过滤题组列表', async ({ page }) => {
  await page.goto('/#practice');
  await expect(page.locator('#label-chips .fbtn').first()).toBeVisible();

  // 考点筛选：主旨把握 → 只显示含该考点题的题组，数量与 BANK 实际一致
  const expectLabel = await page.evaluate(() =>
    BANK.filter((s) => s.questions.some((q) => q.label === '主旨把握')).length);
  await page.locator('#label-chips .fbtn', { hasText: '主旨把握' }).click();
  await expect(page.locator('#set-cards .setcard')).toHaveCount(expectLabel);

  // 组合：在考点筛选内再按标题搜索
  await page.fill('#set-search', '余白');
  const expectBoth = await page.evaluate(() =>
    BANK.filter((s) => s.questions.some((q) => q.label === '主旨把握') && s.title.includes('余白')).length);
  await expect(page.locator('#set-cards .setcard')).toHaveCount(expectBoth);

  // 无匹配的空态
  await page.fill('#set-search', '不存在的关键词XYZ');
  await expect(page.locator('#set-cards')).toContainText('没有匹配的题组');
  await page.fill('#set-search', '');

  // 清除考点筛选后恢复
  await page.locator('#label-chips .fbtn', { hasText: '全部考点' }).click();
  const all = await page.evaluate(() => BANK.length);
  await expect(page.locator('#set-cards .setcard')).toHaveCount(all);
});

test('定向训练：错题本考点筛选 + 首页陷阱画像直达', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  // 制造两类错题：短文组全选① + 长篇组全选①（正解分布不同，产生多标签错题）
  await page.goto('/#practice');
  const makeWrong = async (idx) => {
    await openGroups(page);
    await page.locator('#set-cards .setcard h3').nth(idx).click();
    await expect(page.locator('#session-view')).toBeVisible();
    const n = await page.locator('#session-body .qblock').count();
    for (let i = 0; i < n; i++) {
      await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
    }
    await page.click('#btn-submit');
    await page.click('#btn-back');
  };
  await makeWrong(0);
  const chobunCard = await page.evaluate(() => {
    openAll();
    function openAll() {
      document.querySelectorAll('#set-cards details.typegroup').forEach((d) => { d.open = true; });
    }
    const cards = [...document.querySelectorAll('#set-cards .setcard')];
    return cards.findIndex((c) => BANK.find((x) => x.id === c.dataset.id)?.typeKey === 'chobun');
  });
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').nth(chobunCard).click();
  await expect(page.locator('#session-view')).toBeVisible();
  const n2 = await page.locator('#session-body .qblock').count();
  for (let i = 0; i < n2; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }
  await page.click('#btn-submit');

  // 首页出现「常掉陷阱」画像，点击标签直达定向训练（同文档跳转，内存筛选状态保留）
  await page.goto('/#home');
  await expect(page.locator('.trapline [data-trap]').first()).toBeVisible();
  const trapLabel = await page.locator('.trapline [data-trap]').first().getAttribute('data-trap');
  await page.locator('.trapline [data-trap]').first().click();
  await expect(page.locator('#page-practice.on')).toBeVisible();
  // 会话仍存活时路由会先显示会话视图：回组列表后筛选状态生效
  await page.click('#btn-back-top');
  const expectTrap = await page.evaluate((l) =>
    BANK.filter((s) => s.questions.some((q) => q.label === l)).length, trapLabel);
  await expect(page.locator('#label-chips .fbtn.on')).toContainText(trapLabel);
  await expect(page.locator('#set-cards .setcard')).toHaveCount(expectTrap);

  // 错题本：考点 chips 过滤列表，重练按钮跟随筛选结果
  await page.goto('/#review');
  const chipN = await page.locator('#wrong-filterbar .fbtn').count();
  expect(chipN).toBeGreaterThan(1); // 两类错题 → 至少「全部」+两个考点
  await page.locator('#wrong-filterbar [data-wl]:not([data-wl="all"])').first().click();
  const filteredN = await page.locator('#review-body .wrongitem').count();
  expect(filteredN).toBeGreaterThan(0);
  await expect(page.locator('#btn-wrong-session')).toContainText('重练筛选错题（' + filteredN + ' 题）');
  await page.click('#btn-wrong-session');
  await expect(page.locator('#session-head-title')).toContainText('定向重练 · ');
  await page.click('#btn-back-top');
});

test('阅读设置：字号/行距即时生效并持久化', async ({ page }) => {
  await page.goto('/#practice');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  const base = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('.passage')).fontSize));

  await page.click('#fs-plus');
  const bigger = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('.passage')).fontSize));
  expect(bigger).toBeGreaterThan(base);
  await page.click('#fs-plus');
  const biggest = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('.passage')).fontSize));
  expect(biggest).toBeGreaterThan(bigger);
  await expect(page.locator('#fs-plus')).toBeDisabled(); // 第 3 档封顶

  await page.click('#lh-toggle');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-rlh'))).toBe('1');

  // 持久化：刷新后仍生效
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-rfs'))).toBe('2');
  const kept = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('.passage')).fontSize));
  expect(kept).toBe(biggest);

  // 缩回标准档
  await page.click('#fs-minus');
  await page.click('#fs-minus');
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-rfs'))).toBe(false);
});

test('深色模式：未手动选择时跟随系统切换', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('yt_theme'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');

  // 系统切到深色 → 自动跟随（无显式偏好）
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');

  // 手动切换后为显式偏好，系统再变不再跟随
  await page.click('#theme-toggle');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
});

test('解析引用跳原文：点击解析条目，文章对应句子高亮', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/#practice');
  await openGroups(page);
  // 用长篇组（4 问、长文），提交后解析引用大概率可定位
  const chobunCard = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#set-cards .setcard')];
    return cards.findIndex((c) => BANK.find((x) => x.id === c.dataset.id)?.typeKey === 'chobun');
  });
  await page.locator('#set-cards .setcard h3').nth(chobunCard).click();
  await expect(page.locator('#session-view')).toBeVisible();
  const n = await page.locator('#session-body .qblock').count();
  for (let i = 0; i < n; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }
  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);

  const jqN = await page.locator('#session-body li.jq').count();
  expect(jqN).toBeGreaterThan(0); // 多数解析都带可定位的「…」引用
  await page.locator('#session-body li.jq').first().click();
  const hlN = await page.locator('.passage .sent.hl').count();
  expect(hlN).toBeGreaterThan(0); // 命中句子被高亮
  // 再次点击另一条：旧高亮清除、新高亮生效（单处高亮语义）
  if (jqN > 1) {
    await page.locator('#session-body li.jq').nth(1).click();
    expect(await page.locator('.passage .sent.hl').count()).toBeGreaterThan(0);
  }
});

test('成绩卡分享：出分后生成成绩图片（无 Web Share 文件能力时下载）', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/#practice');
  await page.click('#btn-mock');
  await expect(page.locator('#session-view')).toBeVisible();
  const n = await page.locator('#session-body .qblock').count();
  for (let i = 0; i < n; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }
  await page.click('#btn-submit');
  await expect(page.locator('#btn-share')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-share'),
  ]);
  expect(download.suggestedFilename()).toBe('yomitaku-score.png');
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
  expect(qn).toBeGreaterThanOrEqual(17); // 蓝图抽题后 17~19 问（chobun 组 3 或 4 问、shucho 组 2 或 3 问）
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

test('streak 与 history 上限解耦：300 条截到 200 后，4 天连续打卡仍完整', async ({ page }) => {
  await page.goto('/');
  const day = 24 * 3600 * 1000;
  await page.evaluate(({ day }) => {
    const now = Date.now();
    const hist = [];
    for (let i = 0; i < 100; i++) hist.push({ ts: now, setId: 'sim-tan1', title: 't', c: 1, t: 2, seconds: 1 });
    for (let i = 0; i < 100; i++) hist.push({ ts: now - day, setId: 'sim-tan1', title: 't', c: 1, t: 2, seconds: 1 });
    for (let i = 0; i < 50; i++) hist.push({ ts: now - 2 * day, setId: 'sim-tan1', title: 't', c: 1, t: 2, seconds: 1 });
    for (let i = 0; i < 50; i++) hist.push({ ts: now - 3 * day, setId: 'sim-tan1', title: 't', c: 1, t: 2, seconds: 1 });
    localStorage.setItem('yt_n1_dokkai_v1', JSON.stringify({ stats: {}, history: hist, wrong: {} }));
  }, { day });
  await page.reload(); // pruneData 先从完整历史回填练习日期，再截断 history
  await page.click('nav.tabs a[data-page="home"]');
  await expect(page.locator('.streakline')).toContainText('连续打卡 4 天');
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('yt_n1_dokkai_v1')));
  expect(d.history.length).toBe(200); // 上限依旧生效
  expect(d.days).toHaveLength(4); // 日期独立存储，未被截断
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

test('添加到主屏幕：Chromium 收到安装事件后显示入口，接受安装后隐藏并提示', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#install-btn')).toBeHidden();

  // 模拟 Chromium 的 beforeinstallprompt（真实事件带 prompt()/userChoice，此处手工补齐）
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt');
    e.preventDefault = () => {};
    e.prompt = () => {};
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await expect(page.locator('#install-btn')).toBeVisible();

  await page.click('#install-btn');
  await expect(page.locator('#toast.show')).toContainText('已添加到主屏幕');
  await expect(page.locator('#install-btn')).toBeHidden();
});

test('添加到主屏幕：iOS Safari 无安装事件时入口常显，点击展开分步指引', async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto('/');

  // iOS 不触发 beforeinstallprompt，按钮也应直接可见
  await expect(page.locator('#install-btn')).toBeVisible();
  await page.click('#install-btn');
  await expect(page.locator('#install-guide')).toBeVisible();
  await expect(page.locator('#install-guide')).toContainText('添加到主屏幕');

  await page.click('#install-guide-close');
  await expect(page.locator('#install-guide')).toBeHidden();
  await ctx.close();
});
