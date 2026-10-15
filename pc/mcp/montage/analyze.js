// Анализ для монтажа: длины и потоки файлов (ffprobe), биты трека (спектральный поток → темп → сетка, на чистом JS),
// речь клипов по словам (whisper.cpp). Биты и речь кэшируются в outputs/.montage-cache — повторный рендер (черновик → финал) их не считает.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ensureFfmpeg, ensureWhisper, run, lastErr} from '../avtools.js';

let T = null;
export const tools = async note => (T ||= await ensureFfmpeg(note));
export async function ff(args, what, onLine) {
  const t = await tools();
  const r = await run(t.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {onLine});
  if (r.code !== 0) throw Object.assign(new Error(`${what}: ${lastErr(r.tail)}`), {tail: r.tail});
  return r;
}

export async function info(file) {
  const t = await tools();
  let out = '';
  const r = await run(t.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file], {stdout: d => { out += d; }});
  if (r.code !== 0) throw new Error(`не открывается ${path.basename(file)}: ${lastErr(r.tail)}`);
  const j = JSON.parse(out), v = j.streams.find(s => s.codec_type === 'video');
  const image = /\.(png|jpe?g|webp|gif|bmp)$/i.test(file);
  return {duration: +j.format.duration || 0, width: v?.width || 0, height: v?.height || 0, video: !!v && !image, image, audio: j.streams.some(s => s.codec_type === 'audio')};
}
// звук → моно float32 (для поиска битов)
export async function decode(file, sr, start = 0, dur = 0) {
  const t = await tools(), chunks = [];
  const r = await run(t.ffmpeg, ['-v', 'error', ...(start ? ['-ss', String(start)] : []), '-i', file, ...(dur ? ['-t', String(dur)] : []),
    '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], {stdout: d => chunks.push(d)});
  if (r.code !== 0) throw new Error('звук не читается: ' + lastErr(r.tail));
  const b = Buffer.concat(chunks);
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}

// ---- кэш: ключ — путь, размер и время изменения файла ----
const cacheDir = outDir => path.join(outDir, '.montage-cache');
function cached(outDir, file, kind, extra = '') {
  const st = fs.statSync(file);
  const key = crypto.createHash('sha1').update([path.resolve(file), st.size, st.mtimeMs, kind, extra].join('|')).digest('hex').slice(0, 20);
  const p = path.join(cacheDir(outDir), `${kind}-${key}.json`);
  return {get: () => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } },
    set: v => { try { fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, JSON.stringify(v)); } catch { /* без кэша */ } return v; }};
}

