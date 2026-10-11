// План монтажа: анализ клипов + биты трека + пожелания (и рецепт шаблона) → проект montage.json (project.js) для render.js.
// Этап 2 («умная нарезка»):
//   • швы — на битах; самый мощный момент трека (дроп) — сразу после хука;
//   • клипы без речи: в ролик идут лучшие куски по оценке кадров (резкость, движение, свет, без смены сцены внутри), а не первые секунды;
//   • клипы с речью: паузы и «эээ» вырезаются (прыжок с лёгким зумом), шов — на бите после конца речи, фразы не рвутся;
//   • кадр 16:9 в ролике 9:16 (и наоборот) — окно кадрирования едет за движением и деталями в кадре.
import path from 'node:path';
import {FORMAT, VERSION, ASPECTS, wordsOnTimeline} from './project.js';
import {BEAT_SET, TRANSITIONS} from './fx.js';
import {findDrop} from './analyze.js';

// слова-паразиты: вырезаются из речи и не попадают в субтитры
export const FILLER = /^(э+|э+м+|м+|хм+|ммм+|um+|uh+|erm+|uhm+|hm+|mm+)[.,!?…]*$/i;
const wordEnd = w => Math.min(w.end, w.start + 0.9);   // у последнего слова фразы Whisper тянет конец до следующей фразы

/* ---------- речь клипа → куски без пауз и «эээ» ---------- */
export function speechPieces(c, {clean = true, gap = 0.45} = {}) {
  const words = (c.words || []).filter(w => !FILLER.test(w.text));
  if (!words.length) return null;
  if (!clean) return [{from: 0, len: Math.min(c.duration, wordEnd(words[words.length - 1]) + 0.15)}];
  const pieces = [];
  let a = Math.max(0, words[0].start - 0.1), b = wordEnd(words[0]) + 0.15;
  for (const w of words.slice(1)) {
    if (w.start - b > gap - 0.15) { pieces.push([a, b]); a = Math.max(b, w.start - 0.1); }
    b = Math.min(c.duration, wordEnd(w) + 0.15);
  }
  pieces.push([a, b]);
  // первый кусок — с начала клипа, если до речи меньше секунды (вход в кадр не режем)
  if (pieces[0][0] < 1) pieces[0][0] = 0;
  return pieces.filter(([x, y]) => y - x > 0.15).map(([x, y]) => ({from: +x.toFixed(3), len: +(y - x).toFixed(3)}));
}

/* ---------- лучший кусок клипа нужной длины по оценке кадров ---------- */
export function bestWindow(c, len, used = []) {
  const s = c.shots, dur = c.duration;
  if (len >= dur - 0.1) return 0;
  if (!s?.n) return Math.min(0.3, dur * 0.05);
  const at = t => Math.min(s.n - 1, Math.max(0, Math.round(t * s.fps)));
  const norm = a => { const m = Math.max(...a) || 1; return a.map(v => v / m); };
  const sh = norm(s.sharp), mo = norm(s.motion);
  let best = 0, bs = -Infinity;
  for (let a = 0; a + len <= dur - 0.05; a += 0.25) {
    let q = 0, k = 0;
    for (let f = at(a); f <= at(a + len); f++) {
      const br = s.bright[f];
      q += 0.55 * sh[f] + 0.35 * Math.min(1, mo[f] * 1.6) - (br < 25 || br > 235 ? 0.6 : 0);   // резко, живо, не тёмно и не пересвечено
      k++;
    }
    q /= k || 1;
    if (s.cuts.some(t => t > a + 0.15 && t < a + len - 0.15)) q -= 0.5;      // внутри куска не должно быть чужой склейки
    for (const [u0, u1] of used) q -= 0.8 * Math.max(0, Math.min(u1, a + len) - Math.max(u0, a)) / len;   // уже показанное — хуже
    q -= 0.04 * a / dur;                                                     // при равенстве — раньше
    if (q > bs) { bs = q; best = a; }
  }
  return +best.toFixed(3);
}

