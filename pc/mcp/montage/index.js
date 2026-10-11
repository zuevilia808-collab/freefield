// Монтаж Freefield: анализ (analyze.js) → проект montage.json (plan.js) → рендер (render.js).
// montage() — автомонтаж под бит для MCP-инструмента; renderProject() — готовый проект (из приложения, ИИ-монтажёра или Claude).
// Рендеры идут по одному: каждый занимает видеокарту и все ядра.
import fs from 'node:fs';
import path from 'node:path';
import {info, speech, trackBeats, gridBeats, tools} from './analyze.js';
import {toProject} from './plan.js';
import {render} from './render.js';
import {normalize, ASPECTS} from './project.js';
import {STYLES} from './templates/gfx.js';

export {STYLES, normalize};
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i;

let queue = Promise.resolve();
const queued = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };

const slug = s => String(s || 'montage').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30) || 'montage';
const outName = (dir, title, quality) => path.join(dir, `freefield-montage-${slug(title)}${quality === 'draft' ? '-draft' : ''}-${Date.now().toString(36)}.mp4`);

// готовый проект → mp4 (+ рядом .montage.json, чтобы открыть и поправить)
export function renderProject(project, {outDir, uploadDir, quality = 'final', onStatus = () => {}}) {
  return queued(async () => {
    const P = normalize(project);
    const outFile = outName(outDir, P.name, quality);
    const r = await render(P, {outFile, quality, ctx: {outDir: path.dirname(outDir), uploadDir}, onStatus});
    fs.writeFileSync(outFile.replace(/\.mp4$/, '.montage.json'), JSON.stringify(P, null, 1));
    return {...r, project: outFile.replace(/\.mp4$/, '.montage.json')};
  });
}

// автомонтаж: opts: clips[], music?, duration, style, title, subtitle, items[], cta, captions, language, pace, aspect, music_start, quality, outDir, onStatus
export function montage(opts) {
  return queued(async () => {
    const note = opts.onStatus || (() => {});
    const t0 = Date.now();
    await tools(note);
    if (!opts.clips?.length) throw new Error('нет клипов');
    const root = path.dirname(opts.outDir);   // outputs (кэш анализа — outputs/.montage-cache)
    const warnings = [];
    note('Смотрю клипы…');
    const clips = [];
    for (const file of opts.clips) {
      const i = await info(file).catch(() => null);
      if (!i?.video || i.duration < 0.5) { warnings.push(`пропущен ${path.basename(file)}: не видео`); continue; }
      clips.push({file, ...i});
    }
    if (!clips.length) throw new Error('ни один файл не открылся как видео');
    const aspect = ASPECTS[opts.aspect] ? opts.aspect : (clips[0].width > clips[0].height * 1.2 ? '16:9' : clips[0].width > clips[0].height * 0.9 ? '1:1' : '9:16');

    // речь клипов по словам (для субтитров и чтобы не рвать фразы)
    let lang = opts.language && opts.language !== 'auto' ? opts.language : 'auto';
    if (opts.captions !== false || opts.pace === 'speech' || opts.pace === 'auto' || !opts.pace) {
      for (const c of clips) {
        if (!c.audio) continue;
        try {
          const sp = await speech(c.file, root, {lang, note});
          Object.assign(c, {speech: sp.speech, words: sp.words});
          if (sp.speech && lang === 'auto') lang = sp.language;
        } catch (e) { warnings.push(e.message); break; }
      }
    }
    if (opts.captions !== false && !clips.some(c => c.speech)) warnings.push('в клипах нет речи — субтитры не нужны');

    let music = opts.music && fs.existsSync(opts.music) ? opts.music : null, beat = null;
    if (opts.music && !music) warnings.push('трек не найден: ' + opts.music + ' — монтаж без музыки');
    if (music) {
      try { beat = await trackBeats(music, root, note); note(`Темп трека: ${beat.bpm} BPM`); }
      catch (e) { warnings.push(e.message + ' — монтаж без музыки'); music = null; }
    }
    beat ||= gridBeats(120);
    const duration = Math.min(60, Math.max(6, +opts.duration || 20));
    const {project, plan} = toProject(clips, beat, {...opts, music, aspect, duration, pace: opts.pace || 'auto'});
    note(`План: ${plan.segs.length} кусков под бит (${plan.pace}), ${plan.duration.toFixed(1)} с`);
    const used = new Set(plan.segs.map(x => x.clip)), left = clips.filter((_, i) => !used.has(i));
    if (left.length) warnings.push(`не поместились (речь длинная, ролик стал бы больше ${Math.round(Math.max(duration * 1.5, duration + 6))} с): ${left.map(c => path.basename(c.file)).join(', ')}`);

    const quality = opts.quality === 'draft' ? 'draft' : 'final';
    const outFile = outName(opts.outDir, opts.title, quality);
    const r = await render(project, {outFile, quality, ctx: {outDir: root, uploadDir: path.join(root, 'montage-src')}, onStatus: note});
    const projectFile = outFile.replace(/\.mp4$/, '.montage.json');
    fs.writeFileSync(projectFile, JSON.stringify(normalize(project), null, 1));
    return {...r, bpm: beat.bpm, music_start: +plan.start.toFixed(2), pace: plan.pace, style: project.tracks.gfx[0]?.template || 'none',
      captions: project.tracks.captions.words.length, language: lang, project: projectFile,
      clips: plan.segs.map((s, k) => ({clip: path.basename(clips[s.clip].file), from: +s.from.toFixed(2), at: +s.t0.toFixed(2), len: +s.len.toFixed(2),
        transition: project.tracks.video[k + 1]?.transition.type || null})),
      seconds: Math.round((Date.now() - t0) / 1000), warnings};
  });
}

// последние видео из outputs (если клипы не названы)
export function latestVideos(outDir, n = 4) {
  const all = [];
  const walk = (d, depth) => {
    let es = [];
    try { es = fs.readdirSync(d, {withFileTypes: true}); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 2 && !e.name.startsWith('.') && !['split', 'montage-src'].includes(e.name)) walk(p, depth + 1);
      else if (e.isFile() && VIDEO_EXT.test(e.name) && !e.name.startsWith('freefield-montage-')) all.push({p, m: fs.statSync(p).mtimeMs});
    }
  };
  walk(outDir, 0);
  return all.sort((a, b) => b.m - a.m).slice(0, n).map(x => x.p).reverse();
}
