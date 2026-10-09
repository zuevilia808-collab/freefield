'use strict';
/* =============================== gallery =============================== */
const urls = new Map();
function urlOf(blob) {
  if (!blob) return '';
  if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob));
  return urls.get(blob);
}

function visibleItems() {
  const q = $('#search').value.trim().toLowerCase();
  return items.filter(it =>
    (state.filter === 'all' || it.type === state.filter) &&
    (!state.siteProj || it.siteProject === state.siteProj) &&
    (!q || (it.prompt + ' ' + (it.finalPrompt || '') + ' ' + (it.modelTitle || '') + ' ' + (vc.char(it.char)?.name || '')).toLowerCase().includes(q)));
}

function tierBadge(it) {
  return it.tier === 'paid' ? `<span class="tier paid">${it.cost != null ? fmtUSD(it.cost) : 'Paid'}</span>` : '<span class="tier free">Free</span>';
}

function extQuota(m) {
  const left = extLeft(m);
  return (left != null ? `осталось ${left} из ${m.count.n} · ` : '') + `${m.credits} → ${m.equiv}`;
}

// карточка «без компьютера»: фото, промпт и настройки для сайта сервиса; «Создать» на сайте нажимает пользователь
function phoneCardHTML(it, m) {
  const p = it.phone, refs = it.refs || [], video = it.type === 'video', site = SITE_SHORT[p.site] || m.site;
  const set = [p.engine, p.site !== 'arena' && it.aspect, p.count && `×${p.count}`].filter(Boolean).join(' · ');
  const many = p.count > 1 || p.site === 'dola' || p.site === 'arena';   // сайт отдаёт сразу несколько вариантов
  // персонаж с образцом голоса: в Dola — аудио-референс @Audio1, во Flow — образец голоса (Omni) или сохранённый голос @Имя
  const ch = video && vc.char(it.char), smp = ch?.sample && ['flow', 'dola'].includes(p.site);
  const voiceStep = !video || !ch ? '' : p.site === 'flow' && ch.flow?.name ? `<li>Голос: в промпте уже стоит ${ch.flow.kind === 'char' ? '@' + esc(ch.flow.name) : '@Voice: ' + esc(ch.flow.name)} — Flow возьмёт ваш сохранённый ${ch.flow.kind === 'char' ? 'персонаж' : 'голос'}</li>`
    : smp ? `<li>Голос: сохраните образец (🎧 ниже) и приложите его на сайте ${p.site === 'dola' ? 'аудио-референсом — в промпте он @Audio1' : 'как образец голоса (voice reference)'}</li>` : '';
  return `<div class="card ext" data-id="${it.id}">
    <button class="ext-del" data-act="delete" title="Удалить">✕</button>
    <div class="ext-head"><span class="mc-ico" style="${icoStyle(m)}">${esc(initials(m))}</span>
      <div><b>${p.of > 1 ? `${p.n}/${p.of} · ` : ''}${esc(site)} · ${video ? 'видео' : 'фото'}</b><div class="hint">${esc(set)}${p.info ? ' · ' + esc(p.info) : ''}</div></div></div>
    <ol class="ext-steps">
      ${refs.length ? `<li>Сохраните фото (💾 ниже) — на сайте приложите ${refs.length > 1 ? 'их' : 'его'} к запросу</li>` : ''}
      ${voiceStep}
      <li>Нажмите «Скопировать промпт и открыть ${esc(site)}» — ${isConnected(p.site) ? 'вход уже выполнен' : 'войдите в аккаунт (один раз — браузер запомнит)'}</li>
      <li>Выберите <b>${esc(set)}</b>, вставьте промпт (${pwa.mobile() ? 'долгое нажатие → «Вставить»' : 'Ctrl+V'}) и нажмите «Создать»</li>
      <li>Скачайте готов${video ? 'ое видео' : 'ую картинку'} и нажмите «📥 Загрузить файл»${many ? ' — можно сразу все варианты' : ''}</li>
    </ol>
    ${p.site === 'vids' && pwa.mobile() ? '<div class="ext-warn">Google Vids с телефона видео не создаёт — только с компьютера. Попробуйте в меню браузера ⋮ «Версия для ПК» или сделайте этот сценарий во Flow.</div>' : ''}
    ${refs.length ? `<div class="ext-refs">${refs.map((src, k) => `<button data-act="save-ref" data-k="${k}" title="Сохранить это фото"><img src="${src}" alt=""><i>💾</i></button>`).join('')}</div>` : ''}
    ${smp ? `<div class="ext-voice">🎧 ${esc(ch.name)}<audio controls preload="none" src="${ch.sample}"></audio></div>` : ''}
    <div class="ext-prompt">${esc(it.finalPrompt)}</div>
    <div class="ext-actions">
      <button data-act="open-site" class="primary">↗ Скопировать промпт и открыть ${esc(site)}</button>
      ${refs.length ? '<button data-act="save-refs">💾 Сохранить фото</button>' : '<button data-act="copy">📋 Только промпт</button>'}
      ${smp ? '<button data-act="save-voice">🎧 Сохранить голос</button>' : ''}
      <button data-act="import">📥 Загрузить файл</button>
    </div>
    ${pwa.mobile() ? '' : autoImportBarHTML()}
  </div>`;
}

