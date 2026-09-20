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
   SW 逻辑一变哈希就变，旧缓存随 activate 自动清理，不再依赖手动升版本 */
try {
  let sw = await readFile(join(root, 'sw.js'), 'utf8');
  const m = sw.match(/var CACHE = '([^']*)';/);
  if (!m) {
    console.log('[version] sw.js 未找到 CACHE 声明，跳过');
  } else {
    const v = 'yomitaku-' + createHash('sha256').update(sw.replace(m[0], "var CACHE = '';")).digest('hex').slice(0, 8);
    if (m[1] !== v) {
      await writeFile(join(root, 'sw.js'), sw.replace(m[0], () => `var CACHE = '${v}';`));
      console.log(`[version] sw.js CACHE: ${m[1]} -> ${v}`);
    } else {
      console.log('[version] sw.js CACHE 未变化');
    }
  }
} catch (e) {
  if (e.code === 'ENOENT') console.log('[version] 未找到 sw.js，跳过');
  else throw e;
}
