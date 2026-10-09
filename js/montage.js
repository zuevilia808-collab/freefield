'use strict';
/* ---- «Монтаж»: видео из галереи → один длинный ролик (пользователь 2026-10-08: «складывать видео из галереи в один проект
   для создания длинного видео из видео по 10 секунд»). Проект — порядок клипов, обрезка, переходы, титры; хранится
   в localStorage (только ссылки на видео галереи). Склейка — здесь, в браузере (WebCodecs через Mediabunny): видео никуда не уходят ---- */
const MT_TR = [['cut', '✂', 'Склейка'], ['fade', '◐', 'Плавно'], ['black', '●', 'Через чёрное']];
const MT_POS = [['top', 'Сверху'], ['center', 'Центр'], ['bottom', 'Снизу']];
const MT_ASPECT = [['auto', 'Как у видео'], ['9:16', '9:16'], ['16:9', '16:9'], ['1:1', '1:1']];
const mt = {
  projects: ls.get('freefield.mt.projects', []),
  cur: ls.get('freefield.mt.cur', null),
  tab: ls.get('freefield.mt.tab', 'edit'),   // «🎞 Монтаж» или «✦ ИИ-монтажёр»
  job: null,                                 // идёт склейка: {pct, text, stop}
  busy: false,                               // ИИ думает
  get p() { return this.projects.find(p => p.id === this.cur) || this.projects[0] || null; },
  // запись в localStorage — не на каждое движение: раз в 300 мс (и сразу, когда вкладку закрывают)
  save() {
    const p = this.p;
    if (p) p.updated = Date.now();
    clearTimeout(this.wT); this.wT = setTimeout(() => this.flush(), 300);
  },
  flush() {
    clearTimeout(this.wT); this.wT = 0;
    ls.set('freefield.mt.projects', this.projects); ls.set('freefield.mt.cur', this.p?.id || null); ls.set('freefield.mt.tab', this.tab);
  },
};
addEventListener('pagehide', () => mt.wT && mt.flush());
document.addEventListener('visibilitychange', () => document.hidden && mt.wT && mt.flush());
function mtNew(name) {
  const p = {id: uid(), name: name || `Проект ${mt.projects.length + 1}`, aspect: 'auto', fit: 'cover', audio: true, clips: [], titles: [], chat: [], created: Date.now()};
  mt.projects.unshift(p); mt.cur = p.id; mt.save();
  return p;
}
const mtProj = () => mt.p || mtNew();
const mtItem = c => items.find(x => x.id === c.id && x.type === 'video' && x.blob);
const mtLen = it => it?._dur || it?.duration || 10;   // _dur — настоящая длина файла (узнаём, когда берём кадр)
const mtFmt = s => { s = Math.max(0, s || 0); return s < 59.95 ? `${String(Math.round(s * 10) / 10).replace('.', ',')} с` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const mtClock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const clamp01 = x => Math.max(0, Math.min(1, x));

// Таймлайн: клипы друг за другом; «Плавно» — наплыв (клипы перекрываются), «Через чёрное» — затемнение и появление
function mtSegs(p = mt.p) {
  const segs = [];
  let t = 0;
  for (const c of p?.clips || []) {
    const it = mtItem(c);
    if (!it) continue;
    const full = mtLen(it), a = Math.min(Math.max(0, c.a || 0), Math.max(0, full - 0.3));
    const b = Math.max(a + 0.3, Math.min(c.b ?? full, full)), len = b - a, prev = segs.at(-1);
    const kind = prev ? c.tr || 'cut' : 'cut', d = kind === 'cut' ? 0 : Math.min(c.td || 0.6, len / 2, prev.len / 2);
    const start = kind === 'fade' ? t - d : t;
    const s = {c, it, a, b, len, start, end: start + len, inK: kind, inD: d, outK: 'cut', outD: 0, n: segs.length + 1};
    if (prev && kind !== 'cut') { prev.outK = kind; prev.outD = d; }
    segs.push(s);
    t = s.end;
  }
  return segs;
}
const mtTotal = segs => segs.length ? segs.at(-1).end : 0;
const mtOn = (s, T) => T >= s.start - 1e-6 && T < s.end - 1e-6;
// как клип выглядит в момент T: прозрачность (наплыв), затемнение (через чёрное) и громкость
function mtLook(s, T) {
  const u = T - s.start, v = s.end - T;
  let alpha = 1, dim = 0, gain = 1;
  if (s.inK !== 'cut' && u < s.inD) { gain = u / s.inD; if (s.inK === 'fade') alpha = u / s.inD; else dim = 1 - u / s.inD; }
  if (s.outK !== 'cut' && v < s.outD) { gain = Math.min(gain, v / s.outD); if (s.outK === 'black') dim = Math.max(dim, 1 - v / s.outD); }
  return {alpha: clamp01(alpha), dim: clamp01(dim), gain: clamp01(gain)};
}
// размер готового ролика: формат проекта (или первого клипа), короткая сторона — как у самого чёткого клипа, но не больше 1080
function mtOutDims(p = mt.p, segs = mtSegs(p)) {
  const it0 = segs[0]?.it;
  const r = p?.aspect && p.aspect !== 'auto' ? (([a, b]) => a / b)(p.aspect.split(':').map(Number)) : it0 ? (it0.w || 9) / (it0.h || 16) : 9 / 16;
  const short = Math.min(1080, Math.max(360, ...segs.map(s => Math.min(s.it.w || 720, s.it.h || 1280))));
  const ev = x => Math.max(2, Math.round(x / 2) * 2);
  return r < 1 ? [ev(short), ev(short / r)] : [ev(short * r), ev(short)];
}
// титры: по центру, белым с обводкой; в предпросмотре и в готовом ролике рисуются одинаково
function mtDrawTitles(ctx, W, H, titles, T) {
  for (const t of titles || []) {
    const text = String(t.text || '').trim(), u = T - (t.at || 0), v = (t.at || 0) + (t.dur || 3) - T;
    if (!text || u < 0 || v <= 0) continue;
    const fs = Math.round(Math.min(W, H) * 0.062), lh = fs * 1.2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, u / 0.3, v / 0.3);
    ctx.font = `800 ${fs}px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const lines = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const w of para.split(/\s+/)) {
        const tryL = line ? line + ' ' + w : w;
        if (line && ctx.measureText(tryL).width > W * 0.86) { lines.push(line); line = w; } else line = tryL;
      }
      lines.push(line);
    }
    const bh = lh * lines.length, top = t.pos === 'top' ? H * 0.12 : t.pos === 'center' ? (H - bh) / 2 : H * 0.8 - bh;
    ctx.lineWidth = fs * 0.18; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.fillStyle = '#fff';
    lines.forEach((l, i) => { const y = top + lh * (i + 0.5); ctx.strokeText(l, W / 2, y); ctx.fillText(l, W / 2, y); });
    ctx.restore();
  }
}

/* ---- фото поверх видео (пользователь 2026-10-08: «возможность наложения фотографий на видео») ---- */
const MT_PH_POS = [['full', 'Весь кадр'], ['center', 'Центр'], ['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']];
const mtImgs = new Map();   // id картинки галереи → <img>, готовая к рисованию в просмотре
function mtImg(id) {
  if (!mtImgs.has(id)) {
    const it = items.find(x => x.id === id && x.blob), img = it ? new Image() : null;
    if (img) { img.onload = () => { img._ok = true; if (cl.mode === 'edit') mtShow(mtPv.t); }; img.src = urlOf(it.blob); }
    mtImgs.set(id, img);
  }
  const im = mtImgs.get(id);
  return im?._ok ? im : null;
}
function mtPhotoBox(o, W, H, iw, ih) {
  if (o.pos === 'full') { const k = Math.max(W / iw, H / ih); return [(W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k]; }
  const side = Math.min(W, H) * (o.size ?? 0.6), k = side / Math.max(iw, ih), w = iw * k, h = ih * k, m = Math.min(W, H) * 0.04;
  const x = /l$/.test(o.pos) ? m : /r$/.test(o.pos) ? W - w - m : (W - w) / 2;
  const y = /^t/.test(o.pos) ? m : /^b/.test(o.pos) ? H - h - m : (H - h) / 2;
  return [x, y, w, h];
}
function mtDrawPhotos(ctx, W, H, photos, T, get = mtImg) {
  for (const o of photos || []) {
    const u = T - (o.at || 0), v = (o.at || 0) + (o.dur || 3) - T;
    if (u < 0 || v <= 0) continue;
    const img = get(o.id);
    if (!img) continue;
    const f = o.fade ?? 0.3, [x, y, w, h] = mtPhotoBox(o, W, H, img.naturalWidth || img.width, img.naturalHeight || img.height);
    ctx.save();
    ctx.globalAlpha = (o.opacity ?? 1) * Math.min(1, f ? u / f : 1, f ? v / f : 1);
    if (o.pos !== 'full') { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = Math.min(W, H) * 0.025; }
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }
}

// кадр из середины клипа: миниатюра на таймлайне и «глаза» ИИ-монтажёра. По одному видео за раз — не перегружать браузер
const mtThumbs = new Map();
let mtThumbQ = Promise.resolve();
function mtThumb(it) {
  if (!mtThumbs.has(it.id)) mtThumbs.set(it.id, mtThumbQ = mtThumbQ.then(() => new Promise(res => {
    const v = document.createElement('video');
    let over = false;
    const done = d => { if (over) return; over = true; clearTimeout(tm); v.removeAttribute('src'); v.load(); res(d); };
    const tm = setTimeout(() => done(null), 15000);
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadedmetadata = () => { if (v.duration && isFinite(v.duration)) it._dur = Math.round(v.duration * 100) / 100; v.currentTime = Math.min((v.duration || 1) / 2, 4); };
    v.onseeked = () => {
      const k = 256 / Math.max(v.videoWidth || 1, v.videoHeight || 1), c = document.createElement('canvas');
      c.width = Math.max(2, Math.round(v.videoWidth * k)); c.height = Math.max(2, Math.round(v.videoHeight * k));
      // короткий адрес blob: вместо base64 — таймлайн не разбирает сотни килобайт текста при каждой перерисовке
      try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); c.toBlob(b => done(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.8); } catch { done(null); }
    };
    v.onerror = () => done(null);
    v.src = urlOf(it.blob);
  })));
  return mtThumbs.get(it.id);
}
function mtFillThumbs(root) {
  root?.querySelectorAll('img[data-mt-thumb]:not([src])').forEach(img => {
    const it = items.find(x => x.id === img.dataset.mtThumb);
    if (!it?.blob) return;
    if (it.posterBlob) img.src = urlOf(it.posterBlob);
    mtThumb(it).then(d => {
      if (d && !it.posterBlob) img.src = d;
      // настоящая длина файла не та, что записана, — таймлайн пересчитать (один раз на видео)
      if (it._dur && !it._durSeen) { it._durSeen = true; if (Math.abs(it._dur - (it.duration || 0)) > 0.05 && mt.p?.clips.some(c => c.id === it.id)) mtRefresh(); }
    });
  });
}

/* ---- предпросмотр: два слоя <video> (для наплыва), затемнение и титры поверх; часы — свои, видео подстраиваются.
   Без лагов (пользователь 2026-10-09: «чтобы там ничего не лагало»): элементы сцены и её размер запоминаются (не читаем
   разметку в каждом кадре), стили пишутся, только когда меняются, холст рисуется, только когда на нём что-то есть,
   видео догоняют часы скоростью, а не перемоткой; звук дорожек — Web Audio по расписанию ---- */
const mtPv = {t: 0, playing: false, raf: 0, last: 0, segs: [], drawn: false, cw: 0, ch: 0, pps: 0};
const mtEl = {stage: $('#mtStage'), vids: [...$$('#mtStage video')], dim: $('#mtStage .mt-dim'), cv: $('#mtStage canvas'), time: $('#mtTime'), play: $('#mtWork [data-mt-play]'), head: $('#mtHeadLine'), sc: $('#mtScroll')};
const mtSet = (el, k, v) => { const o = el._st ||= {}; if (o[k] !== v) { o[k] = v; el.style[k] = v; } };
const mtTxt = (el, v) => { if (el && el._tx !== v) { el._tx = v; el.textContent = v; } };
if ('ResizeObserver' in window) new ResizeObserver(() => {
  const dpr = Math.min(2, devicePixelRatio || 1);
  mtPv.cw = Math.round(mtEl.stage.clientWidth * dpr); mtPv.ch = Math.round(mtEl.stage.clientHeight * dpr);
  mtPv.drawn = true;   // холст изменил размер — перерисовать
  if (cl.mode === 'edit' && !mtPv.playing) mtShow(mtPv.t);
}).observe(mtEl.stage);
function mtPvSync() {
  mtPv.segs = mtSegs();
  mtPv.t = Math.min(mtPv.t, mtTotal(mtPv.segs));
  if (mtAE.on) mtAE.plan();
  mtShow(mtPv.t);
}
const mtVisual = (p, T) => [...(p?.titles || []), ...(p?.photos || [])].some(x => T >= (x.at || 0) && T < (x.at || 0) + (x.dur || 3));
function mtShow(T) {
  const stage = mtEl.stage;
  if (!stage?.isConnected) return;
  const p = mt.p, segs = mtPv.segs, total = mtTotal(segs), vids = mtEl.vids, pps = mtPv.pps || mtPps();
  // при просмотре бегунок не уходит за край таймлайна (читаем прокрутку до записи стилей — без лишнего пересчёта)
  const sc = mtEl.sc, x = T * pps;
  if (mtPv.playing && sc && (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 30)) sc.scrollLeft = Math.max(0, x - 40);
  stage.classList.toggle('empty', !segs.length);
  let vis = segs.filter(s => mtOn(s, T));
  if (!vis.length && segs.length && T >= total) vis = [segs.at(-1)];   // конец — последний кадр
  const next = segs.find(s => s.start > T && s.start - T < 1.5 && !vis.includes(s));   // следующий — загружаем заранее
  const want = [...vis, ...(next ? [next] : [])], use = new Map();
  for (const s of want) { const v = vids.find(v => v._seg?.c === s.c && !use.has(v)); if (v) use.set(v, s); }
  for (const s of want) {
    if ([...use.values()].includes(s)) continue;
    const v = vids.find(v => !use.has(v));
    if (!v) break;
    use.set(v, s);
    const url = urlOf(s.it.blob);
    if (v._url !== url) { v._url = url; v.src = url; }
    v.currentTime = s.a;
  }
  let dim = 0;
  for (const v of vids) {
    const s = use.get(v);
    v._seg = s || null;
    mtSet(v, 'objectFit', p?.fit === 'contain' ? 'contain' : 'cover');
    if (!s) { mtSet(v, 'opacity', '0'); if (!v.paused) v.pause(); continue; }
    const on = vis.includes(s), loc = Math.min(s.b, s.a + Math.max(0, T - s.start)), look = on ? mtLook(s, Math.min(T, s.end - 1e-3)) : {alpha: 0, dim: 0, gain: 0};
    mtSet(v, 'opacity', String(look.alpha)); mtSet(v, 'zIndex', String(on ? 1 + vis.indexOf(s) : 0));
    // отделённый голос и фон звучат через Web Audio — у самого видео звук выключен
    const mute = !p?.audio || !!s.c.mute || !!s.c.sep;
    if (v.muted !== mute) v.muted = mute;
    const vol = Math.min(1, look.gain * (s.c.vol ?? 1));
    if (Math.abs(v.volume - vol) > 0.01) v.volume = vol;
    if (on) dim = Math.max(dim, look.dim);
    if (on && mtPv.playing && T < total) {
      const drift = v.currentTime - loc;
      if (Math.abs(drift) > 0.5) v.currentTime = loc;   // далеко — перемотка; близко — догоняем скоростью (без рывков)
      const rate = Math.abs(drift) > 0.05 ? (drift > 0 ? 0.94 : 1.06) : 1;
      if (v.playbackRate !== rate) v.playbackRate = rate;
      if (v.paused) v.play().catch(() => {});
    } else {
      if (!v.paused) v.pause();
      if (v.playbackRate !== 1) v.playbackRate = 1;
      const want = on ? loc : s.a;
      if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want;
    }
  }
  mtSet(mtEl.dim, 'opacity', String(dim));
  // титры и фото: холст трогаем, только когда на нём что-то есть (или надо стереть)
  const draw = mtVisual(p, T);
  if (draw || mtPv.drawn) {
    const cv = mtEl.cv, cw = mtPv.cw || cv.width, chh = mtPv.ch || cv.height;
    if (cv.width !== cw || cv.height !== chh) { cv.width = cw; cv.height = chh; }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cw, chh);
    if (draw) { mtDrawPhotos(ctx, cw, chh, p?.photos, T); mtDrawTitles(ctx, cw, chh, p?.titles, T); }
    mtPv.drawn = draw;
  }
  mtTxt(mtEl.time, `${mtClock(T)}.${Math.floor((T % 1) * 10)} / ${mtClock(total)}`);
  mtTxt(mtEl.play, mtPv.playing ? '⏸' : '▶');
  mtHead();
}
function mtTick(now) {
  mtPv.raf = 0;
  if (!mtPv.playing || !mtEl.stage.isConnected || cl.mode !== 'edit') return mtPause();
  const dt = Math.min(0.25, (now - mtPv.last) / 1000);
  mtPv.last = now;
  // видео ещё грузится — часы и звук ждут его
  const waiting = mtEl.vids.some(v => v._seg && mtOn(v._seg, mtPv.t) && v.readyState < 3);
  // часы идут за видео, которое сейчас на экране (пользователь 2026-10-09: «видео в монтаже фризит»): раньше, если страница
  // на миг задумывалась, часы отставали, и видео отматывалось назад — замирало и прыгало; без видео (фото, звук) — свои часы
  if (!waiting) {
    const lead = mtEl.vids.filter(v => v._seg && mtOn(v._seg, mtPv.t) && !v.paused && !v.seeking).sort((a, b) => b._seg.start - a._seg.start)[0];
    const vt = lead ? lead._seg.start + lead.currentTime - lead._seg.a : NaN;
    mtPv.t = vt > mtPv.t - 0.3 && vt <= lead._seg.end + 0.05 ? Math.max(mtPv.t, vt) : mtPv.t + dt;
  }
  mtAE.hold(waiting);
  const total = mtTotal(mtPv.segs);
  if (mtPv.t >= total) { mtPv.t = total; mtPv.playing = false; }
  else if (!waiting && mtAE.drift() > 0.12) mtAE.plan();   // звук разошёлся с часами — поставить заново
  mtShow(mtPv.t);
  if (mtPv.playing) mtPv.raf = requestAnimationFrame(mtTick);
  else mtAE.stop();
}
function mtPlay() {
  if (!mtPv.segs.length && !mt.p?.audios?.length) return;
  if (mtPv.t >= mtTotal(mtPv.segs) - 0.05) mtPv.t = 0;
  mtPv.playing = true; mtPv.last = performance.now();
  mtAE.start();
  if (!mtPv.raf) mtPv.raf = requestAnimationFrame(mtTick);
  mtShow(mtPv.t);
}
function mtPause() {
  mtPv.playing = false;
  if (mtPv.raf) cancelAnimationFrame(mtPv.raf);
  mtPv.raf = 0;
  mtEl.vids.forEach(v => v.pause());
  mtAE.stop();
  mtShow(mtPv.t);
}
const mtSeekTo = T => { mtPv.t = Math.max(0, Math.min(T, mtTotal(mtPv.segs))); if (mtAE.on) mtAE.plan(); mtShow(mtPv.t); };

/* ---- звук, кроме звука самих видео: дорожка «🎵», фон и голос клипов с отделённым голосом. Один список — и для просмотра
   (AudioContext), и для склейки (OfflineAudioContext): что слышно здесь, то и будет в ролике ---- */
const mtSepSrc = (id, w) => `vsplit-${id}-${w}`;
function mtSounds(p, segs) {
  const out = [];
  for (const a of p.audios || []) out.push({src: a.src, when: a.at, off: a.a || 0, dur: mtALen(a), vol: a.vol ?? 1, fi: a.fadeIn || 0, fo: a.fadeOut || 0});
  for (const s of segs) {
    const c = s.c;
    if (!c.sep || !p.audio || c.mute) continue;
    out.push({src: mtSepSrc(c.id, 'rest'), when: s.start, off: s.a, dur: s.len, vol: c.vol ?? 1, seg: s});
    const v = c.vox || {}, w = mtVoxWin(c, s);
    if (w) out.push({src: w.src, fx: v.fx, when: w.when, off: w.off, dur: w.dur, vol: v.vol ?? 1, seg: s});
  }
  return out;
}
// где на таймлайне звучит голос клипа: исходный (время файла = время видео) или новая озвучка (с начала реплики)
function mtVoxWin(c, s) {
  const t = c.vox?.take, at = t ? t.at : 0, src = t ? t.src : mtSepSrc(c.id, 'voice'), len = t ? t.dur : Infinity;
  const from = Math.max(s.a, at), to = Math.min(s.b, at + len);
  return to - from > 0.02 ? {src, when: s.start + (from - s.a), off: from - at, dur: to - from, at} : null;
}
function mtGainAt(x, T) {
  if (x.seg) return mtLook(x.seg, Math.min(T, x.seg.end - 1e-3)).gain * x.vol;
  const u = T - x.when, v = x.when + x.dur - T;
  return x.vol * Math.max(0, Math.min(1, x.fi ? u / x.fi : 1, x.fo ? v / x.fo : 1));
}
const mtBps = x => (x.seg ? [x.seg.start, x.seg.start + x.seg.inD, x.seg.end - x.seg.outD, x.seg.end] : [x.when, x.when + x.fi, x.when + x.dur - x.fo, x.when + x.dur]).sort((a, b) => a - b);
// поставить звуки с момента T0 (часы ctx: c0) — громкость, нарастания и переходы — автоматикой Web Audio
function mtSchedule(ctx, list, T0, c0, bufOf) {
  const nodes = [];
  for (const x of list) {
    const end = x.when + x.dur;
    if (end <= T0 + 1e-3) continue;
    const buf = bufOf(x);
    if (!buf) continue;
    const t0 = Math.max(T0, x.when), off = x.off + (t0 - x.when), dur = Math.min(end - t0, buf.duration - off);
    if (dur <= 0.01) continue;
    const src = ctx.createBufferSource(), g = ctx.createGain(), at = c0 + (t0 - T0);
    src.buffer = buf; src.connect(g).connect(ctx.destination);
    g.gain.setValueAtTime(mtGainAt(x, t0), at);
    for (const bp of mtBps(x)) if (bp > t0 + 1e-4 && bp <= end + 1e-4) g.gain.linearRampToValueAtTime(mtGainAt(x, Math.min(bp, end - 1e-3)), c0 + bp - T0);
    src.start(at, off, dur);
    nodes.push(src);
  }
  return nodes;
}
// звук готовится заранее и хранится декодированным: файл → AudioBuffer, голос с эффектами — отдельно (последние 3 варианта)
const mtBufs = new Map(), mtBufOk = new Map(), mtFxKeys = new Map();
function mtBufGet(key, make) {
  if (!mtBufs.has(key)) mtBufs.set(key, make().catch(() => null).then(b => {
    if (mtBufs.has(key)) mtBufOk.set(key, b);
    if (mtAE.on) mtAE.plan();
    return b;
  }));
  return mtBufs.get(key);
}
const mtSrcP = src => mtBufGet(src, async () => { const c = await mtAudGet(src); return c ? decodeAudio(c.blob) : null; });
const mtBufKey = x => vfxIsDef(x.fx) ? x.src : x.src + '|' + vfxKey(x.fx);
function mtFxP(src, fx) {
  if (vfxIsDef(fx)) return mtSrcP(src);
  const key = src + '|' + vfxKey(fx), ks = (mtFxKeys.get(src) || []).filter(k => k !== key);
  ks.push(key);
  while (ks.length > 3) { const k = ks.shift(); mtBufs.delete(k); mtBufOk.delete(k); }
  mtFxKeys.set(src, ks);
  return mtBufGet(key, async () => { const b = await mtSrcP(src); return b && vfxRender(b, fx); });
}
function mtBufFor(x) {
  const k = mtBufKey(x);
  if (mtBufOk.has(k)) return mtBufOk.get(k);
  mtFxP(x.src, x.fx);
  return null;
}
const mtAE = {
  ctx: null, nodes: [], T0: 0, c0: 0, on: false,
  start() {
    try { this.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    this.ctx.resume?.().catch(() => {});
    this.on = true; this.plan();
  },
  plan(T = mtPv.t) {
    if (!this.on) return;
    this.stopNodes();
    const p = mt.p;
    this.T0 = T; this.c0 = this.ctx.currentTime + 0.03;
    this.nodes = p ? mtSchedule(this.ctx, mtSounds(p, mtPv.segs), T, this.c0, mtBufFor) : [];
  },
  // насколько звук разошёлся с часами просмотра
  drift() { return this.on && this.ctx.state === 'running' ? Math.abs(this.T0 + Math.max(0, this.ctx.currentTime - this.c0) - mtPv.t) : 0; },
  hold(w) {   // видео грузится — звук на паузе (только тот, что сами остановили)
    if (!this.on || !!w === !!this.held) return;
    this.held = !!w;
    if (w) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().then(() => this.on && !this.held && this.plan()).catch(() => {});
  },
  stopNodes() { this.nodes.forEach(n => { try { n.stop(); n.disconnect(); } catch {} }); this.nodes = []; },
  stop() {
    this.stopNodes(); this.on = false;
    if (this.held) { this.held = false; this.ctx.resume().catch(() => {}); }
  },
};

/* ---- «Монтаж»: просмотр и таймлайн (пользователь 2026-10-08: «должен быть таймлайн, все дела»; «прямо в монтаже —
   музыка, переходы, обрезать, разрезать, укоротить»). Дорожки: видео (клипы друг за другом — тянуть края: обрезать;
   ✂ — разрезать по бегунку; ◆ между клипами — переход), титры, звук (музыка из файла, озвучка «Эхо»).
   На ПК — справа вместо галереи, на телефоне — в самой вкладке. Звук дорожки хранится в базе галереи (в галерее не виден) ---- */
const MTW = $('#mtWork');
mt.sel = null;   // выделено на таймлайне: {t: 'v' | 't' | 'a', k}
mt.zoom = ls.get('freefield.mt.zoom', null);   // пикселей на секунду; null — уместить весь ролик
const mtALen = a => Math.max(0.3, (a.b ?? a.dur ?? 1) - (a.a || 0));
const mtTEnd = p => Math.max(mtTotal(mtSegs(p)), ...[...(p.titles || []), ...(p.photos || [])].map(t => (t.at || 0) + (t.dur || 3)), ...(p.audios || []).map(a => a.at + mtALen(a)), 0);
function mtPps() {
  if (mt.zoom) return mt.zoom;
  const w = ($('#mtScroll')?.clientWidth || 600) - 24;
  return Math.max(4, Math.min(240, w / Math.max(8, mtTEnd(mt.p) + 1)));
}
const mtSel = () => { const p = mt.p, s = mt.sel; if (!p || !s) return null;
  return s.t === 'v' || s.t === 'g' ? p.clips.find(c => c.k === s.k) : s.t === 't' ? p.titles?.find(x => x.k === s.k) : s.t === 'p' ? p.photos?.find(x => x.k === s.k) : p.audios?.find(x => x.k === s.k); };
// дорожки по рядам: что перекрывается по времени — на соседний ряд
function mtLanes(list, len) {
  const ends = [];
  return list.map(x => { const at = x.at || 0; let i = ends.findIndex(e => e <= at + 1e-3); if (i < 0) i = ends.length; ends[i] = at + len(x); return i; });
}
const mtThumbUrl = new Map();
// дорожка без пересборки: блоки — по ключу, у каждого меняются только изменившиеся атрибуты
function mtPatch(box, rows) {
  const old = new Map();
  for (const e of [...box.children]) if (e._k) old.set(e._k, e); else e.remove();
  for (const r of rows) {
    let el = old.get(r.key);
    if (el) old.delete(r.key);
    else { el = document.createElement(r.tag || 'div'); el._k = r.key; el._a = {}; box.append(el); }
    for (const [k, v] of Object.entries(r.a)) if (el._a[k] !== v) { el._a[k] = v; if (k === 'html') el.innerHTML = v; else el.setAttribute(k, v); }
  }
  old.forEach(e => e.remove());
}
// волна звука — картинкой один раз на файл (фон блока сдвигается под обрезку)
const mtWaves = new Map();
function mtWave(src) {
  if (!mtWaves.has(src)) {
    mtWaves.set(src, null);
    mtSrcP(src).then(b => {
      if (!b) return;
      const W = Math.min(4000, Math.max(200, Math.round(b.duration * 60))), H = 40, c = document.createElement('canvas'), d = b.getChannelData(0), step = Math.max(1, Math.floor(d.length / W));
      c.width = W; c.height = H;
      const g = c.getContext('2d'), pk = [];
      for (let i = 0; i < W; i++) { let m = 0; for (let j = i * step, e = Math.min(d.length, j + step); j < e; j += 4) m = Math.max(m, Math.abs(d[j])); pk.push(m); }
      const top = Math.max(...pk, 0.01);
      g.fillStyle = 'rgba(255,255,255,.55)';
      pk.forEach((v, i) => { const h = Math.max(1, v / top * (H - 4)); g.fillRect(i, (H - h) / 2, 1, h); });
      c.toBlob(bl => { if (bl) { mtWaves.set(src, {url: URL.createObjectURL(bl), dur: b.duration}); mtTl(); } });
    });
  }
  return mtWaves.get(src);
}
const mtWaveCss = (src, off, pps) => { const w = mtWave(src); return w ? `--wv:url(${w.url});--wx:${-off * pps}px;--ww:${w.dur * pps}px;` : ''; };
function mtTl() {
  const p = mt.p, inner = $('#mtInner');
  if (!p || !inner) return;
  const segs = mtPv.segs, pps = mtPv.pps = mtPps(), end = mtTEnd(p) + 4, sel = mt.sel;
  inner.style.width = Math.max((mtEl.sc.clientWidth || 0) - 2, Math.ceil(end * pps)) + 'px';
  // линейка — только когда сменились масштаб или длина; шаг подписей — чтобы не налезали
  const rk = pps + '|' + Math.ceil(end);
  if (mtTl.rk !== rk) {
    mtTl.rk = rk;
    const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find(s => s * pps >= 56) || 600;
    let rl = '';
    for (let t = 0; t <= end; t += step) rl += `<i style="left:${t * pps}px">${mtClock(t)}</i>`;
    $('#mtRuler').innerHTML = rl;
  }
  // видео
  const drag = mtDrag?.kind === 'v' && mtDrag.moved && mtDrag.mode === 'move' ? mtDrag : null;
  mtPatch($('#mtTrV'), [...segs.map(s => {
    const c = s.c, it = s.it, th = mtThumbUrl.get(it.id) || (it.posterBlob ? urlOf(it.posterBlob) : '');
    if (!mtThumbUrl.has(it.id) && !it.posterBlob) { mtThumbUrl.set(it.id, ''); mtThumb(it).then(d => { if (d) { mtThumbUrl.set(it.id, d); mtTl(); } }); }
    const left = drag?.k === c.k ? drag.ghost * pps : s.start * pps;
    return {key: 'v' + c.k, a: {class: `tl-b v ${sel?.k === c.k && sel.t === 'v' ? 'sel' : ''} ${drag?.k === c.k ? 'drag' : ''}`, 'data-tl': 'v', 'data-k': c.k,
      style: `left:${left}px;width:${Math.max(6, s.len * pps)}px;${th ? `--th:url(${th})` : ''}`, title: it.prompt || '',
      html: `<i class="tl-h l" data-h="l"></i><span>#${s.n} · ${mtFmt(s.len)}${c.mute ? ' 🔇' : c.sep ? ' 🗣' : ''}</span><i class="tl-h r" data-h="r"></i>`}};
  }), ...segs.slice(1).map(s => {   // ◆ переход между клипами: нажать — следующий вид (склейка → плавно → через чёрное)
    const x = s.inK === 'fade' ? s.start + s.inD / 2 : s.start, tr = MT_TR.find(t => t[0] === (s.c.tr || 'cut'));
    return {key: 'x' + s.c.k, tag: 'button', a: {class: `tl-x ${s.inK}`, 'data-tlx': s.c.k, style: `left:${x * pps}px`, title: `Переход: ${tr[2]} — нажмите, чтобы сменить`, html: tr[1]}};
  }), ...(drag ? [{key: 'ins', tag: 'i', a: {class: 'tl-ins', style: `left:${drag.insX * pps}px`}}] : []),
  ...(segs.length ? [] : [{key: 'empty', tag: 'button', a: {class: 'tl-empty', 'data-mt-add': '', html: '＋ Видео из галереи'}}])]);
  // 🗣 голос клипов, у которых он отделён: блок идёт за клипом (обрезка, перестановка, ✂)
  const gs = segs.filter(s => s.c.sep), box = $('#mtWork .mtw-tl');
  box.classList.toggle('g', gs.length > 0);
  mtPatch($('#mtTrG'), gs.map(s => {
    const c = s.c, w = mtVoxWin(c, s), t = c.vox?.take;
    const left = w ? w.when : s.start, len = w ? w.dur : s.len, fx = !vfxIsDef(c.vox?.fx);
    return {key: 'g' + c.k, a: {class: `tl-b g ${sel?.k === c.k && sel.t === 'g' ? 'sel' : ''} ${t ? 'new' : ''}`, 'data-tl': 'g', 'data-k': c.k,
      style: `left:${left * pps}px;width:${Math.max(6, len * pps)}px;${w ? mtWaveCss(w.src, w.off, pps) : ''}`, title: t ? t.name : 'Голос из ролика',
      html: `<span data-noicon>🗣 #${s.n}${t ? (t.kind === 'vc' ? ' · 🎧 ' : ' · 🎙 ') + esc(t.name) : ''}${fx ? ' ✨' : ''}${(c.vox?.vol ?? 1) === 0 ? ' 🔇' : ''}</span>`}};
  }));
  // фото, титры и звук — по рядам
  const ph = p.photos || [], pLane = mtLanes(ph, x => x.dur || 3), rows = l => Math.max(1, ...l.map(i => i + 1));
  $('#mtTrP').style.setProperty('--rows', rows(pLane));
  mtPatch($('#mtTrP'), ph.map((o, i) => { const it = items.find(x => x.id === o.id);
    return {key: 'p' + o.k, a: {class: `tl-b p ${sel?.k === o.k ? 'sel' : ''}`, 'data-tl': 'p', 'data-k': o.k, title: it?.prompt || 'фото',
      style: `left:${(o.at || 0) * pps}px;width:${Math.max(6, (o.dur || 3) * pps)}px;--row:${pLane[i]};${it?.blob ? `--th:url(${mtThumbUrl.get(it.id) || urlOf(it.blob)})` : ''}`,
      html: `<i class="tl-h l" data-h="l"></i><span>🖼 ${esc(MT_PH_POS.find(x => x[0] === o.pos)?.[1] || '')}</span><i class="tl-h r" data-h="r"></i>`}}; }));
  const tl = p.titles || [], tLane = mtLanes(tl, t => t.dur || 3), au = p.audios || [], aLane = mtLanes(au, mtALen);
  box.style.setProperty('--rp', rows(pLane)); box.style.setProperty('--rt', rows(tLane)); box.style.setProperty('--ra', rows(aLane));   // подписи дорожек — той же высоты
  $('#mtTrT').style.setProperty('--rows', rows(tLane));
  mtPatch($('#mtTrT'), tl.map((t, i) => ({key: 't' + t.k, a: {class: `tl-b t ${sel?.k === t.k ? 'sel' : ''}`, 'data-tl': 't', 'data-k': t.k, title: t.text || '',
    style: `left:${(t.at || 0) * pps}px;width:${Math.max(6, (t.dur || 3) * pps)}px;--row:${tLane[i]}`,
    html: `<i class="tl-h l" data-h="l"></i><span data-noicon>${esc(t.text || 'Титр')}</span><i class="tl-h r" data-h="r"></i>`}})));
  $('#mtTrA').style.setProperty('--rows', rows(aLane));
  mtPatch($('#mtTrA'), au.map((a, i) => ({key: 'a' + a.k, a: {class: `tl-b a ${sel?.k === a.k ? 'sel' : ''}`, 'data-tl': 'a', 'data-k': a.k, title: a.name || '',
    style: `left:${a.at * pps}px;width:${Math.max(6, mtALen(a) * pps)}px;--row:${aLane[i]};${mtWaveCss(a.src, a.a || 0, pps)}`,
    html: `<i class="tl-h l" data-h="l"></i><span data-noicon>${a.voice ? '🎙' : '🎵'} ${esc(a.name)}</span><i class="tl-h r" data-h="r"></i>`}})));
  mtHead();
}
const mtHead = () => mtSet(mtEl.head, 'left', mtPv.t * (mtPv.pps || mtPps()) + 'px');

