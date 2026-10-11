// План монтажа: анализ клипов + биты трека + пожелания → проект montage.json (project.js), который рендерит render.js.
// Швы — на битах; клипы с речью — кусками от начала до первого бита после конца речи; «удары» зумом — на сильных долях.
import path from 'node:path';
import {FORMAT, VERSION, wordsOnTimeline} from './project.js';
import {BEAT_SET, TRANSITIONS} from './fx.js';

/* ---------- нарезка: какой клип, с какой секунды, сколько битов ---------- */
// сегменты: какой клип, с какой секунды, сколько битов; швы — на битах
export function cutPlan(clips, beat, opts) {
  const {period, beats} = beat;
  const target = opts.duration;
  // начало трека: самый «громкий» кусок нужной длины, со сильной доли
  let start = opts.music_start ?? null;
  if (start == null) {
    let best = -1; start = beat.downbeats[0] ?? 0;
    for (const d of beat.downbeats) {
      if (d + target > beat.frames / beat.hz) break;
      let s = 0, c = 0;
      for (let t = d; t < d + target; t += 0.1) { s += beat.env(t); c++; }
      const v = s / c * (1 - 0.15 * d / (beat.frames / beat.hz));   // при равенстве — раньше
      if (v > best) { best = v; start = d; }
    }
  }
  // биты на отрезке ролика, время от его начала
  let local = beats.filter(b => b >= start - 0.01).map(b => b - start).filter(b => b < 65);   // запас: ролик с речью может выйти длиннее заданного
  if (local.length < 4) local = Array.from({length: Math.ceil(target / 0.5) + 1}, (_, i) => i * 0.5);
  const bars = Math.max(2, Math.round(target / (4 * period)));
  const total = Math.min(local.length - 1, bars * 4);           // сколько битов в ролике
  const duration = local[total] ?? target;
  const speech = clips.some(c => c.speech);
  const pace = opts.pace === 'auto' ? (speech ? 'speech' : period < 0.42 ? 'medium' : 'fast') : opts.pace;
  const segs = [];
  if (pace === 'speech') {
    // каждый клип — одним куском с начала, до первого бита после конца его речи: фразы не рвём,
    // поэтому ролик с речью может выйти длиннее заданного (до 60 с); клип без речи — равная доля от заданной длины
    const per = Math.max(4, Math.floor(total / clips.length / 2) * 2);
    let b = 0;
    for (const [i, c] of clips.entries()) {
      // у последнего слова фразы Whisper тянет конец до следующей фразы — слово не длиннее 0,9 с
      const said = Math.max(0, ...(c.words || []).map(w => Math.min(w.end, w.start + 0.9)));
      let n = 0;
      for (let k = 2; b + k < local.length; k += 2) {
        const tc = local[b + k] - local[b];
        if (tc > c.duration - 0.05) break;
        n = k;
        if (said ? tc >= said + 0.2 && k >= 4 : k >= per) break;
      }
      // ролик с речью может выйти длиннее заданного, но не больше чем в полтора раза (и не больше 60 с) — лишние клипы не берём
      if (!n || local[b + n] > Math.min(60, Math.max(target * 1.5, target + 6))) break;
      segs.push({clip: i, from: 0, b0: b, b1: b + n});
      b += n;
    }
  } else {
    const step = {fast: 2, medium: 4, slow: 8}[pace] || 4;
    const pos = clips.map(c => Math.min(0.3, c.duration * 0.05));
    let b = 0, i = 0;
    while (b < total) {
      const n = Math.min(step, total - b), c = i % clips.length;
      const len = local[b + n] - local[b];
      if (pos[c] + len > clips[c].duration - 0.05) pos[c] = Math.min(0.3, clips[c].duration * 0.05);
      segs.push({clip: c, from: pos[c], b0: b, b1: b + n});
      pos[c] += len; b += n; i++;
    }
  }
  for (const s of segs) { s.t0 = local[s.b0]; s.t1 = local[s.b1] ?? duration; s.len = s.t1 - s.t0; }
  return {start, duration: segs[segs.length - 1].t1, segs, pace, beats: local.filter(b => b <= duration + 1e-3)};
}

// clips: [{file, duration, audio, speech, words}], beat — trackBeats/gridBeats, opts — как у montage()
export function toProject(clips, beat, opts) {
  const P = cutPlan(clips, beat, opts);
  const video = P.segs.map((s, k) => {
    const c = clips[s.clip];
    // «удары» на сильных долях внутри куска (и в его начале) — секунды от начала куска
    const punch = P.beats.filter((b, i) => i % 4 === 0 && b >= s.t0 - 1e-3 && b < s.t1).map(b => +(b - s.t0).toFixed(3));
    if (!punch.includes(0)) punch.unshift(0);
    const tr = k ? BEAT_SET[(k - 1) % BEAT_SET.length] : 'cut';
    return {src: {path: c.file}, in: +s.from.toFixed(3), out: +(s.from + s.len).toFixed(3), at: +s.t0.toFixed(3), speed: 1, volume: 1,
      transition: {type: tr, duration: TRANSITIONS[tr].d}, fx: {punch, punch_amount: 0.07, drift: 0.05}};
  });
  const speech = clips.some(c => c.speech);
  const words = opts.captions === false ? [] : wordsOnTimeline(P.segs.map(s => ({at: s.t0, in: s.from, len: s.len, speed: 1, words: clips[s.clip].words})));
  const style = ['titles', 'cards', 'launch'].includes(opts.style) ? opts.style : null;
  return {
    plan: P,
    project: {
      format: FORMAT, version: VERSION, name: opts.title || clips.map(c => path.basename(c.file)).join(' + ').slice(0, 120),
      aspect: opts.aspect, fps: 30, fit: 'cover', duration: +P.duration.toFixed(3),
      music: {bpm: beat.bpm, beats: P.beats.map(b => +b.toFixed(3))},
      tracks: {
        video,
        audio: opts.music ? [{src: {path: opts.music}, in: +P.start.toFixed(3), at: 0, volume: 1, fade_in: 0.05, fade_out: 0.6, role: 'music', duck: true}] : [],
        photo: [], text: [],
        gfx: style ? [{template: style, props: {title: opts.title || '', subtitle: opts.subtitle || '', items: opts.items || [], cta: opts.cta || ''}}] : [],
        captions: {style: 'pop', words},
      },
      // без речи звук клипов тише — главная музыка
      audio_mix: {loudness: -14, speech},
    },
  };
}
