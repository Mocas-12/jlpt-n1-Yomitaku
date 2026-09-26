/* 同步两份 README 的题库规模数字（扩充批次后跑一次）：node scripts/update-docs.mjs
   首页/题库页的规模文案走 data-bank-stat 动态注入，无需处理；bank.js 头部的
   构成注释（如 21×4+1×3）随批次手写，不在此自动化。 */
import { readFileSync, writeFileSync } from 'node:fs';

const BANK = new Function(readFileSync(new URL('../js/bank.js', import.meta.url), 'utf8') + '\nreturn BANK;')();
const sets = BANK.length;
const qs = BANK.reduce((a, s) => a + s.questions.length, 0);

let touched = 0;
for (const [file, re, repl] of [
  ['README.zh-CN.md', /(\d+) 组 (\d+) 问/g, () => `${sets} 组 ${qs} 问`],
  ['README.md', /(\d+) sets \/ (\d+) questions/g, () => `${sets} sets / ${qs} questions`],
]) {
  const path = new URL('../' + file, import.meta.url);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(re, repl);
  if (after !== before) {
    writeFileSync(path, after);
    touched++;
    console.log(`[docs] ${file}: 规模数字已更新为 ${sets} 组 ${qs} 问`);
  } else {
    console.log(`[docs] ${file}: 规模数字已是最新（${sets} 组 ${qs} 问）`);
  }
}
if (!touched) console.log('[docs] 无改动');