/* ---------- биты: спектральный поток → темп (автокорреляция) → сетка битов и сильные доли ---------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], j = i + k + len / 2;
        const vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[j] = ur - vr; im[j] = ui - vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
export function findBeats(x, sr) {
  const N = 1024, HOP = 512, hz = sr / HOP, bins = N / 2;
  const win = Float32Array.from({length: N}, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  const frames = Math.max(0, Math.floor((x.length - N) / HOP));
  const flux = new Float32Array(frames), low = new Float32Array(frames), rms = new Float32Array(frames);
  let prev = new Float32Array(bins);
  const lowBin = Math.round(150 / (sr / N));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < N; i++) { const s = x[f * HOP + i]; re[i] = s * win[i]; im[i] = 0; e += s * s; }
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    const mag = new Float32Array(bins);
    let fl = 0, lo = 0;
    for (let k = 1; k < bins; k++) {
      mag[k] = Math.log1p(1000 * Math.hypot(re[k], im[k]));
      const d = mag[k] - prev[k];
      if (d > 0) { fl += d; if (k <= lowBin) lo += d; }
    }
    flux[f] = fl; low[f] = lo; prev = mag;
  }
  // огибающая атак минус скользящее среднее
  const onset = new Float32Array(frames), M = Math.round(hz * 0.25);
  for (let f = 0; f < frames; f++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, f - M); k <= Math.min(frames - 1, f + M); k++) { s += flux[k]; c++; }
    onset[f] = Math.max(0, flux[f] - s / c);
  }
  // темп: автокорреляция в 70–180 BPM с предпочтением около 120
  let best = 0, bestLag = Math.round(hz * 0.5);
  const score = lag => { let s = 0; for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag]; return s / (frames - lag); };
  for (let lag = Math.floor(hz * 60 / 180); lag <= Math.ceil(hz * 60 / 70); lag++) {
    const bpm = 60 * hz / lag, w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const s = (score(lag) + 0.5 * score(2 * lag)) * w;
    if (s > best) { best = s; bestLag = lag; }
  }
  // уточняем период до долей кадра
  let period = bestLag, bs = -1;
  for (let p = bestLag - 1; p <= bestLag + 1; p += 0.02) {
    // сумма атак по лучшей фазе
    let s = 0;
    for (let ph = 0; ph < p; ph++) { let q = 0; for (let f = ph; f < frames; f += p) q += onset[Math.round(f)] || 0; if (q > s) s = q; }
    if (s > bs) { bs = s; period = p; }
  }
  // фаза: где стоят доли. Хэты на слабых долях дают много «шума» во всех частотах и перетягивают сетку на полудоли,
  // поэтому для фазы атаки баса (бочка) весят вдвое больше остальных
  const lowOn = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, f - M); k <= Math.min(frames - 1, f + M); k++) { s += low[k]; c++; }
    lowOn[f] = Math.max(0, low[f] - s / c);
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const lw = mean(lowOn) > 0 ? 2 * mean(onset) / mean(lowOn) : 0;
  const pon = onset.map((v, f) => v + lw * lowOn[f]);
  let phase = 0, bp = -1;
  for (let ph = 0; ph < period; ph += 0.25) { let q = 0; for (let f = ph; f < frames; f += period) q += pon[Math.round(f)] || 0; if (q > bp) { bp = q; phase = ph; } }
  // каждый бит подтягиваем к ближайшей атаке (±40 мс), сетку не ломаем
  const beats = [], tol = Math.round(hz * 0.04);
  for (let f = phase; f < frames; f += period) {
    let at = Math.round(f), m = -1;
    for (let k = Math.max(0, at - tol); k <= Math.min(frames - 1, at + tol); k++) if (pon[k] > m) { m = pon[k]; at = k; }
    beats.push((at * HOP + N / 2) / sr);
  }
  // сильная доля: из четырёх сдвигов тот, где больше всего баса
  let down = 0, dm = -1;
  for (let o = 0; o < 4; o++) { let s = 0; for (let i = o; i < beats.length; i += 4) s += low[Math.round(beats[i] * hz - 0.5 * N / HOP)] || 0; if (s > dm) { dm = s; down = o; } }
  const env = t => rms[Math.min(frames - 1, Math.max(0, Math.round(t * hz)))] || 0;
  return {bpm: +(60 * hz / period).toFixed(1), period: period / hz, beats, downbeats: beats.filter((_, i) => i % 4 === down), env, frames, hz, rms};
}


// биты трека с кэшем; env (громкость во времени) — по сохранённому rms
export async function trackBeats(file, outDir, note = () => {}) {
  const c = cached(outDir, file, 'beats', 'v2');
  let b = c.get();
  if (!b) {
    note('Ищу биты в треке…');
    const i = await info(file);
    if (!i.audio) throw new Error('в треке нет звука');
    const sr = 22050, x = await decode(file, sr, 0, Math.min(i.duration, 240));
    const r = findBeats(x, sr);
    b = c.set({bpm: r.bpm, period: r.period, beats: r.beats.map(v => +v.toFixed(4)), downbeats: r.downbeats.map(v => +v.toFixed(4)), hz: r.hz, frames: r.frames,
      rms: Array.from(r.rms, v => +v.toFixed(4)), duration: i.duration});
  }
  // трек сделал сам Freefield (music.js): точные темп и дроп лежат рядом — сетка битов от них
  try {
    const meta = JSON.parse(fs.readFileSync(file + '.json', 'utf8'));
    if (meta.bpm > 40 && meta.bpm < 220) {
      const period = 60 / meta.bpm, beats = [];
      for (let t = meta.offset || 0; t < b.duration; t += period) beats.push(+t.toFixed(4));
      b = {...b, bpm: meta.bpm, period, beats, downbeats: beats.filter((_, i) => i % 4 === 0), drop: meta.drop ?? null};
    }
  } catch { /* обычный трек */ }
  b.env = t => b.rms[Math.min(b.frames - 1, Math.max(0, Math.round(t * b.hz)))] || 0;
  return b;
}
// ровная сетка, когда трека нет
export function gridBeats(bpm = 120, seconds = 300) {
  const period = 60 / bpm, beats = Array.from({length: Math.ceil(seconds / period)}, (_, i) => +(i * period).toFixed(4));
  return {bpm, period, beats, downbeats: beats.filter((_, i) => i % 4 === 0), env: () => 1, frames: seconds * 100, hz: 100, duration: seconds};
}