/* ---------- кадрирование 16:9 → 9:16: центр окна едет за интересным ---------- */
// ключи [[t, x, y]] — t от начала куска на шкале ролика, x/y — центр окна (0…1 ширины / высоты кадра), сглажено ~1,2 с
export function reframeKeys(c, from, len, speed = 1) {
  const s = c.shots;
  if (!s?.n) return null;
  const keys = [];
  for (let t = 0; t <= len + 1e-3; t += 0.5) {
    const ft = from + t * speed;
    let sx = 0, sy = 0, k = 0;
    for (let f = Math.round((ft - 0.6) * s.fps); f <= Math.round((ft + 0.6) * s.fps); f++) if (f >= 0 && f < s.n) { sx += s.cx[f]; sy += s.cy?.[f] ?? 0.5; k++; }
    keys.push([+t.toFixed(2), k ? sx / k : 0.5, k ? sy / k : 0.5]);
  }
  // ещё раз сгладить — без рывков камеры
  const sm = (i, j) => +((keys[Math.max(0, i - 1)][j] + keys[i][j] * 2 + keys[Math.min(keys.length - 1, i + 1)][j]) / 4).toFixed(3);
  return keys.map(([t], i) => [t, sm(i, 1), sm(i, 2)]);
}

/* ---------- нарезка: какой клип, с какой секунды, сколько битов ---------- */
export function cutPlan(clips, beat, opts) {
  const {period, beats} = beat;
  const target = opts.duration;
  const trackLen = beat.duration || beat.frames / beat.hz;
  // начало трека: дроп — сразу после хука (1–2 такта), иначе самый громкий кусок нужной длины, со сильной доли
  let start = opts.music_start ?? null, drop = null;
  if (start == null) {
    drop = opts.music ? findDrop(beat) : null;
    const bar = 4 * period, hook = bar >= 1.5 ? bar : 2 * bar;
    if (drop != null && drop - hook >= 0 && drop - hook + target <= trackLen) start = drop - hook;
    else {
      drop = null;
      let best = -1; start = beat.downbeats[0] ?? 0;
      for (const d of beat.downbeats) {
        if (d + target > trackLen) break;
        let s = 0, c = 0;
        for (let t = d; t < d + target; t += 0.1) { s += beat.env(t); c++; }
        const v = s / c * (1 - 0.15 * d / trackLen);   // при равенстве — раньше
        if (v > best) { best = v; start = d; }
      }
    }
  }
  // начало — точно на доле (ближайший бит), иначе первая доля ролика ушла бы на полсекунды вперёд
  if (beats.length) start = beats.reduce((a, b) => Math.abs(b - start) < Math.abs(a - start) ? b : a, beats[0]);
  // биты на отрезке ролика, время от его начала
  let local = beats.filter(b => b >= start - 0.01).map(b => Math.max(0, b - start)).filter(b => b < 65);   // запас: ролик с речью может выйти длиннее заданного
  if (local.length && local[0] > 0.05) local.unshift(0);
  if (local.length < 4) local = Array.from({length: Math.ceil(target / 0.5) + 1}, (_, i) => i * 0.5);
  const bars = Math.max(2, Math.round(target / (4 * period)));
  const total = Math.min(local.length - 1, bars * 4);           // сколько битов в ролике
  const duration = local[total] ?? target;
  const speech = clips.some(c => c.speech);
  const pace = opts.pace === 'auto' ? (speech ? 'speech' : period < 0.42 ? 'medium' : 'fast') : opts.pace;
  const segs = [];
  if (pace === 'speech') {
    // каждый клип с речью — его речь без пауз, до первого бита после её конца: фразы не рвём, поэтому ролик с речью может выйти
    // длиннее заданного (но не больше чем в полтора раза и не больше 60 с — лишние клипы не берём); клип без речи — равная доля
    const per = Math.max(4, Math.floor(total / clips.length / 2) * 2);
    let b = 0;
    for (const [i, c] of clips.entries()) {
      const pieces = c.speech ? speechPieces(c, {clean: opts.clean_speech !== false}) : null;
      const said = pieces ? pieces.reduce((s, p) => s + p.len, 0) : 0;
      const room = pieces ? c.duration - pieces[pieces.length - 1].from : c.duration;   // сколько можно показать после начала последнего куска
      let n = 0;
      for (let k = 2; b + k < local.length; k += 2) {
        const tc = local[b + k] - local[b];
        if (!pieces && tc > c.duration - 0.05) break;
        n = k;
        if (pieces ? tc >= said + 0.1 && k >= 4 : k >= per) break;
      }
      if (!n || local[b + n] > Math.min(60, Math.max(target * 1.5, target + 6))) break;
      const len = local[b + n] - local[b];
      let parts;
      if (pieces) {
        // хвост до бита — продолжением последнего куска (если клип кончается раньше — последний кадр стоит)
        parts = pieces.map(p => ({...p}));
        const last = parts[parts.length - 1];
        last.len = +(len - (said - last.len)).toFixed(3);
        if (last.len > room) last.len = +Math.max(room, 0.1).toFixed(3);
      } else parts = [{from: bestWindow(c, len), len}];
      segs.push({clip: i, from: parts[0].from, b0: b, b1: b + n, parts});
      b += n;
    }
  } else {
    const step = {fast: 2, medium: 4, slow: 8}[pace] || 4;
    const used = clips.map(() => []);
    let b = 0, i = 0;
    while (b < total) {
      const n = Math.min(step, total - b), c = i % clips.length;
      const len = local[b + n] - local[b];
      const from = bestWindow(clips[c], len, used[c]);
      used[c].push([from, from + len]);
      segs.push({clip: c, from, b0: b, b1: b + n, parts: [{from, len}]});
      b += n; i++;
    }
  }
  for (const s of segs) { s.t0 = local[s.b0]; s.t1 = local[s.b1] ?? duration; s.len = s.t1 - s.t0; }
  return {start, drop: drop != null ? +(drop - start).toFixed(3) : null, duration: segs[segs.length - 1].t1, segs, pace, beats: local.filter(b => b <= duration + 1e-3)};
}