/* ---- перетаскивание на таймлайне: края — обрезать, середина — переставить (видео) или сдвинуть (титры, звук); пусто — бегунок.
   На телефоне: первое касание выделяет, тянуть — следующим (иначе таймлайн не прокрутить пальцем) ---- */
let mtDrag = null;
const mtSnap = (T, pps, except) => {   // прилипание к бегунку, началу, стыкам клипов, краям титров и звука
  const p = mt.p, pts = [0, mtPv.t, ...mtPv.segs.flatMap(s => [s.start, s.end]), ...[...(p.titles || []), ...(p.photos || [])].filter(x => x.k !== except).flatMap(x => [x.at, x.at + x.dur]),
    ...(p.audios || []).filter(x => x.k !== except).flatMap(x => [x.at, x.at + mtALen(x)])];
  let best = T, d = 8 / pps;
  for (const x of pts) if (Math.abs(x - T) < d) { d = Math.abs(x - T); best = x; }
  return best;
};
function mtTlDown(e) {
  if (e.button > 0 || e.target.closest('.tl-x, .tl-empty')) return;
  const inner = $('#mtInner'), pps = mtPps(), r = inner.getBoundingClientRect(), T = Math.max(0, (e.clientX - r.left) / pps);
  const blk = e.target.closest('.tl-b'), h = e.target.closest('.tl-h');
  if (!blk) {
    if (e.target.closest('.mtw-ruler') || e.pointerType !== 'touch') { if (!e.target.closest('.mtw-ruler')) mt.sel = null; mtDrag = {mode: 'seek'}; mtSeekTo(T); renderMtEdit(); mtTl(); }
    else return;
  } else {
    const kind = blk.dataset.tl, k = blk.dataset.k, was = mt.sel?.k === k && mt.sel?.t === kind;
    mt.sel = {t: kind, k};
    if (kind === 'g') { mtSeekTo(T); renderMtEdit(); return mtTl(); }   // голос идёт за клипом — только выделить
    const o = mtSel();
    if (e.pointerType === 'touch' && !was && !h) { renderMtEdit(); return mtTl(); }
    mtDrag = {mode: h ? 'trim-' + h.dataset.h : 'move', kind, k, x0: e.clientX, T0: T, o0: JSON.parse(JSON.stringify(o)), moved: false};
    if (kind === 'v') { const s = mtPv.segs.find(s => s.c.k === k); mtDrag.full = mtLen(s.it); mtDrag.s0 = {start: s.start, len: s.len}; }
    renderMtEdit();
  }
  try { inner.setPointerCapture(e.pointerId); } catch { /* касание уже кончилось */ }
  e.preventDefault();
}
// движения мыши копятся, обрабатывается последнее — один раз за кадр (а не на каждое событие)
let mtMoveEv = null, mtMoveRaf = 0;
function mtTlMove(e) {
  if (!mtDrag) return;
  mtMoveEv = e;
  if (!mtMoveRaf) mtMoveRaf = requestAnimationFrame(() => { mtMoveRaf = 0; const ev = mtMoveEv; mtMoveEv = null; if (ev && mtDrag) mtTlMove1(ev); });
}
function mtTlMove1(e) {
  const g = mtDrag;
  if (!g) return;
  const pps = mtPps(), r = $('#mtInner').getBoundingClientRect(), T = Math.max(0, (e.clientX - r.left) / pps);
  if (g.mode === 'seek') { if (mtPv.playing) mtPause(); return mtSeekTo(T); }
  if (!g.moved && Math.abs(e.clientX - g.x0) < 4) return;
  g.moved = true;
  const dx = (e.clientX - g.x0) / pps, o = mtSel(), z = g.o0;
  if (!o) return;
  if (g.kind === 'v') {
    const full = g.full, b0 = z.b ?? full;
    if (g.mode === 'trim-l') o.a = Math.round(Math.min(Math.max(0, (z.a || 0) + dx), b0 - 0.3) * 20) / 20;
    else if (g.mode === 'trim-r') { const b = Math.round(Math.min(full, Math.max((z.a || 0) + 0.3, b0 + dx)) * 20) / 20; o.b = b >= full - 0.05 ? null : b; }
    else {   // переставить: куда встанет — по середине соседних клипов
      g.ghost = Math.max(0, g.s0.start + dx);
      const mid = g.ghost + g.s0.len / 2, others = mtPv.segs.filter(s => s.c.k !== g.k);
      const idx = others.filter(s => s.start + s.len / 2 < mid).length;
      g.to = idx; g.insX = idx < others.length ? others[idx].start : others.length ? others.at(-1).end : 0;
      return mtTl();
    }
    mtPvSync();
    const s = mtPv.segs.find(s => s.c.k === g.k);
    if (s) mtSeekTo(g.mode === 'trim-l' ? s.start : s.end - 0.04);
  } else if (g.kind === 't' || g.kind === 'p') {
    if (g.mode === 'move') o.at = Math.max(0, mtSnap(z.at + dx, pps, o.k));
    else if (g.mode === 'trim-r') o.dur = Math.max(0.5, mtSnap(z.at + z.dur + dx, pps, o.k) - z.at);
    else { const at = Math.min(z.at + z.dur - 0.5, Math.max(0, mtSnap(z.at + dx, pps, o.k))); o.dur = z.dur - (at - z.at); o.at = at; }
    o.at = Math.round(o.at * 20) / 20; o.dur = Math.round(o.dur * 20) / 20;
    mtShow(mtPv.t);
  } else {
    const dur = o.dur ?? 1, b0 = z.b ?? dur;
    if (g.mode === 'move') o.at = Math.max(0, mtSnap(z.at + dx, pps, o.k));
    else if (g.mode === 'trim-r') { const b = Math.min(dur, Math.max(z.a + 0.3, mtSnap(z.at + (b0 - z.a) + dx, pps, o.k) - z.at + z.a)); o.b = b >= dur - 0.05 ? null : b; }
    else { const da = Math.min(b0 - 0.3 - z.a, Math.max(-z.a, -z.at, mtSnap(z.at + dx, pps, o.k) - z.at)); o.a = z.a + da; o.at = z.at + da; }
    o.at = Math.round(o.at * 20) / 20;
  }
  mtTl();
}
function mtTlUp() {
  if (mtMoveEv && mtDrag) mtTlMove1(mtMoveEv);   // последнее движение — не теряем
  mtMoveEv = null;
  const g = mtDrag;
  mtDrag = null;
  if (!g || g.mode === 'seek') return;
  const p = mt.p;
  if (g.moved && g.kind === 'v' && g.mode === 'move' && g.to != null) {
    const i = p.clips.findIndex(c => c.k === g.k), [c] = p.clips.splice(i, 1);
    // место среди видимых клипов → место в списке проекта
    const vis = mtSegs(p).map(s => s.c), before = vis[g.to];
    p.clips.splice(before ? p.clips.indexOf(before) : p.clips.length, 0, c);
  }
  if (!g.moved && g.kind === 'v') mtSeekTo(g.T0);
  if (g.moved) { mt.save(); updateGenButton(); }
  mtPvSync(); mtTl(); renderMtEdit();
}

