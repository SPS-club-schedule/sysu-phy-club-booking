import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pushEnabled=process.env.BOOKING_PUSH_ENABLED!=='0';
const backend=process.env.BOOKING_BACKEND||'cloudflare';
if(!['cloudflare','unicloud'].includes(backend))throw new Error('Invalid backend');
const cloudflare=backend==='cloudflare';
const apiUrl = new URL(process.env.BOOKING_API_BASE || (cloudflare?'https://sysu-phy-club-book.folderrewind.top':'https://env-00jy6xwsp3aa.dev-hz.cloudbasefunction.cn/booking-api'));
if(apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash)throw new Error('Invalid API base');
const apiBase = apiUrl.origin + apiUrl.pathname.replace(/\/$/,'');
if (!apiBase.startsWith('https://')) throw new Error('Online API must use HTTPS');
const result = await build({absWorkingDir:root,entryPoints:['online/entry.tsx'],bundle:true,write:false,metafile:true,format:'iife',platform:'browser',target:['es2022'],jsx:'automatic',minify:true,plugins:cloudflare?[{name:'cloudflare-updates',setup(build){build.onResolve({filter:/^\.\/push$/},()=>({path:resolve(root,'online/cloudflare-push.ts')}))}}]:[],define:{'process.env.NODE_ENV':'"production"',__BOOKING_API_BASE__:JSON.stringify(apiBase),__BOOKING_PUSH_ENABLED__:JSON.stringify(pushEnabled)},legalComments:'inline'});
if (cloudflare && Object.keys(result.metafile.inputs).some(path=>path.includes('online/vendor/'))) throw new Error('Cloudflare frontend must not bundle uni-push');
if (Object.keys(result.metafile.inputs).some(path=>path.endsWith('data/timetables.json'))) throw new Error('Online frontend must not bundle timetable source data');
const script = result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const css = await readFile(resolve(root,'app/globals.css'),'utf8');
const icon = await readFile(resolve(root,'public/favicon.svg'),'utf8');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>物院社团时间预约</title><meta name="description" content="社团活动预约与共享日历。"><link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}"><style>${css}</style></head><body><div id="root"></div><noscript>请启用 JavaScript，以使用预约日历。</noscript><script>${script}</script></body></html>`;
const directory=resolve(root,'outputs/github-pages');
await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,'index.html'),html);
await writeFile(resolve(directory,'.nojekyll'),'');
await copyFile(resolve(root,'public/connection-test.html'),resolve(directory,'connection-test.html'));

console.log(JSON.stringify({output:resolve(directory,'index.html'),apiBase,bytes:Buffer.byteLength(html)}));

await copyFile(resolve(root,'online/vendor/gtpush-min.js.LICENSE.txt'),resolve(directory,'gtpush-min.js.LICENSE.txt'));
await copyFile(resolve(root,'online/vendor/LICENSE'),resolve(directory,'unipush-LICENSE.txt'));
