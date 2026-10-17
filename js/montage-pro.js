'use strict';
/* ---- Монтаж PRO (план «лучше Katana», этап 7): то, что считает программа Freefield на компьютере (ffmpeg, видеокарта, Whisper):
   эффекты клипа, стиль ролика (цвет, субтитры по речи, звуковые удары, бренд), автомонтаж по шаблону из клипов проекта (с превью шаблонов),
   биты трека — метки на таймлайне и прилипание к ним, экспорт в DaVinci / Premiere (FCPXML, OTIO) и CapCut (SRT).
   В просмотре браузера эффектов не видно — они в «🖥 Отрендерить на компьютере» и в автомонтаже ---- */
const MTX_FX = [['shake', '📳 Тряска'], ['flash', '⚡ Вспышка'], ['rgb', '🌈 Глитч'], ['blur', '💨 Смаз'], ['reverse', '⏪ Реверс'], ['beats', '🥁 Удары на бит'], ['smooth', '🫧 Плавное слоумо']];
const MTX_SPEED = [[0.5, '0,5×'], [0.75, '0,75×'], [1, '1×'], [1.5, '1,5×'], [2, '2×']];
const MTX_LOOK = [['none', 'Как есть'], ['teal_orange', 'Бирюза-оранж'], ['film', 'Плёнка'], ['bw', 'Ч/б'], ['neon', 'Неон'], ['warm', 'Тёплый'], ['cold', 'Холодный'], ['aura', 'Аура']];
const MTX_CAPS = [['pop', 'Всплытие'], ['box', 'Плашка'], ['word', 'По слову'], ['karaoke', 'Караоке'], ['outline', 'Обводка'], ['neon', 'Неон'], ['minimal', 'Минимал'],
  ['typewriter', 'Печать'], ['bounce', 'Прыжок'], ['gradient', 'Градиент']];
const mtx = {tpl: null, tplLoading: false, busy: '', note: ''};

// ---- проект приложения → поля montage.json (вызывается из mtPcProject) ----
function mtProApply(project, p, segs) {
  const beats = p.beatsTL || [];
  project.tracks.video.forEach((v, i) => {
    const c = segs[i]?.c, fx = c?.fx || {};
    if (!c) return;
    if (fx.speed && fx.speed !== 1) {   // скорость: длина на таймлайне та же, из файла берётся больше / меньше
      const it = segs[i].it, full = it?._dur || it?.duration || 1e9;
      v.speed = fx.speed; v.out = Math.min(full, v.in + (v.out - v.in) * fx.speed);
    }
    v.fx = {...(fx.shake ? {shake: {amount: 0.45}} : {}), ...(fx.flash ? {flash: true} : {}), ...(fx.rgb ? {rgb: true} : {}), ...(fx.blur ? {blur: true} : {}),
      ...(fx.reverse ? {reverse: true} : {}), ...(fx.smooth ? {smooth: true} : {}), punch: [], drift: 0};
    if (fx.beats || fx.shake || fx.flash || fx.rgb) {   // удары — на битах трека внутри клипа (нет битов — в начале клипа)
      const len = segs[i].len, at = v.at;
      const hits = beats.filter((b, k) => k % 2 === 0 && b >= at && b < at + len).map(b => +(b - at).toFixed(3));
      v.fx.punch = hits.length ? hits : [0];
      v.fx.punch_amount = fx.beats ? 0.07 : 0;
    }
  });
  if (p.look && p.look !== 'none') project.look = {preset: p.look, vignette: true, grain: p.look === 'film' ? 0.4 : 0};
  if (p.capAuto) project.tracks.captions = {style: p.capStyle || 'box', auto: true, words: []};
  if (p.sfx) project.sfx = {transitions: true, hits: !!beats.length, volume: 0.5};
  if (p.brandAccent || p.brandFont) project.brand = {accent: p.brandAccent || undefined, font: p.brandFont || undefined};
  if (beats.length) project.music = {beats: beats.map(b => +b.toFixed(3))};
}

// ---- выделенный клип: эффекты ----
function mtProClipHTML(o) {
  const fx = o.fx || {}, sp = fx.speed || 1;
  return `<div class="block-head"><span class="lbl">✨ Эффекты <small>видно в рендере на компьютере</small></span></div>
    <div class="mt-fl mtx-chips">${MTX_FX.map(([k, t]) => `<button class="chip ${fx[k] ? 'on' : ''}" data-mtx-fx="${k}" data-k="${o.k}">${t}</button>`).join('')}</div>
    <div class="mt-fl"><span>Скорость</span><div class="seg">${MTX_SPEED.map(([v, t]) => `<button class="${sp === v ? 'on' : ''}" data-mtx-speed="${v}" data-k="${o.k}">${t}</button>`).join('')}</div></div>`;
}