/* ---- правка: разрезать по бегунку, удалить, дублировать, переход ---- */
function mtSplit() {
  const p = mt.p, T = mtPv.t, s0 = mtSel();
  if (s0 && (mt.sel.t === 't' || mt.sel.t === 'p') && T > s0.at + 0.2 && T < s0.at + s0.dur - 0.2) {
    const list = mt.sel.t === 't' ? p.titles : p.photos;
    list.splice(list.indexOf(s0) + 1, 0, {...s0, k: uid(), at: T, dur: s0.at + s0.dur - T}); s0.dur = T - s0.at;
  } else if (s0 && mt.sel.t === 'a' && T > s0.at + 0.2 && T < s0.at + mtALen(s0) - 0.2) {
    const cut = s0.a + (T - s0.at);
    p.audios.splice(p.audios.indexOf(s0) + 1, 0, {...s0, k: uid(), at: T, a: cut, fadeIn: 0}); s0.b = cut; s0.fadeOut = 0;
  } else {
    const s = [...mtPv.segs].reverse().find(s => T >= s.start && T < s.end);
    if (!s) return toast('Поставьте бегунок на клип', {type: 'err'});
    const cut = Math.round((s.a + (T - s.start)) * 100) / 100;
    if (cut - s.a < 0.3 || s.b - cut < 0.3) return toast('Слишком близко к краю клипа', {type: 'err'});
    const c = s.c, c2 = {...c, k: uid(), a: cut, tr: 'cut', ...(c.vox && {vox: structuredClone(c.vox)})};
    c.b = cut;
    p.clips.splice(p.clips.indexOf(c) + 1, 0, c2);
    mt.sel = {t: 'v', k: c2.k};
  }
  mt.save(); mtRefresh();
}
function mtDelSel() {
  const p = mt.p, s = mt.sel;
  if (!s) return;
  if (s.t === 'g') {   // голос не удаляется, а затихает — вернуть ползунком «Голос»
    const c = mtSel();
    if (c) { (c.vox ||= {}).vol = 0; mt.save(); mtRefresh(); }
    return toast('🗣 Голос клипа выключен — вернуть: ползунок «Голос» в свойствах', {type: 'ok'});
  }
  if (s.t === 'v') p.clips = p.clips.filter(c => c.k !== s.k);
  else if (s.t === 't') p.titles = p.titles.filter(x => x.k !== s.k);
  else if (s.t === 'p') p.photos = p.photos.filter(x => x.k !== s.k);
  else p.audios = p.audios.filter(x => x.k !== s.k);
  mt.sel = null; mt.save(); mtRefresh();
}
function mtDup() {
  const p = mt.p, s = mt.sel, o = mtSel();
  if (!o) return;
  if (s.t === 'v' || s.t === 'g') { const c = {...o, k: uid(), tr: 'cut', ...(o.vox && {vox: structuredClone(o.vox)})}; p.clips.splice(p.clips.indexOf(o) + 1, 0, c); mt.sel = {t: 'v', k: c.k}; }
  else if (s.t === 't' || s.t === 'p') { const t = {...o, k: uid(), at: o.at + o.dur}; (s.t === 't' ? p.titles : p.photos).push(t); mt.sel = {t: s.t, k: t.k}; }
  else { const a = {...o, k: uid(), at: o.at + mtALen(o)}; p.audios.push(a); mt.sel = {t: 'a', k: a.k}; }
  mt.save(); mtRefresh();
}