// clips: [{file, duration, width, height, audio, speech, words, shots}], beat — trackBeats/gridBeats, opts — как у montage() (+ recipe шаблона)
export function toProject(clips, beat, opts) {
  const R = opts.recipe || {};
  const P = cutPlan(clips, beat, {...opts, pace: opts.pace && opts.pace !== 'auto' ? opts.pace : R.pace || 'auto', clean_speech: opts.clean_speech ?? R.clean_speech});
  const [W, H] = ASPECTS[opts.aspect] || ASPECTS['9:16'];
  const set = R.transitions?.length ? R.transitions : BEAT_SET;
  const video = [], pieceMap = [];
  for (const [k, s] of P.segs.entries()) {
    const c = clips[s.clip];
    const tr = k ? set[(k - 1) % set.length] : 'cut';
    // кадр другой формы, чем ролик (16:9 в 9:16) — окно едет за интересным
    const reframe = opts.reframe !== false && c.width && Math.abs(Math.log((c.width / c.height) / (W / H))) > 0.15;
    let at = s.t0;
    for (const [j, p] of s.parts.entries()) {
      const len = j === s.parts.length - 1 ? s.t1 - at : p.len;
      // «удары» на сильных долях внутри куска (и в начале сегмента) — секунды от начала куска
      const punch = P.beats.filter((b, i) => i % 4 === 0 && b >= at - 1e-3 && b < at + len).map(b => +(b - at).toFixed(3));
      if (!j && !punch.includes(0)) punch.unshift(0);
      video.push({src: {path: c.file}, in: +p.from.toFixed(3), out: +(p.from + len).toFixed(3), at: +at.toFixed(3), speed: 1, volume: 1,
        transition: j ? {type: 'cut'} : {type: tr, duration: (TRANSITIONS[tr] || TRANSITIONS.fade).d},
        fx: {punch, punch_amount: R.punch_amount ?? 0.07, drift: R.drift ?? 0.05, ...(j % 2 ? {zoom: 1.1} : {}),   // прыжок после вырезанной паузы — с лёгким зумом
          ...(reframe ? {reframe: reframeKeys(c, p.from, len)} : {}), ...(R.fx || {})}});
      pieceMap.push({at, in: p.from, len, speed: 1, words: (c.words || []).filter(w => !FILLER.test(w.text))});
      at += len;
    }
  }
  const speech = clips.some(c => c.speech);
  const words = opts.captions === false ? [] : wordsOnTimeline(pieceMap);
  const style = ['titles', 'cards', 'launch'].includes(opts.style) ? opts.style : R.gfx || null;
  return {
    plan: P,
    project: {
      format: FORMAT, version: VERSION, name: opts.title || clips.map(c => path.basename(c.file)).join(' + ').slice(0, 120),
      aspect: opts.aspect, fps: 30, fit: 'cover', duration: +P.duration.toFixed(3),
      music: {bpm: beat.bpm, beats: P.beats.map(b => +b.toFixed(3)), drop: P.drop},
      tracks: {
        video,
        audio: opts.music ? [{src: {path: opts.music}, in: +P.start.toFixed(3), at: 0, volume: 1, fade_in: 0.05, fade_out: 0.6, role: 'music', duck: true}] : [],
        photo: [], text: [],
        gfx: style ? [{template: style, props: {title: opts.title || '', subtitle: opts.subtitle || '', items: opts.items || [], cta: opts.cta || ''}}] : [],
        captions: {style: opts.caption_style || R.captions || 'pop', words},
      },
      ...(R.look ? {look: R.look} : {}), ...(R.sfx ? {sfx: R.sfx} : {}),
      // без речи звук клипов тише — главная музыка
      audio_mix: {loudness: -14, speech},
    },
  };
}