// ---- весь ролик: стиль, автомонтаж, биты, экспорт ----
// Панель «Монтаж» — только главное (пользователь 2026-10-17: «удали всё лишнее из кнопки монтаж»): шаблон, трек, черновик / смонтировать.
// Цвет, субтитры, звуковые удары, бренд, биты, хук, призыв, длина, варианты и экспорт задаёт шаблон (их умеет и ИИ-монтажёр, и агент через MCP)
const MTX_TPL = [['', '✨ Авто — скетч, в режиме «Брейнрот» — брейнрот'], ['sketch', 'Скетч — сценка с речью'], ['brainrot', 'Брейнрот — мем-ролик'],
  ['aura', 'Aura edit'], ['velocity', 'Velocity edit'], ['trailer', 'Кино-трейлер'], ['talking', 'Говорящая голова']];
function mtProHTML(p) {
  const cur = p.autoTpl || '', music = (p.audios || []).find(a => !a.voice);
  const list = MTX_TPL.some(([v]) => v === cur) ? MTX_TPL : [...MTX_TPL, [cur, cur]];   // свой шаблон (по образцу) — тоже в списке
  return `<div class="block-head"><span class="lbl">✦ Автомонтаж</span></div>
    <div class="mt-fl"><label>Шаблон <select data-mtx-tplsel>${list.map(([v, t]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
    <div class="mt-fl mtx-track"><button class="btn small" data-mtx-track title="Песня или бит: Freefield найдёт темп и дроп и смонтирует под него">🎵 ${music ? 'Другой трек' : 'Трек (необязательно)'}</button>
      ${music ? `<span class="mt-note">«${esc(music.name)}»${p.bpm ? ` · ${p.bpm} BPM` : ''}</span>` : ''}</div>
    <div class="mt-fl"><button class="btn small" data-mtx-auto="draft" ${mtx.busy ? 'disabled' : ''}>⚡ Черновик</button><button class="btn small primary" data-mtx-auto="final" ${mtx.busy ? 'disabled' : ''}>🎬 Смонтировать</button></div>
    <div class="mt-fl"><span class="mt-note" id="mtxNote">${mtx.busy ? '⏳ ' + esc(mtx.note) : ''}</span></div>`;
}

// превью шаблонов играют, только когда на виду (галерея не грузит лишнего)
function mtxPreviews() {
  for (const v of $$('#mtBody .mtx-card video[data-src]')) {
    if (!v.src) v.src = v.dataset.src;
    v.play?.().catch(() => {});
  }
}
async function mtxLoadTpl() {
  if (mtx.tplLoading) return;
  mtx.tplLoading = true; renderMtEdit();
  try {
    if (!(await hubReady())) throw new Error('нужна программа Freefield на компьютере');
    const r = await fetch(hubLink.url('/api/montage/templates'));
    if (!r.ok) throw new Error(r.status === 404 ? 'обновите программу Freefield на компьютере' : 'компьютер ответил ' + r.status);
    mtx.tpl = await r.json();
  } catch (e) { toast('Шаблоны: ' + e.message, {type: 'err', ms: 7000}); }
  finally { mtx.tplLoading = false; renderMtEdit(); setTimeout(mtxPreviews, 50); }
}
const mtxNote = t => { mtx.note = t; const el = $('#mtxNote'); if (el) el.textContent = t ? '⏳ ' + t : ''; };
async function mtxMusicSrc(p) {
  const a = (p.audios || []).find(x => !x.voice);
  if (!a) return null;
  const got = await mtAudGet(a.src);
  return got?.blob ? {src: await mtPcSrc(got.blob, null, mtxNote), a} : null;
}
async function mtxRun(kind, fn) {
  if (mtx.busy) return;
  mtx.busy = kind; renderMtEdit();
  try {
    if (!(await hubReady())) throw new Error('нужна программа Freefield на компьютере: откройте Freefield с компьютера или по QR-коду');
    await fn();
  } catch (e) { toast(e.message, {type: 'err', ms: 9000}); }
  finally { mtx.busy = ''; mtx.note = ''; renderMtEdit(); setTimeout(mtxPreviews, 50); }
}
const mtxPost = async (url, body) => {
  const r = await fetch(hubLink.url(url), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `компьютер ответил ${r.status}${r.status === 404 ? ' — обновите программу Freefield на компьютере' : ''}`);
  return j;
};