/* ---- звук на дорожке: музыка из файла, озвучка «Эхо». Файл — в базе галереи (в галерее не виден), в проекте — ссылка ---- */
const mtAud = new Map();   // src → {blob, url}
async function mtAudGet(src) {
  if (!mtAud.has(src)) {
    const rec = await DB.req('readonly', s => s.get(src)).catch(() => null);
    mtAud.set(src, rec?.blob ? {blob: rec.blob, url: urlOf(rec.blob)} : null);
  }
  return mtAud.get(src);
}
async function mtAddAudio(blob, name, o = {}) {
  let buf;
  try { buf = await decodeAudio(blob); } catch { return toast(`«${name}»: не получилось прочитать звук`, {type: 'err'}); }
  const p = mtProj(), src = 'mtaud-' + uid(), dur = buf.duration;
  await DB.put({id: src, kind: 'mt-audio', blob, name, dur, createdAt: Date.now()});
  mtAud.set(src, {blob, url: urlOf(blob)});
  mtBufs.set(src, Promise.resolve(buf)); mtBufOk.set(src, buf);   // уже декодирован — просмотру не надо снова
  const a = {k: uid(), src, name: String(name).slice(0, 80), dur: Math.round(dur * 100) / 100, at: Math.round((o.at ?? mtPv.t) * 20) / 20, a: 0, b: null,
    vol: o.vol ?? 1, fadeIn: o.fadeIn ?? 0, fadeOut: o.fadeOut ?? 0, ...(o.voice && {voice: true})};
  (p.audios ||= []).push(a);
  mt.sel = {t: 'a', k: a.k};
  mt.save(); mtRefresh();
  return a;
}
async function mtAudioFile() {
  const fs = await pickFile('audio/*,video/*', true);
  for (const f of fs || []) await mtAddAudio(f, f.name.replace(/\.\w+$/, ''), {at: (mt.p.audios || []).length ? mtPv.t : 0, vol: 0.7, fadeOut: 1.5});
}
async function mtAudioEcho() {
  await echoEnsure();
  const lan = eh.state === 'nohub' && !hubLink.local() && ls.get('freefield.pcLan', null);
  if (eh.state !== 'ok') return toast(eh.state === 'old' ? 'Программа Freefield на компьютере старая — обновите её (вкладка «Озвучка»)' : eh.state === 'nohub' ? 'Озвучка «Эхо» — с программой Freefield на компьютере' : eh.err || '«Эхо» не запустилось', {type: 'err', ms: 8000,
    ...(lan && {action: '🎙 Открыть с компьютера', onAction: () => pcLanOpen('edit')})});
  try { mtPick.takes = await echoApi('/history'); } catch (e) { return toast(e.message, {type: 'err'}); }
  mtOpenPick('echo');
}
// громкость звука дорожки в момент T: громкость × нарастание × затухание
function mtAudGain(a, T) {
  const u = T - a.at, v = a.at + mtALen(a) - T;
  return (a.vol ?? 1) * Math.min(1, a.fadeIn ? u / a.fadeIn : 1, a.fadeOut ? v / a.fadeOut : 1);
}

/* ---- панель «Монтаж»: проект, вкладки, свойства выделенного на таймлайне, формат ---- */
function renderMt() {
  const root = $('#mtCreate');
  if (!root) return;
  const p = mtProj();
  p.titles ||= []; p.audios ||= []; p.photos ||= [];
  if (!$('#mtHead')) root.innerHTML = `<div class="mt-proj" id="mtHead"></div><div id="mtSlot"></div>
      <div class="seg mt-tabs"><button data-mt-tab="edit">🎞 Монтаж</button><button data-mt-tab="chat">✦ ИИ-монтажёр</button></div>
      <div id="mtProg"></div><div id="mtBody"></div>`;
  $('#mtHead').innerHTML = `<select data-mt-proj aria-label="Проект">${mt.projects.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="__new">＋ Новый проект</option></select>
    <button class="icon-btn" data-mt-rename title="Переименовать">✎</button><button class="icon-btn" data-mt-del title="Удалить проект (видео в галерее останутся)">🗑</button>`;
  workMount();
  const [W, H] = mtOutDims(p);
  $('#mtStage').style.setProperty('--r', W / H);
  $$('#mtCreate [data-mt-tab]').forEach(b => b.classList.toggle('on', b.dataset.mtTab === mt.tab));
  renderMtProg();
  if (mt.tab === 'chat') renderMtChat(); else renderMtEdit();
  mtPvSync();
  mtTl();
  $('#mtZoom').value = mtZoomVal();
}
function renderMtProg() {
  const el = $('#mtProg');
  if (el) el.innerHTML = mt.job ? `<div class="mt-prog"><div class="mt-bar"><i style="width:${Math.round(mt.job.pct * 100)}%"></i></div><span>${esc(mt.job.text)}</span><button class="btn small" data-mt-stop>Отменить</button></div>` : '';
}
/* ---- 🗣 голос клипа (пользователь 2026-10-09: «от видеоряда отделяется только голос аватара, остальная дорожка остаётся;
   голосу — много параметров, чтобы он не был похож; перенести его в „Озвучку“, она распознаёт реплику, выбираю голос — и обратно
   в монтаж»). Отделяет программа Freefield на компьютере (Demucs) — один раз на видео; фон остаётся звуком клипа ---- */