// data URL фото-референса → файл (синхронно: «Поделиться» на iPhone работает только сразу после нажатия)
function dataUrlFile(d, name) {
  const [head, b64] = String(d).split(','), type = head.match(/^data:([^;,]+)/)?.[1] || 'image/jpeg';
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], `${name}.${type.split('/')[1] || 'jpg'}`, {type});
}
// фото карточки — в память телефона, чтобы приложить их на сайте сервиса:
// в APK — в «Документы/Freefield», на iPhone — «Поделиться» → «Сохранить изображение», в остальных — в «Загрузки»
async function saveRefs(it, list) {
  const files = list.map((d, k) => dataUrlFile(d, `freefield-${it.id}-${k + 1}`));
  if (!files.length) return;
  if (native.on()) {
    for (const f of files) {
      try { await native.save(f, f.name); } catch (e) { return toast('Не удалось сохранить: ' + e.message, {type: 'err'}); }
    }
    return;
  }
  if (pwa.ios() && navigator.canShare?.({files})) return navigator.share({files}).catch(() => {});
  for (const [k, f] of files.entries()) {
    if (k) await sleep(500);   // несколько загрузок подряд браузер иначе отбрасывает
    const a = document.createElement('a'), url = URL.createObjectURL(f);
    a.href = url; a.download = f.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  toast(files.length > 1 ? `Фото сохранены (${files.length}) — в «Загрузках»` : 'Фото сохранено — в «Загрузках»', {type: 'ok'});
}

function externalCardHTML(it) {
  const m = allModels().find(x => x.id === it.model) || {};
  if (it.phone) return phoneCardHTML(it, m);
  const video = it.type === 'video';
  return `<div class="card ext" data-id="${it.id}">
    <button class="ext-del" data-act="delete" title="Удалить">✕</button>
    <div class="ext-head"><span class="mc-ico" style="${icoStyle(m)}">${esc(initials(m))}</span>
      <div><b>${esc(m.title || 'Google')}</b><div class="hint">бесплатно · ${extQuota(m)}</div></div></div>
    ${it.statusText ? `<div class="ext-wait"><div class="spin"></div>${esc(it.statusText)}</div>` : `
    <ol class="ext-steps">
      <li>Нажмите кнопку ниже — промпт скопируется, ${esc(m.site)} откроется в окне рядом</li>
      <li>${isConnected(m.service) ? 'Вы уже входили — просто' : 'Войдите в свой аккаунт (один раз — браузер запомнит), затем'} выберите ${esc(m.engine)} и вставьте промпт</li>
      <li>Скачайте готов${video ? 'ый ролик' : 'ую картинку'} — ${autoImport.active() ? 'Freefield заберёт файл сам' : 'и загрузите сюда'}</li>
    </ol>
    <div class="ext-prompt">${esc(it.finalPrompt)}</div>
    <div class="ext-actions">
      <button data-act="open-site" class="primary">↗ Скопировать промпт и открыть ${esc(m.site)}</button>
      <button data-act="import">📥 Загрузить файл</button>
      ${video ? '<button data-act="copy">📋 Только промпт</button>' : '<button data-act="paste-clip">📋 Вставить из буфера</button>'}
    </div>
    ${autoImportBarHTML()}`}
  </div>`;
}

function cardHTML(it) {
  const ar = `aspect-ratio:${it.w}/${it.h}`;
  const paid = it.tier === 'paid' ? 'paid' : '';
  if (it.status === 'external') return externalCardHTML(it);
  if (it.status !== 'done') {
    const err = it.status === 'error';
    return `<div class="card pending ${paid} ${err ? 'err' : ''}" data-id="${it.id}" style="${ar}">
      ${it.posterBlob ? `<div class="bg" style="background-image:url('${urlOf(it.posterBlob)}')"></div>` : ''}
      ${err ? '' : '<div class="shimmer"></div>'}
      <div class="pend-info">
        <div class="spin"></div>
        <div class="pend-kind">${it.type === 'video' ? '🎬' : '🖼'} ${esc(it.modelTitle || '')} ${tierBadge(it)}</div>
        <div class="pend-status" data-status>${esc(it.statusText)}</div>
        ${err ? '' : '<div class="pend-time" data-time></div>'}
        <div class="pend-prompt">${esc(it.prompt)}</div>
        ${err ? '<div class="pend-actions"><button data-act="delete">Удалить</button></div>' : ''}
      </div></div>`;
  }
  if (it.type === 'model') return m3dCardHTML(it);
  const media = it.type === 'video'
    ? `<video data-src="${urlOf(it.blob)}" ${it.posterBlob ? `poster="${urlOf(it.posterBlob)}"` : ''} muted loop playsinline preload="none"></video><span class="badge">▶ ${it.duration != null ? it.duration + ' с' : 'видео'}</span>`
    : `<img src="${urlOf(it.blob)}" alt="${esc(it.prompt)}" loading="lazy">`;
  return `<div class="card ${paid}" data-id="${it.id}" style="${ar}">${media}
    <div class="card-ov">
      <div class="card-actions">
        ${it.type === 'image' ? '<button class="act wide" data-act="animate" title="Сделать видео из этой картинки">🎬 Оживить</button>' : ''}
        ${it.type === 'image' ? '<button class="act" data-act="to3d" title="🧊 3D-модель из этой картинки (на компьютере)">🧊</button>' : ''}
        ${it.type === 'video' ? '<button class="act" data-act="revoice" title="Заменить голос — на образец голоса персонажа">🎙</button>' : ''}
        ${it.type === 'video' && it.blob ? '<button class="act" data-act="to-mt" title="🎞 В монтаж — добавить в текущий проект">🎞</button>' : ''}
        ${String(it.model).startsWith('ext:') ? '<button class="act" data-act="variation" title="Ещё вариант">↻</button>' : ''}
        <button class="act" data-act="reuse" title="Повторить с этими настройками">✎</button>
        <button class="act" data-act="download" title="Скачать">⤓</button>
        <button class="act" data-act="delete" title="Удалить">🗑</button>
      </div>
      <div class="card-foot">
        ${it.siteProject ? `<div class="card-site">🌐 Сайт: ${esc(it.siteProject)}</div>` : ''}
        <div class="card-prompt">${esc(it.prompt)}</div>
        <div class="card-model">${tierBadge(it)} ${esc(it.modelTitle || '')}</div>
      </div>
    </div></div>`;
}

// видео в галерее грузится, только когда карточка рядом с экраном, и отпускается, когда уехала далеко:
// иначе браузер держит плеер на каждое видео, упирается в лимит и подвисает (мигание и «не нажимается»)
let vidIO = null;
function vidRelease(v) { if (!v.getAttribute('src')) return; v.pause(); v.removeAttribute('src'); v.load(); }
function vidWatch(v) {
  vidIO ||= new IntersectionObserver(es => es.forEach(e => {
    const v = e.target;
    if (!e.isIntersecting) vidRelease(v);
    else if (!v.getAttribute('src') && v.isConnected) { v.preload = 'metadata'; v.src = v.dataset.src; }
  }), {root: $('#feed'), rootMargin: '600px 0px'});
  vidIO.observe(v);
}
function vidUnwatch(root) { root.querySelectorAll('video[data-src]').forEach(v => { vidIO?.unobserve(v); vidRelease(v); }); }
function bindCard(el) {
  const v = el.querySelector('video');
  if (!v) return;
  vidWatch(v);
  el.addEventListener('mouseenter', () => v.play().catch(() => {}));
  el.addEventListener('mouseleave', () => v.pause());
}

let lastCols = 0;
function colCount() {
  const w = $('#grid').clientWidth || $('#feed').clientWidth - 24;
  const min = w < 700 ? 150 : 260;
  return Math.max(isMobile() ? 2 : 1, Math.floor((w + 12) / (min + 12)));
}
// галерея не перерисовывается целиком: карточка, у которой ничего не поменялось, остаётся тем же элементом
// (пользователь 2026-10-09: при каждом заходе все фото грузились заново — галерея мигала)
function cardEl(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const el = t.content.firstElementChild;
  el._html = html;
  bindCard(el);
  return el;
}
// фильтр «🌐 Сайт: <проект>» — виден, когда в галерее есть картинки для сайта
function siteFilterSync() {
  const sel = $('#siteFilter');
  if (!sel) return;
  const names = [...new Set(items.map(i => i.siteProject).filter(Boolean))];
  if (state.siteProj && !names.includes(state.siteProj)) state.siteProj = '';
  sel.hidden = !names.length;
  const html = `<option value="">Все проекты</option>${names.map(n => `<option value="${esc(n)}" ${state.siteProj === n ? 'selected' : ''}>🌐 Сайт: ${esc(n)}</option>`).join('')}`;
  if (sel._html !== html) sel.innerHTML = sel._html = html;
}
function render() {
  siteFilterSync();
  const grid = $('#grid'), strip = $('#extStrip');
  const all = visibleItems();
  const ext = all.filter(i => i.status === 'external'), list = all.filter(i => i.status !== 'external');
  const extHTML = ext.map(externalCardHTML).join('');
  if (strip._html !== extHTML) strip.innerHTML = strip._html = extHTML;
  $('#empty').classList.toggle('hidden', items.length > 0);
  if (!items.length) renderEmpty();
  const cols = lastCols = colCount();
  const old = new Map();
  grid.querySelectorAll('.card').forEach(el => old.set(el.dataset.id, el));
  const colEls = Array.from({length: cols}, () => []), heights = Array(cols).fill(0);
  for (const it of list) {
    const k = heights.indexOf(Math.min(...heights));
    const html = cardHTML(it);
    let el = old.get(it.id);
    if (el && el._html === html) old.delete(it.id);
    else el = cardEl(html);
    colEls[k].push(el);
    heights[k] += it.h / it.w + 0.08;
  }
  old.forEach(el => vidUnwatch(el));
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  let colDivs = [...grid.children];
  if (colDivs.length !== cols || colDivs.some(c => !c.classList.contains('col'))) {
    colDivs = colEls.map(() => Object.assign(document.createElement('div'), {className: 'col'}));
    grid.replaceChildren(...colDivs);
  }
  colEls.forEach((els, i) => {
    const c = colDivs[i];
    if (c.children.length === els.length && els.every((el, j) => c.children[j] === el)) return;   // колонка та же — не трогаем
    c.replaceChildren(...els);
  });
  updateCounts();
  renderHubJobs();
}
function refreshCard(it) {
  const el = document.querySelector(`.card[data-id="${it.id}"]`);
  if (!el) return;
  const html = cardHTML(it);
  if (el._html !== html) { vidUnwatch(el); el.replaceWith(cardEl(html)); }
  tick();
}
function updateCounts() {
  const done = items.filter(i => i.status === 'done');
  const nImg = done.filter(i => i.type === 'image').length, n3d = done.filter(i => i.type === 'model').length;
  $('#countLabel').textContent = done.length ? `${nImg} фото · ${done.length - nImg - n3d} видео${n3d ? ` · ${n3d} 3D` : ''}` : '';
  const n = items.filter(i => i.status === 'queued' || i.status === 'running').length;
  $('#queueInfo').textContent = n ? `⏳ В работе: ${n}` : 'Ctrl+Enter';
  $('#navBadge').textContent = n;
  $('#navBadge').classList.toggle('hidden', !n);
}
function tick() {
  const now = Date.now();
  for (const it of items) {
    if ((it.status === 'queued' || it.status === 'running') && it.startedAt) {
      const el = document.querySelector(`.card[data-id="${it.id}"] [data-time]`);
      if (el) el.textContent = fmtTime(Math.floor((now - it.startedAt) / 1000));
    }
  }
  $$('[data-job-time]').forEach(el => { el.textContent = fmtTime(Math.max(0, Math.floor((now - +el.dataset.jobTime) / 1000))); });
}

/* ---- Задания на компьютере — сразу в галерее, живыми карточками ----
   Пользователь 2026-10-07: «отправил 10 „Персонажей в локации“ — цикл прошёл, а в галерее ничего; хочу видеть анимацию
   и на каком этапе: пишет промпт, генерирует, забирает». Галерея показывала только готовые файлы: задание, упавшее
   на компьютере, пропадало молча. Теперь у каждого задания пакета — карточка: этап, что делает сейчас (словами программы),
   сколько идёт; готово — карточка сменяется фото или видео; не вышло — причина. */
const JOB_STEPS = ['Очередь', 'Подготовка', 'Генерация', 'Скачивание', 'В галерею'];
const jobHidden = new Set(ls.get('freefield.jobs.hidden', []));
function jobStep(it) {
  if (it.status === 'queued') return 0;
  if (it.status === 'done') return 4;
  const m = String(it.message || '').toLowerCase();
  if (/скачива|забира|сохраня/.test(m)) return 3;
  if (/генерир|рису|%/.test(m)) return 2;
  return 1;   // открываю проект, настраиваю, прикрепляю фото, вставляю промпт
}
// задания последних 12 часов, которых ещё нет в галерее (готовые и забранные — уже обычные карточки)
function hubJobs() {
  if (!hubLink.ok) return [];
  const out = [], now = Date.now();
  for (const b of hubLink.batches || []) {
    if (b.created < hubLink.since || (b.source === 'sync' && !b.ours) || now - b.created > 12 * 3600e3) continue;
    for (const it of b.items || []) {
      const key = `${b.id}:${it.n}`, files = it.files || [];
      if (jobHidden.has(key)) continue;
      if (it.status === 'done' && files.every(f => hubLink.imported[f.name || f.url])) continue;
      out.push({key, b, it});
    }
  }
  return out;
}
function jobCardHTML({key, b, it}) {
  const err = it.status === 'error', step = jobStep(it);
  const [w, h] = String(it.aspect || (it.kind === 'video' ? '9:16' : '3:4')).split(':').map(Number);
  const status = err ? 'Не получилось' : it.status === 'queued' ? 'В очереди на компьютере' : it.status === 'done' ? 'Готово — забираю в галерею' : it.message || 'Работаю';
  return `<div class="card pending job ${err ? 'err' : ''}" data-job="${esc(key)}" style="aspect-ratio:${w || 3}/${h || 4}">
    ${err ? '' : '<div class="shimmer"></div>'}
    <div class="pend-info">
      ${err ? '<div class="job-x">⚠️</div>' : '<div class="spin"></div>'}
      <div class="pend-kind">${it.kind === 'video' ? '🎬 видео' : it.kind === '3d' ? '🧊 3D-модель' : it.site === 'upscale' ? '🔍 увеличение' : '🖼 фото'} · ${esc(it.siteLabel || SITE_SHORT[it.site] || it.site || 'компьютер')}</div>
      <div class="pend-status">${esc(status)}</div>
      ${err ? `<div class="pend-prompt job-err">${esc(it.message || 'причину программа не назвала')}</div>`
        : `<div class="job-steps">${JOB_STEPS.map((s, i) => `<i class="${i < step ? 'ok' : i === step ? 'now' : ''}" title="${s}"></i>`).join('')}</div>
           <div class="job-step">${JOB_STEPS[step]}</div><div class="pend-time" data-job-time="${b.created}"></div>`}
      ${it.note ? `<div class="pend-prompt">↪ ${esc(it.note)}</div>` : ''}
      <div class="pend-prompt">${esc(it.prompt || '')}</div>
      ${err ? `<div class="pend-actions"><button data-job-hide="${esc(key)}">Убрать</button></div>` : ''}
    </div></div>`;
}
function renderHubJobs() {
  const box = $('#hubJobs');
  if (!box) return;
  const jobs = hubJobs(), bad = jobs.filter(j => j.it.status === 'error').length, run = jobs.length - bad;
  box.innerHTML = jobs.length ? `<div class="hub-jobs-head">💻 <b>На компьютере:</b> ${run ? `в работе ${run}` : ''}${run && bad ? ' · ' : ''}${bad ? `не получилось ${bad}` : ''}
      ${bad ? `<button class="btn small" data-import-all title="Компьютер проверит сайты (Flow и др.) и заберёт в галерею всё, что там уже сделано, — даже если задание считается неудачным">🔄 Забрать всё из сервисов</button>
        <button class="btn small" data-job-hide-err>Убрать неудачные</button>` : ''}</div>` + jobs.map(jobCardHTML).join('') : '';
  if (jobs.length) $('#empty').classList.add('hidden');
  tick();
}
setInterval(tick, 1000);

function fileName(it) {
  const slug = (it.prompt || 'art').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'art';
  if (it.type === 'model') return `freefield-3d-${slug}.${it.m3d?.pack || 'glb'}`;
  return `freefield-${slug}-${it.seed}.${it.type === 'video' ? 'mp4' : ({'image/png': 'png', 'image/webp': 'webp'}[it.blob?.type] || 'jpg')}`;
}

function removeItem(it) {
  const idx = items.indexOf(it);
  if (idx < 0) return;
  items.splice(idx, 1);
  DB.del(it.id);
  render();
  if (it.status !== 'done') return;
  toast('Удалено', {action: 'Вернуть', ms: 6000, onAction: () => {
    items.splice(Math.min(idx, items.length), 0, it); DB.put(it); render();
  }});
}

function pick(it) {
  const {id, blob, status, statusText, createdAt, startedAt, ...rest} = it;
  return rest;
}

async function doAction(act, it, el) {
  switch (act) {
    case 'download': {
      if (native.on()) {
        try { await native.save(it.blob, fileName(it)); } catch (e) { toast('Не удалось сохранить: ' + e.message, {type: 'err'}); }
        break;
      }
      const a = document.createElement('a');
      a.href = urlOf(it.blob); a.download = fileName(it);
      document.body.append(a); a.click(); a.remove();
      break;
    }
    case 'delete':
      if (!$('#lightbox').classList.contains('hidden')) closeLB();
      removeItem(it);
      break;
    case 'copy':
      try { await navigator.clipboard.writeText(it.finalPrompt); }
      catch {
        const ta = document.createElement('textarea');
        ta.value = it.finalPrompt; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      toast(`Промпт скопирован — вставьте его в ${(allModels().find(x => x.id === it.model) || {}).site || 'сервис'}`, {type: 'ok'});
      break;
    case 'open-vids':
    case 'open-site': {
      const m = allModels().find(x => x.id === it.model) || {};
      navigator.clipboard?.writeText(it.finalPrompt).catch(() => {});
      openSide(m.url, m.service);
      autoImport.target = it.id;
      autoImport.since = Date.now();
      markConnected(m.service);
      const paste = pwa.mobile() ? 'долгое нажатие → «Вставить»' : 'Ctrl+V';
      toast(`Промпт скопирован. В ${m.site}: ${it.refs?.length ? 'приложите сохранённое фото, ' : ''}вставьте промпт (${paste}), сгенерируйте и скачайте результат${autoImport.active() ? ' — Freefield заберёт его сам' : ''}`, {type: 'ok', ms: 7000});
      break;
    }
    case 'save-ref': await saveRefs(it, [it.refs?.[+el?.dataset.k]].filter(Boolean)); break;
    case 'save-refs': await saveRefs(it, it.refs || []); break;
    case 'save-voice': { const c = vc.char(it.char); if (c?.sample) await saveFile(dataBlob(c.sample), `голос-${c.name}.wav`); break; }
    case 'revoice': closeLB(); openRevoice(it); break;
    case 'to-char': closeLB(); openToChar(it); break;
    case 'to3d': closeLB(); m3dFromItem(it); break;
    case 'to-mt': mtAddItems([it.id]); break;
    case 'open-mt': closeLB(); mt.cur = it.mt; mt.tab = 'edit'; mt.save(); setView('create'); setCreateMode('edit'); break;
    case 'upscale': closeLB(); openUp(it); break;
    case 'open3d': openLB(it.id); break;
    case 'paste-clip':
      try {
        for (const ci of await navigator.clipboard.read()) {
          const t = ci.types.find(x => x.startsWith('image/'));
          if (t) { await attachExternal(it, new File([await ci.getType(t)], 'pasted.' + t.split('/')[1], {type: t})); return; }
        }
        toast('В буфере нет картинки. На сайте: правый клик по картинке → «Копировать картинку»', {ms: 6000});
      } catch { toast('Браузер не дал прочитать буфер — нажмите Ctrl+V или загрузите файл', {ms: 6000}); }
      break;
    case 'auto-connect': await autoImport.connect(); break;
    case 'auto-allow': await autoImport.allow(); break;
    case 'import': {
      // Flow, Dola и Arena отдают по несколько вариантов — можно выбрать все: каждый станет отдельной работой в галерее
      const want = it.type === 'video' ? 'video/' : 'image/';
      const fs = await pickFile(want + '*', true), ok = fs.filter(f => f.type.startsWith(want));
      if (!ok.length) { if (fs.length) attachExternal(it, fs[0]); break; }   // не тот тип — attachExternal объяснит
      for (const [k, f] of ok.entries()) await attachExternal(k ? newItem({...pick(it), status: 'external', statusText: '', importedAt: null}) : it, f, ok.length > 1);
      if (ok.length > 1) toast(`Добавлено в галерею: ${ok.length} 🎉`, {type: 'ok'});
      break;
    }
    case 'variation': {
      const copy = newItem({...pick(it), status: 'external', statusText: '', importedAt: null});
      DB.put(copy); render();
      toast('Ещё одна карточка с тем же промптом — сгенерируйте вариант на сайте', {type: 'ok'});
      break;
    }
    case 'to-scn':
      closeLB();
      await refToScenario(it.blob);
      break;
    case 'animate':   // оживить через Flow / Dola / Arena / Vids — сценарием с этим фото
      closeLB();
      await refToScenario(it.blob);
      break;
    case 'to-asset':
      closeLB();
      setView('create');
      setCreateMode('one');
      await assetAddRefs([it.blob]);
      break;
    case 'reuse':
      closeLB();
      // видео — новым сценарием, фото — в «Фото»
      if (it.type === 'video') {
        const s = {...blankScn(), kind: 'video', prompt: it.userPrompt ?? it.prompt};
        const empty = cl.scn.findIndex(x => !x.prompt.trim() && !x.ref);
        if (empty >= 0) cl.scn[empty] = s; else if (cl.scn.length < CL_MAX) cl.scn.push(s); else cl.scn[cl.scn.length - 1] = s;
        cl.save(); setView('create'); setCreateMode('scn');
        toast('Промпт — в сценарии. Меняйте и запускайте', {type: 'ok'});
        break;
      }
      // фото — промпт в «Фото»
      setView('create'); setCreateMode('one');
      $('#prompt').value = state.prompts.image = it.userPrompt ?? it.prompt; saveSettings();
      toast('Промпт загружен — меняйте и создавайте', {type: 'ok'});
      break;
  }
}

/* =============================== lightbox =============================== */
let lbList = [], lbIndex = -1;
function openLB(id) {
  lbList = visibleItems().filter(i => i.status === 'done');
  lbIndex = lbList.findIndex(i => i.id === id);
  if (lbIndex < 0) return;
  $('#lightbox').classList.remove('hidden');
  showLB();
}
function closeLB() { $('#lightbox').classList.add('hidden'); $('#lbMedia').innerHTML = ''; }
function showLB() {
  const it = lbList[lbIndex];
  if (!it) return closeLB();
  if (it.type === 'model') return showLB3d(it);
  $('#lbMedia').innerHTML = it.type === 'video'
    ? `<video src="${urlOf(it.blob)}" controls autoplay loop playsinline></video>`
    : `<img src="${urlOf(it.blob)}" alt="">`;
  const rows = [
    ['Модель', it.modelTitle || '—'],
    ['Стоимость', it.tier === 'paid' ? (it.cost != null ? '≈ ' + fmtUSD(it.cost) : 'по факту') : 'Бесплатно'],
    ['Размер', `${it.w} × ${it.h}`],
    ['Seed', it.seed],
    ...(it.type === 'video' ? [...(it.motion ? [['Движение', byId(MOTIONS, it.motion).name]] : []), ['Длительность', it.duration + ' с']] : []),
    ...(it.res ? [['Качество', it.res]] : []),
    ...(it.style && it.style !== 'none' ? [['Стиль', styleOf(it.style).name]] : []),
    ...(it.voiceOf ? [['Голос', it.voiceOf]] : []),
    ['Создано', new Date(it.createdAt).toLocaleString('ru-RU', {dateStyle: 'short', timeStyle: 'short'})],
  ];
  $('#lbInfo').innerHTML = `
    <div>${tierBadge(it)}</div>
    <div><h4>Промпт</h4><p>${esc(it.prompt)}</p></div>
    ${it.finalPrompt && it.finalPrompt !== it.prompt ? `<div><h4>Итоговый промпт ✨</h4><p class="final">${esc(it.finalPrompt)}</p></div>` : ''}
    <dl class="meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="lb-actions">
      ${it.type === 'image' ? '<button class="primary" data-act="animate">🎬 Оживить в видео</button>' : ''}
      ${it.type === 'image' && it.blob ? '<button data-act="to-scn" title="Сделать сценарий с этим фото: Freefield отправит его в Flow / Arena / Dola">📎 В сценарий</button>' : ''}
      ${it.type === 'image' && it.blob ? '<button data-act="to-asset" title="Взять это фото референсом в «Фото» — например, развёртку героя">🖼 Референс для ассета</button>' : ''}
      ${it.type === 'image' && it.blob ? '<button data-act="to-char" title="Сохранить в персонажа: кадр в локации, развёртка или инфографика">🧍 В персонажа</button>' : ''}
      ${it.type === 'image' && it.blob ? '<button data-act="to3d" title="Сделать 3D-модель из этой картинки — на компьютере, бесплатно">🧊 3D-модель</button>' : ''}
      ${it.type === 'image' && it.blob ? '<button data-act="upscale" title="Увеличить в 2 или 4 раза — на компьютере, бесплатно">🔍 Увеличить</button>' : ''}
      ${it.type === 'video' ? '<button data-act="revoice" title="Сделать голос ровно как в образце персонажа">🎙 Заменить голос</button>' : ''}
      ${it.type === 'video' && it.blob ? '<button data-act="to-mt" title="Добавить в текущий проект монтажа">🎞 В монтаж</button>' : ''}
      ${it.mt && mt.projects.some(x => x.id === it.mt) ? '<button data-act="open-mt" title="Открыть проект, из которого склеено это видео">🎞 Открыть проект</button>' : ''}
      <button data-act="download">⤓ Скачать</button>
      ${String(it.model).startsWith('ext:') ? '<button data-act="variation">↻ Вариант</button>' : ''}
      <button data-act="reuse">✎ Повторить</button>
      <button data-act="delete" class="danger">🗑 Удалить</button>
    </div>`;
  $('#lbPrev').style.visibility = lbIndex > 0 ? '' : 'hidden';
  $('#lbNext').style.visibility = lbIndex < lbList.length - 1 ? '' : 'hidden';
}
function stepLB(d) {
  const n = lbIndex + d;
  if (n >= 0 && n < lbList.length) { lbIndex = n; showLB(); }
}
