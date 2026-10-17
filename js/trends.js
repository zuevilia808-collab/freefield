'use strict';
/* ---- «🔥 Тренды» (пользователь 2026-10-17: «чтобы агент сам искал самые вирусные видео сейчас, мы собирали с них движение людей
   и делали motion control — заменяли персонажей, а движение и музыка оставались те же; локацию тоже можно менять;
   и подсовывал мне идеи, с чем сейчас сделать брейнрот»).
   Лента хранится на компьютере (outputs/trends/trends.json): её пополняет Claude в чате (MCP trends — с TikTok и Reels через vidIQ)
   и кнопка «Найти тренды сейчас» здесь (свежие Shorts + идеи от Claude Code по подписке). «Сделать с моим героем» — ролик
   скачивается на компьютере, Wan 2.2 Animate (Hugging Face, квота ZeroGPU пользователя) переносит движение на героя, звук — исходный.
   Готовое видео приходит в галерею, ход работы — там же ---- */
const tr = {
  data: {items: [], ideas: [], updated: 0}, loaded: false, finding: null, timer: null,
  open: null,                       // id тренда, у которого раскрыта форма «Сделать с моим героем»
  q: ls.get('freefield.trends.q', ''),
  // форма: герой (персонаж и его фото или своё фото), локация, кусок ролика
  f: {char: null, img: null, own: null, locMode: 'same', locText: '', locImg: null, start: 0, seconds: 10, quality: 'low', ...ls.get('freefield.trends.form', {}), own: null, locImg: null},
  saveForm() { const {own, locImg, img, ...rest} = this.f; ls.set('freefield.trends.form', rest); },
  sending: false,
};
const TR_PLAT = {tiktok: 'TikTok', youtube: 'YouTube Shorts', instagram: 'Reels', other: 'ролик'};
const trNum = n => n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' млн' : n >= 1e3 ? Math.round(n / 1e3) + ' тыс.' : String(n);
const trHeroes = () => vc.chars.map(c => ({name: c.name, about: c.about || ''})).filter(h => h.name);
// фото персонажа для переноса движения: кадры в локациях (один герой в кадре — лучше всего), потом развёртка
const trCharImgs = c => [...(c?.locs || []), ...(c?.sheet ? [c.sheet] : [])].filter(Boolean);
function trHeroImg() {
  if (tr.f.own) return tr.f.own;
  const c = vc.char(tr.f.char) || vc.chars.find(x => trCharImgs(x).length);
  const imgs = trCharImgs(c);
  return imgs.includes(tr.f.img) ? tr.f.img : imgs[0] || null;
}