mt.sepJob = null;   // идёт отделение: {k, note}
mt.vcChar = null;   // персонаж для «🎧 Голосом персонажа»
const mtFxRng = (k, key, label, min, max, step, val, fmt) => `<div class="mt-fl mt-rng"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" data-mt-f="fx.${key}" data-k="${k}"><b>${fmt(val)}</b></div>`;
const mtFxFmt = {pitch: v => `${v > 0 ? '+' : ''}${v} пт`, formant: v => `${v > 0 ? '+' : ''}${v}%`, low: v => `${v > 0 ? '+' : ''}${v} дБ`, high: v => `${v > 0 ? '+' : ''}${v} дБ`, rasp: v => `${v}%`, room: v => `${v}%`};
function mtVoxHTML(o) {
  const v = o.vox ||= {}, fx = vfxNorm(v.fx), sg = mtPv.segs.find(x => x.c === o), t = v.take, chars = vc.chars.filter(c => c.sample);
  if (!chars.some(c => c.id === mt.vcChar)) mt.vcChar = chars[0]?.id || null;
  const busy = mt.voxJob?.k === o.k;
  return `<div class="block-head"><span class="lbl">🗣 Голос клипа #${sg?.n || '—'}</span></div>
    <div class="mt-sp1" data-noicon>${t ? `${t.kind === 'vc' ? '🎧 Голосом' : '🎙 Озвучка'}: ${esc(t.name)}` : 'Исходный голос из ролика'}</div>
    <div class="mt-fl mt-rng"><span>Голос</span><input type="range" min="0" max="2" step="0.05" value="${v.vol ?? 1}" data-mt-f="vvol" data-k="${o.k}"><b>${Math.round((v.vol ?? 1) * 100)}%</b></div>
    <div class="mt-fl mt-rng"><span>Фон</span><input type="range" min="0" max="1.5" step="0.05" value="${o.vol ?? 1}" data-mt-f="vol" data-k="${o.k}"><b>${Math.round((o.vol ?? 1) * 100)}%</b></div>
    <div class="block-head"><span class="lbl">Изменить голос</span>${vfxIsDef(fx) ? '' : '<button class="link-btn" data-mt-fx-reset>Сбросить</button>'}</div>
    <div class="mt-vp">${VFX_PRESETS.map(([id, name]) => `<button class="chip" data-mt-vp="${id}">${name}</button>`).join('')}</div>
    ${mtFxRng(o.k, 'pitch', 'Высота', -12, 12, 1, fx.pitch, mtFxFmt.pitch)}
    ${mtFxRng(o.k, 'formant', 'Тембр', -30, 30, 1, fx.formant, mtFxFmt.formant)}
    ${mtFxRng(o.k, 'low', 'Низкие', -12, 12, 1, fx.low, mtFxFmt.low)}
    ${mtFxRng(o.k, 'high', 'Высокие', -12, 12, 1, fx.high, mtFxFmt.high)}
    ${mtFxRng(o.k, 'rasp', 'Хрипотца', 0, 100, 5, fx.rasp, mtFxFmt.rasp)}
    ${mtFxRng(o.k, 'room', 'Комната', 0, 100, 5, fx.room, mtFxFmt.room)}
    <div class="seg mt-vk">${VFX_KINDS.map(([k, name]) => `<button data-mt-vk="${k}" class="${fx.kind === k ? 'on' : ''}">${name}</button>`).join('')}</div>
    <div class="mt-fl"><button class="btn small" data-mt-gplay>▶ Послушать клип</button><span class="mt-note" id="mtFxNote"></span></div>
    <p class="hint">Высота и тембр меняются без сдвига по времени — губы совпадают. «Тембр» сильнее всего делает голос непохожим.</p>
    <div class="block-head"><span class="lbl">Другой голос</span></div>
    <div class="mt-fl"><button class="btn small primary" data-mt-to-echo ${busy ? 'disabled' : ''}>🎙 Переозвучить в «Озвучке»</button></div>
    <p class="hint">«Озвучка» распознает реплику — выберите голос, озвучьте и нажмите «→ В монтаж».</p>
    ${chars.length ? `<div class="mt-fl"><select data-mt-vcchar aria-label="Персонаж">${chars.map(c => `<option value="${c.id}" ${c.id === mt.vcChar ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <button class="btn small" data-mt-vc ${busy ? 'disabled' : ''} title="Seed-VC: тот же текст и интонации, голос — как в образце персонажа">🎧 Голосом персонажа</button></div>` : ''}
    ${busy ? `<div class="mt-note" id="mtVoxNote">⏳ ${esc(mt.voxJob.note)}</div>` : ''}
    <div class="mt-fl">${t ? '<button class="btn small" data-mt-vorig>↩ Исходный голос</button>' : ''}<button class="btn small" data-mt-unsep title="Голос и фон — снова одним звуком клипа">Вернуть звук как был</button></div>`;
}
const mtNote = (id, text) => { const el = $('#' + id); if (el) el.textContent = text ? '⏳ ' + text : ''; };
async function mtSep(c) {
  const it = mtItem(c);
  if (!it || mt.sepJob) return;
  const have = async () => !!(await mtAudGet(mtSepSrc(it.id, 'voice'))) && !!(await mtAudGet(mtSepSrc(it.id, 'rest')));
  if (!(await have())) {
    if (!(await canSplit())) return toast('Голос отделяет программа Freefield на компьютере (Demucs, бесплатно) — откройте «Монтаж» на компьютере, где она стоит', {type: 'err', ms: 9000});
    mt.sepJob = {k: c.k, note: 'Достаю звук из ролика…'}; renderMtEdit();
    const note = n => { mt.sepJob.note = n; mtNote('mtSepNote', n); };
    try {
      const ab = await decodeAudio(it.blob);
      note('Компьютер отделяет голос от фона…');
      const r = await hubSplitFiles(wavBlob(await audioMono(ab, 44100)), note);
      for (const w of ['voice', 'rest']) {
        const src = mtSepSrc(it.id, w);
        await DB.put({id: src, kind: 'mt-audio', blob: r[w], name: w === 'voice' ? 'голос' : 'фон', createdAt: Date.now()});
        mtAud.set(src, {blob: r[w], url: urlOf(r[w])});
      }
    } catch (e) { mt.sepJob = null; renderMtEdit(); return toast('Голос не отделился: ' + e.message, {type: 'err', ms: 9000}); }
    mt.sepJob = null;
  }
  // у всех кусков этого видео в проекте (после ✂) — сразу
  for (const x of mt.p.clips) if (x.id === c.id && !x.sep) { x.sep = true; x.vox ||= {vol: 1}; }
  mt.sel = {t: 'g', k: c.k}; mt.save(); mtRefresh();
  toast('🗣 Голос отделён: звуки места и музыка остались у клипа, голос — на дорожке «🗣»', {type: 'ok', ms: 6000});
}
// где в куске [a, b] звучит речь: по громкости кадров 20 мс (с запасом 0,15 с)
function mtSpeech(buf, a, b) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, fr = Math.round(sr * 0.02), i0 = Math.floor(a * sr), i1 = Math.min(d.length, Math.floor(b * sr)), lv = [];
  for (let i = i0; i < i1; i += fr) { let s = 0; for (let j = i, e = Math.min(i1, i + fr); j < e; j += 2) s += d[j] * d[j]; lv.push(Math.sqrt(s / (fr / 2))); }
  const thr = Math.max(...lv, 0) * 0.12, f = lv.findIndex(x => x > thr), l = lv.length - 1 - [...lv].reverse().findIndex(x => x > thr);
  if (f < 0 || !thr) return [a, b];
  return [Math.max(a, a + f * 0.02 - 0.15), Math.min(b, a + (l + 1) * 0.02 + 0.15)];
}
// новый голос клипа (озвучка или голос персонажа) — файлом в базе, в клипе — ссылка и место начала
async function mtSetTake(p, c, buf, take) {
  const blob = wavBlob(buf), src = 'mtaud-' + uid();
  await DB.put({id: src, kind: 'mt-audio', blob, name: take.name, dur: buf.duration, createdAt: Date.now()});
  mtAud.set(src, {blob, url: urlOf(blob)});
  mtBufs.set(src, Promise.resolve(buf)); mtBufOk.set(src, buf);
  c.vox = {...(c.vox || {}), vol: c.vox?.vol || 1, take: {src, at: Math.round(take.at * 1000) / 1000, dur: buf.duration, name: String(take.name).slice(0, 80), kind: take.kind}};
  mt.save();
}
// «🎙 Переозвучить»: голос клипа (где говорят) → «Озвучка»; она распознает реплику
async function mtToEcho(c) {
  const s = mtPv.segs.find(x => x.c === c);
  if (!s) return;
  const vb = await mtSrcP(mtSepSrc(c.id, 'voice'));
  if (!vb) return toast('Голос клипа не найден — отделите его снова', {type: 'err'});
  let [from, to] = mtSpeech(vb, s.a, s.b);
  if (to - from < 1.5) { const mid = (from + to) / 2; from = Math.max(s.a, mid - 0.75); to = Math.min(s.b, from + 1.5); }
  if (to - from < 1.5) return toast('Реплика короче 1,5 с — «Озвучке» её не распознать', {type: 'err'});
  to = Math.min(to, from + 30);
  const wav = wavBlob(await audioMono(vb, 24000, from, to - from));
  const line = {p: mt.p.id, proj: mt.p.name, k: c.k, n: s.n, at: from, dur: to - from};
  mtPause();
  setView('create'); setCreateMode('voice');
  exFromMontage(line, wav);
}
// «→ В монтаж» из «Озвучки»: озвучка без тишины по краям, по длине — как исходная реплика (растягиваем без смены высоты)
async function mtTakeIn(line, blob, name) {
  const p = mt.projects.find(x => x.id === line.p), c = p?.clips.find(x => x.k === line.k);
  if (!c) throw new Error('клип уже удалён из монтажа');
  let buf = await decodeAudio(blob);
  const [a, b] = mtSpeech(buf, 0, buf.duration);
  buf = await audioMono(buf, buf.sampleRate, a, b - a);
  const ratio = line.dur / buf.duration, r = Math.max(0.8, Math.min(1.25, ratio));
  if (Math.abs(r - 1) > 0.03) buf = await vfxStretch(buf, r);
  await mtSetTake(p, c, buf, {at: line.at, name, kind: 'echo'});
  if (!c.sep) { c.sep = true; c.vox.vol ||= 1; }
  mt.cur = p.id; mt.tab = 'edit'; mt.sel = {t: 'g', k: c.k}; mt.save();
  setView('create'); setCreateMode('edit');
  const diff = buf.duration - line.dur;
  toast(Math.abs(diff) > 0.3 ? `🎙 Озвучка в монтаже. Она ${diff > 0 ? 'длиннее' : 'короче'} реплики на ${exNum(Math.abs(diff))} с — губы немного разойдутся; ${diff > 0 ? 'сократите текст или прибавьте темп' : 'добавьте слов или убавьте темп'}`
    : '🎙 Озвучка в монтаже — по длине как исходная реплика', {type: 'ok', ms: 9000});
}
// «🎧 Голосом персонажа»: Seed-VC меняет только тембр — слова, паузы и губы те же
async function mtVc(c) {
  const ch = vc.char(mt.vcChar);
  if (!ch?.sample || mt.voxJob) return;
  mt.voxJob = {k: c.k, note: 'Готовлю голос…'}; renderMtEdit();
  const note = n => { mt.voxJob.note = n; mtNote('mtVoxNote', n); };
  try {
    const vb = await mtSrcP(mtSepSrc(c.id, 'voice'));
    if (!vb) throw new Error('голос клипа не найден — отделите его снова');
    const out = await decodeAudio(await seedVc(wavBlob(await audioMono(vb, 24000)), dataBlob(ch.sample), note));
    const g = Math.min(4, rms(vb) / (rms(out) || 1) || 1), d = out.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * g));
    await mtSetTake(mt.p, c, out, {at: 0, name: ch.name, kind: 'vc'});
    toast(`🎧 Голос клипа — как у «${ch.name}»`, {type: 'ok'});
  } catch (e) { toast('Голос не изменился: ' + e.message, {type: 'err', ms: 9000}); }
  mt.voxJob = null; mtRefresh();
}
// после правки эффектов: голос пересчитывается заранее (в потоке), просмотр — с новым голосом
function mtFxChanged(c) {
  clearTimeout(mtFxChanged.t);
  mtFxChanged.t = setTimeout(() => {
    const s = mtPv.segs.find(x => x.c === c), w = s && mtVoxWin(c, s);
    if (!w) return;
    mtNote('mtFxNote', 'Обрабатываю голос…');
    mtFxP(w.src, c.vox?.fx).then(() => { mtNote('mtFxNote', ''); if (mtAE.on) mtAE.plan(); mtTl(); });
  }, 150);
}
const mtNum = (key, k, v, min, max, step = 0.1) => `<input type="number" data-mt-f="${key}" data-k="${k}" value="${Math.round(v * 100) / 100}" min="${min}" ${max != null ? `max="${max}"` : ''} step="${step}">`;
function renderMtEdit() {
  const body = $('#mtBody');
  if (!body || mt.tab !== 'edit') return;
  const p = mt.p, s = mt.sel, o = mtSel(), seg = (key, list, cur, k = '') => `<div class="seg">${list.map(([v, t]) => `<button data-mt-${key}="${v}" ${k ? `data-k="${k}"` : ''} class="${cur === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  let sel = '';
  if (o && s.t === 'v') {
    const sg = mtPv.segs.find(x => x.c === o), it = sg?.it, full = it ? mtLen(it) : 0;
    sel = `<div class="block-head"><span class="lbl">Клип #${sg?.n || '—'} <small id="mtSelLen">${sg ? mtFmt(sg.len) : ''}</small></span></div>
      <div class="mt-sp1" data-noicon>${esc(it?.prompt || 'видео удалено из галереи')}</div>
      <div class="mt-fl"><label>Начало ${mtNum('a', o.k, o.a || 0, 0, full)}</label><label>Конец ${mtNum('b', o.k, o.b ?? full, 0.3, full)}</label><span>из ${mtFmt(full)}</span></div>
      ${sg && sg.n > 1 ? `<div class="mt-fl"><span>Переход</span>${seg('tr', MT_TR.map(([v, i, t]) => [v, `${i} ${t}`]), o.tr || 'cut', o.k)}</div>
        ${(o.tr || 'cut') !== 'cut' ? `<div class="mt-fl mt-rng"><span>Длина</span><input type="range" min="0.2" max="2" step="0.1" value="${o.td || 0.6}" data-mt-f="td" data-k="${o.k}"><b>${String(o.td || 0.6).replace('.', ',')} с</b></div>` : ''}` : ''}
      <div class="mt-fl mt-rng"><button class="icon-btn ${o.mute ? 'off' : ''}" data-mt-mute="${o.k}" title="${o.mute ? 'Включить звук клипа' : 'Без звука'}">${o.mute ? '🔇' : '🔊'}</button>${o.sep ? '<span>Фон</span>' : ''}<input type="range" min="0" max="1.5" step="0.05" value="${o.vol ?? 1}" data-mt-f="vol" data-k="${o.k}" ${o.mute ? 'disabled' : ''}><b>${Math.round((o.vol ?? 1) * 100)}%</b></div>
      <div class="mt-fl">${o.sep ? `<button class="btn small" data-mt-gsel>🗣 Голос отделён — изменить голос</button>`
        : `<button class="btn small" data-mt-sep ${mt.sepJob ? 'disabled' : ''} title="Голос аватара — на свою дорожку, звуки места и музыка остаются у клипа">🗣 Отделить голос</button>`}</div>
      ${mt.sepJob?.k === o.k ? `<div class="mt-note" id="mtSepNote">⏳ ${esc(mt.sepJob.note)}</div>` : ''}`;
  } else if (o && s.t === 'g') {
    sel = mtVoxHTML(o);
  } else if (o && s.t === 't') {
    sel = `<div class="block-head"><span class="lbl">Титр</span></div>
      <textarea class="mt-ta" rows="2" data-mt-f="text" data-k="${o.k}" placeholder="Текст титра">${esc(o.text || '')}</textarea>
      <div class="mt-fl"><label>С ${mtNum('at', o.k, o.at || 0, 0)}</label><label>На ${mtNum('dur', o.k, o.dur || 3, 0.5)} с</label></div>
      <div class="mt-fl">${seg('pos', MT_POS, o.pos || 'bottom', o.k)}</div>`;
  } else if (o && s.t === 'p') {
    sel = `<div class="block-head"><span class="lbl">🖼 Фото поверх видео</span></div>
      <div class="mt-fl"><label>С ${mtNum('at', o.k, o.at || 0, 0)}</label><label>На ${mtNum('dur', o.k, o.dur || 3, 0.5)} с</label></div>
      <div class="mt-fl">${seg('ppos', MT_PH_POS, o.pos || 'center', o.k)}</div>
      ${o.pos !== 'full' ? `<div class="mt-fl mt-rng"><span>Размер</span><input type="range" min="0.15" max="1" step="0.05" value="${o.size ?? 0.6}" data-mt-f="size" data-k="${o.k}"><b>${Math.round((o.size ?? 0.6) * 100)}%</b></div>` : ''}
      <div class="mt-fl mt-rng"><span>Видимость</span><input type="range" min="0.1" max="1" step="0.05" value="${o.opacity ?? 1}" data-mt-f="opacity" data-k="${o.k}"><b>${Math.round((o.opacity ?? 1) * 100)}%</b></div>
      <div class="mt-fl"><label>Появление ${mtNum('fade', o.k, o.fade ?? 0.3, 0, 3, 0.1)} с</label></div>`;
  } else if (o && s.t === 'a') {
    sel = `<div class="block-head"><span class="lbl">${o.voice ? '🎙 Озвучка' : '🎵 Звук'}</span></div>
      <div class="mt-sp1" data-noicon>${esc(o.name)}</div>
      <div class="mt-fl"><label>С ${mtNum('at', o.k, o.at, 0)}</label><label>Из файла ${mtNum('a', o.k, o.a || 0, 0, o.dur)}</label><label>до ${mtNum('b', o.k, o.b ?? o.dur, 0.3, o.dur)}</label></div>
      <div class="mt-fl mt-rng"><span>Громкость</span><input type="range" min="0" max="1.5" step="0.05" value="${o.vol ?? 1}" data-mt-f="vol" data-k="${o.k}"><b>${Math.round((o.vol ?? 1) * 100)}%</b></div>
      <div class="mt-fl"><label>Нарастание ${mtNum('fadeIn', o.k, o.fadeIn || 0, 0, 10, 0.5)} с</label><label>Затухание ${mtNum('fadeOut', o.k, o.fadeOut || 0, 0, 10, 0.5)} с</label></div>`;
  }
  const gone = p.clips.filter(c => !mtItem(c)).length;
  body.innerHTML = `${sel ? `<div class="mt-selbox">${sel}<div class="mt-fl"><button class="btn small" data-mt-split title="Разрезать по бегунку (S)">✂ Разрезать</button><button class="btn small" data-mt-dup>⧉ Повторить</button><button class="btn small" data-mt-del-sel>🗑 Удалить</button></div></div>` : ''}
    ${gone ? `<div class="mt-fl mt-gone">${gone} ${plur(gone, 'клип удалён', 'клипа удалены', 'клипов удалены')} из галереи <button class="btn small" data-mt-gone>Убрать</button></div>` : ''}
    <div class="block-head"><span class="lbl">Кадр</span></div>
    ${seg('aspect', MT_ASPECT, p.aspect || 'auto')}
    <div class="mt-row2">${seg('fit', [['cover', 'Заполнить'], ['contain', 'Целиком']], p.fit || 'cover')}<label class="mt-chk"><input type="checkbox" data-mt-audio ${p.audio ? 'checked' : ''}> Звук клипов</label></div>`;
}
// после правки: длины, таймлайн, просмотр, свойства
function mtRefresh() {
  if (cl.mode !== 'edit') return;
  mtPvSync(); mtTl(); renderMtEdit();
  updateGenButton();
}
function mtAddItems(ids, quiet) {
  const p = mtProj();
  const add = ids.map(id => items.find(x => x.id === id)).filter(it => it?.type === 'video' && it.blob && it.status === 'done');
  for (const it of add) p.clips.push({k: uid(), id: it.id, a: 0, b: null, tr: 'cut'});
  mt.save();
  if (cl.mode === 'edit') renderMt();
  updateGenButton();
  if (!quiet) toast(`🎞 В монтаж «${p.name}»: ${add.length} ${plur(add.length, 'видео', 'видео', 'видео')}`, {type: 'ok', ...(cl.mode !== 'edit' && {action: 'Открыть', onAction: () => { setView('create'); setCreateMode('edit'); }})});
  return add.length;
}
// масштаб: ползунок 0…100 ↔ 4…400 пикселей на секунду
const mtZoomVal = () => Math.round(Math.log(mtPps() / 4) / Math.log(100) * 100);
function mtZoomSet(v) { mt.zoom = Math.round(4 * Math.pow(100, Math.max(0, Math.min(100, v)) / 100) * 10) / 10; ls.set('freefield.mt.zoom', mt.zoom); mtTl(); $('#mtZoom').value = mtZoomVal(); }

/* ---- обработчики: панель ---- */
$('#mtCreate').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset, p = mt.p, o = mtSel();
  if (d.mtTab) { mt.tab = d.mtTab; mt.save(); return renderMt(); }
  if ('mtStop' in d) { if (mt.job) mt.job.stop = true; return; }
  if ('mtRename' in d) { const n = prompt('Название проекта', p.name); if (n?.trim()) { p.name = n.trim().slice(0, 80); mt.save(); renderMt(); } return; }
  if ('mtDel' in d) {
    if (!confirm(`Удалить проект «${p.name}»? Видео в галерее останутся.`)) return;
    mt.projects = mt.projects.filter(x => x !== p); mt.cur = mt.projects[0]?.id || null; mt.sel = null; mt.save(); mtPause(); renderMt(); return updateGenButton();
  }
  if ('mtSplit' in d) return mtSplit();
  if ('mtDup' in d) return mtDup();
  if ('mtDelSel' in d) return mtDelSel();
  if ('mtGone' in d) { p.clips = p.clips.filter(c => mtItem(c)); mt.save(); return mtRefresh(); }
  // голос клипа
  if ('mtSep' in d && o) return mtSep(o);
  if ('mtGsel' in d && o) { mt.sel = {t: 'g', k: o.k}; renderMtEdit(); return mtTl(); }
  if ('mtToEcho' in d && o) return mtToEcho(o);
  if ('mtVc' in d && o) return mtVc(o);
  if ('mtGplay' in d && o) { const sg = mtPv.segs.find(x => x.c === o); if (sg) { mtSeekTo(sg.start); mtPlay(); } return; }
  if ('mtVorig' in d && o?.vox) { delete o.vox.take; mt.save(); mtRefresh(); return mtFxChanged(o); }
  if ('mtUnsep' in d && o) { o.sep = false; mt.sel = {t: 'v', k: o.k}; mt.save(); return mtRefresh(); }
  if ((d.mtVp || 'mtFxReset' in d || d.mtVk) && o) {
    const v = o.vox ||= {};
    if (d.mtVp) v.fx = {...VFX_DEF, ...VFX_PRESETS.find(x => x[0] === d.mtVp)?.[2]};
    else if (d.mtVk) v.fx = {...vfxNorm(v.fx), kind: d.mtVk};
    else delete v.fx;
    mt.save(); renderMtEdit(); mtTl();
    return mtFxChanged(o);
  }
  if (d.mtTr && o) { o.tr = d.mtTr; o.td = o.td || 0.6; }
  else if (d.mtMute && o) o.mute = !o.mute;
  else if (d.mtPos && o) o.pos = d.mtPos;
  else if (d.mtPpos && o) o.pos = d.mtPpos;
  else if (d.mtAspect) { p.aspect = d.mtAspect; mt.save(); return renderMt(); }
  else if (d.mtFit) p.fit = d.mtFit;
  else return;
  mt.save(); mtRefresh();
});
$('#mtCreate').addEventListener('input', e => {
  const el = e.target, f = el.dataset.mtF, o = mtSel();
  if (!f || !o || o.k !== el.dataset.k) return;
  const v = f === 'text' ? el.value.slice(0, 200) : +el.value, p = mt.p, s = mt.sel;
  if (f !== 'text' && !Number.isFinite(v)) return;
  if (s.t === 'g') {   // голос: громкость, фон, эффекты
    const vx = o.vox ||= {}, lbl = el.nextElementSibling;
    if (f === 'vvol') { vx.vol = v; lbl.textContent = Math.round(v * 100) + '%'; }
    else if (f === 'vol') { o.vol = v; lbl.textContent = Math.round(v * 100) + '%'; }
    else if (f.startsWith('fx.')) {
      const k = f.slice(3);
      vx.fx = {...vfxNorm(vx.fx), [k]: v};
      lbl.textContent = mtFxFmt[k](v);
      mtFxChanged(o);
    }
    if (mtAE.on) mtAE.plan();
  } else if (s.t === 'v') {
    const full = mtLen(mtItem(o));
    if (f === 'a') o.a = Math.max(0, Math.min(v, (o.b ?? full) - 0.3));
    else if (f === 'b') { const b = Math.max((o.a || 0) + 0.3, Math.min(v, full)); o.b = b >= full - 0.05 ? null : b; }
    else if (f === 'td') { o.td = v; el.nextElementSibling.textContent = String(v).replace('.', ',') + ' с'; }
    else if (f === 'vol') { o.vol = v; el.nextElementSibling.textContent = Math.round(v * 100) + '%'; }
    mtPvSync();
    const sg = mtPv.segs.find(x => x.c === o);
    if (sg && (f === 'a' || f === 'b')) { mtSeekTo(f === 'a' ? sg.start : sg.end - 0.04); $('#mtSelLen').textContent = mtFmt(sg.len); }
  } else if (s.t === 't' || s.t === 'p') {
    if (f === 'text') o.text = v; else if (f === 'at') o.at = Math.max(0, v); else if (f === 'dur') o.dur = Math.max(0.5, v);
    else if (f === 'fade') o.fade = Math.max(0, v);
    else if (f === 'size' || f === 'opacity') { o[f] = v; el.nextElementSibling.textContent = Math.round(v * 100) + '%'; }
    if (!(mtPv.t >= o.at && mtPv.t < o.at + o.dur)) mtSeekTo(o.at + Math.min(0.5, o.dur / 2)); else mtShow(mtPv.t);
  } else {
    if (f === 'at') o.at = Math.max(0, v);
    else if (f === 'a') o.a = Math.max(0, Math.min(v, (o.b ?? o.dur) - 0.3));
    else if (f === 'b') { const b = Math.max((o.a || 0) + 0.3, Math.min(v, o.dur)); o.b = b >= o.dur - 0.05 ? null : b; }
    else if (f === 'vol') { o.vol = v; el.nextElementSibling.textContent = Math.round(v * 100) + '%'; }
    else if (f === 'fadeIn' || f === 'fadeOut') o[f] = Math.max(0, v);
  }
  mtTl();
  updateGenButton();
  clearTimeout(mt.saveT); mt.saveT = setTimeout(() => mt.save(), 400);
});
$('#mtCreate').addEventListener('change', e => {
  const el = e.target, d = el.dataset, p = mt.p;
  if ('mtProj' in d) {
    mtPause();
    if (el.value === '__new') { const n = prompt('Название проекта', `Проект ${mt.projects.length + 1}`); if (n === null) return renderMt(); mtNew(n.trim().slice(0, 80) || undefined); }
    else { mt.cur = el.value; mt.save(); }
    mtPv.t = 0; mt.sel = null;
    renderMt(); return updateGenButton();
  }
  if ('mtAudio' in d) { p.audio = el.checked; mt.save(); if (mtAE.on) mtAE.plan(); return mtShow(mtPv.t); }
  if ('mtVcchar' in d) { mt.vcChar = el.value; return; }
  if (d.mtF) { mt.save(); mtRefresh(); }
});

/* ---- обработчики: просмотр и таймлайн ---- */
MTW.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset, p = mtProj();
  if ('mtPlay' in d) return mtPv.playing ? mtPause() : mtPlay();
  if ('mtHome' in d) { mtPause(); return mtSeekTo(0); }
  if ('mtAdd' in d) return mtOpenPick();
  if ('mtSplit' in d) return mtSplit();
  if ('mtDelSel' in d) return mtDelSel();
  if ('mtTadd' in d) {   // новый титр — с того места, где сейчас бегунок
    const t = {k: uid(), text: 'Титр', at: Math.round(mtPv.t * 10) / 10, dur: 3, pos: 'bottom'};
    p.titles.push(t); mt.sel = {t: 't', k: t.k}; mt.save(); mtRefresh();
    if (isMobile()) $('#mtBody')?.scrollIntoView({block: 'nearest'});
    return $('#mtBody [data-mt-f="text"]')?.select();
  }
  if ('mtPadd' in d) return mtOpenPick('photo');
  if ('mtAadd' in d) return $('#mtAudMenu').classList.toggle('hidden');
  if ('mtAudFile' in d) { $('#mtAudMenu').classList.add('hidden'); return mtAudioFile(); }
  if ('mtAudEcho' in d) { $('#mtAudMenu').classList.add('hidden'); return mtAudioEcho(); }
  if (d.mtZoom) return mtZoomSet(+$('#mtZoom').value + 12 * +d.mtZoom);
  if ('mtFit' in d) { mt.zoom = null; ls.del('freefield.mt.zoom'); mtTl(); $('#mtZoom').value = mtZoomVal(); return; }
  if (d.tlx) {   // ◆ переход: склейка → плавно → через чёрное
    const c = p.clips.find(x => x.k === d.tlx), i = MT_TR.findIndex(t => t[0] === (c.tr || 'cut'));
    c.tr = MT_TR[(i + 1) % MT_TR.length][0]; c.td = c.td || 0.6;
    mt.sel = {t: 'v', k: c.k}; mt.save(); mtRefresh();
    const s = mtPv.segs.find(x => x.c === c);
    return s && mtSeekTo(Math.max(0, s.start - 0.8));
  }
});
MTW.addEventListener('input', e => { if (e.target.id === 'mtZoom') mtZoomSet(+e.target.value); });
$('#mtInner').addEventListener('pointerdown', mtTlDown);
$('#mtInner').addEventListener('pointermove', mtTlMove);
$('#mtInner').addEventListener('pointerup', mtTlUp);
$('#mtInner').addEventListener('pointercancel', mtTlUp);
// Ctrl + колёсико — масштаб таймлайна
$('#mtScroll').addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); mtZoomSet(+$('#mtZoom').value - Math.sign(e.deltaY) * 6); }, {passive: false});
// клавиши: пробел — смотреть, S — разрезать, Delete — удалить, ← → — кадр (с Shift — секунда), Home — в начало
document.addEventListener('keydown', e => {
  if (cl.mode !== 'edit' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]') || !$$('.sheet').every(x => x.classList.contains('hidden'))) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); return mtPv.playing ? mtPause() : mtPlay(); }
  if (k === 's' || k === 'S' || k === 'ы' || k === 'Ы') { e.preventDefault(); return mtSplit(); }
  if ((k === 'Delete' || k === 'Backspace') && mt.sel) { e.preventDefault(); return mtDelSel(); }
  if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); if (mtPv.playing) mtPause(); return mtSeekTo(mtPv.t + (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / 30)); }
  if (k === 'Home') { e.preventDefault(); return mtSeekTo(0); }
});
addEventListener('resize', () => { if (cl.mode === 'edit' && !mt.zoom) mtTl(); });

/* ---- «＋ Из галереи»: выбрать видео по порядку ---- */
const mtPick = {sel: [], mode: 'clips', takes: []};   // clips — видео в проект; photo — фото поверх видео; att — в чат «ИИ-монтажёра»; echo — озвучки «Эхо»
const mtPickList = () => items.filter(x => (mtPick.mode === 'photo' ? x.type === 'image' : x.type === 'video' || mtPick.mode === 'att' && x.type === 'image') && x.status === 'done' && x.blob);
// видео и фото с устройства (галерея телефона, папка компьютера) → в галерею Freefield, дальше — как обычные
async function mtImportFiles(files) {
  const out = [];
  for (const f of files || []) {
    const kind = /^video\//.test(f.type) ? 'video' : /^image\//.test(f.type) ? 'image' : null;
    if (!kind) continue;
    const d = kind === 'video' ? await videoDims(f) : await dims(f);
    const duration = kind === 'video' ? await new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata';
      v.onloadedmetadata = () => res(Math.round(v.duration * 10) / 10 || null); v.onerror = () => res(null); v.src = urlOf(f); }) : undefined;
    const name = (f.name || (kind === 'video' ? 'видео' : 'фото')).replace(/\.\w+$/, '');
    const it = {id: uid(), type: kind, status: 'done', statusText: '', createdAt: Date.now(), importedAt: Date.now(), prompt: name, userPrompt: name, finalPrompt: name,
      model: 'dev:upload', tier: 'free', modelTitle: '📱 С устройства', seed: 0, cost: 0, source: 'text', aspect: d && d[0] < d[1] ? '9:16' : d && d[0] === d[1] ? '1:1' : '16:9',
      w: d?.[0] || 1280, h: d?.[1] || 720, ...(kind === 'video' && {duration}), blob: f};
    items.push(it);
    await DB.put(it);
    out.push(it);
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  render();
  return out;
}
// фото поверх видео — с бегунка, по 3 с одно за другим
function mtAddPhotos(ids) {
  const p = mtProj();
  let at = Math.round(mtPv.t * 10) / 10, last = null;
  for (const id of ids) { last = {k: uid(), id, at, dur: 3, pos: 'center', size: 0.6, opacity: 1, fade: 0.3}; (p.photos ||= []).push(last); at += 3; }
  if (last) mt.sel = {t: 'p', k: last.k};
  mt.save(); mtRefresh();
}
function mtOpenPick(mode = 'clips') {
  mtPick.sel = []; mtPick.mode = mode;
  $('#mtSheet h2').textContent = mode === 'att' ? '📎 В чат: картинки и видео' : mode === 'echo' ? '🎙 Озвучка из «Эхо»' : mode === 'photo' ? '🖼 Фото поверх видео' : '🎞 Видео в монтаж';
  renderMtPick();
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#mtSheet').classList.remove('hidden');
}
function renderMtPick() {
  if (mtPick.mode === 'echo') {   // озвучки «Эхо» — новые сверху
    const n = mtPick.sel.length;
    $('#mtPickBody').innerHTML = mtPick.takes.length ? `<div class="mt-elist">${mtPick.takes.map(t => { const k = mtPick.sel.indexOf(t.id) + 1;
      return `<button class="mt-er ${k ? 'on' : ''}" data-mt-pi="${esc(t.id)}">${k ? `<b>${k}</b>` : '<b>＋</b>'}<span data-noicon><i>${esc(t.voice_name)}${t.favorite ? ' ★' : ''} · ${esc(echoEmoName(t.emotion).toLowerCase())}</i>${esc(t.text)}</span><small>${mtFmt(t.duration)}</small></button>`; }).join('')}</div>
      <div class="mt-pick-go"><button class="btn primary" data-mt-pick-go ${n ? '' : 'disabled'}>＋ На звуковую дорожку${n ? ' ' + n : ''}</button></div>`
      : '<p class="mt-none">В «Эхо» пока нет озвучек — сделайте их во вкладке «Озвучка»</p>';
    return;
  }
  const att = mtPick.mode === 'att', ph = mtPick.mode === 'photo', vids = mtPickList(), inP = new Set(att || ph ? [] : (mt.p?.clips || []).map(c => c.id)), n = mtPick.sel.length;
  $('#mtPickBody').innerHTML = `<button class="btn mt-dev" data-mt-dev>📱 С устройства — ${ph ? 'фото' : att ? 'фото или видео' : 'видео'} из галереи телефона или с компьютера</button>` + (vids.length ? `<div class="mt-pick">${vids.map(it => { const k = mtPick.sel.indexOf(it.id) + 1;
    return `<button class="mt-pi ${k ? 'on' : ''}" data-mt-pi="${it.id}" title="${esc(it.prompt)}">${it.type === 'image' ? `<img src="${urlOf(it.blob)}" alt="" loading="lazy">` : `<img data-mt-thumb="${it.id}" alt="">`}${k ? `<b>${k}</b>` : ''}${inP.has(it.id) ? '<i>в проекте</i>' : ''}${it.type === 'video' ? `<span>${mtFmt(mtLen(it))}</span>` : ''}</button>`; }).join('')}</div>
    <div class="mt-pick-go"><button class="btn primary" data-mt-pick-go ${n ? '' : 'disabled'}>${att ? '📎 Приложить' : '＋ Добавить'}${n ? ' ' + n : ''}</button>${att || ph ? '' : '<button class="btn" data-mt-pick-all>Все по порядку</button>'}</div>`
    : `<p class="mt-none">В галерее Freefield пока нет ${ph ? 'фото' : att ? 'картинок и видео' : 'видео'}</p>`);
  mtFillThumbs($('#mtPickBody'));
}

/* ---- склейка: кадры перекодируются в один MP4 (H.264 + AAC, где браузер умеет; иначе VP9 / Opus) ---- */
async function mtFps(segs) {
  let best = 0;
  for (const s of segs) {
    try { const st = await s._in.vt.computePacketStats(90); best = Math.max(best, st.averagePacketRate || 0); } catch {}
  }
  const snap = [24, 25, 30].reduce((a, b) => Math.abs(b - best) < Math.abs(a - best) ? b : a, 30);
  return best ? Math.min(30, best > 31 ? 30 : snap) : 30;
}
async function mtMixAudio(segs, total, M, p) {
  const SR = 48000, ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * SR)), SR);
  let any = false;
  // дорожка «🎵», фон и голос клипов (с эффектами, озвучкой) — тем же расписанием, что и в просмотре
  const list = mtSounds(p, segs).filter(x => x.when < total), bufs = new Map();
  for (const x of list) { const b = await mtFxP(x.src, x.fx); if (b) bufs.set(x, b); }
  if (mtSchedule(ctx, list, 0, 0, x => bufs.get(x)).length) any = true;
  for (const s of segs) {
    const at = s._in.at;
    if (!p.audio || s.c.mute || s.c.sep || !at || !(await at.canDecode().catch(() => false))) continue;
    const g = ctx.createGain(), vol = s.c.vol ?? 1;
    g.connect(ctx.destination);
    g.gain.setValueAtTime(s.inK !== 'cut' ? 0 : vol, s.start);
    if (s.inK !== 'cut') g.gain.linearRampToValueAtTime(vol, s.start + s.inD);
    if (s.outK !== 'cut') { g.gain.setValueAtTime(vol, s.end - s.outD); g.gain.linearRampToValueAtTime(0, s.end); }
    for await (const {buffer, timestamp} of new M.AudioBufferSink(at).buffers(Math.max(0, s.a - 0.1), s.b)) {
      const when = s.start + (timestamp - s.a);
      if (when >= s.end || when + buffer.duration <= s.start) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer; src.connect(g);
      if (when < s.start) src.start(s.start, s.start - when); else src.start(when);
      src.stop(s.end);
      any = true;
    }
  }
  return any ? ctx.startRendering() : null;
}
async function mtExport(p = mt.p) {
  const segs = mtSegs(p);
  if (!segs.length) throw new Error('добавьте видео из галереи');
  if (typeof VideoEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') throw new Error('этот браузер не умеет собирать видео — откройте Freefield в Google Chrome или Microsoft Edge');
  const job = mt.job = {pct: 0, text: 'Загружаю библиотеку склейки…', stop: false};
  const step = (pct, text) => { job.pct = pct; job.text = text; renderMtProg(); updateGenButton(); };
  renderMtProg(); updateGenButton();
  const M = await mediabunny();   // та же библиотека, что у «🎙 Заменить голос»
  const opened = [], live = new Map();
  let output = null;
  try {
    for (const s of segs) {
      const input = new M.Input({source: new M.BlobSource(s.it.blob), formats: M.ALL_FORMATS});
      opened.push(input);
      const vt = await input.getPrimaryVideoTrack();
      if (!vt || !(await vt.canDecode())) throw new Error(`клип #${s.n}: браузер не читает это видео (${vt?.codec || 'нет картинки'}) — откройте Freefield в Google Chrome`);
      s._in = {vt, at: await input.getPrimaryAudioTrack(), t0: await vt.getFirstTimestamp().catch(() => 0)};
    }
    const [W, H] = mtOutDims(p, segs), fps = await mtFps(segs), total = mtTotal(segs), N = Math.max(1, Math.round(total * fps));
    const vcodec = await M.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], {width: W, height: H});
    if (!vcodec) throw new Error(`браузер не умеет кодировать видео ${W}×${H}`);
    step(0.02, 'Звук…');
    const mix = p.audio || p.audios?.length ? await mtMixAudio(segs, total, M, p) : null;
    const acodec = mix ? await M.getFirstEncodableAudioCodec(['aac', 'opus'], {numberOfChannels: 2, sampleRate: 48000}) : null;
    output = new M.Output({format: new M.Mp4OutputFormat({fastStart: 'in-memory'}), target: new M.BufferTarget()});
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const vsrc = new M.CanvasSource(canvas, {codec: vcodec, quality: M.QUALITY_HIGH, keyFrameInterval: 2});
    output.addVideoTrack(vsrc, {frameRate: fps});
    let asrc = null;
    if (mix && acodec) { asrc = new M.AudioBufferSource({codec: acodec, quality: M.QUALITY_HIGH}); output.addAudioTrack(asrc); }
    await output.start();
    if (asrc) { await asrc.add(mix); asrc.close(); }
    // кадры каждого клипа — по порядку, ровно в те моменты, когда клип виден
    const frames = s => {
      const ts = [];
      for (let n = Math.max(0, Math.floor(s.start * fps) - 1); n / fps < s.end + 1 / fps; n++) if (mtOn(s, n / fps)) ts.push(Math.max(s._in.t0, s.a + (n / fps - s.start)));
      return new M.CanvasSink(s._in.vt, {width: W, height: H, fit: p.fit === 'contain' ? 'contain' : 'cover', poolSize: 4}).canvasesAtTimestamps(ts);
    };
    let poster = null;
    const bitmaps = new Map();   // фото поверх видео — готовыми к рисованию
    for (const o of p.photos || []) if (!bitmaps.has(o.id)) { const it = items.find(x => x.id === o.id); if (it?.blob) bitmaps.set(o.id, await createImageBitmap(it.blob).catch(() => null)); }
    for (let n = 0; n < N; n++) {
      if (job.stop) throw Object.assign(new Error('склейка отменена'), {cancel: true});
      const T = n / fps;
      ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      let dim = 0;
      for (const s of segs) {
        if (!mtOn(s, T)) continue;
        if (!live.has(s)) live.set(s, {it: frames(s), last: null});
        const L = live.get(s), r = await L.it.next();
        if (r.value) L.last = r.value.canvas;
        if (!L.last) continue;
        const look = mtLook(s, T);
        ctx.globalAlpha = look.alpha;
        ctx.drawImage(L.last, 0, 0, W, H);
        ctx.globalAlpha = 1;
        dim = Math.max(dim, look.dim);
      }
      // клип кончился: его кадры выбраны все — дочитываем генератор до конца, чтобы библиотека сама закрыла декодер
      for (const [s, L] of live) if ((n + 1) / fps >= s.end - 1e-6) { live.delete(s); const r = await L.it.next().catch(() => ({done: true})); if (!r.done) await L.it.return?.().catch(() => {}); }
      if (dim) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, W, H); }
      mtDrawPhotos(ctx, W, H, p.photos, T, id => bitmaps.get(id));
      mtDrawTitles(ctx, W, H, p.titles, T);
      if (!poster && T >= Math.min(1, total / 2)) poster = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
      await vsrc.add(T, 1 / fps);
      if (n % 10 === 0) step(0.05 + 0.93 * n / N, `Кадры ${n} из ${N} · ${mtClock(T)} / ${mtClock(total)}`);
    }
    vsrc.close();
    step(0.99, 'Сохраняю…');
    await output.finalize();
    const blob = new Blob([output.target.buffer], {type: 'video/mp4'});
    return {blob, poster, W, H, total, fps, vcodec, acodec, n: segs.length};
  } catch (e) {
    for (const L of live.values()) await L.it.return?.().catch(() => {});
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    throw e;
  } finally {
    opened.forEach(i => { try { i.dispose(); } catch {} });
    segs.forEach(s => delete s._in);
    mt.job = null;
    renderMtProg(); updateGenButton();
  }
}
// большая кнопка «🎞 Склеить видео» → готовый ролик в галерею
async function mtGo() {
  const p = mtProj();
  if (peek.on) {
    if (mt.tab === 'chat') return mtAsk($('#mtAskIn')?.value || '', true);
    const segs = mtSegs(p), [W, H] = mtOutDims(p, segs);
    return peekShow('Монтаж', {prompts: [['Что соберётся (в этом браузере, видео никуда не уходят)', [
      `${W}×${H}, ${mtFmt(mtTotal(segs))}, кадр: ${p.fit === 'contain' ? 'целиком' : 'заполнить'}, звук клипов: ${p.audio ? 'да' : 'нет'}`,
      'Кодеки: видео H.264 (нет в браузере — VP9/AV1), звук AAC (нет — Opus); MP4; библиотека Mediabunny с cdn.jsdelivr.net',
      ...segs.map(s => `#${s.n} ${mtClock(s.start)}–${mtClock(s.end)} · из клипа ${s.a.toFixed(1)}–${s.b.toFixed(1)} с${s.inK !== 'cut' ? ` · вход: ${MT_TR.find(x => x[0] === s.inK)[2].toLowerCase()} ${s.inD.toFixed(1)} с` : ''}${s.c.mute ? ' · без звука' : ''} · ${s.it.prompt.slice(0, 80)}`),
      ...(p.titles || []).map(t => `Титр ${mtClock(t.at || 0)} на ${t.dur || 3} с (${MT_POS.find(x => x[0] === (t.pos || 'bottom'))[1].toLowerCase()}): ${t.text}`)].join('\n')]],
      request: {проект: {...p, chat: `${p.chat?.length || 0} сообщений`}}});
  }
  if (mt.job) return;
  if (!mtSegs(p).length) { toast('Добавьте видео из галереи', {type: 'err'}); return mtOpenPick(); }
  mtPause();
  try {
    const r = await mtExport(p);
    const it0 = mtSegs(p)[0]?.it;
    const item = {id: uid(), type: 'video', status: 'done', statusText: '', createdAt: Date.now(), importedAt: Date.now(),
      prompt: `Монтаж: ${p.name}`, userPrompt: `Монтаж: ${p.name}`, finalPrompt: `Монтаж: ${p.name}`, model: 'mt:montage', tier: 'free',
      modelTitle: `🎞 Монтаж · ${r.n} ${plur(r.n, 'клип', 'клипа', 'клипов')}`, seed: 0, cost: 0, source: 'text',
      aspect: p.aspect !== 'auto' ? p.aspect : it0?.aspect || (r.W < r.H ? '9:16' : '16:9'), w: r.W, h: r.H, duration: Math.round(r.total * 10) / 10,
      blob: r.blob, posterBlob: r.poster || null, mt: p.id};
    items.push(item);
    items.sort((a, b) => b.createdAt - a.createdAt);
    await DB.put(item);
    render();
    toast(`🎞 Готово: «${p.name}», ${mtFmt(r.total)} — в галерее`, {type: 'ok', ms: 8000, action: '⤓ Скачать', onAction: () => saveFile(r.blob, `freefield-montage-${p.name.replace(/[^\wа-яё-]+/gi, '-').slice(0, 40)}.mp4`)});
    if (isMobile()) setView('gallery');
  } catch (e) {
    toast(e.cancel ? 'Склейка отменена' : 'Не склеилось: ' + e.message, {type: e.cancel ? '' : 'err', ms: 9000});
  }
}

