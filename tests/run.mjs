// Все проверки по очереди: node run.mjs (или npm test); одну — node run.mjs voice
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';

const only = process.argv[2];
const files = fs.readdirSync(import.meta.dirname).filter(f => f.endsWith('.test.mjs') && (!only || f.startsWith(only))).sort();
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [f], {cwd: import.meta.dirname, stdio: 'inherit', timeout: 5 * 60e3});
  if (r.status !== 0) bad++;
}
console.log(bad ? `\nНе прошло: ${bad} из ${files.length}` : `\nВсё прошло: ${files.length} из ${files.length}`);
process.exitCode = bad ? 1 : 0;