// «ИИ-монтажёр»: «сделай эдит типа аура фарминг», «velocity эдит под фонк», «смонтируй как запуск продукта» → шаблон на компьютере,
// без ключа ИИ. Хук — текст в кавычках («…» или "…"); «короткий» / «на 15 секунд» — длина; «3 варианта» — три черновика
const MTX_INTENT = [
  ['aura', /аур|aura|эстетик|aesthetic|фарминг|farming|сигм|sigma|вайб|vibe/i],
  ['velocity', /velocity|велосит|ускорен|замедлен|speed ?ramp|фонк|phonk|динамичн|резк/i],
  ['launch', /запуск|launch|анонс|презентац|продукт|apple/i],
  ['demo', /демо|demo|интерфейс|запись экрана|скринкаст|screen/i],
  ['talking', /говорящ|talking|голова|подкаст|интервью|блог/i],
  ['reel', /рилс по формуле|по формуле|хук|reels?|рилс/i],
];
function mtxChatIntent(text) {
  const t = String(text || '');
  // после черновика: «финал» / «давай в 1080» / «ещё 3 варианта» — тот же шаблон
  const last = mt.p?.autoTpl;
  if (last && /^\s*(финал|давай финал|в 1080|чисто|готово|делай финал)(?=[\s.,!?]|$)/i.test(t)) return {template: last, mode: 'final'};
  if (last && /^\s*(ещё|еще)\s*(3|три)?\s*вариант/i.test(t)) return {template: last, mode: 'variants'};
  let tpl = MTX_INTENT.find(([, re]) => re.test(t))?.[0];
  // «сделай эдит под этот трек» без стиля — по темпу трека: быстрый (от 115 BPM) — velocity, медленный — aura
  if (!tpl && /эдит|edit|под (этот |мой )?трек|под (эту )?музык|под (эту )?песн/i.test(t)) tpl = (mt.p?.bpm || 0) >= 115 ? 'velocity' : 'aura';
  if (!tpl || !/эдит|edit|смонтир|монтаж|нарежь|сделай|собери|ролик|видео|рилс|reel|трек|музык|песн/i.test(t) && !/аур|aura|velocity|велосит/i.test(t)) return null;
  const hook = /[«"“]([^»"”]{2,90})[»"”]/.exec(t)?.[1];
  const sec = +(/(\d{1,2})\s*(?:сек|с(?=[\s.,!?]|$)|s(?=[\s.,!?]|$))/i.exec(t)?.[1] || 0);
  return {template: tpl, hook, duration: sec >= 6 && sec <= 60 ? sec : /коротк/i.test(t) ? 15 : /длинн/i.test(t) ? 30 : null,
    mode: /(\d|три|3)\s*вариант/i.test(t) ? 'variants' : /финал|чисто|1080|готов/i.test(t) ? 'final' : 'draft'};
}
async function mtxChatRun(p, text, it) {
  const label = mtx.tpl?.templates.find(x => x.id === it.template)?.label || {aura: 'Aura edit', velocity: 'Velocity edit', launch: 'Запуск продукта', demo: 'Демо интерфейса', reel: 'Рилс по формуле', talking: 'Говорящая голова'}[it.template];
  (p.chat ||= []).push({role: 'user', text: text.slice(0, 4000), at: Date.now()});
  const box = $('#mtAskIn');
  if (box) box.value = '';
  if (!mtSegs(p).length) {
    p.chat.push({role: 'ai', text: 'Сначала добавьте в проект клипы из галереи (вкладка «🎞 Монтаж» → ＋ Видео), а трек приложите скрепкой 📎 сюда или кнопкой «🎵 Загрузить трек» — и напишите ещё раз.', at: Date.now()});
    mt.save(); return renderMtChat();
  }
  p.autoTpl = it.template;
  if (it.hook) p.autoTitle = it.hook;
  if (it.duration) p.autoDur = it.duration;
  p.chat.push({role: 'ai', text: `Собираю «${label}» на компьютере из ${mtSegs(p).length} клипов${(p.audios || []).some(a => !a.voice) ? ' под ваш трек' : ' (трека нет — ровный ритм 120 BPM; приложите трек скрепкой 📎, и эдит смонтируется под него)'}` +
    `${it.mode === 'variants' ? ', 3 варианта черновиками' : it.mode === 'final' ? ', сразу в 1080p' : ', черновиком 540p — понравится, нажмите «🎬 Смонтировать» или напишите «финал»'}. ` +
    'Карточка в галерее покажет ход, готовый ролик придёт туда же.', at: Date.now(), by: 'Freefield на компьютере'});
  mt.save(); renderMtChat();
  await mtxAuto(it.mode, true);   // шаблон из чата — целиком: цвет и субтитры шаблона, не настройки панели
}

