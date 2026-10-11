// Монтаж по образцу (этап 5, ответ Katana — но прозрачно): рилс-образец → «рецепт» (длины кадров в долях бита, переходы, цвет,
// речь/субтитры) + понятное описание + раскадровка для Claude (текст на экране, шрифты, композицию Claude видит сам).
// Рецепт применяется к своим клипам (montage template = id рецепта) и сохраняется как свой шаблон в outputs/montage-recipes.
import fs from 'node:fs';
import path from 'node:path';
import {run, lastErr} from '../avtools.js';
import {tools, info, shots, trackBeats, speech, ff} from './analyze.js';

const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const fmt = n => String(Math.round(n * 100) / 100).replace('.', ',');

// цвет образца: средняя насыщенность и «теплота» по маленьким цветным кадрам (2 в секунду)
async function colorStats(file) {
  const t = await tools(), chunks = [];
  const r = await run(t.ffmpeg, ['-v', 'error', '-i', file, '-t', '120', '-vf', 'fps=2,scale=32:-2,format=rgb24', '-f', 'rawvideo', '-'], {stdout: d => chunks.push(d)});
  if (r.code !== 0) throw new Error('цвет образца не читается: ' + lastErr(r.tail));
  const b = Buffer.concat(chunks);
  let sat = 0, warm = 0, teal = 0, light = 0, n = 0;
  for (let i = 0; i + 2 < b.length; i += 3) {
    const R = b[i], G = b[i + 1], B = b[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    sat += mx ? (mx - mn) / mx : 0; warm += (R - B) / 255; light += (R + G + B) / 765;
    if (mx > 60 && B > R && G > R) teal++;
    n++;
  }
  return {saturation: sat / n, warmth: warm / n, brightness: light / n, teal_share: teal / n};
}
function lookOf(c) {
  if (c.saturation < 0.08) return {preset: 'bw', why: 'почти без цвета'};
  if (c.teal_share > 0.25 && c.warmth > -0.02) return {preset: 'teal_orange', why: 'бирюзовые тени и тёплые лица'};
  if (c.saturation > 0.45) return {preset: 'neon', why: 'очень насыщенный'};
  if (c.warmth > 0.12) return {preset: 'warm', why: 'тёплый'};
  if (c.warmth < -0.04) return {preset: 'cold', why: 'холодный'};
  if (c.saturation < 0.2) return {preset: 'film', why: 'приглушённый, «плёночный»'};
  return {preset: 'none', why: 'естественный'};
}

// раскадровка 4×N для глаз Claude: что в кадре, текст, шрифты, композиция
export async function contactSheet(file, out, {cols = 4, rows = 3, width = 220} = {}) {
  const fi = await info(file);
  const n = cols * rows, step = Math.max(0.2, (fi.duration || 1) / n);
  await ff(['-i', file, '-vf', `fps=1/${step.toFixed(3)},scale=${width}:-2,tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', '-q:v', '4', out], 'раскадровка');
  return out;
}

// яркость и детальность каждого кадра (30 в секунду, кадр 32 px) — для типа переходов
async function fineSeries(file) {
  const t = await tools(), chunks = [], w = 32, h = 56, fps = 30;
  const r = await run(t.ffmpeg, ['-v', 'error', '-i', file, '-t', '180', '-vf', `fps=${fps},scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'], {stdout: d => chunks.push(d)});
  if (r.code !== 0) throw new Error('кадры образца не читаются: ' + lastErr(r.tail));
  const b = Buffer.concat(chunks), size = w * h, n = Math.floor(b.length / size), bright = [], detail = [];
  for (let f = 0; f < n; f++) {
    let s = 0, d = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = f * size + y * w + x;
      s += b[i];
      if (x) d += Math.abs(b[i] - b[i - 1]);   // перепады соседних пикселей — детали (при смазе пропадают)
    }
    bright.push(s / size); detail.push(d / size);
  }
  return {fps, n, bright, detail};
}

// склейки образца: детектор смены сцен ffmpeg (scdet) — видит склейки и между похожими планами, и при тряске;
// соседние срабатывания ближе 0,25 с (переход длится несколько кадров) — одна склейка
async function sceneCuts(file) {
  const t = await tools(), times = [];
  const r = await run(t.ffmpeg, ['-hide_banner', '-i', file, '-t', '180', '-vf', 'scale=270:-2,scdet=threshold=6', '-an', '-f', 'null', '-'],
    {onLine: l => { const m = /lavfi\.scd\.time:\s*([\d.]+)/.exec(l); if (m) times.push(+m[1]); }});
  if (r.code !== 0) throw new Error('склейки образца не находятся: ' + lastErr(r.tail));
  return times.filter(x => x > 0.1).filter((x, i, a) => !i || x - a[i - 1] > 0.25);
}

export async function analyzeReference(file, {outDir, note = () => {}}) {
  const fi = await info(file);
  if (!fi.video) throw new Error('образец — не видео');
  note('Разбираю образец: смены кадров…');
  const s = await shots(file, outDir, note);
  const sc = await sceneCuts(file);
  const cuts = [0, ...sc.filter(t => t < fi.duration - 0.1), fi.duration];
  const lens = cuts.slice(1).map((t, i) => t - cuts[i]).filter(l => l > 0.08);
  // тип перехода у каждой склейки — по каждому кадру (вспышка длится 3–4 кадра): вспышка (яркость резко вверх),
  // через чёрное, смаз (детали пропадают); иначе обычная склейка
  const F = await fineSeries(file);
  const kinds = sc.map(t => {
    const f0 = Math.round(t * F.fps), win = [], base = [];
    for (let f = f0 - 5; f <= f0 + 5; f++) if (f >= 0 && f < F.n) win.push(f);
    for (let f = f0 - 20; f <= f0 + 20; f++) if (f >= 0 && f < F.n && Math.abs(f - f0) > 7) base.push(f);
    const bb = med(base.map(f => F.bright[f])), bd = med(base.map(f => F.detail[f])) || 1;
    if (Math.max(...win.map(f => F.bright[f])) > Math.max(bb + 35, 150)) return 'flash';
    if (Math.min(...win.map(f => F.bright[f])) < 16) return 'black';
    if (Math.min(...win.map(f => F.detail[f])) < bd * 0.45) return 'hblur';
    return 'cut';
  });
  // ритм: биты звука образца (если есть), длины кадров в долях
  let bpm = null, period = 0.5;
  if (fi.audio) {
    try { const b = await trackBeats(file, outDir, note); bpm = b.bpm; period = b.period; } catch { /* без музыки — 120 BPM */ }
  }
  const pattern = lens.map(l => Math.max(1, Math.round(l / period))).slice(0, 48);
  note('Разбираю образец: цвет и речь…');
  const color = await colorStats(file);
  const look = lookOf(color);
  const sp = fi.audio ? await speech(file, outDir, {note}).catch(() => null) : null;
  const motion = s.motion.reduce((a, b) => a + b, 0) / (s.n || 1);
  const count = k => kinds.filter(x => x === k).length;
  const mLen = med(lens), mBeats = med(pattern);
  const recipe = {
    label: 'По образцу: ' + path.basename(file).replace(/\.\w+$/, '').slice(0, 40),
    pace: 'pattern', pattern, transitions: kinds.length ? kinds.map(k => k === 'black' ? 'black' : k) : ['cut'],
    punch_amount: mBeats <= 2 ? 0.08 : 0.05, drift: mBeats <= 2 ? 0.02 : 0.05,
    fx: {...(motion > 9 && mBeats <= 2 ? {shake: {amount: 0.35}} : {}), ...(count('flash') > 1 ? {flash: true} : {})},
    look: look.preset !== 'none' ? {preset: look.preset, vignette: color.brightness < 0.4} : undefined,
    sfx: {transitions: count('hblur') + count('flash') > 1, hits: mBeats <= 2, volume: 0.5},
    captions: sp?.speech ? 'box' : 'pop', clean_speech: true,
  };
  const desc = [
    `Длина ${fmt(fi.duration)} с, ${lens.length} ${lens.length === 1 ? 'кадр' : 'кадров'}: в среднем ${fmt(mLen)} с` + (bpm ? ` — ${mBeats} ${mBeats === 1 ? 'доля' : 'доли'} при ${bpm} BPM` : ''),
    `Переходы: ${count('cut')} резких, ${count('flash')} вспышек, ${count('hblur')} смазов, ${count('black')} через чёрное`,
    `Цвет: ${look.why} (насыщенность ${Math.round(color.saturation * 100)} %, ${color.warmth > 0.05 ? 'тёплый' : color.warmth < -0.03 ? 'холодный' : 'нейтральный'}) → пресет ${look.preset}`,
    `Движение в кадре: ${motion > 9 ? 'много (тряска, быстрые планы)' : motion > 4 ? 'среднее' : 'спокойное'}`,
    sp?.speech ? `Речь есть (${sp.words.length} слов, ${sp.language}) → субтитры по словам` : 'Речи нет — ролик держится на музыке и картинке',
  ];
  recipe.desc = desc.join('; ');
  return {file, duration: fi.duration, bpm, shots: lens.map(l => +l.toFixed(2)), transitions: kinds, color, look: look.preset, speech: !!sp?.speech,
    transcript: sp?.words?.map(w => w.text).join(' ').slice(0, 2000) || '', recipe, description: desc};
}

// свои шаблоны: outputs/montage-recipes/<id>.json
const recipeDir = outDir => path.join(outDir, 'montage-recipes');
export function saveRecipe(outDir, id, recipe) {
  const safe = String(id).toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'my-template';
  fs.mkdirSync(recipeDir(outDir), {recursive: true});
  fs.writeFileSync(path.join(recipeDir(outDir), safe + '.json'), JSON.stringify(recipe, null, 1));
  return safe;
}
export function userRecipes(outDir) {
  const out = {};
  try {
    for (const f of fs.readdirSync(recipeDir(outDir))) if (f.endsWith('.json')) {
      try { out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(recipeDir(outDir), f), 'utf8')); } catch { /* битый файл */ }
    }
  } catch { /* папки нет */ }
  return out;
}
