// Рендер проекта montage.json → mp4. Один проход ffmpeg (filter_complex) для картинки, отдельный — для звука:
// звук сводится в wav, громкость меряется и выравнивается до −14 LUFS (два прохода loudnorm), потом картинка + звук → mp4.
// Кодер — NVENC видеокарты, если работает (иначе libx264). quality: draft — 540p, быстро; final — 1080p.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {chromium} from 'playwright-core';
import {run, lastErr} from '../avtools.js';
import {tools, ff, info} from './analyze.js';
import {normalize, sourcePath, ASPECTS} from './project.js';
import {transitionOf, cameraExpr, hasCamera, reframeXY, clipFxFilters, lookChain, SFX} from './fx.js';
import {gfxHtml} from './templates/gfx.js';

const CHROME = process.env.FREEFIELD_CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

// NVENC проверяем один раз: крошечный ролик через h264_nvenc
let nvenc = null;
async function hasNvenc() {
  if (nvenc !== null || process.env.FREEFIELD_NO_NVENC) return nvenc ?? false;
  const t = await tools();
  const r = await run(t.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-']);
  return (nvenc = r.code === 0);
}
const encoder = async q => (await hasNvenc())
  ? ['-c:v', 'h264_nvenc', '-preset', q === 'draft' ? 'p2' : 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', q === 'draft' ? '30' : '19', '-b:v', '0', '-profile:v', 'high', '-bf', '2']
  : ['-c:v', 'libx264', '-preset', q === 'draft' ? 'veryfast' : 'medium', '-crf', q === 'draft' ? '28' : '19', '-profile:v', 'high'];

/* ---------- раскладка: клипы на шкале, дыры — чёрным, перекрытия без перехода — склейкой ---------- */
async function layout(P, ctx) {
  const segs = [];
  let cursor = 0;
  for (const [i, c] of P.tracks.video.entries()) {
    const file = sourcePath(c.src, ctx);
    const fi = await info(file);
    if (!fi.video && !fi.image) throw new Error(`клип ${i + 1} — не видео: ${path.basename(file)}`);
    const srcLen = fi.image ? 3600 : fi.duration;
    const inn = Math.min(c.in, Math.max(0, srcLen - 0.1));
    const out = Math.min(c.out ?? (fi.image ? inn + 3 : srcLen), srcLen);   // фото без конца — 3 с
    const len = Math.max(0.1, (out - inn) / c.speed);
    const at = c.at ?? cursor;
    if (c.fx.ramp?.length && !fi.image) {
      // speed ramp: длина на шкале та же, что без него; кусок режется на участки со своей скоростью (склейкой, без перехода)
      const marks = [{at: 0, speed: c.speed}, ...c.fx.ramp.filter(k => k.at > 0 && k.at < len)];
      let p = inn;
      for (const [j, m] of marks.entries()) {
        const t0 = m.at, t1 = marks[j + 1]?.at ?? len, take = Math.min((t1 - t0) * m.speed, Math.max(0.04, srcLen - p));
        const shift = p => p - t0;
        segs.push({...c, i, file, fi, in: p, out: p + take, speed: m.speed, len: t1 - t0, at: at + t0, srcLen,
          transition: j ? {type: 'cut', duration: 0} : c.transition,
          fx: {...c.fx, punch: c.fx.punch.map(shift).filter(x => x >= 0 && x < t1 - t0), freeze: (c.fx.freeze || []).map(shift).filter(x => x >= 0 && x < t1 - t0),
            reframe: c.fx.reframe?.length ? c.fx.reframe.map(([t, x, y]) => [t - t0, x, y]) : c.fx.reframe}});
        p = Math.min(srcLen - 0.04, p + take);
      }
    } else segs.push({...c, i, file, fi, in: inn, out, len, at, srcLen});
    cursor = at + len;
  }
  segs.sort((a, b) => a.at - b.at);
  // линейная шкала: перекрытие без перехода — предыдущий режется; дыра — чёрный кусок
  const lin = [];
  for (const s of segs) {
    const prev = lin[lin.length - 1];
    if (prev) {
      const gap = s.at - (prev.at + prev.len);
      // маленький зазор перед переходом — не чёрная дыра, а встык (иначе переход молча стал бы склейкой через чёрное)
      if (gap > 0.04 && gap < 0.35 && s.transition?.type && s.transition.type !== 'cut') s.at = prev.at + prev.len;
      else if (gap > 0.04) lin.push({black: true, at: prev.at + prev.len, len: gap, transition: {type: 'cut'}});
      else if (gap < -0.04) { prev.len = Math.max(0.1, s.at - prev.at); }
      else s.at = prev.at + prev.len;   // встык
    } else if (s.at > 0.04) lin.push({black: true, at: 0, len: s.at, transition: {type: 'cut'}});
    lin.push(s);
  }
  // переходы: шов в начале куска; нужен запас d/2 у предыдущего после шва и у этого — до шва
  for (const [k, s] of lin.entries()) {
    const t = k ? transitionOf(s.black || lin[k - 1].black ? {type: 'cut'} : s.transition) : {xfade: null, d: 0};
    s.tr = t.xfade ? {...t, d: Math.min(t.d, s.len / 2, lin[k - 1].len / 2)} : t;
    s.pre = s.tr.d / 2;
    if (k) lin[k - 1].post = s.tr.d / 2;
  }
  for (const s of lin) s.post ||= 0;
  const end = lin.length ? lin[lin.length - 1].at + lin[lin.length - 1].len : 0;
  return {lin, end};
}

/* ---------- графика и субтитры: HTML → прозрачные PNG по кадрам ---------- */
async function renderGfx(dir, cfg, note) {
  if (!CHROME) throw new Error('для титров и субтитров нужен Chrome или Edge на компьютере');
  fs.mkdirSync(dir, {recursive: true});
  const browser = await chromium.launch({executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--force-device-scale-factor=1']});
  try {
    const page = await browser.newPage({viewport: {width: cfg.W, height: cfg.H}, deviceScaleFactor: 1});
    await page.setContent(gfxHtml(), {waitUntil: 'load', timeout: 30000}).catch(() => {});
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 6000))]));
    await page.evaluate(c => window.SETUP(c), cfg);
    const n = Math.ceil(cfg.duration * cfg.fps);
    const blank = path.join(dir, 'blank.png');
    let prevKey = null, prevFile = null, shots = 0;
    for (let f = 0; f < n; f++) {
      const {key, empty} = await page.evaluate(t => ({key: window.FRAME(t), empty: window.EMPTY()}), f / cfg.fps);
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

/* ---------- звук: клипы (с переходами как у картинки) + дорожки audio → wav → −14 LUFS ---------- */
async function renderAudio(P, L, D, work, ctx, note) {
  const args = [], fc = [];
  let n = 0;
  const input = (...a) => { args.push(...a); return n++; };
  // звук клипов — та же цепочка швов, что у картинки
  let acc = null;
  for (const [k, s] of L.lin.entries()) {
    const total = s.pre + s.len + s.post;
    let lbl;
    if (s.black || s.mute || !s.fi?.audio || s.fi?.image) {
      const i = input('-f', 'lavfi', '-t', total.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
      lbl = `[${i}:a]`;
    } else {
      const from = Math.max(0, s.in - s.pre * s.speed), lead = Math.max(0, s.pre - s.in / s.speed);
      const i = input('-ss', from.toFixed(3), '-t', ((total - lead) * s.speed + 0.1).toFixed(3), '-i', s.file);
      const tempo = [];
      for (let x = s.speed; x > 2.0001 || x < 0.4999;) { const f = x > 2 ? 2 : 0.5; tempo.push(`atempo=${f}`); x /= f; }
      const rest = s.speed / tempo.reduce((m, t) => m * +t.split('=')[1], 1);
      if (Math.abs(rest - 1) > 1e-3) tempo.push(`atempo=${rest.toFixed(4)}`);
      fc.push(`[${i}:a]${s.fx?.reverse ? 'areverse,' : ''}asetpts=PTS-STARTPTS,${tempo.length ? tempo.join(',') + ',' : ''}aresample=48000,aformat=channel_layouts=stereo,volume=${s.volume},` +
        `${lead > 0 ? `adelay=${Math.round(lead * 1000)}:all=1,` : ''}apad,atrim=duration=${total.toFixed(3)}[ca${k}]`);
      lbl = `[ca${k}]`;
    }
    if (acc === null) acc = lbl;
    else if (!s.tr.xfade) { fc.push(`${acc}${lbl}concat=n=2:v=0:a=1[cj${k}]`); acc = `[cj${k}]`; }
    else {
      const off = s.at - s.tr.d / 2;
      fc.push(`${acc}atrim=duration=${(off + s.tr.d).toFixed(3)}[ct${k}];[ct${k}]${lbl}acrossfade=d=${s.tr.d.toFixed(3)}:c1=tri:c2=tri[cj${k}]`);
      acc = `[cj${k}]`;
    }
  }
  if (acc === null) { const i = input('-f', 'lavfi', '-t', D.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'); acc = `[${i}:a]`; }
  fc.push(`${acc}apad,atrim=duration=${D.toFixed(3)}[clip]`);
  // дорожки audio
  const music = [], voices = ['[clip]'];
  for (const [k, a] of P.tracks.audio.entries()) {
    const file = sourcePath(a.src, ctx);
    const fi = await info(file);
    if (!fi.audio) continue;
    const out = Math.min(a.out ?? fi.duration, fi.duration), len = Math.max(0, Math.min(out - a.in, D - a.at));
    if (len <= 0.05) continue;
    const i = input('-ss', a.in.toFixed(3), '-t', len.toFixed(3), '-i', file);
    const fo = Math.min(a.fade_out, len), fi2 = Math.min(a.fade_in, len);
    fc.push(`[${i}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${a.volume}` +
      `${fi2 ? `,afade=t=in:d=${fi2.toFixed(3)}` : ''}${fo ? `,afade=t=out:st=${(len - fo).toFixed(3)}:d=${fo.toFixed(3)}` : ''}` +
      `,adelay=${Math.round(a.at * 1000)}:all=1,apad,atrim=duration=${D.toFixed(3)}[au${k}]`);
    (a.role === 'voice' ? voices : music).push({lbl: `[au${k}]`, duck: a.duck});
  }
  // речь (клипы + озвучка) → музыка с duck уступает ей; без речи музыка как есть
  // речь есть: субтитры по словам, озвучка или отметка проекта (клипы с речью без субтитров)
  const speechy = P.audio_mix.speech || P.tracks.captions.words.length > 0 || P.tracks.audio.some(a => a.role === 'voice');
  const vlist = voices.map(v => typeof v === 'string' ? v : v.lbl);
  const parts = [];
  if (vlist.length > 1) fc.push(`${vlist.join('')}amix=inputs=${vlist.length}:duration=first:normalize=0[voice]`); else fc.push(`${vlist[0]}anull[voice]`);
  const ducked = music.filter(m => m.duck && speechy), plain = music.filter(m => !(m.duck && speechy));
  if (ducked.length) {
    fc.push(`[voice]asplit=2[voice1][sc]`);
    fc.push(`${ducked.map(m => m.lbl).join('')}${ducked.length > 1 ? `amix=inputs=${ducked.length}:normalize=0,` : ''}volume=0.55[mu];[mu][sc]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[mud]`);
    parts.push('[voice1]', '[mud]');
  } else parts.push('[voice]');
  parts.push(...plain.map(m => m.lbl));
  // звуковые удары (этап 3): свист на переходах, удар на сильных долях клипов, нарастание перед дропом
  if (P.sfx) {
    const ev = {whoosh: [], hit: [], riser: []};
    for (const [k, s] of L.lin.entries()) {
      if (k && !s.black && P.sfx.transitions && s.transition?.type !== 'cut') ev.whoosh.push(s.at - 0.28);
      if (!s.black && P.sfx.hits) for (const p of s.fx?.punch || []) if (p > 0.05 || !k) ev.hit.push(s.at + p);
    }
    if (P.sfx.riser && P.music?.drop) ev.riser.push(P.music.drop - SFX.riser.d);
    const sl = [];
    for (const [name, times] of Object.entries(ev)) {
      const ts = times.filter(t => t >= 0 && t < D - 0.1).slice(0, 60);
      if (!ts.length) continue;
      const i = input('-f', 'lavfi', '-i', SFX[name].src);
      fc.push(`[${i}:a]${SFX[name].af},aformat=channel_layouts=stereo,volume=${P.sfx.volume},asplit=${ts.length}${ts.map((_, j) => `[x${name}${j}]`).join('')}`);
      ts.forEach((t, j) => { fc.push(`[x${name}${j}]adelay=${Math.round(t * 1000)}:all=1,apad,atrim=duration=${D.toFixed(3)}[y${name}${j}]`); sl.push(`[y${name}${j}]`); });
    }
    if (sl.length) { fc.push(`${sl.join('')}amix=inputs=${sl.length}:duration=first:normalize=0[sfx]`); parts.push('[sfx]'); }
  }
  fc.push(`${parts.join('')}amix=inputs=${parts.length}:duration=first:normalize=0,afade=t=out:st=${Math.max(0, D - 0.6).toFixed(3)}:d=0.6[mix]`);
  const mix = path.join(work, 'mix.wav');
  note('Свожу звук…');
  await ff([...args, '-filter_complex', fc.join(';'), '-map', '[mix]', '-c:a', 'pcm_s16le', '-ar', '48000', mix], 'сведение звука');
  // громкость: замер → точная поправка (loudnorm в два прохода)
  const t = await tools();
  const target = P.audio_mix.loudness;
  const m = await run(t.ffmpeg, ['-hide_banner', '-i', mix, '-af', `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-']);
  const js = /\{[\s\S]*"input_i"[\s\S]*?\}/.exec(m.tail)?.[0];
  const meas = js ? JSON.parse(js) : null;
  const out = path.join(work, 'mix-norm.wav');
  if (meas && Number.isFinite(+meas.input_i) && +meas.input_i > -70) {
    await ff(['-i', mix, '-af', `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true,aresample=48000`,
      '-c:a', 'pcm_s16le', out], 'громкость');
    const chk = await run(t.ffmpeg, ['-hide_banner', '-i', out, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-']);
    const lufs = +(/I:\s+(-?[\d.]+) LUFS/.exec(chk.tail.split('Summary:').pop())?.[1]);
    return {file: out, lufs: Number.isFinite(lufs) ? lufs : null};
  }
  return {file: mix, lufs: null};   // тишина — выравнивать нечего
}

/* ---------- главное ---------- */
// project — montage.json; ctx: {outDir, uploadDir}; quality: draft | final
export async function render(project, {outFile, quality = 'final', ctx, onStatus: note = () => {}, keep = false}) {
  const t0 = Date.now();
  await tools(note);
  const P = normalize(project);
  const work = path.join(ctx.outDir, '.montage-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(work, {recursive: true});
  try {
    let [W, H] = ASPECTS[P.aspect];
    if (quality === 'draft') { W = Math.round(W / 2 / 2) * 2; H = Math.round(H / 2 / 2) * 2; }
    const fps = P.fps;
    note('Раскладываю клипы на шкале…');
    const L = await layout(P, ctx);
    const D = Math.max(0.5, P.duration ?? Math.max(L.end, ...P.tracks.text.map(x => x.at + x.duration), ...P.tracks.photo.map(x => x.at + x.duration)));

    // ---- картинка ----
    const args = [], fc = [];
    let n = 0;
    const input = (...a) => { args.push(...a); return n++; };
    const zoomScale = quality === 'final' ? 2 : 1;   // zoompan дрожит меньше, если считать на увеличенном кадре
    let acc = null;
    for (const [k, s] of L.lin.entries()) {
      const total = s.pre + s.len + s.post;
      let chain;
      if (s.black) {
        const i = input('-f', 'lavfi', '-t', total.toFixed(3), '-i', `color=c=black:s=${W}x${H}:r=${fps}`);
        chain = `[${i}:v]format=yuv420p,setsar=1,settb=AVTB`;
      } else {
        const from = s.fi.image ? 0 : Math.max(0, s.in - s.pre * s.speed);
        const lead = s.fi.image ? 0 : Math.max(0, s.pre - s.in / s.speed);   // не хватило кадров до начала — первый кадр стоит
        const i = s.fi.image ? input('-loop', '1', '-t', total.toFixed(3), '-i', s.file)
          : input('-ss', from.toFixed(3), '-t', ((total - lead) * s.speed + 0.2).toFixed(3), '-i', s.file);
        // кадр другой формы: окно кадрирования едет по ключам fx.reframe (этап 2); время потока здесь — до tpad начала
        const rf = s.fx.reframe?.length ? reframeXY(s.fx.reframe, s.pre - lead) : null;
        const fit = (w, h) => P.fit === 'contain'
          ? `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`
          : `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}:x=${rf ? `'${rf.x}'` : '(iw-ow)/2'}:y=${rf ? `'${rf.y}'` : '(ih-oh)/2'}`;
        const z = hasCamera(s.fx);
        const steps = [];
        if (s.fx.reverse) steps.push('reverse');
        steps.push(`setpts=(PTS-STARTPTS)/${s.speed}`);
        // плавное слоумо: недостающие кадры досчитываются по движению (черновик — смешиванием, быстрее)
        if (s.fx.smooth && s.speed < 1) steps.push(`minterpolate=fps=${fps}:mi_mode=${quality === 'final' ? 'mci:mc_mode=aobmc:me_mode=bidir' : 'blend'}`);
        steps.push(`fps=${fps}`);
        steps.push(z ? fit(W * zoomScale, H * zoomScale) : fit(W, H));
        steps.push('setsar=1');
        if (lead > 0) steps.push(`tpad=start_mode=clone:start_duration=${lead.toFixed(3)}`);
        if (z) { const c = cameraExpr(s.fx, {fps, pre: s.pre, len: s.len}); steps.push(`zoompan=z='${c.z}':d=1:x='${c.x}':y='${c.y}':s=${W}x${H}:fps=${fps}`); }
        steps.push(...clipFxFilters(s.fx, {pre: s.pre, fps}));
        steps.push(`tpad=stop_mode=clone:stop_duration=${total.toFixed(3)}`, `trim=duration=${total.toFixed(3)}`, 'setpts=PTS-STARTPTS', 'format=yuv420p', 'settb=AVTB');   // одна шкала времени у всех кусков — иначе xfade после concat не соединяет
        chain = `[${i}:v]${steps.join(',')}`;
      }
      fc.push(`${chain}[s${k}]`);
      if (acc === null) acc = `[s${k}]`;
      else if (!s.tr.xfade) { fc.push(`${acc}[s${k}]concat=n=2:v=1:a=0,settb=AVTB[j${k}]`); acc = `[j${k}]`; }
      else { fc.push(`${acc}[s${k}]xfade=transition=${s.tr.xfade}:duration=${s.tr.d.toFixed(3)}:offset=${(s.at - s.tr.d / 2).toFixed(3)}[j${k}]`); acc = `[j${k}]`; }
    }
    if (acc === null) { const i = input('-f', 'lavfi', '-t', D.toFixed(3), '-i', `color=c=black:s=${W}x${H}:r=${fps}`); acc = `[${i}:v]`; }
    fc.push(`${acc}tpad=stop_mode=add:stop_duration=${D.toFixed(3)}:color=black,trim=duration=${D.toFixed(3)},setpts=PTS-STARTPTS[base]`);
    let v = '[base]';
    // цвет и атмосфера всего ролика (этап 3) — до графики, чтобы титры остались чистыми
    if (P.look && (P.look.preset !== 'none' || P.look.vignette || P.look.grain || P.look.letterbox)) { fc.push(...lookChain(P.look, v, '[looked]')); v = '[looked]'; }
    // фото поверх
    for (const [k, ph] of P.tracks.photo.entries()) {
      const i = input('-loop', '1', '-t', ph.duration.toFixed(3), '-i', sourcePath(ph.src, ctx));
      const full = ph.pos === 'full', bw = Math.round(W * (full ? 1 : ph.scale) / 2) * 2, bh = Math.round(H * (full ? 1 : ph.scale) / 2) * 2, m = Math.round(Math.min(W, H) * 0.04);
      const xy = {full: ['0', '0'], center: ['(W-w)/2', '(H-h)/2'], tl: [m, m], tr: [`W-w-${m}`, m], bl: [m, `H-h-${m}`], br: [`W-w-${m}`, `H-h-${m}`]}[ph.pos];
      fc.push(`[${i}:v]scale=${bw}:${bh}:force_original_aspect_ratio=${full ? 'increase' : 'decrease'},${full ? `crop=${W}:${H},` : ''}format=rgba,` +
        `fade=t=in:d=0.25:alpha=1,fade=t=out:st=${Math.max(0, ph.duration - 0.25).toFixed(3)}:d=0.25:alpha=1,setpts=PTS-STARTPTS+${ph.at.toFixed(3)}/TB[ph${k}]`);
      fc.push(`${v}[ph${k}]overlay=x=${xy[0]}:y=${xy[1]}:eof_action=pass:enable='between(t,${ph.at.toFixed(3)},${(ph.at + ph.duration).toFixed(3)})'[pv${k}]`);
      v = `[pv${k}]`;
    }
    // графика, титры, субтитры
    const g0 = P.tracks.gfx[0];
    const cfg = {W, H, fps, duration: D, style: g0?.template || 'none', title: g0?.props.title || '', subtitle: g0?.props.subtitle || '', items: g0?.props.items || [],
      cta: g0?.props.cta || '', captions: P.tracks.captions.words.length > 0, words: P.tracks.captions.words, beats: P.music?.beats || [], texts: P.tracks.text};
    let g = null;
    if (cfg.captions || cfg.texts.length || (cfg.style !== 'none' && (cfg.title || cfg.cta || cfg.items.length))) {
      g = await renderGfx(path.join(work, 'gfx'), cfg, note);
      const i = input('-framerate', String(fps), '-i', path.join(work, 'gfx', 'g%05d.png'));
      fc.push(`${v}[${i}:v]overlay=format=auto:eof_action=pass[gv]`);
      v = '[gv]';
    }
    fc.push(`${v}fade=t=out:st=${Math.max(0, D - 0.6).toFixed(3)}:d=0.6,format=yuv420p[vout]`);

    // ---- звук ----
    const A = await renderAudio(P, L, D, work, ctx, note);
    const ai = input('-i', A.file);

    note(`Собираю ролик (${quality === 'draft' ? 'черновик 540p' : `${W}×${H}`}${await hasNvenc() ? ', видеокарта' : ''})…`);
    fs.mkdirSync(path.dirname(outFile), {recursive: true});
    await ff(['-stats', ...args, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', `${ai}:a`, '-t', D.toFixed(3),
      ...await encoder(quality), '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', quality === 'draft' ? '128k' : '192k', '-movflags', '+faststart', outFile],
      'рендер', l => { const m = /time=(\d+):(\d+):([\d.]+)/.exec(l); if (m) note(`Рендер: ${Math.min(100, Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) / D * 100))} %`); });
    const fin = await info(outFile);
    return {path: outFile, mime: 'video/mp4', width: W, height: H, aspect: P.aspect, quality, duration: +fin.duration.toFixed(2), lufs: A.lufs,
      encoder: await hasNvenc() ? 'h264_nvenc' : 'libx264', cuts: L.lin.filter(s => !s.black).length, gfx_frames: g?.frames || 0, gfx_shots: g?.shots || 0,
      seconds: Math.round((Date.now() - t0) / 1000)};
  } finally {
    if (!keep && !process.env.FREEFIELD_MONTAGE_KEEP) fs.rmSync(work, {recursive: true, force: true});
  }
}