$('#mtSheet').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mtPi) {
    const i = mtPick.sel.indexOf(b.dataset.mtPi);
    if (i >= 0) mtPick.sel.splice(i, 1); else mtPick.sel.push(b.dataset.mtPi);
    return renderMtPick();
  }
  if ('mtPickAll' in b.dataset) { mtPick.sel = mtPickList().map(x => x.id).reverse(); return renderMtPick(); }   // старые — раньше
  if ('mtDev' in b.dataset) {   // с устройства: сразу в галерею Freefield и туда, куда выбирали
    const mode = mtPick.mode, got = await mtImportFiles(await pickFile(mode === 'photo' ? 'image/*' : mode === 'att' ? 'image/*,video/*' : 'video/*', true));
    if (!got.length) return;
    closeSheets();
    if (mode === 'att') { for (const it of got) await mtAttach(it.blob, it.prompt, it); return; }
    if (mode === 'photo') return mtAddPhotos(got.map(x => x.id));
    const n = mtAddItems(got.map(x => x.id), true);
    return toast(`🎞 С устройства: ${n} видео — в монтаже и в галерее`, {type: 'ok'});
  }
  if ('mtPickGo' in b.dataset) {
    const sel = [...mtPick.sel];
    closeSheets();
    if (mtPick.mode === 'att') { for (const id of sel) { const it = items.find(x => x.id === id); if (it?.blob) await mtAttach(it.blob, (it.prompt || '').slice(0, 60) || 'из галереи', it); } return; }
    if (mtPick.mode === 'photo') return mtAddPhotos(sel);
    if (mtPick.mode === 'echo') {   // озвучки — одна за другой с бегунка
      let at = mtPv.t;
      for (const id of sel) {
        const t = mtPick.takes.find(x => x.id === id);
        try { const a = await mtAddAudio(await echoBlob(t), `${t.voice_name}: ${t.text}`, {at, voice: true}); if (a) at = a.at + mtALen(a); }
        catch (er) { toast('Не получилось взять озвучку: ' + er.message, {type: 'err'}); }
      }
      return;
    }
    const n = mtAddItems(sel, true);
    toast(`🎞 Добавлено ${n} ${plur(n, 'видео', 'видео', 'видео')}`, {type: 'ok'});
  }
});

