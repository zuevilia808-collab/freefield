// Обновление программы Freefield из репозитория (GitHub, ветка main): все pc/mcp/*.js и *.mjs → эта папка.
// Прежние версии изменённых файлов — в mcp/backup-<дата>. Настройки, профили и готовые файлы не трогаем.
// Новый код начнёт работать после перезапуска программы (Claude Desktop или ярлыка Freefield).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO = 'zuevilia808-collab/freefield';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = `https://raw.githubusercontent.com/${REPO}/main/pc/mcp/`;

export async function updateFromGithub({dir = HERE, log = () => {}} = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/pc/mcp?ref=main`, {headers: {'User-Agent': 'freefield-update', Accept: 'application/vnd.github+json'}});
  if (!r.ok) throw new Error(r.status === 403 ? 'GitHub временно не отвечает (лимит запросов) — попробуйте через час' : `GitHub ответил ${r.status}`);
  const list = (await r.json()).filter(f => f.type === 'file' && /^[\w.-]+\.m?js$/.test(f.name));
  if (!list.length) throw new Error('в репозитории нет файлов программы');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const backup = path.join(dir, 'backup-' + stamp), changed = [];
  for (const f of list) {
    const res = await fetch(RAW + f.name, {headers: {'User-Agent': 'freefield-update'}});
    if (!res.ok) throw new Error(`не скачался ${f.name}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer()), dst = path.join(dir, f.name);
    const old = fs.existsSync(dst) ? fs.readFileSync(dst) : null;
    if (old && old.equals(buf)) continue;
    if (old) { fs.mkdirSync(backup, {recursive: true}); fs.copyFileSync(dst, path.join(backup, f.name)); }
    fs.writeFileSync(dst + '.new', buf);
    fs.renameSync(dst + '.new', dst);
    changed.push(f.name);
    log('обновлён ' + f.name);
  }
  return {changed, total: list.length, backup: changed.length && fs.existsSync(backup) ? backup : null};
}
