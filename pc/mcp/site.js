// «🌐 Ассеты для сайта» (пользователь 2026-10-09): чужие картинки из интернета — только образцы настроения и роли на странице.
// Приложение присылает проект (о чём сайт, стиль, цвета) и исходники с пожеланиями → задание ждёт Claude на этом компьютере
// (site_tasks в любом чате Claude) → Claude разбирает каждый исходник, пишет новый промпт с заметными отличиями, генерирует
// через batch_generate с меткой проекта и отчитывается site_task_update. Хранение — как у пакетов: файл рядом с программой.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {HERE} from './state.js';

const OUT = process.env.FREEFIELD_OUTPUT_DIR || path.join(HERE, '..', 'outputs');
const FILE = path.join(HERE, '.site-tasks.json');
// исходники — не в папках дней outputs: в галерею они не попадают
export const SRC_DIR = path.join(OUT, 'site-sources');
export const SITE_ROLES = {hero: 'главный баннер', bg: 'фон', card: 'карточка', icon: 'иконка / иллюстрация', product: 'фото товара', other: 'другое'};
export const SITE_STATUS = {waiting: 'ждёт Claude', working: 'в работе', done: 'готово', error: 'ошибка'};
const EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'};
const IMG = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const str = (v, n) => String(v ?? '').trim().slice(0, n);

const readAll = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const writeAll = list => fs.writeFileSync(FILE, JSON.stringify(list.slice(0, 100), null, 1));
const find = id => readAll().find(t => t.id === id) || null;
function patch(id, fn) {
  const list = readAll(), t = list.find(x => x.id === id);
  if (!t) return null;
  fn(t);
  t.updated = Date.now();
  writeAll(list);
  return t;
}

// задание из приложения: {project: {name, about, style, colors}, sources: [{image, role, keep, count, composition}]}
export function siteCreate(body = {}) {
  const p = body.project || {};
  const project = {name: str(p.name, 80) || 'Мой сайт', about: str(p.about, 2000), style: str(p.style, 1000),
    colors: (Array.isArray(p.colors) ? p.colors : []).filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 5).map(c => c.toLowerCase())};
  const src = Array.isArray(body.sources) ? body.sources : [];
  if (!src.length || src.length > 10) throw new Error('нужно от 1 до 10 исходников');
  if (!project.about) throw new Error('впишите, о чём сайт');
  const id = 's' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), dir = path.join(SRC_DIR, id);
  const sources = src.map((s, i) => {
    const m = IMG.exec(String(s.image || ''));
    if (!m) throw new Error(`исходник ${i + 1}: нужна картинка PNG, JPG, WebP или GIF`);
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 15e6) throw new Error(`исходник ${i + 1} больше 15 МБ — уменьшите его`);
    return {n: i + 1, buf, ext: EXT[m[1]], role: SITE_ROLES[s.role] ? s.role : 'other', keep: str(s.keep, 300),
      count: Math.max(1, Math.min(4, +s.count || 1)), composition: s.composition === true};
  });
  fs.mkdirSync(dir, {recursive: true});
  const task = {id, created: Date.now(), updated: Date.now(), status: 'waiting', message: '', project,
    sources: sources.map(({buf, ext, ...s}) => { const file = path.join(dir, `${s.n}.${ext}`); fs.writeFileSync(file, buf); return {...s, file}; })};
  writeAll([task, ...readAll()]);
  return {id};
}

// для приложения: без путей на диске, превью исходника — по адресу хаба
export function siteList() {
  return readAll().map(t => ({id: t.id, created: t.created, updated: t.updated, status: t.status, statusText: SITE_STATUS[t.status] || t.status,
    message: t.message || '', project: t.project, sources: t.sources.map(s => ({n: s.n, role: s.role, roleText: SITE_ROLES[s.role], keep: s.keep, count: s.count,
      composition: s.composition, url: `/api/site/${t.id}/${s.n}`, analysis: s.analysis || '', prompts: s.prompts || [], note: s.note || ''}))}));
}
export function siteSrcFile(id, n) {
  const s = find(id)?.sources.find(x => x.n === +n);
  return s && path.resolve(s.file).startsWith(path.resolve(SRC_DIR) + path.sep) && fs.existsSync(s.file) ? s.file : null;
}
export function siteDelete(id) {
  const list = readAll(), t = list.find(x => x.id === id);
  if (!t) return false;
  if (t.status === 'working') throw new Error('задание сейчас в работе у Claude — удалить можно, когда он закончит');
  writeAll(list.filter(x => x.id !== id));
  fs.rmSync(path.join(SRC_DIR, id), {recursive: true, force: true});
  return true;
}

// для Claude: задания «ждёт Claude» (или одно по id); take — забрать их в работу
export function siteTasks({take = false, id} = {}) {
  const list = readAll().filter(t => id ? t.id === id : t.status === 'waiting');
  if (take) for (const t of list) if (t.status === 'waiting') patch(t.id, x => { x.status = 'working'; });
  return list.map(t => ({...t, status: take && t.status === 'waiting' ? 'working' : t.status}));
}
// итог от Claude: статус, текст для пользователя, по каждому исходнику — разбор и промпты
export function siteUpdate({id, status, message, sources} = {}) {
  if (!SITE_STATUS[status]) throw new Error('status: waiting | working | done | error');
  const t = patch(id, x => {
    x.status = status;
    if (message != null) x.message = str(message, 4000);
    for (const u of Array.isArray(sources) ? sources : []) {
      const s = x.sources.find(y => y.n === +u.n);
      if (!s) continue;
      if (u.analysis != null) s.analysis = str(u.analysis, 3000);
      if (Array.isArray(u.prompts)) s.prompts = u.prompts.map(p => str(p, 2500)).filter(Boolean).slice(0, 8);
      if (u.note != null) s.note = str(u.note, 600);
    }
  });
  if (!t) throw new Error('нет такого задания: ' + id);
  return t;
}
export const siteProject = id => find(id)?.project.name || null;
