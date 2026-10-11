// Проект монтажа montage.json — общий язык MCP-инструмента montage, ИИ-монтажёра и редактора в приложении (js/montage.js).
// Программа на компьютере рендерит его (render.js), приложение присылает его в POST /api/montage.
//
// {
//   "format": "freefield-montage", "version": 1,
//   "name": "Шимпанзе идёт в банк",
//   "aspect": "9:16" | "1:1" | "4:5" | "16:9",   "fps": 30,   "fit": "cover" | "contain",
//   "duration": 19.37,                         // длина ролика, с (по умолчанию — конец последнего элемента)
//   "music": {"bpm": 124, "beats": [0, 0.48, …]},   // биты на шкале ролика (для эффектов «в такт»), необязательно
//   "tracks": {
//     "video": [{                              // клипы по порядку; встык — с переходом
//       "src": {…источник…}, "in": 0, "out": 5.8,   // кусок файла, с
//       "at": 0,                               // где на шкале ролика (по умолчанию — встык за предыдущим)
//       "speed": 1,                            // 0.25–4 (звук тоже, высота тона сохраняется)
//       "volume": 1, "mute": false,            // звук самого клипа
//       "transition": {"type": "fadewhite", "duration": 0.18},   // переход В этот клип (fx.js TRANSITIONS); cut — склейка
//       "fx": {"punch": [0, 1.93], "punch_amount": 0.07, "drift": 0.05}   // «удары» зумом (секунды от начала клипа на шкале) и наезд
//     }],
//     "audio": [{"src": {…}, "in": 0, "out": null, "at": 0, "volume": 1, "fade_in": 0, "fade_out": 0.6,
//                "role": "music" | "voice" | "sfx", "duck": true}],   // duck — музыка уступает речи клипов и озвучке
//     "photo": [{"src": {…}, "at": 2, "duration": 3, "pos": "full" | "center" | "tl" | "tr" | "bl" | "br", "scale": 0.4}],
//     "text":  [{"text": "Привет", "at": 1, "duration": 3, "pos": "top" | "center" | "bottom"}],   // простые титры
//     "gfx":   [{"template": "titles" | "cards" | "launch", "props": {"title": "", "subtitle": "", "items": [], "cta": ""}}],
//     "captions": {"style": "pop", "words": [{"text": "Шаг", "start": 0.12, "end": 0.45}]}   // субтитры по словам, шкала ролика
//   },
//   "audio_mix": {"loudness": -14, "speech": false}   // громкость готового ролика, LUFS (Reels / TikTok); speech — в клипах речь (музыка с duck уступает)
// }
//
// Источник (src) — одно из:
//   {"path": "C:\\…\\clip.mp4"}   абсолютный путь на компьютере (MCP, Claude);
//   {"out": "freefield-….mp4"}    файл, который сделал этот компьютер (имя из outputs, у галереи — pcName);
//   {"ref": "mf-<sha1>.mp4"}      файл, загруженный приложением через POST /api/montage/file.
import fs from 'node:fs';
import path from 'node:path';

