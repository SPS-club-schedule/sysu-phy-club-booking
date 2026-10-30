import { spawn } from 'node:child_process';

const wrangler = 'node_modules/wrangler/bin/wrangler.js';
const config = 'wrangler.leafuke.jsonc';
async function run(args) {
  const child = spawn(process.execPath, args, { stdio: ['inherit', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; process.stdout.write(data); });
  child.stderr.on('data', data => { output += data; process.stderr.write(data); });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (code !== 0) throw new Error(`Command failed (${code}): ${args[0]}`);
  return output;
}

await run(['scripts/build-cloudflare.mjs']);
// The domain already belongs to this Worker. Version deployment preserves its
// routes and works with Individual Workers Admin, without account-wide access.
const output = await run([wrangler, 'versions', 'upload', '--config', config]);
const version = output.match(/Worker Version ID:\s*([0-9a-f-]{36})/)?.[1];
if (!version) throw new Error('Upload did not return a version ID; nothing was deployed');
await run([wrangler, 'versions', 'deploy', `${version}@100`, '--config', config, '--yes']);
