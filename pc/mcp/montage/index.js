// Монтаж Freefield: анализ (analyze.js) → проект montage.json (plan.js) → рендер (render.js).
//   montage()          — автомонтаж под бит (MCP montage);
//   planMontage()      — то же без рендера: проект для правки (Claude-режиссёр, этап 6);
//   editMontage()      — правка словами: быстрее / медленнее / короче / длиннее / ещё вариант / другой шаблон…;
//   variants()         — несколько вариантов черновиками;
//   fromReference()    — монтаж по образцу (этап 5): рецепт рилса → свои клипы, 3 варианта, рецепт можно сохранить шаблоном;
//   renderProject()    — готовый проект (из приложения, Claude или правки);
//   analyzeClips(), musicLibrary(), exportProject() — для Claude-режиссёра.
// Рендеры идут по одному: каждый занимает видеокарту и все ядра.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {info, speech, shots, trackBeats, gridBeats, tools, findDrop} from './analyze.js';
import {toProject, bestWindow} from './plan.js';
import {render} from './render.js';
import {normalize, ASPECTS, CAPTION_STYLES} from './project.js';
import {STYLES} from './templates/gfx.js';
import {RECIPES, recipeList as builtinList} from './templates/recipes.js';
import {LOOKS} from './fx.js';
import {analyzeReference, saveRecipe, userRecipes, contactSheet} from './reference.js';
import {exportProject as exportFiles} from './export.js';

export {STYLES, normalize, RECIPES, CAPTION_STYLES, LOOKS};
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i, AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i;

let queue = Promise.resolve();
const queued = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };

const slug = s => String(s || 'montage').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30) || 'montage';
const outName = (dir, title, quality) => path.join(dir, `freefield-montage-${slug(title)}${quality === 'draft' ? '-draft' : ''}-${Date.now().toString(36)}.mp4`);
const rootOf = outDir => path.dirname(outDir);   // outputs/<дата> → outputs (кэш анализа, свои шаблоны)

// шаблоны: встроенные + свои (outputs/montage-recipes, в т. ч. по образцу)
export const recipeList = outRoot => [...builtinList(), ...Object.entries(outRoot ? userRecipes(outRoot) : {}).map(([id, r]) => ({id, label: r.label || id, desc: r.desc || '', own: true}))];
const recipeOf = (id, outRoot) => RECIPES[id] || userRecipes(outRoot)[id] || null;

// готовый проект → mp4 (+ рядом .montage.json, чтобы открыть и поправить)
// restrict — проект пришёл по сети: файлы только из outputs (project.js sourcePath)
export function renderProject(project, {outDir, uploadDir, quality = 'final', restrict = false, onStatus = () => {}}) {
  return queued(async () => {
    const P = normalize(project);
    const outFile = outName(outDir, P.name, quality);
    const r = await render(P, {outFile, quality, ctx: {outDir: rootOf(outDir), uploadDir: uploadDir || path.join(rootOf(outDir), 'montage-src'), restrict}, onStatus});
    fs.writeFileSync(outFile.replace(/\.mp4$/, '.montage.json'), JSON.stringify(P, null, 1));
    return {...r, project: outFile.replace(/\.mp4$/, '.montage.json')};
  });
}