function trIdeaHTML(i) {
  return `<li><b>${esc(i.title)}</b>${i.hero ? ` <span class="tr-hero">${esc(i.hero)}</span>` : ''}${i.how ? `<div class="hint">${esc(i.how)}</div>` : ''}</li>`;
}
function trFormHTML(t) {
  const f = tr.f, c = vc.char(f.char) || vc.chars.find(x => trCharImgs(x).length), hero = trHeroImg();
  const chars = vc.chars.filter(x => trCharImgs(x).length);
  const fit = t.duration ? Math.max(2, Math.floor(t.duration - (f.start || 0))) : 20;
  return `<div class="tr-form">
    <div class="lbl-s">Кто вместо людей</div>
    <div class="tr-chars">${chars.map(x => `<button class="tr-char ${!f.own && x.id === c?.id ? 'on' : ''}" data-tr-char="${x.id}"><img src="${trCharImgs(x)[0]}" alt=""><span>${esc(x.name)}</span></button>`).join('')}
      <button class="tr-char ${f.own ? 'on' : ''}" data-tr-own>${f.own ? `<img src="${f.own}" alt="">` : '<i>📁</i>'}<span>Своё фото</span></button></div>
    ${!f.own && c && trCharImgs(c).length > 1 ? `<div class="tr-imgs">${trCharImgs(c).map((s, i) => `<button class="${s === hero ? 'on' : ''}" data-tr-img="${i}" title="Это фото героя"><img src="${s}" alt=""></button>`).join('')}</div>` : ''}
    ${!chars.length && !f.own ? '<div class="hint">Персонажей с фото пока нет — добавьте фото героя в полный рост (или заведите персонажа в «Персонажах»).</div>' : ''}
    <div class="lbl-s">Локация</div>
    <div class="seg tr-loc">${[['same', 'Та же, что в ролике'], ['new', 'Новая']].map(([v, t2]) => `<button data-tr-loc="${v}" class="${f.locMode === v ? 'on' : ''}">${t2}</button>`).join('')}</div>
    ${f.locMode === 'new' ? `<input class="site-in" data-tr-f="locText" type="text" maxlength="300" value="${esc(f.locText)}" placeholder="Например: советская кухня в хрущёвке, вечер">
      <div class="tr-locimg">${f.locImg ? `<img src="${f.locImg}" alt=""><button class="btn small" data-tr-locimg-rm>✕ Убрать фото</button>` : '<button class="btn small" data-tr-locimg>📁 Фото локации (можно без него)</button>'}</div>
      <div class="hint">Google Flow поставит героя в эту локацию в позе из первого кадра ролика — и движение перенесётся на него.</div>` : '<div class="hint">Герой встанет на место человека прямо в кадре ролика.</div>'}
    <div class="tr-row">
      <label>С секунды <input type="number" min="0" max="${Math.max(0, (t.duration || 60) - 2)}" step="1" data-tr-f="start" value="${f.start || 0}"></label>
      <label>Длина <select data-tr-f="seconds">${[3, 4, 5, 6, 8, 10, 12, 15, 20].filter(s => s <= Math.max(3, fit)).map(s => `<option value="${s}" ${+f.seconds === s ? 'selected' : ''}>${s} с</option>`).join('')}</select></label>
      <label>Качество <select data-tr-f="quality"><option value="low" ${f.quality !== 'medium' ? 'selected' : ''}>360p → 720p</option><option value="medium" ${f.quality === 'medium' ? 'selected' : ''}>480p → 720p</option></select></label>
    </div>
    <div class="hint">Бесплатный аккаунт Hugging Face — 5 мин GPU в день: это один ролик до 10 с (360p) или до 5 с (480p). Вход в huggingface.co — один раз, в окне Chrome Freefield.</div>
    <button class="btn free tr-go" data-tr-go="${t.id}" ${tr.sending || !hero ? 'disabled' : ''}>${tr.sending ? '⏳ Отправляю…' : '🎬 Сделать'}</button>
  </div>`;
}
function trCardHTML(t) {
  const meta = [t.views != null && `👁 ${trNum(t.views)}`, t.growth, t.age_days != null && `${t.age_days < 1 ? 'сегодня' : Math.round(t.age_days) + ' дн.'}`, t.duration && `${Math.round(t.duration)} с`].filter(Boolean);
  return `<div class="tr-card" data-id="${esc(t.id)}">
    <div class="tr-top">
      <a class="tr-thumb" href="${esc(t.url)}" target="_blank" rel="noopener" title="Открыть ролик">${t.thumb ? `<img src="${esc(t.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<i>🔥</i>'}<span>${TR_PLAT[t.platform] || 'ролик'}</span></a>
      <div class="tr-info">
        <b class="tr-title">${esc(t.title || t.url)}</b>
        ${t.author ? `<div class="hint">@${esc(t.author.replace(/^@/, ''))}</div>` : ''}
        <div class="tr-meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}${t.fit != null ? `<span class="tr-fit ${t.fit >= 7 ? 'ok' : t.fit >= 4 ? 'mid' : 'low'}" title="Насколько ролик подходит для переноса движения">движение ${t.fit}/10</span>` : ''}</div>
        ${t.about ? `<p>${esc(t.about)}</p>` : ''}
        ${t.motion ? `<p><span class="hint">Движение:</span> ${esc(t.motion)}</p>` : ''}
        ${t.sound ? `<p><span class="hint">Звук:</span> ${esc(t.sound)}</p>` : ''}
      </div>
      <button class="icon-btn tr-rm" data-tr-rm="${esc(t.id)}" title="Убрать из ленты"><svg class="ic"><use href="#i-x"/></svg></button>
    </div>
    ${t.ideas?.length ? `<ul class="tr-ideas">${t.ideas.map(trIdeaHTML).join('')}</ul>` : ''}
    <div class="tr-act">
      <button class="btn ${tr.open === t.id ? '' : 'free'}" data-tr-open="${esc(t.id)}">${tr.open === t.id ? 'Свернуть' : '🎬 Сделать с моим героем'}</button>
      <a class="btn small" href="${esc(t.url)}" target="_blank" rel="noopener">Открыть ↗</a>
    </div>
    ${tr.open === t.id ? trFormHTML(t) : ''}
  </div>`;
}
function renderTrends() {
  const el = $('#trendsCreate');
  if (!el) return;
  const D = tr.data, fresh = D.updated ? new Date(D.updated).toLocaleString('ru', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) : '';
  el.innerHTML = `
    <p class="set-p">Самые вирусные короткие ролики сейчас и идеи брейнрота под ваших героев. Выберите ролик — движение и звук останутся, вместо людей будет ваш герой, локацию можно сменить.</p>
    <div class="tr-warn">⚠ Чужая музыка в ролике может отключить звук или монетизацию на площадке.</div>
    <div class="tr-search"><input class="site-in" data-tr-q type="text" maxlength="200" value="${esc(tr.q)}" placeholder="Тема или хэштеги (необязательно): dance, meme, cat…">
      <button class="btn" data-tr-find ${tr.finding ? 'disabled' : ''}>${tr.finding ? '⏳ Ищу…' : '🔎 Найти'}</button></div>
    ${tr.finding ? `<div class="tr-status">${esc(tr.finding.message || 'ищу…')}</div>` : ''}
    <p class="tr-tip">Ещё больше — с TikTok и Reels: скажите Claude в чате «найди тренды для брейнрота» (он смотрит их через vidIQ и сам кладёт сюда).</p>
    ${D.ideas?.length ? `<div class="block-head"><span class="lbl">💡 Что снять сейчас</span></div><ul class="tr-ideas tr-top-ideas">${D.ideas.map(trIdeaHTML).join('')}</ul>` : ''}
    <div class="block-head"><span class="lbl">Лента</span><span class="hint">${D.items.length ? `${D.items.length} · ${fresh}` : ''}</span>
      <button class="icon-btn" data-tr-refresh title="Обновить"><svg class="ic"><use href="#i-refresh"/></svg></button></div>
    <div class="tr-feed">${!hubLink.ok && !tr.loaded ? '<div class="hint">Лента хранится на компьютере — появится, когда программа Freefield на нём ответит.</div>'
      : D.items.length ? D.items.map(trCardHTML).join('') : '<div class="hint">Пока пусто — нажмите «Найти тренды сейчас».</div>'}</div>`;
}
async function trendsRefresh() {
  clearTimeout(tr.timer);
  if (await hubReady() && hubHas('trends')) {
    try { const r = await fetch(hubLink.url('/api/trends')); if (r.ok) { tr.data = await r.json(); tr.loaded = true; } } catch { /* в следующий раз */ }
  }
  if (cl.mode === 'trends' && !document.activeElement?.closest?.('#trendsCreate input, #trendsCreate select')) renderTrends();
  if (cl.mode === 'trends') tr.timer = setTimeout(trendsRefresh, 60000);
}
async function trendsFind() {
  if (tr.finding) return;
  if (!(await hubReady())) return hubMissingToast('Тренды ищет программа Freefield на компьютере');
  if (!hubHas('trends')) return toast('Программа Freefield на компьютере старая — обновите её и перезапустите Claude Desktop', {type: 'err', ms: 9000});
  tr.finding = {message: 'начинаю'}; renderTrends(); updateGenButton();
  try {
    const r = await fetch(hubLink.url('/api/trends/find'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({query: tr.q.trim(), heroes: trHeroes()})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(j.error || `компьютер ответил ${r.status}`);
    for (const t0 = Date.now(); Date.now() - t0 < 10 * 60e3;) {
      await new Promise(res => setTimeout(res, 2500));
      const s = await fetch(hubLink.url('/api/trends/find/' + j.id)).then(x => x.json()).catch(() => null);
      if (!s) continue;
      tr.finding = s;
      if (cl.mode === 'trends') { const st = $('#trendsCreate .tr-status'); if (st) st.textContent = s.message || '…'; else renderTrends(); }
      if (s.status === 'error') throw new Error(s.message);
      if (s.status === 'done') { toast(`🔥 Нашёл ${s.found} ${plur(s.found, 'тренд', 'тренда', 'трендов')}${s.note ? ' · ' + s.note : ''}`, {type: s.note ? 'err' : 'ok', ms: 7000}); break; }
    }
  } catch (e) { toast('Тренды не нашлись: ' + e.message, {type: 'err', ms: 9000}); }
  finally { tr.finding = null; updateGenButton(); await trendsRefresh(); }
}
async function trendsMake(id) {
  const t = tr.data.items.find(x => x.id === id), f = tr.f, hero = trHeroImg();
  if (!t) return;
  if (!hero) return toast('Выберите героя или добавьте его фото', {type: 'err'});
  if (f.locMode === 'new' && !f.locText.trim() && !f.locImg) { $('#trendsCreate [data-tr-f="locText"]')?.focus(); return toast('Опишите новую локацию или добавьте её фото', {type: 'err'}); }
  if (!(await hubReady())) return hubMissingToast('Ролик делает программа Freefield на компьютере');
  if (!hubHas('trends')) return toast('Программа Freefield на компьютере старая — обновите её и перезапустите Claude Desktop', {type: 'err', ms: 9000});
  tr.sending = true; renderTrends();
  try {
    const c = f.own ? null : vc.char(f.char) || vc.chars.find(x => trCharImgs(x).length);
    const locText = f.locMode === 'new' ? f.locText.trim() : '';
    const body = {url: t.url, hero, hero_name: f.own ? 'мой герой' : c?.name || 'герой', location: locText ? await asIs(locText) : '', location_text: locText,
      location_image: f.locMode === 'new' ? f.locImg : null, mode: f.locMode === 'new' ? 'move' : 'swap', start: +f.start || 0, seconds: +f.seconds || 10, quality: f.quality};
    if (peek.on) return peekShow('Тренд → мой герой', {prompts: [['Задание для компьютера', [`Ролик: ${t.url}`, `Герой: ${body.hero_name}`, `Локация: ${locText || 'та же, что в ролике'}${body.location && body.location !== locText ? ` (${body.location})` : ''}`,
      `Кусок: с ${body.start} с, ${body.seconds} с · ${body.quality === 'medium' ? '480p' : '360p'} → 720p`, 'Движок: Wan 2.2 Animate (Hugging Face, ваша квота ZeroGPU), звук — исходный'].join('\n')]],
      request: {куда: 'программа на компьютере: POST /api/trends/make → задание в галерее', body: {...body, hero: `(фото, ${Math.round(hero.length / 1365)} КБ)`, location_image: body.location_image ? '(фото)' : null}}});
    const r = await fetch(hubLink.url('/api/trends/make'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(j.error || `компьютер ответил ${r.status}`);
    tr.open = null;
    toast('🎬 Делаю ролик с вашим героем — ход работы и готовое видео в галерее (обычно 3–10 минут)', {type: 'ok', ms: 9000, action: 'Галерея', onAction: () => setView('gallery')});
    hubLink.refresh();
  } catch (e) { toast('Не получилось отправить: ' + e.message, {type: 'err', ms: 9000}); }
  finally { tr.sending = false; renderTrends(); }
}

$('#trendsCreate').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset, f = tr.f;
  if ('trFind' in d) return trendsFind();
  if ('trRefresh' in d) return trendsRefresh();
  if (d.trOpen) { tr.open = tr.open === d.trOpen ? null : d.trOpen; return renderTrends(); }
  if (d.trGo) return trendsMake(d.trGo);
  if (d.trChar) { Object.assign(f, {char: d.trChar, img: null, own: null}); tr.saveForm(); return renderTrends(); }
  if (d.trImg != null) { f.img = trCharImgs(vc.char(f.char) || vc.chars.find(x => trCharImgs(x).length))[+d.trImg] || null; return renderTrends(); }
  if ('trOwn' in d) { const file = await pickFile('image/*'); if (file) { f.own = await refDataUrl(file); renderTrends(); } return; }
  if (d.trLoc) { f.locMode = d.trLoc; tr.saveForm(); return renderTrends(); }
  if ('trLocimg' in d) { const file = await pickFile('image/*'); if (file) { f.locImg = await refDataUrl(file); renderTrends(); } return; }
  if ('trLocimgRm' in d) { f.locImg = null; return renderTrends(); }
  if (d.trRm) {
    try {
      const r = await fetch(hubLink.url('/api/trends/' + encodeURIComponent(d.trRm)), {method: 'DELETE'});
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      tr.data.items = tr.data.items.filter(t => t.id !== d.trRm); renderTrends();
    } catch (err) { toast('Не убралось: ' + err.message, {type: 'err'}); }
  }
});
$('#trendsCreate').addEventListener('input', e => {
  const el = e.target;
  if (el.matches('[data-tr-q]')) { tr.q = el.value; return ls.set('freefield.trends.q', tr.q); }
  const k = el.dataset.trF;
  if (!k) return;
  tr.f[k] = el.type === 'number' ? Math.max(0, +el.value || 0) : el.value;
  tr.saveForm();
});
$('#trendsCreate').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-tr-q]')) { e.preventDefault(); trendsFind(); } });
