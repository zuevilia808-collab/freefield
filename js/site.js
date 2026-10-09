'use strict';
/* ---- «🌐 Ассеты для сайта» (пользователь 2026-10-09): чужие картинки из интернета — только образцы настроения и роли на странице.
   Проект (о чём сайт, стиль, цвета) + исходники с пожеланиями → задание на компьютере «ждёт Claude» → Claude в любом чате берёт его
   (site_tasks), делает новые оригинальные картинки с заметными отличиями и пишет итог (site_task_update) — он виден здесь же.
   Готовые картинки приходят в галерею с меткой «🌐 Сайт: <проект>»; исходники в галерею не попадают ---- */
const SITE_ROLES = [['hero', 'Главный баннер'], ['bg', 'Фон'], ['card', 'Карточка'], ['icon', 'Иконка / иллюстрация'], ['product', 'Фото товара'], ['other', 'Другое']];
const SITE_ST = {waiting: ['wait', 'ждёт Claude'], working: ['run', 'в работе'], done: ['ok', 'готово'], error: ['err', 'ошибка']};
const SITE_MAX = 10;
const site = {
  project: {name: '', about: '', style: '', colors: [], ...ls.get('freefield.site.project', {})},
  srcs: [],    // {k, img (data URL), role, keep, count, composition} — в хранилище галереи (без status: в галерею не попадают)
  tasks: [], sending: false, loaded: false, timer: null,
  save() { ls.set('freefield.site.project', this.project); DB.put({id: 'freefield-site-srcs', srcs: this.srcs}).catch(() => {}); },
};
async function siteLoad() {
  const rec = await DB.req('readonly', s => s.get('freefield-site-srcs')).catch(() => null);
  site.srcs = rec?.srcs || [];
  if (cl.mode === 'site') renderSite();
}
// исходник — как есть, если сайт его примет; большой или другого формата — уменьшить
const siteImg = async f => /^image\/(png|jpeg|webp|gif)$/.test(f.type) && f.size < 8e6 ? blobDataUrl(f) : blobDataUrl(await downscale(f, 2560));

// программа на компьютере не отвечает — что делать (одним сообщением для всех разделов)
function hubMissingToast(what = 'Это делает программа Freefield на компьютере') {
  const st = pcStatus();
  toast(st.k !== 'none' ? `${st.icon} ${st.text}` : `${what}. ${pwa.mobile() || isMobile() ? 'Свяжите телефон с компьютером: на компьютере во Freefield — «📱 На телефон», QR-код'
    : 'Откройте Claude Desktop — программа Freefield запускается вместе с ним'}`, {type: 'err', ms: 10000});
}

