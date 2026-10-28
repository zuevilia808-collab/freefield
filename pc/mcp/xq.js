// Общая очередь всех копий Freefield (у каждого чата Claude своя копия сервера, а аккаунты Flow/Dola/Arena/Vids — одни на всех).
// 2026-10-28: 10 чатов YouTube-каналов генерировали сразу — копия с большим пакетом забирала сайт снова и снова (замок-файл
// доставался тому, кто первым проверил), у других из 40 картинок приходили 2, а у каждой копии было своё «до 4 во Flow» —
// на один аккаунт уходило по 20–40 генераций. Теперь места сайта (Flow 4, Dola 2, Arena 2, Vids 1 на аккаунт) и право
// печатать в окне — общие на все копии, и раздаются честно: первым идёт тот чат, у кого сейчас меньше занято мест,
// видео — раньше картинок, при равенстве — кто дольше ждёт.
// Устройство: папка .queue/<ключ>/ — по файлу на каждого ждущего или занявшего место; решение «кто следующий» принимается
// под коротким замком; мёртвые копии (процесс закрыт или 90 с без отметки) из очереди убираются сами.
import fs from 'node:fs';
import path from 'node:path';
import {HERE} from './state.js';
import {chatTag} from './chat.js';

const ROOT = path.join(HERE, '.queue');
const STALE_MS = 90e3, BEAT_MS = 20e3, POLL_MS = 700;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dirOf = key => path.join(ROOT, key.replace(/[^\w.@-]/g, '_'));
let seq = 0;
const readServed = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.served'), 'utf8')); } catch { return {}; } };
const writeServed = (dir, s) => { try { fs.writeFileSync(path.join(dir, '.served'), JSON.stringify(s)); } catch {} };

function entries(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    const f = path.join(dir, n);
    let e = null;
    try { e = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }   // пишется прямо сейчас — в следующий раз
    if (!alive(e.pid) || Date.now() - (e.beat || 0) > STALE_MS) { fs.rmSync(f, {force: true}); continue; }
    out.push({...e, file: f});
  }
  return out;
}
// короткий замок на решение «кто следующий» (держится миллисекунды; брошенный старше 5 с — снимается)
async function mutex(dir, fn) {
  const m = path.join(dir, '.mtx');
  for (;;) {
    try { fs.writeFileSync(m, String(process.pid), {flag: 'wx'}); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(m).mtimeMs > 5000) fs.rmSync(m, {force: true}); } catch {}
      await sleep(10 + Math.random() * 25);
    }
  }
  try { return fn(); } finally { fs.rmSync(m, {force: true}); }
}

// Занять место: limit — сколько мест у ключа на все копии; prio — 1 для видео (идёт раньше картинок);
// onWait(n) — сколько заданий впереди (для статуса). Возвращает release().
export async function acquire(key, limit, {prio = 0, tag = chatTag(), onWait = () => {}, maxWaitMs = 0} = {}) {
  const dir = dirOf(key);
  fs.mkdirSync(dir, {recursive: true});
  const me = {pid: process.pid, tag, prio, at: Date.now(), beat: Date.now(), hold: false};
  const file = path.join(dir, `${process.pid}-${++seq}.json`);
  const write = () => fs.writeFileSync(file, JSON.stringify(me));
  write();
  const beat = setInterval(() => { me.beat = Date.now(); try { write(); } catch {} }, BEAT_MS);
  beat.unref?.();
  let done = false;
  const release = () => { if (done) return; done = true; clearInterval(beat); fs.rmSync(file, {force: true}); };
  try {
    let lastAhead = -1;
    for (;;) {
      const ahead = await mutex(dir, () => {
        const all = entries(dir), holders = all.filter(e => e.hold);
        const free = limit - holders.length;
        const byTag = {};
        for (const h of holders) byTag[h.tag] = (byTag[h.tag] || 0) + 1;
        // по кругу между чатами: меньше занято сейчас → видео раньше картинок → чат, которому давали место давнее всех → кто дольше ждёт
        const served = readServed(dir);
        const waiting = all.filter(e => !e.hold)
          .sort((a, b) => (byTag[a.tag] || 0) - (byTag[b.tag] || 0) || b.prio - a.prio || (served[a.tag] || 0) - (served[b.tag] || 0) || a.at - b.at);
        const pos = waiting.findIndex(e => e.file === file);
        if (pos < 0) { me.beat = Date.now(); write(); return Infinity; }   // файл убрали (долго «спали») — вернулись в очередь
        if (pos < free) { me.hold = true; me.beat = Date.now(); write(); served[tag] = Date.now(); writeServed(dir, served); return 0; }
        return pos - Math.max(free, 0) + 1;
      });
      if (ahead === 0) return release;
      if (ahead !== lastAhead && ahead !== Infinity) { lastAhead = ahead; try { onWait(ahead); } catch {} }
      if (maxWaitMs && Date.now() - me.at > maxWaitMs) { release(); return null; }
      await sleep(POLL_MS);
    }
  } catch (e) { release(); throw e; }
}

// Сколько заданий у ключа сейчас во всех копиях (идут + ждут) — планировщик пакета раскладывает по свободным аккаунтам
export function load(key) { return entries(dirOf(key)).length; }
