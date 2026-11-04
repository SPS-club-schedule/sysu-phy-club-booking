import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
const file=new URL('../outputs/qa/readonly-page.mjs',import.meta.url);
const built=await build({entryPoints:['app/page.tsx'],bundle:true,write:false,format:'esm',platform:'node',packages:'external',jsx:'automatic'});
await mkdir(new URL('../outputs/qa/',import.meta.url),{recursive:true});
await writeFile(file,built.outputFiles[0].text);
const {default:Home}=await import(file.href);
await unlink(file);
test('public and local pages expose no timetable editing or import controls',()=>{
 const initialCurriculum={version:1,timetables:[{id:'g3',label:'大三',term:'测试',grade:3,week1Monday:'2026-09-07',courses:[],overrides:[]}]};
 for(const localOnly of [true,false]){
  const html=renderToStaticMarkup(createElement(Home,{localOnly,initialCurriculum}));
  if(localOnly)assert.match(html,/大三/);
  else {assert.match(html,/正在恢复登录/);assert.doesNotMatch(html,/class="calendar-grid"/)}
  assert.doesNotMatch(html,/导入 \/ 更新课表|manage-timetables|timetable-editor|type="file"/);
 }
});
