/* 题库规模元信息：直接在 Node 侧求值 bank.js（纯数据文件，无 DOM 依赖）。
   扩充批次后 ALL_SETS/TANBUN 自动跟随，测试断言无需手动同步（README 用 scripts/update-docs.mjs 同步）。
   路径用 process.cwd()（Playwright 以仓库根为 cwd，与 tests/server.mjs 同约定）：
   本文件被 Playwright 转译为 CJS 加载，import.meta 不可用 */
import { readFileSync } from 'node:fs';

const BANK = new Function(readFileSync('js/bank.js', 'utf8') + '\nreturn BANK;')();
export const ALL_SETS = BANK.length;
export const TANBUN = BANK.filter((s) => s.typeKey === 'tanbun').length;