/* ---- «✦ ИИ-монтажёр»: чат в «Монтаже» (пользователь 2026-10-08: «чат с ИИ, который умеет писать сценарии и выполнять автомонтаж»).
   Сценарий — по тому, что дали: картинкам, инфографике, видео или просто по промпту, без деления на 10-секундные сцены
   (пользователь 2026-10-08). Промпты для видео — по просьбе, по одному на клип. Автомонтаж — порядок, обрезка, переходы, титры.
   ИИ видит описания клипов и кадр из середины каждого; вложенное видео Gemini получает целиком, Claude — кадрами ---- */
const MT_QUICK = ['Напиши сценарий по вложениям', 'Собери ролик из клипов проекта', 'Обрежь лишнее в начале и в конце клипов', 'Сделай плавные переходы', 'Добавь титры'];
const MT_PROMPTS_ASK = 'Сделай по этому сценарию промпты для видео — по одному на каждый клип';
const mtWho = () => wr.ai === 'gemini' && wallet.gemini ? 'gemini' : wr.ai === 'claude' && wallet.anthropic ? 'claude' : wallet.anthropic ? 'claude' : wallet.gemini ? 'gemini' : null;
mt.att = [];   // вложения к следующему сообщению: {k, kind: 'image' | 'video', name, blob, thumb, prompt?}
// кадры из видео в моменты at (доли длины) — для Claude и для миниатюр
function mtGrab(blob, at = [0.5], max = 512) {
  return new Promise(res => {
    const v = document.createElement('video'), out = [];
    let i = 0, over = false;
    const done = () => { if (over) return; over = true; clearTimeout(tm); v.removeAttribute('src'); v.load(); res(out); };
    const tm = setTimeout(done, 20000);
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadedmetadata = () => { out.dur = v.duration; v.currentTime = (v.duration || 1) * at[0]; };
    v.onseeked = () => {
      const k = Math.min(1, max / Math.max(v.videoWidth || 1, v.videoHeight || 1)), c = document.createElement('canvas');
      c.width = Math.max(2, Math.round(v.videoWidth * k)); c.height = Math.max(2, Math.round(v.videoHeight * k));
      try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); out.push([v.currentTime, c.toDataURL('image/jpeg', 0.85)]); } catch {}
      if (++i < at.length) v.currentTime = (v.duration || 1) * at[i]; else done();
    };
    v.onerror = done;
    v.src = urlOf(blob);
  });
}
async function mtAttach(blob, name, from) {
  const kind = /^video\//.test(blob?.type) ? 'video' : /^image\//.test(blob?.type) ? 'image' : null;
  if (!kind) return toast('Можно картинку или видео', {type: 'err'});
  if (mt.att.length >= 8) return toast('Не больше 8 вложений в одном сообщении', {type: 'err'});
  const thumb = kind === 'image' ? await blobDataUrl(await downscale(blob, 160)).catch(() => null) : (await mtGrab(blob, [0.5], 160))[0]?.[1] || null;
  mt.att.push({k: uid(), kind, name: name || (kind === 'video' ? 'видео' : 'картинка'), blob, thumb, prompt: from?.prompt || ''});
  if (mt.tab !== 'chat') { mt.tab = 'chat'; mt.save(); renderMt(); } else renderMtAtt();
}
function renderMtAtt() {
  const el = $('#mtAtt');
  if (el) el.innerHTML = mt.att.map(a => `<span class="mt-a" title="${esc(a.name)}">${a.thumb ? `<img src="${a.thumb}" alt="">` : ''}${a.kind === 'video' ? '<i>▶</i>' : ''}<button data-mt-att-rm="${a.k}" title="Убрать">✕</button></span>`).join('');
}
const mtMime = b => b.type === 'video/quicktime' ? 'video/mov' : b.type;
// что видит ИИ: вложения (a1…), проект (c1…), видео галереи вне проекта (g1…), кадры, персонаж, разговор
async function mtBrief(p, text, who, frames = true) {
  const sec = cl.seconds || 10, ch = vc.char(wr.char), lang = ch?.lang === 'en' ? 'English' : 'Russian';
  const segs = mtSegs(p), bySeg = new Map(segs.map(s => [s.c, s])), refs = new Map(), media = [];
  const inP = new Set(p.clips.map(c => c.id));
  const gal = items.filter(x => x.type === 'video' && x.status === 'done' && x.blob && !inP.has(x.id) && !x.mt).slice(0, 30);
  const line = (it, extra) => `${mtFmt(mtLen(it)).replace(' с', ' s')}${extra} — "${String(it.prompt || '').replace(/\s+/g, ' ').slice(0, 400)}"`;
  const clipLines = p.clips.map((c, i) => {
    const it = mtItem(c), s = bySeg.get(c);
    refs.set('c' + (i + 1), {id: c.id});
    return it ? `c${i + 1} — file ${line(it, `, used ${s.a.toFixed(1)}–${s.b.toFixed(1)} s, transition in: ${c.tr || 'cut'}${c.mute ? ', muted' : ''}, on the timeline ${s.start.toFixed(1)}–${s.end.toFixed(1)} s`)}` : `c${i + 1} — (deleted, ignore)`;
  });
  const galLines = gal.map((it, i) => { refs.set('g' + (i + 1), {id: it.id}); return `g${i + 1} — ${line(it, '')}`; });
  // вложения: картинка — целиком (до 1600 px); видео — Gemini целиком со звуком (пока влезает в запрос), Claude — 4 кадра
  let bytes = 0;
  const attLines = [];
  for (const [i, a] of mt.att.entries()) {
    const ref = 'a' + (i + 1);
    if (a.kind === 'image') {
      attLines.push(`${ref} — picture "${a.name}"${a.prompt ? ` (made from the prompt: "${a.prompt.slice(0, 200)}")` : ''}`);
      media.push([`ATTACHMENT ${ref} — PICTURE:`, frames ? await blobDataUrl(await downscale(a.blob, 1600)) : null]);
    } else if (who === 'gemini' && bytes + a.blob.size < 14e6) {
      bytes += a.blob.size;
      attLines.push(`${ref} — video "${a.name}" (the whole file with sound is attached)${a.prompt ? `, made from the prompt: "${a.prompt.slice(0, 200)}"` : ''}`);
      media.push([`ATTACHMENT ${ref} — VIDEO:`, frames ? (await blobDataUrl(new Blob([a.blob], {type: mtMime(a.blob)}))) : null]);
    } else {
      const fr = frames ? await mtGrab(a.blob, [0.1, 0.37, 0.63, 0.9], 768) : [[0], [0], [0], [0]];
      attLines.push(`${ref} — video "${a.name}"${fr.dur ? `, ${fr.dur.toFixed(1)} s` : ''} (4 frames attached, no sound)${a.prompt ? `, made from the prompt: "${a.prompt.slice(0, 200)}"` : ''}`);
      fr.forEach(([t, d], k) => media.push([`ATTACHMENT ${ref} — VIDEO FRAME ${k + 1} of 4${t ? ` at ${t.toFixed(1)} s` : ''}:`, d || null]));
    }
  }
  if (frames) {
    const want = [...p.clips.slice(0, 16).map((c, i) => ['c' + (i + 1), mtItem(c)]), ...gal.slice(0, 10).map((it, i) => ['g' + (i + 1), it])].filter(x => x[1]);
    for (const [ref, it] of want) { const d = await mtThumb(it); if (d) media.push([`FRAME ${ref} (middle of the clip):`, d]); }
  } else media.push(...[...p.clips.slice(0, 16).map((c, i) => [`FRAME c${i + 1}`]), ...gal.slice(0, 10).map((x, i) => [`FRAME g${i + 1}`])]);
  const sys = `You are the AI screenwriter and video editor ("ИИ-монтажёр") inside Freefield — an app where a user generates short AI video clips (Google Flow / Veo, Google Vids, Dola, Arena; one clip is at most about ${sec} s) and edits them into one long video right in the browser.
Depending on what the user asks, you do one or more of these:
1. WRITE A SCRIPT from whatever the user gives you: attached pictures (photos, character sheets, infographics — read every text, number and fact on them and build the story on them), attached videos (what happens and what is said in them), the project clips, or just the user's text prompt. Write a complete, ready-to-shoot scenario in Russian (spoken lines and on-screen text in ${lang}): a title, then the scenes in order — for each scene: what we see (place, characters, action, camera), what is said word for word (voice-over or dialogue) and on-screen text, with approximate timing. The structure and length follow the user's request and the material — do not cut the story into fixed-length pieces. Put it in "script".
2. MAKE VIDEO PROMPTS only when the user asks for prompts, clips or to generate the video: split the script into AI clips of at most ${sec} s each and write one prompt per clip in the user's reference format — these labeled lines, one per line, all filled in:
${refLabels().map(l => l + ': …').join('\n')}
On-screen text and spoken lines in ${lang}, everything else in English; a spoken line must fit its clip (about 2.3 words per second). Every clip is generated separately, so repeat the key appearance details of the characters and places in every prompt. Put them in "scenes".
3. EDIT THE MONTAGE (auto-edit): choose, order and trim the clips, set transitions and titles to make a coherent, engaging long video. Use the clip descriptions and frames. Cut dead air and typical AI artifacts at clip edges (often the first 0.3–0.8 s and the last 0.5–1 s), drop duplicates and failed takes, keep the story order. Transitions: "cut" for continuous action, "fade" for a change of time or place, "black" for a chapter break. Titles: short (up to 6 words), only where they help. Put it in "edit".
Answer with ONLY one JSON object, no markdown:
{"reply": "short answer to the user in Russian, 1–3 sentences",
 "script": {"title": "…", "text": "the whole scenario as plain text with line breaks"},
 "scenes": [{"title": "short clip name in Russian", "seconds": 8, "prompt": "the filled reference prompt"}],
 "edit": {"clips": [{"ref": "c1", "start": 0.4, "end": 9.2, "transition": "cut", "mute": false}],
          "titles": [{"text": "…", "at": 0, "dur": 3, "pos": "bottom"}],
          "aspect": "auto", "fit": "cover"}}
Rules: include "script", "scenes" and "edit" only when needed; a question gets just "reply". In "edit", "clips" is the complete new timeline in order; "ref" is "c<N>" (a clip of the project, can be used twice) or "g<N>" (a gallery video not yet in the project) — never "a<N>" and never refs that are not listed; "start"/"end" are seconds inside that clip; "transition" is into this clip from the previous one ("cut" | "fade" | "black"); title "at" is seconds on the final timeline, "pos" is "top" | "center" | "bottom"; "aspect" is "auto" | "9:16" | "16:9" | "1:1"; "fit" is "cover" | "contain".`;
  const hist = (p.chat || []).filter(m => !m.err).slice(-12).map(m => `${m.role === 'user' ? 'User' : 'Editor'}: ${m.text || ''}${m.att?.length ? ` [attached: ${m.att.map(a => a.kind + ' "' + a.name + '"').join(', ')}]` : ''}${m.script ? `\n[script "${m.script.title}":\n${String(m.script.text).slice(0, 3000)}]` : ''}${m.scenes ? ` [wrote ${m.scenes.length} video prompts: ${m.scenes.map(s => s.title).join('; ')}]` : ''}${m.edit ? ` [edited the montage: ${m.edit}]` : ''}`).join('\n');
  const user = `${attLines.length ? `ATTACHED TO THIS MESSAGE:\n${attLines.join('\n')}\n` : ''}PROJECT "${p.name}": aspect ${p.aspect || 'auto'}, fit ${p.fit || 'cover'}, clip sound ${p.audio ? 'on' : 'off'}, total ${mtTotal(segs).toFixed(1)} s.
TIMELINE NOW:
${clipLines.join('\n') || '(empty)'}
TITLES NOW: ${(p.titles || []).length ? p.titles.map(t => `"${t.text}" at ${t.at} s for ${t.dur} s (${t.pos || 'bottom'})`).join('; ') : 'none'}
GALLERY VIDEOS NOT IN THE PROJECT (newest first):
${galLines.join('\n') || '(none)'}
${ch ? `MAIN CHARACTER: ${ch.name}${ch.about ? ' — ' + ch.about.slice(0, 300) : ''}; speaks ${lang}.\n` : ''}${hist ? `CONVERSATION SO FAR:\n${hist}\n` : ''}USER NOW: ${text}`;
  return {sys, user, media, refs};
}
const mtParse = t => { const s = String(t || '').replace(/```(?:json)?/g, ''), i = s.indexOf('{'), j = s.lastIndexOf('}'); try { return i >= 0 ? JSON.parse(s.slice(i, j + 1)) : null; } catch { return null; } };
// правка от ИИ → в проект; прежнее состояние — для «↶ Отменить»
function mtApply(p, edit, refs) {
  const snap = JSON.parse(JSON.stringify({clips: p.clips, titles: p.titles || [], aspect: p.aspect, fit: p.fit})), done = [];
  const num = (v, d) => v != null && v !== '' && Number.isFinite(+v) ? +v : d;
  if (Array.isArray(edit.clips)) {
    const out = [];
    for (const x of edit.clips) {
      const it = items.find(i => i.id === refs.get(String(x?.ref || '').trim().toLowerCase())?.id && i.blob);
      if (!it) continue;
      const full = mtLen(it), a = Math.min(Math.max(0, num(x.start, 0)), Math.max(0, full - 0.3)), b = Math.min(full, Math.max(a + 0.3, num(x.end, full)));
      out.push({k: uid(), id: it.id, a: Math.round(a * 10) / 10, b: b >= full - 0.05 ? null : Math.round(b * 10) / 10,
        tr: MT_TR.some(t => t[0] === x.transition) ? x.transition : 'cut', td: 0.6, mute: !!x.mute});
    }
    if (out.length) { p.clips = out; done.push(`${out.length} ${plur(out.length, 'клип', 'клипа', 'клипов')}`); }
  }
  if (Array.isArray(edit.titles)) {
    p.titles = edit.titles.filter(t => String(t?.text || '').trim()).slice(0, 30).map(t => ({k: uid(), text: String(t.text).trim().slice(0, 200),
      at: Math.max(0, Math.round(num(t.at, 0) * 10) / 10), dur: Math.min(30, Math.max(0.5, num(t.dur, 3))), pos: MT_POS.some(x => x[0] === t.pos) ? t.pos : 'bottom'}));
    done.push(p.titles.length ? `${p.titles.length} ${plur(p.titles.length, 'титр', 'титра', 'титров')}` : 'без титров');
  }
  if (MT_ASPECT.some(a => a[0] === edit.aspect) && edit.aspect !== p.aspect) { p.aspect = edit.aspect; done.push('формат ' + edit.aspect); }
  if (['cover', 'contain'].includes(edit.fit) && edit.fit !== p.fit) { p.fit = edit.fit; done.push(edit.fit === 'contain' ? 'кадр целиком' : 'кадр заполнен'); }
  return done.length ? {snap, text: done.join(', ') + ' · ' + mtFmt(mtTotal(mtSegs(p)))} : null;
}
function mtNeedKey() {
  mt.tab = 'chat'; mt.save();
  if (cl.mode === 'edit') renderMt();
  toast('Нужен ИИ: подключите Gemini — бесплатно (или ключ Claude в «Сценариях»)', {type: 'err', ms: 8000});
}
async function mtAsk(text, dry) {
  const p = mtProj();
  text = String(text || '').trim() || (dry ? '(ваше сообщение)' : mt.att.length ? 'Напиши сценарий по вложениям' : '');
  if (!text) return toast('Напишите, что сделать с роликом', {type: 'err'});
  const who = mtWho();
  if (dry) {
    const {sys, user, media} = await mtBrief(p, text, who, false);
    return peekShow('ИИ-монтажёр', {prompts: [['Системный промпт', sys], ['Сообщение (вместе с вложениями и кадрами клипов)', user]],
      request: {ИИ: who ? WRITERS[who].name : 'нет ключа — Gemini (бесплатно) или Claude', вложения_и_кадры: media.map(m => m[0]), отправка: who === 'claude' ? 'api.anthropic.com/v1/messages' : 'generativelanguage.googleapis.com (Gemini)'}});
  }
  if (!who) return mtNeedKey();
  if (mt.busy) return;
  const att = mt.att;
  (p.chat ||= []).push({role: 'user', text: text.slice(0, 4000), at: Date.now(), ...(att.length && {att: att.map(a => ({kind: a.kind, name: a.name, thumb: a.thumb}))})});
  mt.busy = true;
  mt.save();
  const box = $('#mtAskIn');
  if (box) box.value = '';
  renderMtChat();
  try {
    const {sys, user, media, refs} = await mtBrief(p, text, who);
    const r = await aiWrite(who, sys, user, media);
    mt.att = [];
    const j = mtParse(r.text);
    const msg = {role: 'ai', text: String(j?.reply || (j ? '' : r.text)).slice(0, 4000), at: Date.now(), by: r.by};
    if (j?.script?.text) msg.script = {title: String(j.script.title || 'Сценарий').slice(0, 120), text: String(j.script.text).slice(0, 20000)};
    if (Array.isArray(j?.scenes) && j.scenes.length) msg.scenes = j.scenes.filter(s => s?.prompt).slice(0, 30).map(s => ({title: String(s.title || '').slice(0, 80), sec: +s.seconds || null, prompt: fillBlocks(String(s.prompt))}));
    const ed = j?.edit && typeof j.edit === 'object' ? mtApply(p, j.edit, refs) : null;
    if (ed) { msg.edit = ed.text; msg.undo = ed.snap; }
    if (!msg.text && !msg.script && !msg.scenes && !msg.edit) msg.text = 'Готово.';
    p.chat.push(msg);
  } catch (e) {
    p.chat.push({role: 'ai', text: 'Не получилось: ' + e.message, err: true, at: Date.now()});
    mt.retry = text;   // текст — обратно в поле: отправить ещё раз
  } finally {
    p.chat = p.chat.slice(-60);
    mt.busy = false;
    mt.save();
    if (cl.mode === 'edit') renderMt();
    if (mt.retry && $('#mtAskIn')) $('#mtAskIn').value = mt.retry;
    mt.retry = null;
    updateGenButton();
  }
}
function renderMtChat() {
  const body = $('#mtBody');
  if (!body || mt.tab !== 'chat') return;
  const p = mtProj(), who = mtWho(), msgs = p.chat || [];
  const lastEdit = msgs.findLastIndex(m => m.undo);
  const atts = m => m.att?.length ? `<div class="mt-ma">${m.att.map(a => `<span title="${esc(a.name)}">${a.thumb ? `<img src="${a.thumb}" alt="">` : ''}${a.kind === 'video' ? '<i>▶</i>' : ''}</span>`).join('')}</div>` : '';
  const bubble = (m, i) => m.role === 'user' ? `<div class="mt-msg me">${atts(m)}<div data-noicon>${esc(m.text)}</div></div>`
    : `<div class="mt-msg ai ${m.err ? 'err' : ''}">${m.text ? `<div data-noicon>${esc(m.text).replace(/\n/g, '<br>')}</div>` : ''}
      ${m.script ? `<details class="mt-script" open><summary>📜 ${esc(m.script.title)}</summary><div data-noicon>${esc(m.script.text).replace(/\n/g, '<br>')}</div></details>
        <div class="mt-sa"><button class="btn small" data-mt-scopy="${i}">📋 Копировать</button><button class="btn small" data-mt-prompts="${i}">🎬 Промпты для видео</button></div>` : ''}
      ${m.edit ? `<div class="mt-did">✓ Смонтировал: ${esc(m.edit)}${i === lastEdit ? ` <button class="wr-link" data-mt-undo="${i}">↶ Отменить</button>` : ''}</div>` : ''}
      ${m.scenes ? `<div class="mt-scenes">${m.scenes.map((s, k) => `<details><summary><b>${k + 1}.</b> ${esc(s.title || 'Клип ' + (k + 1))}${s.sec ? ` · ${s.sec} с` : ''}</summary><div class="mt-sp" data-noicon>${blocksHTML(s.prompt)}</div></details>`).join('')}
        <div class="mt-sa"><button class="btn small primary" data-mt-scn="${i}">🎬 В «Видео» · ${m.scenes.length}</button><button class="btn small" data-mt-copy="${i}">📋 Копировать</button></div></div>` : ''}
      ${m.by ? `<small>${esc(m.by)}</small>` : ''}</div>`;
  body.innerHTML = `
    ${who ? '' : `<div class="mt-key"><button class="btn primary" data-keys-open>✦ Подключить Gemini — бесплатно</button></div>`}
    <div class="mt-chat" id="mtChat">${msgs.map(bubble).join('') || '<div class="mt-msg ai first">Пришлите картинки, инфографику, видео 📎 или просто опишите идею — напишу сценарий. Скажите «собери ролик» — сам расставлю клипы проекта, обрежу лишнее, сделаю переходы и титры.</div>'}
      ${mt.busy ? '<div class="mt-msg ai busy"><i></i><i></i><i></i></div>' : ''}</div>
    <div class="mt-att" id="mtAtt"></div>
    <div class="mt-ask"><button class="btn" data-mt-attach title="Приложить картинку, инфографику или видео" ${mt.busy ? 'disabled' : ''}>📎</button><textarea id="mtAskIn" rows="2" placeholder="Идея, вопрос или что смонтировать…" ${mt.busy ? 'disabled' : ''}></textarea><button class="btn primary" data-mt-send title="Отправить (Enter)" ${mt.busy ? 'disabled' : ''}>➤</button></div>
    <div class="mt-attm hidden" id="mtAttMenu"><button class="chip" data-mt-att-file>💻 С компьютера</button><button class="chip" data-mt-att-gal>🖼 Из галереи</button></div>
    <div class="chips mt-quick">${MT_QUICK.map(q => `<button class="chip" data-mt-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    ${who ? `<div class="mt-who">${WRITERS[who].ico} ${WRITERS[who].name}${msgs.length ? ' · <button class="wr-link" data-mt-clear>Очистить чат</button>' : ''}</div>` : ''}`;
  renderMtAtt();
  const chat = $('#mtChat');
  chat.scrollTop = chat.scrollHeight;
}
// промпты → «Видео» (как написаны, формат — как у проекта; персонаж из «Сценариев» — с его развёрткой и голосом)
function mtToScn(m) {
  const p = mt.p, ch = vc.char(wr.char), aspect = p?.aspect && p.aspect !== 'auto' ? p.aspect : '9:16';
  let added = 0;
  for (const s of m.scenes || []) {
    const scn = {...blankScn(), kind: 'video', prompt: s.prompt, aspect, fixed: true, ...(ch?.sheet && {sheet: ch.sheet}), ...(ch && {char: ch.id, voice: ch.voice})};
    const empty = cl.scn.findIndex(scnEmpty);
    if (empty >= 0) cl.scn[empty] = scn; else if (cl.scn.length < CL_MAX) cl.scn.push(scn); else break;
    added++;
  }
  if (!added) return toast(`Уже ${CL_MAX} сценариев — уберите лишние в «Видео»`, {type: 'err'});
  cl.save();
  setCreateMode('scn');
  toast(`🎬 В «Видео»: ${added} ${plur(added, 'промпт', 'промпта', 'промптов')}${added < m.scenes.length ? ` из ${m.scenes.length} — больше ${CL_MAX} за раз нельзя, остальные отправьте следующим заходом` : ''}. Готовые видео добавьте в монтаж кнопкой 🎞`, {type: 'ok', ms: 9000});
}
$('#mtCreate').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset, p = mt.p;
  if ('mtSend' in d) return mtAsk($('#mtAskIn')?.value);
  if (d.mtQ) { const box = $('#mtAskIn'); if (box) { box.value = d.mtQ; box.focus(); } return; }
  if ('mtAttach' in d) return $('#mtAttMenu')?.classList.toggle('hidden');
  if ('mtAttFile' in d) { $('#mtAttMenu')?.classList.add('hidden'); for (const f of await pickFile('image/*,video/*', true)) await mtAttach(f, f.name); return; }
  if ('mtAttGal' in d) { $('#mtAttMenu')?.classList.add('hidden'); return mtOpenPick('att'); }
  if (d.mtAttRm) { mt.att = mt.att.filter(a => a.k !== d.mtAttRm); return renderMtAtt(); }
  if ('mtClear' in d) { if (confirm('Очистить чат этого проекта?')) { p.chat = []; mt.save(); renderMtChat(); } return; }
  if (d.mtUndo) { const m = p.chat[+d.mtUndo]; if (!m?.undo) return; Object.assign(p, m.undo); delete m.undo; m.edit += ' (отменено)'; mt.save(); return renderMt(); }
  if (d.mtScn) return mtToScn(p.chat[+d.mtScn]);
  if (d.mtPrompts) return mtAsk(MT_PROMPTS_ASK);
  if (d.mtScopy) { const m = p.chat[+d.mtScopy]; return toast(await clCopyText(`${m.script.title}\n\n${m.script.text}`) ? 'Сценарий скопирован' : 'Не удалось скопировать', {type: 'ok'}); }
  if (d.mtCopy) { const m = p.chat[+d.mtCopy]; return toast(await clCopyText(m.scenes.map((s, i) => `Клип ${i + 1}. ${s.title}\n${s.prompt}`).join('\n\n')) ? 'Промпты скопированы' : 'Не удалось скопировать', {type: 'ok'}); }
});
$('#mtCreate').addEventListener('keydown', e => {
  if (e.target.id === 'mtAskIn' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); mtAsk(e.target.value); }
});
// картинку или видео можно перетащить в чат или вставить (Ctrl+V)
$('#mtCreate').addEventListener('dragover', e => { if (mt.tab === 'chat') e.preventDefault(); });
$('#mtCreate').addEventListener('drop', async e => {
  if (mt.tab !== 'chat') return;
  e.preventDefault();
  for (const f of [...(e.dataTransfer?.files || [])].filter(f => /^(image|video)\//.test(f.type))) await mtAttach(f, f.name);
});
document.addEventListener('paste', e => {
  if (cl.mode !== 'edit' || mt.tab !== 'chat') return;
  const fs = [...(e.clipboardData?.files || [])].filter(f => /^(image|video)\//.test(f.type));
  if (fs.length) { e.preventDefault(); fs.forEach(f => mtAttach(f, f.name || 'из буфера')); }
});
