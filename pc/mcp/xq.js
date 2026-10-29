// Общая очередь всех чатов. Все чаты работают через одну главную копию Freefield (main.js), поэтому очередь — в её памяти.
// 2026-10-28: 10 чатов YouTube-каналов генерировали сразу — копия с большим пакетом забирала сайт снова и снова, у других
// из 40 картинок приходили 2, а у каждой копии было своё «до 4 во Flow» — на один аккаунт уходило по 20–40 генераций.
// Теперь места сайта (Flow 4, Dola 2, Arena 2, Vids 1 на аккаунт) и право печатать в окне раздаются честно: первым идёт тот
// чат, у кого сейчас меньше занято мест, видео — раньше картинок, дальше — чат, которому давали место давнее всех, и кто дольше ждёт.
// (2026-10-29: первая версия делила очередь через файлы и опрашивала их по каждому ожидающему — при 240 заданиях главная копия
// захлёбывалась чтением файлов, не успевала ответить Chrome и открывала лишние окна. В памяти — мгновенно и без нагрузки.)
import {chatTag} from './chat.js';

const queues = new Map();   // ключ → {holders, waiting, served: {чат: когда последний раз дали место}, limit}
const Q = key => { let q = queues.get(key); if (!q) queues.set(key, q = {holders: [], waiting: [], served: {}, limit: 1}); return q; };

function pump(q) {
  const byTag = {};
  for (const h of q.holders) byTag[h.tag] = (byTag[h.tag] || 0) + 1;
  while (q.holders.length < q.limit && q.waiting.length) {
    q.waiting.sort((a, b) => (byTag[a.tag] || 0) - (byTag[b.tag] || 0) || b.prio - a.prio || (q.served[a.tag] || 0) - (q.served[b.tag] || 0) || a.at - b.at);
    const w = q.waiting.shift();
    q.holders.push(w);
    byTag[w.tag] = (byTag[w.tag] || 0) + 1;
    q.served[w.tag] = Date.now();
    w.grant();
  }
  q.waiting.forEach((w, i) => { if (w.ahead !== i + 1) { w.ahead = i + 1; try { w.onWait(i + 1); } catch {} } });
}

// Занять место: limit — сколько мест у ключа; prio — 1 для видео (идёт раньше картинок); onWait(n) — сколько заданий впереди.
// Возвращает release() (или null, если maxWaitMs истёк)
export function acquire(key, limit, {prio = 0, tag = chatTag(), onWait = () => {}, maxWaitMs = 0} = {}) {
  const q = Q(key);
  q.limit = limit;
  return new Promise(resolve => {
    const w = {tag, prio, at: Date.now(), onWait, ahead: 0};
    let done = false, timer = null;
    const release = () => {
      if (done) return;
      done = true;
      const i = q.holders.indexOf(w);
      if (i >= 0) q.holders.splice(i, 1);
      pump(q);
    };
    w.grant = () => { clearTimeout(timer); resolve(release); };
    if (maxWaitMs) timer = setTimeout(() => {
      const i = q.waiting.indexOf(w);
      if (i >= 0) { q.waiting.splice(i, 1); done = true; resolve(null); pump(q); }
    }, maxWaitMs);
    q.waiting.push(w);
    pump(q);
  });
}

// Сколько заданий у ключа сейчас (идут + ждут) — планировщик пакета раскладывает по свободным аккаунтам
export function load(key) { const q = queues.get(key); return q ? q.holders.length + q.waiting.length : 0; }