// свой трек для эдита (пользователь 2026-10-15: «добавь возможность загрузить трек и сделать эдит под него»): трек проекта заменяется,
// компьютер сразу находит его темп и дроп — эдит («Смонтировать», шаблон или «сделай эдит» в «ИИ-монтажёре») режется под него
async function mtxSetTrack(file, name, fromChat = false) {
  const p = mtProj();
  name = String(name || file.name || 'трек').replace(/\.\w+$/, '').slice(0, 80);
  p.audios = (p.audios || []).filter(a => a.voice);   // прежняя музыка уходит, озвучка остаётся
  p.beatsTL = p.downTL = null; p.bpm = null;
  await mtAddAudio(file, name, {at: 0, vol: 1, fadeOut: 1.5});
  if (!(p.audios || []).some(a => !a.voice)) return;   // не прочитался — mtAddAudio уже сказал
  mt.save(); mtTl.rk = ''; renderMt();
  if (fromChat) { (p.chat ||= []).push({role: 'ai', text: `🎵 Трек «${name}» — эдит смонтирую под него. Напишите стиль: «сделай эдит типа аура», «velocity», «кино-трейлер» — или просто «сделай эдит под трек».`, at: Date.now(), by: 'Freefield'}); mt.save(); renderMtChat(); }
  else toast(`🎵 Трек «${name}» в проекте — выберите шаблон и нажмите «Смонтировать»`, {type: 'ok', ms: 6000});
  if (hubLink.ok || await hubReady().catch(() => false)) mtxBeats();   // темп и дроп — сразу
}

// автомонтаж клипов проекта
function mtxAuto(mode, pure = false) {
  const p = mtProj(), segs = mtSegs(p);
  if (!segs.length) { toast('Добавьте видео из галереи', {type: 'err'}); return mtOpenPick(); }
  return mtxRun('auto', async () => {
    const seen = new Map();
    for (const s of segs) if (!seen.has(s.it.id)) seen.set(s.it.id, await mtPcSrc(s.it.blob, s.it.pcName, mtxNote));
    const music = await mtxMusicSrc(p);
    mtxNote('отправляю на компьютер…');
    const [W, H] = mtOutDims(p, segs);
    const own = !pure;   // свои настройки стиля (старые проекты, ИИ-монтажёр) — только не из главной кнопки панели
    const j = await mtxPost('/api/montage/auto', {clips: [...seen.values()], music: music?.src, template: p.autoTpl || undefined, duration: own ? p.autoDur || 20 : undefined,
      title: own && p.autoTitle || undefined, hook: own && p.autoTitle || undefined, cta: own && p.autoCta || undefined, caption_style: p.capAuto && own ? p.capStyle : undefined,
      look: p.look && p.look !== 'none' && own ? p.look : undefined, brand: own && (p.brandAccent || p.brandFont) ? {accent: p.brandAccent, font: p.brandFont} : undefined,
      aspect: p.aspect && p.aspect !== 'auto' ? p.aspect : W > H * 1.2 ? '16:9' : W > H * 0.9 ? '1:1' : '9:16',
      quality: mode === 'final' ? 'final' : 'draft', variants: mode === 'variants' ? 3 : 1});
    if (!j.id) throw new Error('компьютер не принял задание');
    toast(mode === 'variants' ? '🎲 3 варианта монтируются на компьютере — карточки в галерее' : '✦ Автомонтаж идёт на компьютере — карточка в галерее покажет ход', {type: 'ok', ms: 7000});
    if (isMobile()) setView('gallery');
    hubLink.refresh();
  });
}
// биты трека → метки и прилипание (время — на шкале проекта: момент в файле − начало куска файла + место звука)
function mtxBeats() {
  const p = mtProj();
  return mtxRun('beats', async () => {
    const m = await mtxMusicSrc(p);
    if (!m) throw new Error('добавьте музыку (＋ Звук)');
    mtxNote('ищу биты…');
    const j = await mtxPost('/api/montage/beats', {src: m.src});
    const a = m.a, from = a.a || 0, to = a.b ?? a.dur ?? 1e9;
    p.bpm = j.bpm;
    p.beatsTL = j.beats.filter(b => b >= from && b <= to).map(b => +(b - from + (a.at || 0)).toFixed(3));
    p.downTL = j.downbeats.filter(b => b >= from && b <= to).map(b => +(b - from + (a.at || 0)).toFixed(3));
    mt.save(); mtTl.rk = ''; mtTl();
    toast(`🥁 ${j.bpm} BPM, ${p.beatsTL.length} битов — клипы и титры прилипают к ним`, {type: 'ok'});
  });
}
// экспорт: проект → файл
function mtxExport(fmt) {
  const p = mtProj();
  if (!mtSegs(p).length) { toast('Добавьте видео из галереи', {type: 'err'}); return; }
  return mtxRun('export', async () => {
    const {project} = await mtPcProject(p, mtxNote);
    if (fmt === 'srt' && !project.tracks.captions.auto) project.tracks.captions = {style: 'box', auto: true, words: []};
    mtxNote(fmt === 'srt' ? 'распознаю речь…' : 'готовлю файл…');
    const j = await mtxPost('/api/montage/export', {project, formats: [fmt]});
    if (!j[fmt]) throw new Error(fmt === 'srt' ? 'в клипах не нашлось речи' : 'файл не получился');
    const name = `freefield-${(p.name || 'montage').replace(/[^\wа-яё-]+/gi, '-').slice(0, 40)}.${fmt}`;
    saveFile(new Blob([fmt === 'srt' ? '﻿' + j[fmt] : j[fmt]], {type: 'text/plain'}), name);
    if (fmt !== 'srt') toast('Файл ссылается на видео на компьютере — открывайте его в редакторе на этом же компьютере', {ms: 8000});
  });
}

