// Автомонтаж «как Higgsfield Katana», бесплатно на этом компьютере (пользователь 2026-10-10):
// клипы из outputs + трек → биты → нарезка под ритм с переходами и «ударными» зумами → субтитры по словам (whisper.cpp)
// → моушн-графика (HTML-шаблон из montage-gfx.js, кадры снимает Chrome без окна) → готовый mp4 в галерею.
// ffmpeg и whisper.cpp ставятся сами в папку Freefield\tools при первом запуске (avtools.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {chromium} from 'playwright-core';
import {ensureFfmpeg, ensureWhisper, run, lastErr} from './avtools.js';
import {gfxHtml, STYLES} from './montage-gfx.js';

export {STYLES};
const FPS = 30;
const SIZES = {'9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080], '4:5': [1080, 1350]};
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i;
const CHROME = process.env.FREEFIELD_CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

let T = null;   // пути ffmpeg / ffprobe
const ff = async (args, what, onLine) => {
  const r = await run(T.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {onLine});
  if (r.code !== 0) throw new Error(`${what}: ${lastErr(r.tail)}`);
};

async function info(file) {
  let out = '';
  const r = await run(T.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', file], {stdout: d => { out += d; }});
  if (r.code !== 0) throw new Error(`не открывается ${path.basename(file)}: ${lastErr(r.tail)}`);
  const j = JSON.parse(out), v = j.streams.find(s => s.codec_type === 'video');
  return {duration: +j.format.duration || 0, width: v?.width || 0, height: v?.height || 0, video: !!v, audio: j.streams.some(s => s.codec_type === 'audio')};
}
// звук → моно float32 (для поиска битов)
function decode(file, sr, start = 0, dur = 0) {
  const chunks = [];
  return run(T.ffmpeg, ['-v', 'error', ...(start ? ['-ss', String(start)] : []), '-i', file, ...(dur ? ['-t', String(dur)] : []),
    '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], {stdout: d => chunks.push(d)}).then(r => {
    if (r.code !== 0) throw new Error('звук не читается: ' + lastErr(r.tail));
    const b = Buffer.concat(chunks);
    return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
  });
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
  let phase = 0, bp = -1;
  for (let ph = 0; ph < period; ph += 0.25) { let q = 0; for (let f = ph; f < frames; f += period) q += onset[Math.round(f)] || 0; if (q > bp) { bp = q; phase = ph; } }
  // каждый бит подтягиваем к ближайшей атаке (±40 мс), сетку не ломаем
  const beats = [], tol = Math.round(hz * 0.04);
  for (let f = phase; f < frames; f += period) {
    let at = Math.round(f), m = -1;
    for (let k = Math.max(0, at - tol); k <= Math.min(frames - 1, at + tol); k++) if (onset[k] > m) { m = onset[k]; at = k; }
    beats.push((at * HOP + N / 2) / sr);
  }
  // сильная доля: из четырёх сдвигов тот, где больше всего баса
  let down = 0, dm = -1;
  for (let o = 0; o < 4; o++) { let s = 0; for (let i = o; i < beats.length; i += 4) s += low[Math.round(beats[i] * hz - 0.5 * N / HOP)] || 0; if (s > dm) { dm = s; down = o; } }
  const env = t => rms[Math.min(frames - 1, Math.max(0, Math.round(t * hz)))] || 0;
  return {bpm: +(60 * hz / period).toFixed(1), period: period / hz, beats, downbeats: beats.filter((_, i) => i % 4 === down), env, frames, hz, rms};
}

/* ---------- субтитры: whisper.cpp по словам ---------- */
async function transcribe(wav, lang, note) {
  const W = await ensureWhisper(note);
  note('Распознаю речь для субтитров…');
  const base = wav.replace(/\.wav$/, '');
  const r = await run(W.whisper, ['-m', W.model, '-f', wav, '-l', lang || 'auto', '-ml', '1', '-sow', '-oj', '-of', base, '-np', '-t', '4'], {cwd: path.dirname(W.whisper)});
  if (r.code !== 0 || !fs.existsSync(base + '.json')) throw new Error('распознавание речи не сработало: ' + lastErr(r.tail));
  const j = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
  const words = [];
  for (const s of j.transcription || []) {
    const text = String(s.text || '').trim();
    if (!text || /^\[.*\]$|^\(.*\)$|^[♪*]+$/.test(text)) continue;
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

/* ---------- план нарезки ---------- */
// сегменты: какой клип, с какой секунды, сколько битов; швы — на битах
function plan(clips, beat, opts) {
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
      if (!n || local[b + n] > 60) break;
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

// переходы между кусками — разные, но предсказуемые
const TRANS = [
  {name: 'hblur', d: 0.14}, {name: 'fadewhite', d: 0.18}, {name: 'smoothleft', d: 0.22}, {name: 'fade', d: 0.06},
  {name: 'circleopen', d: 0.26}, {name: 'smoothup', d: 0.22}, {name: 'fade', d: 0.06}, {name: 'slideleft', d: 0.2},
];

/* ---------- графика: HTML → прозрачные PNG по кадрам ---------- */
async function renderGfx(dir, cfg, note) {
  if (!CHROME) throw new Error('для графики нужен Chrome или Edge на компьютере');
  fs.mkdirSync(dir, {recursive: true});
  const browser = await chromium.launch({executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--force-device-scale-factor=1']});
  try {
    const page = await browser.newPage({viewport: {width: cfg.W, height: cfg.H}, deviceScaleFactor: 1});
    await page.setContent(gfxHtml(), {waitUntil: 'load', timeout: 30000}).catch(() => {});
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 6000))]));
    await page.evaluate(c => window.SETUP(c), cfg);
    const n = Math.ceil(cfg.duration * FPS);
    const blank = path.join(dir, 'blank.png');
    let prevKey = null, prevFile = null, shots = 0;
    for (let f = 0; f < n; f++) {
      const t = f / FPS;
      const {key, empty} = await page.evaluate(t => ({key: window.FRAME(t), empty: window.EMPTY()}), t);
      const file = path.join(dir, `g${String(f).padStart(5, '0')}.png`);
      if (empty) {
        if (!fs.existsSync(blank)) fs.writeFileSync(blank, await page.screenshot({omitBackground: true, type: 'png'}));
        fs.copyFileSync(blank, file);
      } else if (key === prevKey && prevFile) fs.copyFileSync(prevFile, file);
      else { fs.writeFileSync(file, await page.screenshot({omitBackground: true, type: 'png'})); shots++; }
      prevKey = key; prevFile = file;
      if (f % 30 === 0) note(`Рисую графику и субтитры: ${Math.round(f / n * 100)} %`);
    }
    return {frames: n, shots};
  } finally { await browser.close().catch(() => {}); }
}

/* ---------- главное ---------- */
// opts: clips[], music?, duration, style, title, subtitle, items[], cta, captions, language, pace, aspect, music_start, outDir, onStatus
let queue = Promise.resolve();   // по одному: рендер занимает все ядра
export function montage(opts) {
  const p = queue.then(() => montageNow(opts));
  queue = p.catch(() => {});
  return p;
}
async function montageNow(opts) {
  const note = opts.onStatus || (() => {});
  const t0 = Date.now();
  T = await ensureFfmpeg(note);
  if (!opts.clips?.length) throw new Error('нет клипов');
  const work = path.join(opts.outDir, '.montage-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(work, {recursive: true});
  const warnings = [];
  try {
    note('Смотрю клипы…');
    const clips = [];
    for (const file of opts.clips) {
      const i = await info(file);
      if (!i.video || i.duration < 0.5) { warnings.push(`пропущен ${path.basename(file)}: не видео`); continue; }
      clips.push({file, ...i});
    }
    if (!clips.length) throw new Error('ни один файл не открылся как видео');
    const aspect = SIZES[opts.aspect] ? opts.aspect : (clips[0].width > clips[0].height * 1.2 ? '16:9' : clips[0].width > clips[0].height * 0.9 ? '1:1' : '9:16');
    const [W, H] = SIZES[aspect];

    // есть ли в клипах речь — коротко проверяем каждый (для режима нарезки и громкости музыки)
    let lang = opts.language && opts.language !== 'auto' ? opts.language : 'auto';
    if (opts.captions !== false && clips.some(c => c.audio)) {
      for (const [k, c] of clips.entries()) {
        if (!c.audio) continue;
        const wav = path.join(work, `probe${k}.wav`);
        await ff(['-i', c.file, '-t', '12', '-ac', '1', '-ar', '16000', wav], 'звук клипа');
        try {
          const tr = await transcribe(wav, lang, note);
          c.speech = tr.words.length >= 3; c.words = tr.words;
          // Whisper путает русский с болгарским/сербским — пользователь говорит по-русски, близкие славянские = русский
          if (c.speech && lang === 'auto' && tr.language) lang = ['bg', 'mk', 'sr', 'be', 'uk'].includes(tr.language) ? 'ru' : tr.language;
        } catch (e) { warnings.push(e.message); break; }
      }
    }

    // музыка → биты
    let beat, music = opts.music && fs.existsSync(opts.music) ? opts.music : null;
    if (opts.music && !music) warnings.push('трек не найден: ' + opts.music + ' — монтаж без музыки');
    if (music) {
      note('Ищу биты в треке…');
      const mi = await info(music).catch(() => null);
      if (!mi?.audio) { warnings.push('в треке нет звука — монтаж без музыки'); music = null; }
      else {
        const sr = 22050, x = await decode(music, sr, 0, Math.min(mi.duration, 240));
        beat = findBeats(x, sr);
        note(`Темп трека: ${beat.bpm} BPM`);
      }
    }
    if (!beat) {   // без трека — ровная сетка 120 BPM
      const len = 300, beats = Array.from({length: len * 2}, (_, i) => i * 0.5);
      beat = {bpm: 120, period: 0.5, beats, downbeats: beats.filter((_, i) => i % 4 === 0), env: () => 1, frames: len * 100, hz: 100};
    }
    const duration = Math.min(60, Math.max(6, +opts.duration || 20));
    const P = plan(clips, beat, {duration, pace: opts.pace || 'auto', music_start: opts.music_start});
    note(`План: ${P.segs.length} кусков под бит (${P.pace}), ${P.duration.toFixed(1)} с`);

    // куски: размер кадра, 30 к/с, «удар» зумом на сильных долях, плавный наезд
    const segFiles = [];
    for (const [k, s] of P.segs.entries()) {
      const c = clips[s.clip], tr = TRANS[k % TRANS.length];
      s.trans = k < P.segs.length - 1 ? tr : null;
      const len = s.len + 0.32;   // запас под переход (обрезается при склейке)
      const from = Math.max(0, Math.min(s.from, c.duration - Math.min(len, c.duration)));
      const punches = P.beats.filter((b, i) => i % 4 === 0 && b >= s.t0 - 1e-3 && b < s.t1).map(b => (b - s.t0).toFixed(3));
      if (!punches.includes('0.000')) punches.unshift('0.000');
      const ot = '(on/' + FPS + ')';
      const punch = punches.map(p => `0.07*exp(-11*(${ot}-${p}))*gte(${ot},${p})`).join('+');
      const drift = `0.05*${ot}/${len.toFixed(3)}`;
      const vf = [`fps=${FPS}`, `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${W * 2}:${H * 2}`, 'setsar=1',
        `zoompan=z='1+${drift}+${punch}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`,
        `tpad=stop_mode=clone:stop_duration=${len.toFixed(3)}`, `trim=duration=${len.toFixed(3)}`, 'setpts=PTS-STARTPTS', 'format=yuv420p'].join(',');
      const out = path.join(work, `seg${k}.mp4`);
      const audioIn = c.audio ? ['-ss', from.toFixed(3), '-t', len.toFixed(3), '-i', c.file] : ['-f', 'lavfi', '-t', len.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'];
      await ff(['-ss', from.toFixed(3), '-t', len.toFixed(3), '-i', c.file, ...audioIn,
        '-filter_complex', `[0:v]${vf}[v];[1:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${len.toFixed(3)}[a]`,
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-c:a', 'pcm_s16le', out.replace('.mp4', '.mov')], `кусок ${k + 1}`);
      segFiles.push({file: out.replace('.mp4', '.mov'), len});
      note(`Режу под бит: ${k + 1} из ${P.segs.length}`);
    }

    // склейка с переходами: шов каждого перехода — ровно на бите
    note('Склеиваю с переходами…');
    const joined = path.join(work, 'joined.mov');
    if (segFiles.length === 1) fs.copyFileSync(segFiles[0].file, joined);
    else {
      const inputs = segFiles.flatMap(s => ['-i', s.file]);
      const fc = [];
      let v = '[0:v]', a = '[0:a]';
      for (let k = 0; k < segFiles.length - 1; k++) {
        const tr = P.segs[k].trans, off = (P.segs[k + 1].t0 - tr.d / 2).toFixed(3);
        const vo = `[v${k}]`, ao = `[a${k}]`;
        fc.push(`${v}[${k + 1}:v]xfade=transition=${tr.name}:duration=${tr.d}:offset=${off}${vo}`);
        // звук режем там же, где картинку, иначе он уедет
        fc.push(`${a}atrim=duration=${(+off + tr.d).toFixed(3)}[at${k}];[at${k}][${k + 1}:a]acrossfade=d=${tr.d}:c1=tri:c2=tri${ao}`);
        v = vo; a = ao;
      }
      await ff([...inputs, '-filter_complex', fc.join(';'), '-map', v, '-map', a, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-c:a', 'pcm_s16le', joined], 'склейка');
    }

    // субтитры по словам — из звука уже смонтированных клипов
    let words = [];
    const anySpeech = clips.some(c => c.speech);
    if (opts.captions !== false && anySpeech) {
      const wav = path.join(work, 'speech.wav');
      await ff(['-i', joined, '-t', P.duration.toFixed(3), '-vn', '-ac', '1', '-ar', '16000', wav], 'звук для субтитров');
      try { words = (await transcribe(wav, lang, note)).words.filter(w => w.start < P.duration - 0.1); }
      catch (e) { warnings.push(e.message); }
    } else if (opts.captions !== false) warnings.push('в клипах нет речи — субтитры не нужны');

    // графика + субтитры
    const style = STYLES[opts.style] ? opts.style : 'titles';
    const gdir = path.join(work, 'gfx');
    const cfg = {W, H, duration: P.duration, style, title: opts.title || '', subtitle: opts.subtitle || '', items: opts.items || [], cta: opts.cta || '',
      captions: opts.captions !== false, words, beats: P.beats};
    const needGfx = words.length || (style !== 'none' && (cfg.title || cfg.cta || cfg.items.length));
    let g = null;
    if (needGfx) g = await renderGfx(gdir, cfg, note);

    // финал: видео + графика + музыка (под речь музыка тише и «уступает» голосу)
    note('Собираю финальный ролик…');
    const date = new Date().toISOString().slice(0, 10);
    const slug = String(opts.title || 'montage').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30) || 'montage';
    fs.mkdirSync(opts.outDir, {recursive: true});
    let outFile = path.join(opts.outDir, `freefield-montage-${slug}-${Date.now().toString(36)}.mp4`);
    const D = P.duration.toFixed(3), fadeAt = Math.max(0, P.duration - 0.6).toFixed(3);
    const args = ['-i', joined];
    const fc = [];
    let vin = '[0:v]';
    if (g) { args.push('-framerate', String(FPS), '-i', path.join(gdir, 'g%05d.png')); fc.push(`[0:v][1:v]overlay=format=auto:shortest=0[ov]`); vin = '[ov]'; }
    fc.push(`${vin}trim=duration=${D},fade=t=out:st=${fadeAt}:d=0.6,format=yuv420p[vout]`);
    const voice = anySpeech ? 1.0 : 0.22;
    if (music) {
      const mi = args.filter(a => a === '-i').length;
      args.push('-ss', P.start.toFixed(3), '-t', (P.duration + 0.5).toFixed(3), '-i', music);
      fc.push(`[0:a]atrim=duration=${D},volume=${voice},asplit=2[cv][sc]`);
      fc.push(`[${mi}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${anySpeech ? 0.55 : 1.0},afade=t=in:d=0.05[m0]`);
      fc.push(anySpeech ? `[m0][sc]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[m1]` : `[m0]anull[m1];[sc]anullsink`);
      fc.push(`[cv][m1]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,afade=t=out:st=${fadeAt}:d=0.6[aout]`);
    } else fc.push(`[0:a]atrim=duration=${D},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,afade=t=out:st=${fadeAt}:d=0.6[aout]`);
    await ff([...args, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', D,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outFile], 'финальный рендер');
    const fin = await info(outFile);
    return {path: outFile, mime: 'video/mp4', width: W, height: H, aspect, duration: +fin.duration.toFixed(2), bpm: beat.bpm, music_start: +P.start.toFixed(2),
      cuts: P.segs.length, pace: P.pace, style, captions: words.length, language: lang, gfx_frames: g?.frames || 0, gfx_shots: g?.shots || 0,
      clips: P.segs.map(s => ({clip: path.basename(clips[s.clip].file), from: +s.from.toFixed(2), at: +s.t0.toFixed(2), len: +s.len.toFixed(2), transition: s.trans?.name || null})),
      seconds: Math.round((Date.now() - t0) / 1000), warnings};
  } finally {
    if (!process.env.FREEFIELD_MONTAGE_KEEP) fs.rmSync(work, {recursive: true, force: true});
  }
}

// последние видео из outputs (если клипы не названы)
export function latestVideos(outDir, n = 4) {
  const all = [];
  const walk = (d, depth) => {
    let es = [];
    try { es = fs.readdirSync(d, {withFileTypes: true}); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 2 && !e.name.startsWith('.') && e.name !== 'split') walk(p, depth + 1);
      else if (e.isFile() && VIDEO_EXT.test(e.name) && !e.name.startsWith('freefield-montage-')) all.push({p, m: fs.statSync(p).mtimeMs});
    }
  };
  walk(outDir, 0);
  return all.sort((a, b) => b.m - a.m).slice(0, n).map(x => x.p).reverse();
}