// анализ клипов и трека → проект (без рендера)
// opts: clips[], music?, duration, template, style, title, subtitle, items[], cta, hook, captions, caption_style, language, pace, aspect, music_start,
//       look, brand, variant, outDir, onStatus
async function prepare(opts) {
  const note = opts.onStatus || (() => {});
  await tools(note);
  if (!opts.clips?.length) throw new Error('нет клипов');
  const root = rootOf(opts.outDir);
  const warnings = [];
  note('Смотрю клипы…');
  const clips = [];
  for (const file of opts.clips) {
    const i = await info(file).catch(() => null);
    if (!i?.video || i.duration < 0.5) { warnings.push(`пропущен ${path.basename(file)}: не видео`); continue; }
    clips.push({file, ...i});
  }
  if (!clips.length) throw new Error('ни один файл не открылся как видео');
  // формат не задан — как у большинства клипов (рилсы обычно вертикальные, при равенстве — 9:16)
  const wide = clips.filter(c => c.width > c.height * 1.2).length, square = clips.filter(c => c.width <= c.height * 1.2 && c.width > c.height * 0.9).length;
  const aspect = ASPECTS[opts.aspect] ? opts.aspect : wide > clips.length / 2 ? '16:9' : square > clips.length / 2 ? '1:1' : '9:16';

  // речь клипов по словам (для субтитров и чтобы не рвать фразы)
  let lang = opts.language && opts.language !== 'auto' ? opts.language : 'auto';
  for (const c of clips) {
    if (!c.audio) continue;
    try {
      const sp = await speech(c.file, root, {lang, note});
      Object.assign(c, {speech: sp.speech, words: sp.words});
      if (sp.speech && lang === 'auto') lang = sp.language;
    } catch (e) { warnings.push(e.message); break; }
  }
  if (opts.captions !== false && !clips.some(c => c.speech)) warnings.push('в клипах нет речи — субтитры не нужны');
  // кадры клипов: лучшие куски и кадрирование (этап 2)
  for (const c of clips) c.shots = await shots(c.file, root, note).catch(e => { warnings.push(e.message); return null; });

  let music = opts.music && fs.existsSync(opts.music) ? opts.music : null, beat = null;
  if (opts.music && !music) warnings.push('трек не найден: ' + opts.music + ' — монтаж без музыки');
  if (music) {
    try { beat = await trackBeats(music, root, note); note(`Темп трека: ${beat.bpm} BPM`); }
    catch (e) { warnings.push(e.message + ' — монтаж без музыки'); music = null; }
  }
  beat ||= gridBeats(120);
  const duration = Math.min(60, Math.max(6, +opts.duration || 20));
  // шаблон (этап 4) или свой / по образцу (этап 5); явные параметры вызова важнее шаблона
  const recipe = opts.recipe || (opts.template ? recipeOf(opts.template, root) : null);
  if (opts.template && !recipe) warnings.push('нет шаблона ' + opts.template + ' — монтаж без шаблона');
  const {project, plan} = toProject(clips, beat, {...opts, recipe, music, aspect, duration, pace: opts.pace || 'auto'});
  note(`План: ${plan.segs.length} кусков под бит (${plan.pace}), ${plan.duration.toFixed(1)} с`);
  const used = new Set(plan.segs.map(x => x.clip)), left = clips.filter((_, i) => !used.has(i));
  if (left.length) warnings.push(`не поместились (речь длинная, ролик стал бы больше ${Math.round(Math.max(duration * 1.5, duration + 6))} с): ${left.map(c => path.basename(c.file)).join(', ')}`);
  // как собран — для правки словами
  const {onStatus, recipe: _r, outDir: _o, ...meta} = opts;
  project.meta = {opts: meta};
  const summary = {bpm: beat.bpm, music_start: +plan.start.toFixed(2), drop: plan.drop, pace: plan.pace, style: project.tracks.gfx[0]?.template || 'none',
    template: opts.template || null, captions: project.tracks.captions.words.length, language: lang,
    clips: plan.segs.map((s, k) => ({clip: path.basename(clips[s.clip].file), from: +s.from.toFixed(2), at: +s.t0.toFixed(2), len: +s.len.toFixed(2),
      transition: project.tracks.video[k + 1]?.transition.type || null}))};
  return {project, summary, warnings, root};
}

export function planMontage(opts) {
  return queued(async () => {
    const {project, summary, warnings} = await prepare(opts);
    fs.mkdirSync(opts.outDir, {recursive: true});
    const file = path.join(opts.outDir, `freefield-montage-${slug(opts.title)}-${Date.now().toString(36)}.plan.montage.json`);
    fs.writeFileSync(file, JSON.stringify(normalize(project), null, 1));
    return {project: file, duration: normalize(project).duration, ...summary, warnings};
  });
}

