import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// A separate target: website exports and the production backend stay unchanged.
const root = resolve(import.meta.dirname, '..');
const apiBase = 'https://sysu-phy-club-book.folderrewind.top';
const result = await build({
  absWorkingDir: root, entryPoints: ['online/entry.tsx'], bundle: true,
  write: false, metafile: true, format: 'iife', platform: 'browser',
  target: ['es2022'], jsx: 'automatic', minify: true, charset: 'utf8', legalComments: 'inline',
  plugins: [{ name: 'cloudflare-updates', setup(builder) {
    builder.onResolve({ filter: /^\.\/push$/ }, () => ({ path: resolve(root, 'online/cloudflare-push.ts') }));
  } }],
  define: { 'process.env.NODE_ENV': '"production"', __BOOKING_API_BASE__: JSON.stringify(apiBase), __BOOKING_PUSH_ENABLED__: 'true' },
});
const inputs = Object.keys(result.metafile.inputs);
if (inputs.some(path => path.includes('online/vendor/') || path.endsWith('data/timetables.json') || path.startsWith('offline/'))) {
  throw new Error('Android must use live Cloudflare data without old push SDKs or embedded timetable records');
}
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// Android supplies Chinese system fonts. Do not fetch fonts or any frontend assets.
const css = (await readFile(resolve(root, 'app/globals.css'), 'utf8')).replace(/^@import\s+url\([^\n]+\);\s*/m, '');
if (/@import|url\(\s*['"]?https?:/i.test(css)) throw new Error('Android styles must be fully local');
const icon = await readFile(resolve(root, 'public/favicon.svg'), 'utf8');
const scriptHash = createHash('sha256').update(script).digest('base64');
const csp = `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src ${apiBase} ${apiBase.replace('https:', 'wss:')}; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'`;
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>物院社团时间预约</title><link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}"><style>${css}</style></head><body><div id="root"></div><noscript>请启用 JavaScript，以使用预约日历。</noscript><script>${script}</script></body></html>`;
const directory = resolve(root, 'android/app/src/main/assets/www');
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'index.html'), html);
await writeFile(resolve(directory, 'build.json'), JSON.stringify({
  version: 1, apiBase, frontend: 'bundled', realtime: 'cloudflare-websocket',
  sha256: createHash('sha256').update(html).digest('hex'),
}, null, 2) + '\n');
console.log(JSON.stringify({ output: resolve(directory, 'index.html'), bytes: Buffer.byteLength(html), apiBase }));
