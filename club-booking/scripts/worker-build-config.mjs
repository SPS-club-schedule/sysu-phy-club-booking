// The published repository nests this project below the Pages HTML. Workers
// Builds starts at that repository's root unless its dashboard setting changes.
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const canonical = JSON.parse(await readFile(new URL('../wrangler.leafuke.jsonc', import.meta.url), 'utf8'));
const { $schema, ...settings } = canonical;
const expected = { ...settings, main: 'club-booking/' + settings.main };
if (process.argv[2] === '--check') {
  const actual = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  if (!isDeepStrictEqual(actual, expected)) throw new Error('Regenerate root wrangler.jsonc with node club-booking/scripts/worker-build-config.mjs > wrangler.jsonc');
} else {
  process.stdout.write(JSON.stringify(expected, null, 2) + '\n');
}