// автомонтаж: анализ → проект → рендер
export function montage(opts) {
  return queued(async () => {
    const t0 = Date.now();
    const {project, summary, warnings, root} = await prepare(opts);
    const quality = opts.quality === 'draft' ? 'draft' : 'final';
    const outFile = outName(opts.outDir, opts.title, quality);
    const r = await render(project, {outFile, quality, ctx: {outDir: root, uploadDir: path.join(root, 'montage-src')}, onStatus: opts.onStatus || (() => {})});
    const projectFile = outFile.replace(/\.mp4$/, '.montage.json');
    fs.writeFileSync(projectFile, JSON.stringify(normalize(project), null, 1));
    return {...r, ...summary, project: projectFile, seconds: Math.round((Date.now() - t0) / 1000), warnings};
  });
}

// правка словами: ops — {faster|slower: true, shorter|longer: секунды, duration, template, look, caption_style, style, variant: true, title…}
const PACES = ['slow', 'medium', 'fast'];
export function editOpts(meta, ops) {
  const o = {...meta};
  if (ops.faster || ops.slower) {
    const cur = PACES.includes(o.pace) ? o.pace : 'medium';
    o.pace = PACES[Math.max(0, Math.min(2, PACES.indexOf(cur) + (ops.faster ? 1 : -1)))];
  }
  if (ops.shorter) o.duration = Math.max(6, (o.duration || 20) - ops.shorter);
  if (ops.longer) o.duration = Math.min(60, (o.duration || 20) + ops.longer);
  if (ops.variant) o.variant = (o.variant || 0) + 1;
  for (const k of ['duration', 'template', 'style', 'caption_style', 'title', 'subtitle', 'items', 'cta', 'hook', 'music', 'music_start', 'aspect', 'brand', 'clips', 'captions'])
    if (ops[k] !== undefined) o[k] = ops[k];
  if (ops.look !== undefined) o.look = ops.look === 'none' ? {preset: 'none'} : typeof ops.look === 'string' ? {preset: ops.look, vignette: true} : ops.look;
  return o;
}
export async function editMontage(projectFile, ops, {outDir, quality = 'draft', onStatus}) {
  const P = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  if (!P.meta?.opts) throw new Error('этот проект собран не автомонтажом — правьте сам проект (montage_render с изменённым JSON)');
  const opts = editOpts(P.meta.opts, ops);
  return montage({...opts, quality, outDir, onStatus});
}

// несколько вариантов черновиками (разный порядок клипов и переходы; третий — с другим цветом)
export async function variants(opts, n = 3) {
  const out = [];
  const looks = ['teal_orange', 'film', 'warm', 'cold', 'neon'];
  for (let v = 0; v < n; v++) {
    const o = {...opts, variant: (opts.variant || 0) + v, quality: opts.quality || 'draft'};
    if (v === 2 && !opts.look) o.look = {preset: looks[(opts.variant || 0) % looks.length], vignette: true};
    try { out.push(await montage(o)); } catch (e) { out.push({error: e.message}); }
  }
  return out;
}

// по образцу: разбор → рецепт → (сохранить шаблоном) → варианты на своих клипах
export async function fromReference({reference, save_as, variants: n = 3, ...opts}) {
  const root = rootOf(opts.outDir);
  const note = opts.onStatus || (() => {});
  const ref = await queued(() => analyzeReference(reference, {outDir: root, note}));
  const sheet = await contactSheet(reference, path.join(root, '.montage-cache', `ref-${Date.now().toString(36)}.jpg`));
  let template = null;
  if (save_as) template = saveRecipe(root, save_as, ref.recipe);
  const results = opts.clips?.length ? await variants({...opts, recipe: ref.recipe, template: template || undefined}, n) : [];
  return {reference: ref, sheet, template, results};
}

