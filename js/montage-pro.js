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
function mtProHTML(p) {
  const tpl = mtx.tpl, cur = p.autoTpl || '', music = (p.audios || []).find(a => !a.voice);
  if (tpl) setTimeout(mtxPreviews, 0);   // панель перерисовали — превью шаблонов снова играют
  const sel = (key, list, val) => `<select data-mtx-${key}>${list.map(([v, t]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  return `<div class="block-head"><span class="lbl">🎨 Стиль ролика <small>рендер на компьютере</small></span></div>
    <div class="mt-fl"><label>Цвет ${sel('look', MTX_LOOK, p.look || 'none')}</label></div>
    <div class="mt-fl"><label class="mt-chk"><input type="checkbox" data-mtx-cap ${p.capAuto ? 'checked' : ''}> Субтитры по речи</label>${p.capAuto ? sel('capstyle', MTX_CAPS, p.capStyle || 'box') : ''}</div>
    <div class="mt-fl"><label class="mt-chk"><input type="checkbox" data-mtx-sfx ${p.sfx ? 'checked' : ''}> Звуковые удары (свист на переходах)</label></div>
    <div class="mt-fl"><label>Бренд-цвет <input type="color" data-mtx-accent value="${p.brandAccent || '#d4ff3a'}"></label>
      <label>Шрифт <input type="text" data-mtx-font placeholder="напр. Russo One" value="${esc(p.brandFont || '')}" maxlength="40" style="width:9em"></label></div>
    <div class="mt-fl"><button class="btn small" data-mtx-beats ${music ? '' : 'disabled'} title="${music ? 'Программа найдёт биты трека: метки на таймлайне, клипы прилипают к ним' : 'Сначала добавьте музыку (＋ Звук)'}">🥁 ${p.beatsTL?.length ? `Биты: ${p.bpm} BPM ✓` : 'Найти биты трека'}</button></div>
    <div class="block-head"><span class="lbl">✦ Автомонтаж по шаблону</span></div>
    <div class="mt-note">Компьютер сам нарежет клипы проекта под бит музыки: лучшие куски, речь без пауз, переходы, эффекты, субтитры, графика.</div>
    ${tpl ? `<div class="mtx-tpl">${tpl.templates.map(t => `<button class="mtx-card ${cur === t.id ? 'on' : ''}" data-mtx-tpl="${esc(t.id)}" title="${esc(t.desc)}">
        ${t.preview ? `<video muted loop playsinline preload="none" data-src="${esc(hubLink.url(t.preview))}"></video>` : '<i></i>'}<b>${esc(t.label)}</b>${t.own ? '<small>свой</small>' : ''}</button>`).join('')}</div>`
      : `<div class="mt-fl"><button class="btn small" data-mtx-load ${mtx.tplLoading ? 'disabled' : ''}>${mtx.tplLoading ? '⏳ Загружаю шаблоны…' : '🎞 Показать шаблоны'}</button></div>`}
    <div class="mt-fl"><label>Заголовок / хук <input type="text" data-mtx-title value="${esc(p.autoTitle || '')}" maxlength="90" placeholder="Первые 2 секунды"></label></div>
    <div class="mt-fl"><label>Призыв <input type="text" data-mtx-cta value="${esc(p.autoCta || '')}" maxlength="40" placeholder="Подпишись"></label>
      <label>Длина ${sel('dur', [['15', '15 с'], ['20', '20 с'], ['30', '30 с'], ['45', '45 с']], String(p.autoDur || 20))}</label></div>
    <div class="mt-fl"><button class="btn small" data-mtx-auto="draft" ${mtx.busy ? 'disabled' : ''}>⚡ Черновик</button><button class="btn small" data-mtx-auto="final" ${mtx.busy ? 'disabled' : ''}>🎬 Смонтировать</button>
      <button class="btn small" data-mtx-auto="variants" ${mtx.busy ? 'disabled' : ''} title="3 варианта черновиками — выбрать лучший">🎲 3 варианта</button></div>
    <div class="block-head"><span class="lbl">📤 Экспорт в другие редакторы</span></div>
    <div class="mt-fl"><button class="btn small" data-mtx-export="fcpxml" ${mtx.busy ? 'disabled' : ''} title="DaVinci Resolve, Final Cut, Premiere (импорт XML) — на этом компьютере">FCPXML</button>
      <button class="btn small" data-mtx-export="otio" ${mtx.busy ? 'disabled' : ''} title="OpenTimelineIO">OTIO</button>
      <button class="btn small" data-mtx-export="srt" ${mtx.busy ? 'disabled' : ''} title="Субтитры для CapCut / YouTube">SRT</button></div>
    <div class="mt-note">Пресет Reels / TikTok / Shorts: формат 9:16, 1080×1920, 30 к/с, громкость −14 LUFS — так рендерит компьютер.</div>
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
  const tpl = MTX_INTENT.find(([, re]) => re.test(t))?.[0];
  if (!tpl || !/эдит|edit|смонтир|монтаж|нарежь|сделай|собери|ролик|видео|рилс|reel/i.test(t) && !/аур|aura|velocity|велосит/i.test(t)) return null;
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
    p.chat.push({role: 'ai', text: 'Сначала добавьте в проект клипы из галереи (вкладка «🎞 Монтаж» → ＋ Видео), а лучше и музыку (＋ Звук) — и напишите ещё раз.', at: Date.now()});
    mt.save(); return renderMtChat();
  }
  p.autoTpl = it.template;
  if (it.hook) p.autoTitle = it.hook;
  if (it.duration) p.autoDur = it.duration;
  p.chat.push({role: 'ai', text: `Собираю «${label}» на компьютере из ${mtSegs(p).length} клипов${(p.audios || []).some(a => !a.voice) ? ' под ваш трек' : ' (музыки в проекте нет — ровный ритм; добавьте трек для монтажа под бит)'}` +
    `${it.mode === 'variants' ? ', 3 варианта черновиками' : it.mode === 'final' ? ', сразу в 1080p' : ', черновиком 540p — понравится, нажмите «🎬 Смонтировать» или напишите «финал»'}. ` +
    'Карточка в галерее покажет ход, готовый ролик придёт туда же.', at: Date.now(), by: 'Freefield на компьютере'});
  mt.save(); renderMtChat();
  await mtxAuto(it.mode, true);   // шаблон из чата — целиком: цвет и субтитры шаблона, не настройки панели
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
    const j = await mtxPost('/api/montage/auto', {clips: [...seen.values()], music: music?.src, template: p.autoTpl || undefined, duration: p.autoDur || 20,
      title: p.autoTitle || undefined, hook: p.autoTitle || undefined, cta: p.autoCta || undefined, caption_style: p.capAuto && !pure ? p.capStyle : undefined,
      look: p.look && p.look !== 'none' && !pure ? p.look : undefined, brand: p.brandAccent || p.brandFont ? {accent: p.brandAccent, font: p.brandFont} : undefined,
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
  if (d.mtxTpl !== undefined) { p.autoTpl = p.autoTpl === d.mtxTpl ? '' : d.mtxTpl; mt.save(); renderMtEdit(); return setTimeout(mtxPreviews, 50); }
  if (d.mtxAuto) return mtxAuto(d.mtxAuto);
  if ('mtxBeats' in d) return mtxBeats();
  if (d.mtxExport) return mtxExport(d.mtxExport);
});
$('#mtCreate').addEventListener('change', e => {
  const el = e.target, d = el.dataset, p = mt.p;
  if (!p) return;
  if ('mtxLook' in d) p.look = el.value;
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
