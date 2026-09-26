/* 题库结构与质量校验（扩充批次后必跑）：node scripts/check-bank.mjs
   检查项：
   - 结构：重复 id/title、字段完整性（options 4 项、answer 0-3、explain 等长、minutes）
   - 划线句：⟪…⟫ 必须被题干引用（容忍题干引用时「」→『』的引号嵌套转换）、标记配对
   - 考点标签：只允许标准词表（与 index.html AI 提示词一致）
   - 正解分布：整体均匀性（任一选项占比过高即报错）
   - 字数下限（防退化）：低于下限报错；低于官方目标 80% 提示（现有题库以精简篇幅编写，
     目标是新增批次不再变短，见 README 与题库页的篇幅说明）
   退出码：有 error 为 1，可供 CI / 提交前把关。 */
import { readFileSync } from 'node:fs';

const TYPE_KEYS = ['tanbun', 'chubun', 'chobun', 'togo', 'shucho', 'joho'];
const LABELS = ['主旨把握', '内容一致', '指示语', '划线句含义', '理由说明', '意见一致', '共通点', '相違点', '条件筛选', '注意事项'];
const LEN_FLOOR = { tanbun: 150, chubun: 200, chobun: 500, togo: 300, shucho: 350, joho: 250 };
const LEN_OFFICIAL = { tanbun: 200, chubun: 500, chobun: 1000, togo: 600, shucho: 1000, joho: 700 };
const TYPE_NAMES = { tanbun: '短文', chubun: '中文', chobun: '长篇', togo: '統合', shucho: '主張', joho: '情報' };

const src = readFileSync(new URL('../js/bank.js', import.meta.url), 'utf8');
const ctx = (await import('node:vm')).createContext({});
const vm = await import('node:vm');
vm.runInContext(src, ctx); // bank.js 顶层 const 不上 global，需在同一上下文里再取一次
const BANK = vm.runInContext('BANK', ctx);
if (!Array.isArray(BANK)) { console.error('bank.js 未求值出 BANK 数组'); process.exit(1); }

const errors = [];
const warns = [];
const seenId = new Set(), seenTitle = new Set();
const passageSeen = new Map();
const ansDist = [0, 0, 0, 0];
const labelDist = {};
const lenByType = {};
const underTarget = {};
let totalQ = 0;

/* 引号/括号/空白归一：题干引用划线句时常把「」嵌套成『』 */
const norm = (s) => String(s).replace(/[「」『』（）()【】\s、。]/g, '');