$('#mtCreate').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset, p = mt.p;
  if (!p) return;
  if (d.mtxFx) {
    const c = p.clips.find(x => x.k === d.k);
    if (!c) return;
    const fx = c.fx ||= {};
    fx[d.mtxFx] = !fx[d.mtxFx];
    mt.save(); return renderMtEdit();
  }
  if (d.mtxSpeed) { const c = p.clips.find(x => x.k === d.k); if (c) { (c.fx ||= {}).speed = +d.mtxSpeed; mt.save(); renderMtEdit(); } return; }
  if ('mtxLoad' in d) return mtxLoadTpl();
  if ('mtxTrack' in d) return pickFile('audio/*,video/*', false).then(f => f && mtxSetTrack(f, f.name));
  if (d.mtxTpl !== undefined) { p.autoTpl = p.autoTpl === d.mtxTpl ? '' : d.mtxTpl; mt.save(); renderMtEdit(); return setTimeout(mtxPreviews, 50); }
  if (d.mtxAuto) return mtxAuto(d.mtxAuto, true);   // панель — только шаблон и трек: остальное задаёт шаблон
  if ('mtxBeats' in d) return mtxBeats();
  if (d.mtxExport) return mtxExport(d.mtxExport);
});
$('#mtCreate').addEventListener('change', e => {
  const el = e.target, d = el.dataset, p = mt.p;
  if (!p) return;
  if ('mtxTplsel' in d) p.autoTpl = el.value;
  else if ('mtxLook' in d) p.look = el.value;
  else if ('mtxCap' in d) { p.capAuto = el.checked; mt.save(); return renderMtEdit(); }
  else if ('mtxCapstyle' in d) p.capStyle = el.value;
  else if ('mtxSfx' in d) p.sfx = el.checked;
  else if ('mtxAccent' in d) p.brandAccent = el.value;
  else if ('mtxFont' in d) p.brandFont = el.value.trim().replace(/[^A-Za-z0-9 ]/g, '').slice(0, 40);
  else if ('mtxTitle' in d) p.autoTitle = el.value.trim().slice(0, 90);
  else if ('mtxCta' in d) p.autoCta = el.value.trim().slice(0, 40);
  else if ('mtxDur' in d) p.autoDur = +el.value;
  else return;
  mt.save();
});
