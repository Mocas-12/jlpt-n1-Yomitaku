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

/* sw.js 的缓存名与文件内容绑定（扣除缓存名本身后取哈希）：
   CACHE 名 = f(sw 逻辑, index.html 资产指纹)：分片/样式/脚本更新会换 index.html 的 ?v=，
   指纹行随之变化并参与缓存名哈希——旧缓存随 activate 全量清理（否则旧 ?v= 条目
   在同一缓存里永久累积） */
try {
  let sw = await readFile(join(root, 'sw.js'), 'utf8');
  const indexHash = createHash('sha256')
    .update(await readFile(join(root, 'index.html'), 'utf8'))
    .digest('hex').slice(0, 8);
  const m = sw.match(/var CACHE = '([^']*)';/);
  const am = sw.match(/var ASSETS = '([^']*)';/);
  if (!m || !am) {
    console.log('[version] sw.js 未找到 CACHE/ASSETS 声明，跳过');
  } else {
    // ASSETS 行写入本轮 index.html 指纹；缓存名对「扣除 CACHE 行的全文」取哈希（含 ASSETS 行）
    let body = sw.replace(m[0], "var CACHE = '';").replace(am[0], `var ASSETS = '${indexHash}';`);
    const v = 'yomitaku-' + createHash('sha256').update(body).digest('hex').slice(0, 8);
    const next = sw.replace(m[0], () => `var CACHE = '${v}';`).replace(am[0], () => `var ASSETS = '${indexHash}';`);
    if (next !== sw) {
      await writeFile(join(root, 'sw.js'), next);
      console.log(`[version] sw.js CACHE: ${m[1]} -> ${v}（assets ${am[1] || '(空)'} -> ${indexHash}）`);
    } else {
      console.log('[version] sw.js CACHE 未变化');
    }
  }
} catch (e) {
  if (e.code === 'ENOENT') console.log('[version] 未找到 sw.js，跳过');
  else throw e;
}