function siteSrcHTML(s, i) {
  return `<div class="site-src" data-k="${s.k}">
    <div class="site-src-img"><img src="${s.img}" alt="Исходник ${i + 1}"><button class="asset-slot-rm" data-site-rm="${s.k}" title="Убрать исходник">✕</button><b>${i + 1}</b></div>
    <div class="site-src-f">
      <label class="lbl-s">Где на сайте</label>
      <select data-site-f="role">${SITE_ROLES.map(([v, t]) => `<option value="${v}" ${s.role === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="lbl-s">Что сохранить</label>
      <input data-site-f="keep" type="text" maxlength="300" value="${esc(s.keep)}" placeholder="свет, настроение, ракурс…">
      <div class="site-src-row"><span class="lbl-s">Вариантов</span><div class="seg site-n">${[1, 2, 3, 4].map(n => `<button data-site-n="${n}" class="${s.count === n ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <label class="site-chk" title="Расположение можно повторить, но люди, детали, цвета и надписи всё равно будут другими"><input type="checkbox" data-site-f="composition" ${s.composition ? 'checked' : ''}> Брать композицию из исходника</label>
    </div></div>`;
}
function siteTaskHTML(t) {
  const [cls, txt] = SITE_ST[t.status] || ['wait', t.status];
  const date = new Date(t.created).toLocaleString('ru', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
  const srcs = t.sources.map(s => `<div class="site-t-src">
      <img src="${hubLink.ok ? hubLink.url(s.url) : ''}" alt="" loading="lazy">
      <div><b>${s.n}. ${esc(s.roleText || s.role)}</b> · ${s.count} ${plur(s.count, 'вариант', 'варианта', 'вариантов')}${s.composition ? ' · композиция из исходника' : ''}${s.keep ? `<div class="hint">Сохранить: ${esc(s.keep)}</div>` : ''}
        ${s.note ? `<div class="site-t-note">${esc(s.note)}</div>` : ''}
        ${s.analysis ? `<details><summary>Разбор Claude</summary><p>${esc(s.analysis)}</p></details>` : ''}
        ${s.prompts?.length ? `<details><summary>Промпты (${s.prompts.length})</summary>${s.prompts.map(p => `<p class="site-t-prompt">${esc(p)}</p>`).join('')}</details>` : ''}</div></div>`).join('');
  return `<div class="site-task" data-id="${t.id}">
    <div class="site-t-head"><span class="site-st ${cls}">${txt}</span><b>${esc(t.project?.name || 'Проект')}</b><span class="hint">${date}</span>
      ${t.status !== 'working' ? `<button class="icon-btn" data-site-del="${t.id}" title="Удалить задание"><svg class="ic"><use href="#i-trash"/></svg></button>` : ''}</div>
    ${t.message ? `<div class="site-t-msg">${esc(t.message)}</div>` : t.status === 'waiting' ? '<div class="hint">Скажите в чате Claude: «Сделай ассеты для сайта» — он возьмёт задание.</div>' : ''}
    ${srcs}</div>`;
}
function renderSiteTasks() {
  const el = $('#siteTasks');
  if (!el) return;
  el.innerHTML = !hubLink.ok ? '<div class="hint">Задания хранятся на компьютере — список появится, когда программа Freefield на нём ответит.</div>'
    : site.tasks.length ? site.tasks.map(siteTaskHTML).join('') : '<div class="hint">Заданий пока нет.</div>';
}
function renderSite() {
  const el = $('#siteCreate');
  if (!el) return;
  const P = site.project;
  el.innerHTML = `
    <p class="set-p site-lead">Найденные картинки — только образец: Claude сделает <b>новые</b> с тем же настроением и ролью на странице, но с другими людьми, деталями, композицией и вашими цветами. Надписи, логотипы и бренды — убираются.</p>
    <div class="block-head"><span class="lbl">Проект</span></div>
    <label class="lbl-s">Название проекта</label>
    <input class="site-in" data-site-p="name" type="text" maxlength="80" value="${esc(P.name)}" placeholder="Например: Кофейня «Прибой» — для галереи">
    <label class="lbl-s">О чём сайт</label>
    <textarea class="site-in" data-site-p="about" rows="3" maxlength="2000" placeholder="Что продаёте или рассказываете, для кого">${esc(P.about)}</textarea>
    <label class="lbl-s">Стиль и цвета</label>
    <textarea class="site-in" data-site-p="style" rows="2" maxlength="1000" placeholder="Минимализм, тёплый свет, много воздуха…">${esc(P.style)}</textarea>
    <div class="site-colors">${P.colors.map((c, i) => `<span class="site-color"><input type="color" value="${c}" data-site-color="${i}" aria-label="Цвет ${i + 1}"><button data-site-color-rm="${i}" title="Убрать цвет">✕</button></span>`).join('')}
      ${P.colors.length < 5 ? '<button class="btn small" data-site-color-add>＋ Цвет</button>' : ''}<span class="hint">${P.colors.length ? `${P.colors.length} из 5` : 'до 5 цветов палитры'}</span></div>
    <div class="block-head"><span class="lbl">Исходники</span><span class="hint">${site.srcs.length ? `${site.srcs.length} из ${SITE_MAX}` : ''}</span></div>
    <div class="site-srcs">${site.srcs.map(siteSrcHTML).join('')}</div>
    ${site.srcs.length < SITE_MAX ? '<button class="btn site-add" data-site-add><svg class="ic"><use href="#i-plus"/></svg> Исходники</button><div class="hint">Можно сразу несколько файлов, перетащить сюда или вставить Ctrl+V</div>' : ''}
    <div class="block-head"><span class="lbl">Задания</span><button class="icon-btn" data-site-refresh title="Обновить"><svg class="ic"><use href="#i-refresh"/></svg></button></div>
    <div id="siteTasks"></div>`;
  renderSiteTasks();
}
async function siteRefresh() {
  clearTimeout(site.timer);
  if (await hubReady() && hubHas('site')) {
    try { const r = await fetch(hubLink.url('/api/site')); if (r.ok) site.tasks = await r.json(); } catch { /* в следующий раз */ }
  }
  if (cl.mode === 'site') {
    renderSiteTasks();
    // пока Claude работает — проверять чаще; свежие картинки в галерею забирает обычная связь с компьютером
    site.timer = setTimeout(siteRefresh, site.tasks.some(t => ['waiting', 'working'].includes(t.status)) ? 8000 : 30000);
    if (site.tasks.some(t => t.status === 'working')) hubLink.refresh();
  }
}
async function siteAddFiles(files) {
  const list = [...files].filter(f => f.type?.startsWith('image/')).slice(0, SITE_MAX - site.srcs.length);
  if (!list.length) return files.length ? toast(`Не больше ${SITE_MAX} исходников за раз`, {type: 'err'}) : null;
  for (const f of list) {
    try { site.srcs.push({k: uid(), img: await siteImg(f), role: 'hero', keep: '', count: 2, composition: false}); } catch { toast(`Не прочиталась картинка ${f.name}`, {type: 'err'}); }
  }
  site.save();
  renderSite(); updateGenButton();
}
async function siteGo() {
  const P = site.project;
  if (!P.about.trim()) { $('#siteCreate [data-site-p="about"]')?.focus(); return toast('Впишите, о чём сайт — по нему Claude подберёт сюжеты', {type: 'err'}); }
  if (!site.srcs.length) return siteAddFiles(await pickFile('image/*', true) || []);
  const body = {project: {name: P.name.trim() || 'Мой сайт', about: P.about.trim(), style: P.style.trim(), colors: P.colors},
    sources: site.srcs.map(s => ({image: s.img, role: s.role, keep: s.keep.trim(), count: s.count, composition: s.composition}))};
  if (peek.on) return peekShow('Ассеты для сайта', {prompts: [['Задание для Claude (ждёт на компьютере)', [`Проект: ${body.project.name}`, `О чём сайт: ${body.project.about}`,
    `Стиль и цвета: ${body.project.style || '—'} ${body.project.colors.join(' ')}`, ...body.sources.map((s, i) => `Исходник ${i + 1}: ${SITE_ROLES.find(r => r[0] === s.role)[1]} · сохранить: ${s.keep || '—'} · ${s.count} вар.${s.composition ? ' · композиция из исходника' : ''}`)].join('\n')]],
    request: {куда: 'программа на компьютере: POST /api/site → очередь «ждёт Claude» (MCP: site_tasks)', body: {...body, sources: body.sources.map(s => ({...s, image: `(картинка, ${Math.round(s.image.length / 1365)} КБ)`}))}}});
  site.sending = true; updateGenButton();
  try {
    if (!(await hubReady())) return hubMissingToast('Задания для Claude хранит программа Freefield на компьютере');
    if (!hubHas('site')) return toast('Программа Freefield на компьютере старая — обновите её и перезапустите Claude Desktop', {type: 'err', ms: 9000});
    const r = await fetch(hubLink.url('/api/site'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(j.error || `компьютер ответил ${r.status}`);
    site.srcs = []; site.save();
    toast('Задание ждёт Claude. Скажите в чате Claude: «Сделай ассеты для сайта»', {type: 'ok', ms: 10000});
    renderSite();
    siteRefresh();
  } catch (e) { toast('Не получилось отправить: ' + e.message, {type: 'err', ms: 8000}); }
  finally { site.sending = false; updateGenButton(); }
}

$('#siteCreate').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset, P = site.project, card = b.closest('.site-src'), s = card && site.srcs.find(x => x.k === card.dataset.k);
  if ('siteAdd' in d) return siteAddFiles(await pickFile('image/*', true) || []);
  if ('siteRefresh' in d) return siteRefresh();
  if (d.siteRm) { site.srcs = site.srcs.filter(x => x.k !== d.siteRm); site.save(); renderSite(); return updateGenButton(); }
  if (d.siteN && s) { s.count = +d.siteN; site.save(); card.querySelectorAll('[data-site-n]').forEach(x => x.classList.toggle('on', x === b)); return; }
  if ('siteColorAdd' in d) { P.colors.push(['#d4ff3a', '#1e293b', '#f97316', '#0ea5e9', '#f5f5f4'][P.colors.length] || '#888888'); site.save(); return renderSite(); }
  if (d.siteColorRm) { P.colors.splice(+d.siteColorRm, 1); site.save(); return renderSite(); }
  if (d.siteDel) {
    if (!await askYes('Удалить задание? Готовые картинки в галерее останутся.')) return;
    try {
      const r = await fetch(hubLink.url('/api/site/' + d.siteDel), {method: 'DELETE'});
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      site.tasks = site.tasks.filter(t => t.id !== d.siteDel); renderSiteTasks();
    } catch (err) { toast('Не удалилось: ' + err.message, {type: 'err'}); }
  }
});
$('#siteCreate').addEventListener('input', e => {
  const el = e.target, d = el.dataset;
  if (d.siteP) { site.project[d.siteP] = el.value; return ls.set('freefield.site.project', site.project); }
  if (d.siteColor != null) { site.project.colors[+d.siteColor] = el.value.toLowerCase(); return ls.set('freefield.site.project', site.project); }
  const s = site.srcs.find(x => x.k === el.closest('.site-src')?.dataset.k);
  if (!s || !d.siteF) return;
  s[d.siteF] = d.siteF === 'composition' ? el.checked : el.value;
  site.save();
});
$('#siteCreate').addEventListener('dragover', e => e.preventDefault());
$('#siteCreate').addEventListener('drop', e => { e.preventDefault(); siteAddFiles(e.dataTransfer.files); });
document.addEventListener('paste', e => {
  if (cl.mode !== 'site' || e.target.closest?.('input, textarea')) return;
  const fs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (fs.length) { e.preventDefault(); siteAddFiles(fs); }
});
