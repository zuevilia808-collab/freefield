// Персонажи, которых завёл агент (пользователь 2026-10-17: «ты можешь автоматически сохранять персонажей — вот в чём дело»):
// герой появился в чате (придумали, сделали фото или развёртку) — агент сохраняет его здесь (MCP hero_save),
// а приложение само добавляет его в «Персонажи» (GET /api/heroes). Хранилище — outputs/heroes/heroes.json + фото рядом.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {HERE} from './state.js';

const OUT = process.env.FREEFIELD_OUTPUT_DIR || path.join(HERE, '..', 'outputs');
const DIR = path.join(OUT, 'heroes');
const STORE = path.join(DIR, 'heroes.json');
const EXT = {'.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp'};

export function heroesList() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return []; }
}
const write = list => { fs.mkdirSync(DIR, {recursive: true}); fs.writeFileSync(STORE, JSON.stringify(list, null, 1)); };
// name — как зовут; about — кто он и как выглядит (по-русски, коротко); image — фото героя (лучше в полный рост)
export function heroSave({name, about = '', image}) {
  const n = String(name || '').trim().slice(0, 60);
  if (!n) throw new Error('нужно имя персонажа');
  const ext = EXT[path.extname(String(image || '')).toLowerCase()];
  if (!image || !fs.existsSync(image) || !ext) throw new Error('нужно фото персонажа (jpg, png или webp)');
  const list = heroesList();
  let h = list.find(x => x.name.toLowerCase() === n.toLowerCase());
  if (!h) { h = {id: 'h' + crypto.randomBytes(5).toString('hex'), name: n, created: Date.now()}; list.push(h); }
  const file = `${h.id}.${ext}`;
  fs.mkdirSync(DIR, {recursive: true});
  for (const e of ['jpg', 'png', 'webp']) if (e !== ext) fs.rmSync(path.join(DIR, `${h.id}.${e}`), {force: true});
  fs.copyFileSync(image, path.join(DIR, file));
  Object.assign(h, {about: String(about || h.about || '').trim().slice(0, 400), file, updated: Date.now()});
  write(list);
  return h;
}
export function heroFile(id) {
  const h = heroesList().find(x => x.id === id);
  return h ? path.join(DIR, h.file) : null;
}
