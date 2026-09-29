// Синхронизация: то, что Freefield сам запускал на сайтах (Flow, Dola, Arena, Google Vids), но не успел забрать, сохраняется в outputs
// и попадает в историю (.batches.json) — оттуда приложение Freefield само забирает файлы в галерею. Чужое (что пользователь
// делал на сайтах сам) не трогаем — в галерею только сделанное через Freefield.
// Уже имеющиеся файлы узнаём по содержимому (sha1), поэтому дублей нет.
import * as P from './portals.js';
import {HERE, withProfile, profileName, activeProfileId} from './state.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = process.env.FREEFIELD_OUTPUT_DIR || path.join(HERE, '..', 'outputs');
const BATCH_FILE = path.join(HERE, '.batches.json');
const EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm'};
const sha = buf => crypto.createHash('sha1').update(buf).digest('hex');
const slug = s => (s || 'art').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'art';

// хэши файлов за последние 7 дней
function knownHashes() {
  const set = new Set();
  const days = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-7) : [];
  for (const d of days) for (const n of fs.readdirSync(path.join(OUT, d))) {
    if (!/\.(png|jpe?g|webp|gif|mp4|webm)$/i.test(n)) continue;
    try { set.add(sha(fs.readFileSync(path.join(OUT, d, n)))); } catch {}
  }
  return set;
}

// профили, окна которых сейчас открыты (окна закрытых профилей синхронизация не открывает)
async function openIds() {
  const {chromeOpen, openProfilesNow} = await import('./bridge.js');
  if (!(await chromeOpen())) return [activeProfileId()];
  const ids = Object.keys((await openProfilesNow()).map).map(dir => dir === 'Default' ? 1 : +dir.split(' ')[1] + 1);
  return ids.length ? ids : [activeProfileId()];
}

export async function syncSites({onStatus = () => {}} = {}) {
  const found = [];
  const errors = [];
  const ids = await openIds().catch(() => [activeProfileId()]);
  for (const p of ids) await withProfile(p, async () => {
    const who = ids.length > 1 ? ` (${profileName(p)})` : '';
    const mine = list => list.map(f => ({...f, p}));
    try { found.push(...mine(await P.flowSync({onStatus}))); } catch (e) { errors.push(`Google Flow${who}: ${e.message}`); }
    if (P.oursSet('dola').size) try { found.push(...mine(await P.dolaSync({onStatus}))); } catch (e) { errors.push(`Dola${who}: ${e.message}`); }
    if (P.oursSet('arena').size) try { found.push(...mine(await P.arenaSync({onStatus}))); } catch (e) { errors.push(`Arena${who}: ${e.message}`); }
    try { found.push(...mine(await P.vidsSync({onStatus}))); } catch (e) { errors.push(`Google Vids${who}: ${e.message}`); }
  });
  const have = knownHashes();
  const items = [];
  for (const f of found) {
    const h = sha(f.buf);
    withProfile(f.p, () => P.markSynced(f.site, [f.id]));   // отметка — в профиле, откуда файл
    if (have.has(h)) continue;
    have.add(h);
    const dir = path.join(OUT, new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dir, {recursive: true});
    const mime = f.mime || (f.kind === 'video' ? 'video/mp4' : 'image/jpeg');
    const file = path.join(dir, `freefield-${f.site}-${slug(f.title)}-${h.slice(0, 8)}.${EXT[mime] || "bin"}`);
    fs.writeFileSync(file, f.buf);
    items.push({n: items.length + 1, prompt: f.title || 'с сайта', kind: f.kind, site: f.site, model: 'забрано с сайта', aspect: null,
      status: 'done', message: '', note: '', files: [{path: file, mime, label: f.label || ''}]});
  }
  if (items.length) {
    const batch = {id: `s${Date.now().toString(36)}`, source: 'sync', ours: true, created: Date.now(), done: true, items};
    let all = [];
    try { all = JSON.parse(fs.readFileSync(BATCH_FILE, 'utf8')); } catch {}
    fs.writeFileSync(BATCH_FILE, JSON.stringify([batch, ...all].sort((a, b) => b.created - a.created).slice(0, 200), null, 1));
  }
  return {added: items, errors};
}
