/* 将 index.html 中带 ?v= 的静态资源引用，改写为「文件内容 SHA-256 前 8 位」。
   零依赖（仅 Node 内置模块），幂等：同一份文件重复执行结果不变。
   CI 部署前自动执行；本地也可手动跑：node scripts/version.mjs
   这样版本号永远与文件内容一致，不再需要手动升号。 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const htmlPath = process.argv[2] || 'index.html';
const root = process.cwd();
let html = await readFile(htmlPath, 'utf8');

const refs = [...html.matchAll(/(src|href)="([^"?]+)\?v=([^"]*)"/g)];
if (!refs.length) {
  console.log(`[version] ${htmlPath}: 未找到带 ?v= 的资源引用，跳过`);
  process.exit(0);
}

let changed = 0;
for (const m of refs) {
  const [tag, attr, path, oldV] = m;
  const buf = await readFile(join(root, decodeURIComponent(path))); // 引用了不存在的文件则直接抛错，让构建失败
  const v = createHash('sha256').update(buf).digest('hex').slice(0, 8);
  if (oldV === v) continue;
  html = html.replace(tag, () => `${attr}="${path}?v=${v}"`);
  changed++;
  console.log(`[version] ${path}: ${oldV || '(空)'} -> ${v}`);
}
if (changed) await writeFile(htmlPath, html);
console.log(`[version] ${htmlPath}: ${changed} 处已更新，其余未变`);