// клипы для глаз Claude: раскадровка, речь, лучшие моменты, смены сцен (этап 6)
export function analyzeClips(files, {outDir, onStatus: note = () => {}}) {
  return queued(async () => {
    const root = rootOf(outDir), out = [];
    for (const file of files.slice(0, 8)) {
      const fi = await info(file).catch(() => null);
      if (!fi?.video) { out.push({file, error: 'не видео'}); continue; }
      const s = await shots(file, root, note).catch(() => null);
      const sp = fi.audio ? await speech(file, root, {note}).catch(() => null) : null;
      const c = {file, duration: fi.duration, shots: s};
      const len = Math.min(2, fi.duration / 2), best = [];
      for (let k = 0; k < 3 && fi.duration > len + 0.5; k++) { const a = bestWindow(c, len, best.map(b => [b, b + len])); if (!best.includes(a)) best.push(a); }
      const sheet = await contactSheet(file, path.join(root, '.montage-cache', `sheet-${path.basename(file).replace(/\W+/g, '_').slice(0, 40)}-${Date.now().toString(36)}.jpg`), {cols: 4, rows: 2, width: 200});
      out.push({file, duration: +fi.duration.toFixed(2), size: `${fi.width}×${fi.height}`, audio: fi.audio,
        speech: sp?.speech ? sp.words.map(w => w.text).join(' ').slice(0, 1500) : '', language: sp?.language || null,
        best_moments: best.map(a => ({from: +a.toFixed(2), to: +(a + len).toFixed(2)})), scene_cuts: s?.cuts || [],
        motion: s ? +(s.motion.reduce((x, y) => x + y, 0) / s.n).toFixed(1) : null, sheet});
    }
    return out;
  });
}

// музыка пользователя: темп, энергия, длина — чтобы подобрать трек под настроение (этап 6)
export function musicLibrary({folders, outDir, limit = 30, onStatus: note = () => {}}) {
  return queued(async () => {
    const root = rootOf(outDir);
    const dirs = folders?.length ? folders : [path.join(os.homedir(), 'Music'), path.join(os.homedir(), 'Downloads'), path.join(root, 'music')];
    const files = [];
    const walk = (d, depth) => {
      let es = [];
      try { es = fs.readdirSync(d, {withFileTypes: true}); } catch { return; }
      for (const e of es) {
        const p = path.join(d, e.name);
        if (e.isDirectory() && depth < 2 && !e.name.startsWith('.')) walk(p, depth + 1);
        else if (e.isFile() && AUDIO_EXT.test(e.name)) { const st = fs.statSync(p); if (st.size > 300e3) files.push({p, m: st.mtimeMs}); }
      }
    };
    for (const d of dirs) walk(d, 0);
    const out = [];
    for (const {p} of files.sort((a, b) => b.m - a.m).slice(0, limit)) {
      try {
        const b = await trackBeats(p, root, note);
        if (!b.duration || b.duration < 15) continue;   // голосовые и короткие звуки — не музыка
        const energy = b.rms.reduce((x, y) => x + y, 0) / (b.rms.length || 1), drop = findDrop(b);
        out.push({file: p, name: path.basename(p), bpm: b.bpm, duration: +b.duration.toFixed(1), energy: +energy.toFixed(3),
          mood: b.bpm >= 118 && energy > 0.12 ? 'энергичный' : b.bpm < 95 || energy < 0.06 ? 'спокойный' : 'средний', drop: drop != null ? +drop.toFixed(1) : null});
      } catch { /* не трек */ }
    }
    return out;
  });
}

// экспорт в DaVinci / Premiere / CapCut (этап 7)
export const exportProject = (projectFile, {outDir, formats}) => {
  const P = JSON.parse(fs.readFileSync(projectFile, 'utf8')), root = rootOf(outDir);
  return exportFiles(P, {base: projectFile.replace(/(\.plan)?\.montage\.json$/, ''), ctx: {outDir: root, uploadDir: path.join(root, 'montage-src')}, formats});
};

// последние видео из outputs (если клипы не названы)
export function latestVideos(outDir, n = 4) {
  const all = [];
  const walk = (d, depth) => {
    let es = [];
    try { es = fs.readdirSync(d, {withFileTypes: true}); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 2 && !e.name.startsWith('.') && !['split', 'montage-src', 'montage-templates'].includes(e.name)) walk(p, depth + 1);
      else if (e.isFile() && VIDEO_EXT.test(e.name) && !e.name.startsWith('freefield-montage-')) all.push({p, m: fs.statSync(p).mtimeMs});
    }
  };
  walk(outDir, 0);
  return all.sort((a, b) => b.m - a.m).slice(0, n).map(x => x.p).reverse();
}