for (const s of BANK) {
  const at = s.id || `(第 ${BANK.indexOf(s) + 1} 组)`;
  if (!s.id || typeof s.id !== 'string') errors.push(`${at}: 缺 id`);
  if (seenId.has(s.id)) errors.push(`重复 id: ${s.id}`);
  seenId.add(s.id);
  if (!s.title) errors.push(`${at}: 缺 title`);
  else if (seenTitle.has(s.title)) errors.push(`重复 title: ${s.title}`);
  seenTitle.add(s.title);
  if (!TYPE_KEYS.includes(s.typeKey)) errors.push(`${at}: 非法 typeKey ${s.typeKey}`);
  if (!s.minutes) errors.push(`${at}: 缺 minutes`);
  if (s.sourceUrl && !/^https?:\/\//i.test(s.sourceUrl)) errors.push(`${at}: sourceUrl 非 http(s)`);

  const text = (s.passageA || '') + '\n' + (s.passage || '') + '\n' + (s.passageB || '');
  const open = (text.match(/⟪/g) || []).length, close = (text.match(/⟫/g) || []).length;
  if (open !== close) errors.push(`${at}: ⟪⟫ 不配对 (${open}/${close})`);
  const qsNorm = s.questions.map((q) => norm(q.q)).join('\n');
  for (const m of text.matchAll(/⟪(.+?)⟫/g)) {
    if (!qsNorm.includes(norm(m[1]).slice(0, 12))) {
      errors.push(`${at}: 划线句未被题干引用 → ${m[1].slice(0, 20)}…`);
    }
  }

  const pkey = norm(s.passageA || s.passage || '').slice(0, 40);
  if (passageSeen.has(pkey)) warns.push(`${at} 与 ${passageSeen.get(pkey)} 文章开头相同`);
  else passageSeen.set(pkey, s.id);

  const len = ((s.passageA || '') + (s.passageB || '') + (s.passage || '')).length;
  const floor = LEN_FLOOR[s.typeKey];
  if (floor && len < floor) errors.push(`${at}: ${TYPE_NAMES[s.typeKey]} 字数 ${len} 低于下限 ${floor}`);
  if (LEN_OFFICIAL[s.typeKey] && len < LEN_OFFICIAL[s.typeKey] * 0.8) {
    underTarget[s.typeKey] = (underTarget[s.typeKey] || 0) + 1; // 汇总展示，避免逐组刷屏
  }
  (lenByType[s.typeKey] = lenByType[s.typeKey] || []).push(len);

  for (const [i, q] of (s.questions || []).entries()) {
    totalQ++;
    if (!q.q || typeof q.q !== 'string') errors.push(`${at}#${i}: 缺 q`);
    if (!Array.isArray(q.options) || q.options.length !== 4) errors.push(`${at}#${i}: options ≠ 4`);
    else if (new Set(q.options).size !== 4) errors.push(`${at}#${i}: 选项文本重复`);
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3 || q.answer % 1 !== 0) errors.push(`${at}#${i}: answer 非法`);
    else ansDist[q.answer]++;
    if (q.explain !== undefined && (!Array.isArray(q.explain) || q.explain.length !== 4)) errors.push(`${at}#${i}: explain ≠ 4`);
    if (q.label !== undefined) {
      if (!LABELS.includes(q.label)) errors.push(`${at}#${i}: 考点标签「${q.label}」不在标准词表（${LABELS.join(' / ')}）`);
      else labelDist[q.label] = (labelDist[q.label] || 0) + 1;
    }
  }
}

const maxShare = Math.max(...ansDist) / totalQ;
if (maxShare > 0.4) errors.push(`正解分布失衡：${ansDist.join('/')}（单选项占比 ${(maxShare * 100).toFixed(1)}%）`);

console.log(`组数 ${BANK.length} · 问数 ${totalQ} · 正解 ${ansDist.join('/')}`);
console.log('题型组数:', TYPE_KEYS.map((k) => `${TYPE_NAMES[k]} ${BANK.filter((s) => s.typeKey === k).length}`).join(' · '));
console.log('字数中位数:', TYPE_KEYS.map((k) => {
  const a = (lenByType[k] || []).sort((x, y) => x - y);
  return a.length ? `${TYPE_NAMES[k]} ${a[Math.floor(a.length / 2)]}` : '';
}).filter(Boolean).join(' · '));
console.log('标签分布:', Object.entries(labelDist).map(([k, v]) => `${k} ${v}`).join(' · '));
const unused = LABELS.filter((l) => !labelDist[l]);
if (unused.length) console.log(`词表未用到: ${unused.join(' / ')}`);
const underStr = TYPE_KEYS.filter((k) => underTarget[k])
  .map((k) => `${TYPE_NAMES[k]} ${underTarget[k]}/${BANK.filter((s) => s.typeKey === k).length}`).join(' · ');
if (underStr) console.log(`低于官方目标 80%（精简篇幅为既有现状，新增批次勿再变短）: ${underStr}`);

if (warns.length) {
  console.log(`--- 提示 ${warns.length} 件（不阻断） ---`);
  warns.forEach((w) => console.log('  [!]', w));
}
if (errors.length) {
  console.error(`--- 错误 ${errors.length} 件 ---`);
  errors.forEach((e) => console.error('  [X]', e));
  process.exit(1);
}
console.log('✓ 题库校验通过');