/* ---------- кадры клипа (этап 2): резкость, движение, свет, смены сцен, центр интереса по X ---------- */
// ffmpeg отдаёт уменьшенные серые кадры (6 в секунду), считаем на JS. Результат — ряды по времени, кэшируется.
export async function shots(file, outDir, note = () => {}) {
  const c = cached(outDir, file, 'shots', 'v3');
  const hit = c.get();
  if (hit) return hit;
  const fi = await info(file);
  if (!fi.video) return null;
  note(`Смотрю кадры: ${path.basename(file)}…`);
  const fps = 6, w = 96, h = Math.max(2, Math.round(w * fi.height / Math.max(1, fi.width) / 2) * 2);
  const t = await tools(), chunks = [];
  const r = await run(t.ffmpeg, ['-v', 'error', '-i', file, '-t', '180', '-vf', `fps=${fps},scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'], {stdout: d => chunks.push(d)});
  if (r.code !== 0) throw new Error('кадры не читаются: ' + lastErr(r.tail));
  const buf = Buffer.concat(chunks), size = w * h, n = Math.floor(buf.length / size);
  const sharp = [], motion = [], bright = [], cx = [], cy = [];
  let prev = null;
  for (let f = 0; f < n; f++) {
    const px = buf.subarray(f * size, (f + 1) * size);
    let sum = 0, lap = 0, lap2 = 0, mot = 0, wx = 0, wy = 0, ww = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, v = px[i];
      const l = 4 * v - px[i - 1] - px[i + 1] - px[i - w] - px[i + w];   // лапласиан — резкость и края
      lap += l; lap2 += l * l; sum += v;
      const d = prev ? Math.abs(v - prev[i]) : 0;
      mot += d;
      const wgt = d * d + 0.02 * Math.abs(l);   // куда смотрит зритель: прежде всего туда, где движется (квадрат разницы), чуть-чуть — на детали
      wx += wgt * x; wy += wgt * y; ww += wgt;
    }
    const cnt = (w - 2) * (h - 2);
    sharp.push(+(lap2 / cnt - (lap / cnt) ** 2).toFixed(1));
    motion.push(+(mot / cnt).toFixed(2));
    bright.push(+(sum / cnt).toFixed(1));
    cx.push(+(ww ? wx / ww / (w - 1) : 0.5).toFixed(3));
    cy.push(+(ww ? wy / ww / (h - 1) : 0.5).toFixed(3));
    prev = px;
  }
  // смены сцен: скачок движения намного выше обычного
  const med = [...motion].sort((a, b) => a - b)[Math.floor(motion.length / 2)] || 1;
  const cuts = motion.map((m, i) => i && m > Math.max(18, med * 4) ? +(i / fps).toFixed(2) : null).filter(x => x != null);
  return c.set({fps, n, sharp, motion, bright, cx, cy, cuts, duration: fi.duration});
}

// дроп трека: сильная доля, после которой громкость резко выше, чем до неё (самый мощный момент)
export function findDrop(beat, minAt = 4) {
  if (beat.drop != null) return beat.drop;   // известен заранее (трек Freefield)
  if (!beat.rms?.length) return null;
  const mean = (a, b) => { let s = 0, c = 0; for (let t = a; t < b; t += 0.1) { s += beat.env(t); c++; } return c ? s / c : 0; };
  let best = null, bs = 0;
  for (const d of beat.downbeats) {
    if (d < minAt || d + 4 > beat.duration) continue;
    const before = mean(d - 4, d - 0.2), after = mean(d, d + 4);
    const s = after - before * 1.15;
    if (after > 0 && s > bs) { bs = s; best = d; }
  }
  return best;
}

/* ---------- речь: whisper.cpp по словам ---------- */
async function whisperWords(wav, lang, note) {
  const W = await ensureWhisper(note);
  const base = wav.replace(/\.wav$/, '');
  const r = await run(W.whisper, ['-m', W.model, '-f', wav, '-l', lang || 'auto', '-ml', '1', '-sow', '-oj', '-of', base, '-np', '-t', '4'], {cwd: path.dirname(W.whisper)});
  if (r.code !== 0 || !fs.existsSync(base + '.json')) throw new Error('распознавание речи не сработало: ' + lastErr(r.tail));
  const j = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
  const words = [];
  let skip = '';   // пометки Whisper «(dog barks)», «[музыка]» — по одному слову; пропускаем до закрывающей скобки
  for (const s of j.transcription || []) {
    const text = String(s.text || '').trim();
    if (skip) { if (text.includes(skip)) skip = ''; continue; }
    if (/^[([*]/.test(text) && !/[)\]*]$/.test(text)) { skip ={'(': ')', '[': ']', '*': '*'}[text[0]]; continue; }
    if (!text || /^\[.*\]$|^\(.*\)$|^\*.*\*$|^[♪*]+$/.test(text)) continue;
    const w = {text, start: s.offsets.from / 1000, end: s.offsets.to / 1000};
    // одни знаки препинания: точку/запятую приклеиваем к предыдущему слову, тире и прочее — долой
    if (/^[\p{P}\s]+$/u.test(text)) {
      if (words.length && /^[.,!?…:;»"]+$/.test(text)) { words[words.length - 1].text += text; words[words.length - 1].end = w.end; }
      continue;
    }
    words.push(w);
  }
  return {language: j.result?.language || lang, words};
}
// Whisper путает русский с болгарским/сербским — пользователь говорит по-русски, близкие славянские = русский
const SLAVIC = ['bg', 'mk', 'sr', 'be', 'uk'];
// речь файла целиком (до 120 с): слова со временем в файле
export async function speech(file, outDir, {lang = 'auto', note = () => {}, workDir} = {}) {
  const c = cached(outDir, file, 'speech', 'v2|' + lang);
  const hit = c.get();
  if (hit) return hit;
  note(`Распознаю речь: ${path.basename(file)}…`);
  const wav = path.join(workDir || cacheDir(outDir), `sp-${crypto.randomBytes(4).toString('hex')}.wav`);
  fs.mkdirSync(path.dirname(wav), {recursive: true});
  try {
    await ff(['-i', file, '-t', '120', '-vn', '-ac', '1', '-ar', '16000', wav], 'звук клипа');
    let r = await whisperWords(wav, lang, note);
    if (lang === 'auto' && SLAVIC.includes(r.language)) r = {...await whisperWords(wav, 'ru', note), language: 'ru'};
    return c.set({language: r.language, words: r.words, speech: r.words.length >= 3});
  } finally { for (const f of [wav, wav.replace(/\.wav$/, '.json')]) fs.rmSync(f, {force: true}); }
}
