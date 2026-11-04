import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test('Android bundles the complete UI with a script hash and only live API connections', async () => {
  execFileSync(process.execPath, ['scripts/export-android.mjs']);
  const html = await readFile('android/app/src/main/assets/www/index.html', 'utf8');
  const metadata = JSON.parse(await readFile('android/app/src/main/assets/www/build.json', 'utf8'));
  assert.equal(metadata.sha256, createHash('sha256').update(html).digest('hex'));
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  assert.ok(html.includes(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`));
  assert.ok(html.includes('connect-src https://sysu-phy-club-book.folderrewind.top wss://sysu-phy-club-book.folderrewind.top'));
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+rel="stylesheet"|fonts\.googleapis|fonts\.gstatic|@import/);
  assert.doesNotMatch(script, /env-00jy6xwsp3aa|uni-push|gtpush|fc-mp-a5e7/);
  assert.ok(html.includes('实时更新已连接'));
  assert.ok(html.includes('叠加年级课表'));
  const source = JSON.parse(await readFile('data/timetables.json', 'utf8'));
  for (const table of source.timetables) for (const course of table.courses) {
    assert.ok(!html.includes(JSON.stringify(course)), 'No timetable records embedded');
  }
});