export const FORMAT = 'freefield-montage', VERSION = 1;
export const ASPECTS = {'9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080]};
const num = (v, d, lo = -Infinity, hi = Infinity) => Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d;
const str = (v, max = 300) => String(v ?? '').slice(0, max);
const arr = v => Array.isArray(v) ? v : [];

// путь источника: resolve(src) → абсолютный путь или ошибка
export function sourcePath(src, {outDir, uploadDir}) {
  if (!src || typeof src !== 'object') throw new Error('у элемента нет источника (src)');
  if (src.path) { const p = path.resolve(String(src.path)); if (!fs.existsSync(p)) throw new Error('нет файла: ' + p); return p; }
  if (src.ref) {
    if (!/^mf-[0-9a-f]{40}\.\w{2,5}$/.test(src.ref)) throw new Error('неверная ссылка на загруженный файл');
    const p = path.join(uploadDir, src.ref);
    if (!fs.existsSync(p)) throw new Error('загруженный файл пропал — отправьте проект ещё раз');
    return p;
  }
  if (src.out) {
    const name = path.basename(String(src.out));
    const days = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() : [];
    for (const d of days) { const p = path.join(outDir, d, name); if (fs.existsSync(p)) return p; }
    throw new Error('на компьютере нет файла ' + name);
  }
  throw new Error('у источника нет path / out / ref');
}

// проект → проверенный и дополненный значениями по умолчанию (времена «встык» раскрыты)
export function normalize(p) {
  if (!p || typeof p !== 'object') throw new Error('проект монтажа — не объект');
  if (p.format && p.format !== FORMAT) throw new Error('это не проект монтажа Freefield');
  const t = p.tracks || {};
  const video = arr(t.video).slice(0, 200).map((c, i) => {
    const speed = num(c.speed, 1, 0.25, 4), inn = num(c.in, 0, 0);
    const out = c.out == null ? null : num(c.out, null, inn + 0.05);
    const tr = c.transition && c.transition.type && c.transition.type !== 'cut' && i > 0
      ? {type: str(c.transition.type, 30), duration: num(c.transition.duration, 0.25, 0.04, 2)} : {type: 'cut', duration: 0};
    const v = {src: c.src, in: inn, out, at: c.at == null ? null : num(c.at, 0, 0),   // null — встык (render.js узнаёт длины файлов)
      speed, volume: num(c.volume, 1, 0, 4), mute: !!c.mute, transition: tr,
      fx: {punch: arr(c.fx?.punch).map(x => num(x, 0, 0)).slice(0, 200), punch_amount: num(c.fx?.punch_amount, 0.07, 0, 0.5), drift: num(c.fx?.drift, 0.05, -0.5, 0.5)}};
    return v;
  });
  const audio = arr(t.audio).slice(0, 50).map(a => ({src: a.src, in: num(a.in, 0, 0), out: a.out == null ? null : num(a.out, null, 0), at: num(a.at, 0, 0),
    volume: num(a.volume, 1, 0, 4), fade_in: num(a.fade_in, 0, 0, 30), fade_out: num(a.fade_out, 0, 0, 30),
    role: ['music', 'voice', 'sfx'].includes(a.role) ? a.role : 'music', duck: a.duck !== false}));
  const photo = arr(t.photo).slice(0, 50).map(x => ({src: x.src, at: num(x.at, 0, 0), duration: num(x.duration, 3, 0.1, 600),
    pos: ['full', 'center', 'tl', 'tr', 'bl', 'br'].includes(x.pos) ? x.pos : 'full', scale: num(x.scale, 0.4, 0.05, 1)}));
  const text = arr(t.text).slice(0, 100).map(x => ({text: str(x.text, 400), at: num(x.at, 0, 0), duration: num(x.duration, 3, 0.1, 600),
    pos: ['top', 'center', 'bottom'].includes(x.pos) ? x.pos : 'bottom'})).filter(x => x.text.trim());
  const gfx = arr(t.gfx).slice(0, 5).map(g => ({template: str(g.template, 30), props: {title: str(g.props?.title, 80), subtitle: str(g.props?.subtitle, 120),
    items: arr(g.props?.items).map(s => str(s, 60)).filter(Boolean).slice(0, 5), cta: str(g.props?.cta, 40)}}));
  const words = arr(t.captions?.words).slice(0, 3000).map(w => ({text: str(w.text, 40), start: num(w.start, 0, 0), end: num(w.end, 0, 0)})).filter(w => w.text);
  return {
    format: FORMAT, version: VERSION, name: str(p.name || 'Монтаж', 120),
    aspect: ASPECTS[p.aspect] ? p.aspect : '9:16', fps: num(p.fps, 30, 12, 60), fit: p.fit === 'contain' ? 'contain' : 'cover',
    duration: p.duration == null ? null : num(p.duration, null, 0.5, 600),
    music: p.music ? {bpm: num(p.music.bpm, null), beats: arr(p.music.beats).map(Number).filter(Number.isFinite).slice(0, 4000)} : null,
    tracks: {video, audio, photo, text, gfx, captions: {style: str(t.captions?.style || 'pop', 20), words}},
    audio_mix: {loudness: num(p.audio_mix?.loudness, -14, -30, -6), speech: !!p.audio_mix?.speech},
  };
}

// слова клипа (время в файле) → слова на шкале ролика, для каждого куска video
export function wordsOnTimeline(segs) {
  const out = [];
  for (const s of segs) for (const w of s.words || []) {
    if (w.start < s.in - 0.02 || w.start >= s.in + s.len * s.speed - 0.08) continue;
    const st = s.at + (w.start - s.in) / s.speed, en = s.at + (Math.min(w.end, s.in + s.len * s.speed) - s.in) / s.speed;
    out.push({text: w.text, start: +st.toFixed(3), end: +Math.max(st + 0.08, en).toFixed(3)});
  }
  return out.sort((a, b) => a.start - b.start);
}
