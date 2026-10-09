'use strict';
function scnFormats(s) { const k = SITE_AR[s.kind]; return k[s.service] || AR_ORDER.filter(a => k.flow.includes(a) || k.dola.includes(a)); }
const arRatio = a => { const [w, h] = a.split(':').map(Number); return w / h; };
// ближайший доступный формат: вертикальный остаётся вертикальным (3:4 → 9:16), широкий — широким
function fitAr(list, a) { if (list.includes(a)) return a; const d = x => Math.abs(Math.log(arRatio(x) / arRatio(a))); return list.reduce((b, x) => d(x) < d(b) ? x : b); }
function scnAspect(s) { return fitAr(scnFormats(s), s.aspect || cl.aspect); }
// подсказка у формата: чего нет во Flow (для «авто») или сколько форматов у сервиса
function scnFmtHint(s) {
  const k = SITE_AR[s.kind], what = s.kind === 'video' ? 'видео' : 'фото';
  if (s.service === 'arena') return 'Arena формат не выбирает — Freefield допишет его в промпт';
  if (s.service !== 'auto') { const n = k[s.service].length; return `в ${SITE_SHORT[s.service]} для ${what} ${n} ${plur(n, 'формат', 'формата', 'форматов')}`; }
  const only = scnFormats(s).filter(a => !k.flow.includes(a));
  if (only.length && s.kind === 'video' && (s.ref || s.sheet)) return `${only.join(', ')} — только в Dola, а видео по фото героя Dola не делает: формат станет ближайшим (9:16 или 16:9)`;
  return only.length ? `${only.join(', ')} — только в Dola` : '';
}
function arChip(a, on, attr) {
  const [w, h] = a.split(':').map(Number), k = 13 / Math.max(w, h);
  return `<button class="chip ${on ? 'on' : ''}" ${attr}="${a}" title="${AR_NAME[a]}"><span class="ar" style="width:${Math.round(w * k)}px;height:${Math.round(h * k)}px"></span>${a}</button>`;
}
const scnModel = (kind, site, key) => SCN_MODELS[kind].find(m => m[0] === site && m[1] === key);
// модель по умолчанию на сервисе (пользователь 2026-09-27, 2026-10-07): видео Flow — Omni 1.1 Flash, Dola — Seedance 2.5; фото Flow — Nano Banana 2.1, Dola — Seedream 5.0
function scnDefault(kind, site) {
  if (kind === 'video') return {flow: 'omni-1.1-flash', dola: 'seedance-2.5', arena: 'battle', vids: 'omni'}[site];
  return {flow: 'nano-banana-2.1', dola: 'seedream-5-pro', arena: 'battle'}[site];
}
// телефон без связи с компьютером: сценарии и ассеты делаются вручную на сайтах сервисов (карточки «на телефоне»)
const phoneOnly = () => !hubLink.ok && pwa.mobile();
// тот же план, что у компьютера: видео — по кругу Flow → Dola → Arena, картинки — Flow ↔ Dola; сайты с лимитом пропускаем
function clPlan(list) {
  const info = hubLink.info || {};
  const profs = info.profiles?.length ? info.profiles : [info];
  let flow = profs.reduce((a, p) => a + (p.flowLeft ?? 50), 0);
  let dola = profs.some(p => p.dolaPoints == null) ? null : profs.reduce((a, p) => a + p.dolaPoints, 0);
  // сервис «вне игры», только если он недоступен во всех профилях
  const out = {flow: profs.every(p => p.siteOut?.flow), dola: profs.every(p => p.siteOut?.dola), arena: profs.every(p => p.siteOut?.arena),
    vids: profs.every(p => p.siteOut?.vids || p.vidsWait === 'smart')};
  const turn = {video: 0, image: 0};
  return list.map(s => {
    const kind = s.kind;
    const ok = site => {
      const m = scnModel(kind, site, s.service === site && s.model ? s.model : scnDefault(kind, site));
      if (!m) return false;
      if (site === 'flow') return !out.flow && flow >= m[4];
      if (site === 'dola') return !out.dola && (kind === 'image' || dola == null || dola >= m[4]);
      if (site === 'vids') return !out.vids && !((s.ref || s.sheet) && profs.every(p => p.vidsWait === 'terms'));
      return !out.arena;
    };
    let site = s.service !== 'auto' ? s.service : null;
    if (!site) {
      // Google Vids с телефона видео не создаёт (только с компьютера) — без компьютера на телефоне «Авто» его пропускает
      const order = (kind === 'video' ? ['vids', 'flow', 'dola', 'arena'] : ['flow', 'dola']).filter(x => x !== 'vids' || !phoneOnly());
      const k = turn[kind]++ % order.length;
      const rot = [...order.slice(k), ...order.slice(0, k)];
      const fits = x => SITE_AR[kind][x].includes(scnAspect(s));   // 3:4 или 21:9 для видео — только Dola
      // видео по фото человека Dola не делает («защита права на образ») — такие сценарии идут на другие сервисы
      // только развёртка (без кадра в локации) — Arena её не возьмёт, сначала Flow и Vids
      const use = x => !(kind === 'video' && (s.ref || s.sheet) && (x === 'dola' || !s.ref && x === 'arena'));
      site = rot.find(x => fits(x) && use(x) && ok(x)) || rot.find(x => use(x) && ok(x)) || rot.find(fits) || rot[0];
    }
    const model = s.service === site && s.model ? s.model : scnDefault(kind, site);
    const m = scnModel(kind, site, model) || scnModel(kind, site, scnDefault(kind, site));
    if (site === 'flow') flow -= m[4];
    if (site === 'dola' && kind === 'video' && dola != null) dola -= m[4];
    return {site, model: m[1], m};
  });
}
function clPlanText() {
  const list = cl.ready();
  if (!list.length) return 'Напишите хотя бы один сценарий — Freefield разложит их по сервисам так, чтобы хватило бесплатных кредитов.';
  const plan = clPlan(list), c = {flow: 0, dola: 0, arena: 0, vids: 0}, cr = {flow: 0, dola: 0};
  plan.forEach(p => { c[p.site]++; if (p.site === 'flow') cr.flow += p.m[4]; if (p.site === 'dola' && p.m[0] === 'dola' && SCN_MODELS.video.includes(p.m)) cr.dola += p.m[4]; });
  const left = hubLink.info?.flowLeft;
  const parts = [];
  if (c.vids) parts.push(`<b>Google Vids</b> — ${c.vids} (бесплатно)`);
  if (c.flow) parts.push(`<b>Google Flow</b> — ${c.flow} (${cr.flow} кр.${left != null ? ` из ${left}` : ''})`);
  if (c.dola) parts.push(`<b>Dola</b> — ${c.dola}${cr.dola ? ` (${cr.dola} балл.)` : ''}`);
  if (c.arena) { const v = plan.filter((p, i) => p.site === 'arena' && list[i].kind === 'video').length, f = c.arena - v;
    parts.push(`<b>Arena</b> — ${c.arena} → ${[v && `${v * 2} видео`, f && `${f * 2} фото`].filter(Boolean).join(' и ')}`); }
  const st = styleOf(state.style), own = list.filter(s => s.style != null && s.style !== state.style).length;
  return `План: ${parts.join(' · ')}. ${phoneOnly() ? 'На каждый сценарий — карточка с фото и промптом для сайта.' : 'Все сценарии уходят сразу, сервисы работают параллельно.'}` +
    (st.suffix ? ` Стиль «${esc(st.name)}» добавится ${own ? `ко всем, кроме ${own} со своим стилем` : 'ко всем'}.` : own ? ` Свой стиль — у ${own} ${plur(own, 'сценария', 'сценариев', 'сценариев')}.` : '');
}

// Сайт с GitHub на компьютере, а профилей нет: программа Freefield не запущена — или запущена, но сайт к себе не пускает
function accPcHTML() {
  const up = hubLink.pcUp, find = `<button class="btn small free" data-acc-find ${up === null ? 'disabled' : ''}>${up === null ? '⏳ Ищу…' : '↻ Проверить ещё раз'}</button>`;
  const text = up === null ? '⏳ Ищу программу Freefield на этом компьютере — профили Chrome показывает она…'
    : up ? '🟡 Программа Freefield на компьютере запущена, но показывать профили сайту с GitHub не даёт. Откройте Freefield с компьютера — там профили Chrome, вход в Flow, Dola, Arena, Vids и генерация во всех профилях.'
    : `🔴 Сайт не достучался до программы Freefield на этом компьютере — профили Chrome показывает она.${hubLink.lna === 'denied' ? ' <b>Chrome запретил этому сайту доступ к программам на компьютере.</b>' : ''}
      ${helpHTML('Что сделать', `• Через папку Freefield (адрес 127.0.0.1:5180) всё работает — значит, Chrome не пускает сюда сайт: значок слева от адреса → «Настройки сайтов» → <b>«Доступ к локальной сети»</b> → «Разрешить», обновите страницу и нажмите «Проверить ещё раз».
      <br>• И там не открывается — программа не запущена: откройте Claude Desktop (или запустите Freefield из папки).`)}`;
  return `<div class="acc-box"><div class="hint">${text}</div><div class="acc-foot">${find}${up ? `<a class="btn small" href="${HUB_PC}/">🔗 Открыть Freefield с компьютера</a>` : ''}</div></div>`;
}
// Аккаунты в сервисах по профилям Chrome: вход, баланс, «Выйти» / «Войти» (аккаунт выбирает и входит сам пользователь в окне Chrome Freefield)
const accState = {pending: {}, checking: false, adding: false, busy: {}, choose: {}};   // choose: «site@профиль» → почты аккаунтов Google на выбор
function scnAccHTML() {
  // открыто не с компьютера (файлом, с GitHub Pages) — профилей не видно; на компьютере ведём на адрес Freefield, где ключ связи уже сохранён
  // на телефоне адрес 127.0.0.1 — сам телефон, а не компьютер: объясняем, что без компьютера этот раздел не нужен (пользователь 2026-09-28)
  if (!hubLink.ok && hubLink.pcSite()) return accPcHTML();
  if (!hubLink.ok) return `<div class="acc-box"><div class="hint">${isMobile()
    ? '📱 Без компьютера этот раздел не нужен: во Flow, Dola и Arena входите сами — на их сайтах в Chrome. Freefield делает карточки с фото и промптом, «Создать» нажимаете на сайте. Профили Chrome, баланс и автозапуск — только с компьютером: Freefield работает в Claude Desktop на ПК, а телефон подключается к нему по QR-коду в той же сети Wi-Fi.'
    : 'Профили Chrome, баланс Flow, Dola, Arena и кнопки входа видны, когда Freefield открыт с компьютера — по адресу <b>127.0.0.1:5180</b> (пока открыт Claude Desktop с Freefield). На телефоне — по QR-коду (попросите Claude в Claude Desktop: «подключи телефон к Freefield»).'}</div>
    ${location.port !== '5180' && !isMobile() ? '<div class="acc-foot"><a class="btn small free" href="http://127.0.0.1:5180/">🔗 Открыть Freefield с компьютера</a></div>' : ''}</div>`;
  const info = hubLink.info || {};
  const act = info.active ?? null;   // null — окно Chrome Freefield закрыто (или открыто несколько профилей)
  const open = info.open || (act ? [act] : []);   // профили, окна которых открыты сейчас
  const isOpen = pr => open.includes(pr.id);
  // открытые сейчас профили — первыми, чтобы их кнопки «Закрыть» были сразу видны
  const profs = (info.profiles?.length ? info.profiles : [{...info, id: 1, name: 'Профиль 1'}])
    .slice().sort((a, b) => isOpen(b) - isOpen(a));
  const ago = t => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : `${Math.round(m / 60)} ч назад`; };
  const row = (pr, id) => {
    const x = SERVICES.find(v => v.id === id), lg = pr.login?.[id], key = `${id}@${pr.id}`, p = accState.pending[key], out = pr.siteOut || {};
    const inn = lg ? lg.ok : null;
    const bal = id === 'flow' ? (pr.flowLeft != null ? `осталось <b>${pr.flowLeft}</b> из ${pr.flowDaily || 50} кредитов${pr.flowChecked ? ' · ' + ago(pr.flowChecked) : ''}` : 'кредиты ещё не проверены')
      + (out.flow ? ' · ⏸ пауза (сайт жаловался на активность)' : '')
      : id === 'dola' ? (pr.dolaPoints != null ? `баллов на видео сегодня: <b>${pr.dolaPoints}</b>` : 'баллы видео Dola называет после первого видео') + (out.dola ? ' · ⛔ лимит на сегодня' : '')
      : id === 'vids' ? (out.vids ? '⛔ лимит ИИ-видео на сегодня' : pr.vidsWait === 'smart' ? '⚠️ Google просит включить «умные функции Google Workspace» — это делаете вы сами в окне Chrome'
        : pr.vidsWait === 'terms' ? 'видео по тексту — да; для фото героя Google ждёт, что вы нажмёте «Ингредиенты» в Vids и примете его правила' : 'бесплатно · Omni 720p · 10 с')
      : out.arena ? '⛔ лимит видео на сегодня — смените аккаунт' : 'бесплатно · лимит Arena не публикует';
    const busy = accState.busy[key], choose = accState.choose[key];
    const st = busy ? '⏳ Вхожу через Google…' : choose ? '👤 Какой аккаунт Google взять?' : p === 'out' ? '🔑 Вышли — войдите другим аккаунтом' : p === 'in' ? '⏳ Войдите в окне Chrome, потом нажмите «Я вошёл»'
      : inn === true ? '🟢 вход выполнен' : inn === false ? '🔴 не вошли' : 'вход ещё не проверялся';
    const use = pr.usage?.[id] ? `<span class="hint">📊 ${esc(pr.usage[id])}</span>` : '';
    // Dola и Arena входят через Google сами; Flow — выбор аккаунта Google в окне Chrome
    const auto = id !== 'flow' && id !== 'vids';   // Flow и Vids — выбор аккаунта Google в окне Chrome
    const btn = busy ? '<button class="btn small" disabled>⏳</button>'
      : p === 'in' ? `<button class="btn small free" data-acc-check="${id}" data-p="${pr.id}">✅ Я вошёл</button>`
      : p === 'out' || inn === false ? `<button class="btn small" data-acc-in="${id}" data-p="${pr.id}" title="${auto ? 'Freefield сам нажмёт «Продолжить с Google» и выберет аккаунт Google этого профиля Chrome. Пароли не вводит.' : 'Откроется выбор аккаунта Google в окне Chrome Freefield'}">🔑 ${auto ? 'Войти через Google' : 'Войти'}</button>`
      : `<button class="btn small" data-acc-out="${id}" data-p="${pr.id}" title="Выйти, чтобы войти другим аккаунтом (например, когда кредиты кончились)">👤 Выйти из аккаунта</button>`;
    const pick = choose ? `<div class="acc-pick">${choose.map(m => `<button class="btn small" data-acc-as="${id}" data-p="${pr.id}" data-email="${esc(m)}">👤 ${esc(m)}</button>`).join('')}</div>` : '';
    return `<div class="acc-row"><span class="mc-ico" style="background:${x.color};color:#fff">${esc(x.ico)}</span>
      <div class="acc-main"><b>${esc(x.name)}</b> <span class="hint">${st} · ${bal}</span>${use}${pick}</div>${btn}</div>`;
  };
  // «Открыть» — окно этого профиля рядом с остальными: Flow, Dola, Arena и окна входа; «Закрыть» — окно этого профиля
  const btns = pr => `<span class="acc-prof-btns">
      <button class="btn small" data-acc-open="${pr.id}" ${accState.opening ? 'disabled' : ''} title="Окно Chrome этого профиля — рядом с уже открытыми: Flow, Dola и Arena вкладками, и где вход не выполнен — окно входа">${accState.opening === pr.id ? '⏳ Открываю…' : '↪ Открыть этот профиль'}</button>
      <button class="btn small" data-acc-close="${pr.id}" ${isOpen(pr) ? '' : 'disabled'} title="${isOpen(pr) ? 'Закрыть окно Chrome этого профиля' : 'Этот профиль сейчас не открыт'}">✕ Закрыть этот профиль</button></span>`;
  const head = pr => `<div class="acc-prof"><span>🧑‍💻 Профиль Chrome «${esc(pr.name)}»${isOpen(pr) ? ' · открыт сейчас' : ''}</span>${btns(pr)}</div>`;
  const body = profs.map(pr => (profs.length > 1 ? head(pr) : '') + ['flow', 'dola', 'arena', 'vids'].map(id => row(pr, id)).join('')).join('');
  const openOne = profs.length > 1 ? '' : btns(profs[0]);
  // несколько окон профилей сразу: входить можно, а генерации ждут, пока не останется один профиль
  const multi = info.multi ? `<div class="cl-conn">🪟 Открыты окна профилей: ${open.length}. Freefield генерирует во всех сразу — каждое задание в окне своего профиля. Где открыто окно входа — войдите и нажмите «✅ Я вошёл».${info.unknown ? ` Ещё ${info.unknown === 1 ? 'одно окно' : info.unknown + ' окна'} Chrome — профиль Freefield не узнал (в окне нет пустой вкладки): откройте в нём новую вкладку.` : ''}</div>` : '';
  return `<div class="acc-box">${multi}${body}<div class="acc-foot">${openOne}
    <button class="btn small" data-acc-new ${accState.adding ? 'disabled' : ''} title="Новый профиль Google Chrome в отдельном окне (рядом с открытыми): Flow, Dola и Arena с окнами входа — входите другим аккаунтом, кредитов станет больше">${accState.adding ? '⏳ Открываю…' : '＋ Добавить профиль для входа'}</button>
    ${profs.length > 1 ? `<button class="btn small" data-acc-all ${accState.opening ? 'disabled' : ''} title="Окна всех профилей Chrome сразу: в каждом Flow, Dola, Arena и окна входа, где вход не выполнен">${accState.opening === 'all' ? '⏳ Открываю профили…' : '🪟 Открыть все профили'}</button>
    <button class="btn small" data-acc-close-all ${open.length && !accState.opening ? '' : 'disabled'} title="${open.length ? 'Закрыть окна Chrome всех профилей' : 'Окна профилей сейчас не открыты'}">✕ Закрыть все профили</button>` : ''}
    <button class="btn small" data-acc-refresh ${accState.checking ? 'disabled' : ''}>${accState.checking ? '⏳ Проверяю…' : '↻ Проверить баланс'}</button></div></div>`;
}
async function accAction(kind, site, btn, p = 1, email = null) {
  if (btn) btn.disabled = true;
  const post = async u => { const r = await fetch(hubLink.url(u), {method: 'POST'}); return {r, j: await r.json().catch(() => ({}))}; };
  try {
    if (kind === 'refresh' || kind === 'check') {
      accState.checking = true; renderScnAcc();
      const {r, j} = await post(kind === 'check' ? `/api/status?profile=${p}` : '/api/status');
      if (r.ok) { const {status, ...info} = j; hubLink.info = {...hubLink.info, ...info}; if (site) delete accState.pending[`${site}@${p}`]; else accState.pending = {}; toast(j.message || 'Баланс обновлён', {type: 'ok', ms: j.message ? 9000 : 4200}); }
      else toast(j.error || `компьютер ответил ${r.status}`, {type: 'err'});
    } else if (kind === 'open' || kind === 'all' || kind === 'new') {
      // окна профилей рядом с открытыми: Flow, Dola, Arena и окна входа (где вход не выполнен — ждём «Я вошёл»)
      if (kind === 'new') accState.adding = true; else accState.opening = kind === 'all' ? 'all' : p;
      renderScnAcc();
      const {r, j} = await post(kind === 'all' ? '/api/profiles/all' : kind === 'new' ? '/api/profile' : `/api/profile/open?profile=${p}`);
      const {message, ok, profiles: res, ...rest} = j;
      if (r.ok && rest.profiles) hubLink.info = {...hubLink.info, ...rest, profiles: rest.profiles};
      for (const x of res || []) for (const [site, v] of Object.entries(x.sites || {})) {
        const key = `${site}@${x.id}`;
        delete accState.choose[key];
        if (v === 'login') accState.pending[key] = 'in'; else delete accState.pending[key];
      }
      toast(message || j.error || `компьютер ответил ${r.status}`, {type: r.ok && ok !== false ? 'ok' : 'err', ms: 12000});
      if (kind === 'new') await hubLink.refresh();
    } else if (kind === 'close' || kind === 'close-all') {
      const {r, j} = await post(kind === 'close-all' ? '/api/profiles/close' : `/api/profile/close?profile=${p}`);
      if (r.ok && j.ok) { const {message, ok, ...info} = j; hubLink.info = {...hubLink.info, ...info}; }
      toast(j.message || j.error || `компьютер ответил ${r.status}`, {type: r.ok && j.ok ? 'ok' : 'err', ms: 7000});
    } else if (kind === 'in') {
      // вход: Dola и Arena — через Google сами; email — аккаунт, выбранный из списка
      const key = `${site}@${p}`;
      accState.busy[key] = true; delete accState.choose[key]; renderScnAcc();
      const {r, j} = await post(`/api/login?site=${site}&profile=${p}${email ? '&email=' + encodeURIComponent(email) : ''}`);
      delete accState.busy[key];
      if (j.loggedIn) {
        delete accState.pending[key];
        const s = await post(`/api/status?profile=${p}`).catch(() => null);   // баланс нового аккаунта
        if (s?.r.ok) { const {status, ...info} = s.j; hubLink.info = {...hubLink.info, ...info}; }
      } else if (j.choose?.length) accState.choose[key] = j.choose;
      else if (r.ok) accState.pending[key] = 'in';
      toast(j.message || j.error || `компьютер ответил ${r.status}`, {type: j.loggedIn || j.choose ? 'ok' : 'err', ms: 9000});
    } else {
      const {r, j} = await post(`/api/account?site=${site}&profile=${p}`);
      if (r.ok && j.ok !== false) { accState.pending[`${site}@${p}`] = 'out'; delete accState.choose[`${site}@${p}`]; }
      toast(j.message || j.error || `компьютер ответил ${r.status}`, {type: r.ok && j.ok !== false ? 'ok' : 'err', ms: 8000});
    }
  } catch (e) { toast('Компьютер не отвечает: ' + e.message, {type: 'err'}); }
  accState.checking = false; accState.adding = false; accState.opening = null;
  renderScnAcc();
  renderScn();
}
const renderScnAcc = () => { const el = $('#scnAcc'); if (el) el.innerHTML = scnAccHTML(); };
// в окне «Профили» — ещё и все остальные сервисы, где вы вошли (отмечены в «Мои сервисы»)
function clBatchHTML(b) {
  const ic = {queued: '⏳', running: '⏳', done: '✅', error: '❌'};
  const ok = b.items.filter(i => i.status === 'done').length;
  return `<div class="cl-batch">
    <div class="cl-batch-head"><span>${b.source === 'phone' ? '📱 Из приложения' : b.source === 'sync' ? '🔄 Забрано с сайтов' : '🤖 От Claude'} · ${new Date(b.created).toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'})}</span>
      <span>${b.done ? `готово ${ok} из ${b.items.length}` : '⏳ идёт…'}</span></div>
    ${b.items.map(it => `<div class="cl-item">
      <div>${ic[it.status] || '⏳'} ${it.kind === 'video' ? '🎬' : '🖼'} <b>${esc(it.siteLabel || it.site)}</b>${it.model ? ' · ' + esc(it.model) : ''} — ${esc(it.prompt.slice(0, 90))}${it.prompt.length > 90 ? '…' : ''}</div>
      ${it.note ? `<div class="msg">↪ ${esc(it.note)}</div>` : ''}
      ${it.status === 'error' ? `<div class="err">${esc(it.message)}</div>` : it.status === 'done'
        ? `<div class="msg">${it.files.length} ${plur(it.files.length, 'файл', 'файла', 'файлов')} — в галерее</div>` : `<div class="msg">${esc(it.message || 'в очереди')}</div>`}
    </div>`).join('')}
  </div>`;
}

// расход за сегодня — знает только компьютер (он ведёт счёт по каждому сайту)
function clUseText(id) {
  const u = hubLink.ok && hubLink.info?.usage?.[id];
  return u ? `📊 ${esc(u)}` : '';
}

// смена аккаунта: компьютер открывает выбор аккаунта в окне Chrome Freefield, аккаунт выбирает пользователь
async function clSwitchAccount(id, btn) {
  const name = SITE_NAMES[id];
  if (!hubLink.ok) {
    const ok = await clCopyText(`Смени аккаунт в ${name} через Freefield (switch_account site="${id}")`);
    return toast(ok ? `Скопировано — вставьте в чат с Claude на компьютере: он откроет смену аккаунта ${name} в окне Chrome Freefield` : `Попросите Claude на компьютере: «смени аккаунт в ${name}»`, {type: 'ok', ms: 7000});
  }
  btn.disabled = true;
  try {
    const r = await fetch(hubLink.url(`/api/account?site=${id}`), {method: 'POST'});
    const j = await r.json().catch(() => ({}));
    toast(j.message || `компьютер ответил ${r.status}`, {type: j.ok ? 'ok' : 'err', ms: 9000});
  } catch (e) { toast('Компьютер не отвечает: ' + e.message, {type: 'err'}); }
  btn.disabled = false;
}

// нижняя часть раздела — статус связи, кнопки, задания: обновляется при каждом опросе компьютера, не трогая поля ввода
function clLiveHTML(where = 'create') {
  const st = pcStatus();
  const conn = hubLink.ok
    ? `<div class="cl-conn on">🟢 Приложение подключено к компьютеру — задания уйдут прямо туда${hubLink.info?.flowLeft != null ? ` · во Flow осталось <b>${hubLink.info.flowLeft}</b> из 50 кредитов` : ''}${hubLink.onPc() ? ' <button class="btn small" data-phone-qr title="QR-код: открыть Freefield с вашими аккаунтами на телефоне">📱 На телефон</button>' : ''}</div>`
    : st.k === 'denied' || st.k === 'down' ? `<div class="cl-conn">${st.icon} ${st.text}.${st.k === 'down' ? ' Или без него: «Подготовить» сделает карточки для сайтов — «Создать» там нажмёте сами.' : ''}</div>`
    : where === 'asset' ? ''   // в «Фото» инструкцию для телефона не показываем (просьба пользователя 2026-09-27)
    // без компьютера (версия с GitHub, APK) — вручную на сайтах сервисов (пользователь 2026-09-28: «генерация с телефона без компа»)
    : `<div class="cl-conn">${helpHTML('📱 Без компьютера — сами на сайтах сервисов', `<ol class="steps"><li>Нажмите <b>«Подготовить»</b> — на каждый сценарий в галерее появится карточка: фото, промпт, сервис, модель и формат.</li>
        <li>На карточке: <b>💾 сохраните фото</b> → <b>«Скопировать промпт и открыть»</b> сайт → приложите фото, вставьте промпт и нажмите там «Создать».</li>
        <li>Скачайте результат и нажмите <b>«📥 Загрузить файл»</b> — он появится в галерее.</li></ol>
        Тратятся те же бесплатные кредиты ваших аккаунтов.${pwa.mobile() ? ' Google Vids с телефона видео не создаёт — «Авто» раскладывает по Flow, Dola и Arena.' : ''}
        Чтобы всё запускалось само, нужен компьютер: там во Freefield кнопка «📱 На телефон».`)}</div>`;
  return `${conn}
    <div class="cl-acts">
      ${where === 'create' && (hubLink.ok || !pwa.mobile()) ? '<button class="btn" data-copy>📋 Скопировать задание для Claude</button>' : ''}
      ${hubLink.ok ? '<button class="btn" data-import-all title="Компьютер проверит сервисы (Flow…) и отдаст все картинки и видео за сегодня и вчера">🔄 Забрать всё из сервисов</button>' : ''}
    </div>
    ${hubLink.ok && hubLink.batches.length ? `<div class="cl-sec">Задания</div>${hubLink.batches.slice(0, where === 'asset' ? 3 : 6).map(clBatchHTML).join('')}` : ''}`;
}

// Сценарии в разделе «Создать»: несколько промптов сразу → Flow / Arena / Dola
// без компьютера на телефоне — не «запустит», а подготовит (обновляется и при ответе компьютера)
const scnIntroText = () => `Каждый сценарий — отдельное видео или фото. Freefield сам разложит их по ${phoneOnly()
  ? 'Google Flow, Arena и Dola на бесплатных кредитах и подготовит для каждого фото и промпт — «Создать» на сайте нажмёте сами'
  : 'Google Vids, Google Flow, Arena и Dola на бесплатных кредитах и запустит все сразу'}. До ${CL_MAX} за раз.`;
function renderScn() {
  if (!$('#scnCreate')) return;
  const scn = cl.scn.map((s, i) => `<div class="scn ${cl.sel === i ? 'sel' : ''}" data-i="${i}">
      <div class="scn-head"><b>Сценарий ${i + 1}</b>
        <div class="scn-opts"><div class="seg"><button data-kind="video" class="${s.kind === 'video' ? 'on' : ''}">🎬 Видео</button><button data-kind="image" class="${s.kind === 'image' ? 'on' : ''}">🖼 Фото</button></div>
        <button class="scn-style ${s.style != null ? 'has' : ''} ${cl.sel === i ? 'on' : ''}" data-style-pick title="${cl.sel === i ? 'Снять выбор' : 'Выбрать этот сценарий и назначить ему стиль в сетке «Стиль» ниже'}">🎨 ${s.style != null ? esc(styleOf(s.style).name) : 'Стиль'}</button>
        ${s.kind === 'video' ? `<button class="scn-style ${s.camera ? 'has' : ''}" data-cam-pick title="Движение камеры — допишется в промпт видео, в строку «Camera & framing»">🎥 ${s.camera ? esc(byId(MOTIONS, s.camera).name) : 'Камера'}</button>` : ''}
        ${s.kind === 'video' ? `<button class="scn-style ${scnVoice(s) ? 'has' : ''}" data-voice-pick title="${esc(scnVoice(s) ? `Голос: ${scnVoice(s).name} — ${scnVoice(s).ru}` : 'Кто говорит: персонаж и его голос — впишется в промпт видео, в строку «Spoken line»')}">🎙 ${esc(scnVoiceLabel(s))}</button>` : ''}
        <select data-sm aria-label="Сервис и модель">${scnSelectHTML(s)}</select></div>
        <div class="scn-tools"><button class="scn-rm" data-copy-one title="Скопировать промпт этого сценария">📋</button>
        ${cl.scn.length > 1 ? '<button class="scn-rm" data-rm title="Убрать сценарий">✕</button>' : ''}</div></div>
      <div class="scn-to" data-to="${i}">${scnToHTML(i)}</div>
      <div class="scn-fmt"><span>Формат ${s.kind === 'video' ? 'видео' : 'фото'}</span><div class="chips">${scnFormats(s).map(a => arChip(a, scnAspect(s) === a, 'data-sar')).join('')}</div>
        ${scnFmtHint(s) ? `<span class="hint">${scnFmtHint(s)}</span>` : ''}</div>
      ${scnRefHTML(s, i)}
      <textarea data-prompt rows="${isBlockPrompt(s.prompt) ? 10 : 3}" placeholder="${i === 0 ? 'Например: дрон пролетает над ночным мегаполисом, неон отражается в лужах, камера медленно опускается к улице' : 'Что происходит в кадре, как движется камера, какой свет и настроение'}">${esc(s.prompt)}</textarea>
    </div>`).join('');
  $('#scnCreate').innerHTML = `
    ${helpHTML('Как это работает', `<div class="scn-intro">${scnIntroText()}</div>`)}
    ${scn}
    <div class="cl-row">
      ${cl.scn.length < CL_MAX ? '<button class="btn" data-add>＋ Сценарий</button>' : ''}
      <button class="btn" data-tok title="Сколько кредитов во Flow и на сколько сценариев хватит; вход и лимиты в Dola, Google Vids и Arena">💳 Проверить баланс</button>
    </div>
`;
  $('#scnLive').innerHTML = `<div class="cl-plan">${clPlanText()}</div><div class="cl-live" data-where="create">${clLiveHTML('create')}</div>`;
}
const SITE_SHORT = {flow: 'Google Flow', dola: 'Dola', arena: 'Arena', vids: 'Google Vids'};
// ✓ — модель по умолчанию на сервисе: её берёт «Авто» (Omni 1.1 Flash, Seedance 2.5, Nano Banana 2, Seedream 5.0…)
const scnModelLabel = (kind, m) => `${m[1] === scnDefault(kind, m[0]) ? '✓ ' : ''}${m[2]} · ${m[3]}`;
function scnSelectHTML(s) {
  const cur = s.service === 'auto' ? 'auto' : `${s.service}:${s.model || scnDefault(s.kind, s.service)}`;
  const groups = ['vids', 'flow', 'dola', 'arena'].map(site => {
    const ms = SCN_MODELS[s.kind].filter(m => m[0] === site);
    return ms.length ? `<optgroup label="${SITE_SHORT[site]}">${ms.map(m => `<option value="${site}:${m[1]}" ${cur === site + ':' + m[1] ? 'selected' : ''}>${scnModelLabel(s.kind, m)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  return `<option value="auto" ${cur === 'auto' ? 'selected' : ''}>⚡ Авто — Freefield выберет сам (модели с ✓)</option>${groups}`;
}
// подпись у сценария: куда он пойдёт по плану (с учётом остальных сценариев)
function scnToHTML(i) {
  const list = cl.scn.map(x => ({...x}));
  const p = clPlan(list)[i];
  if (!p) return '';
  return `→ <b>${SITE_SHORT[p.site]}</b> · ${esc(p.m[2])} · ${esc(p.m[3])}${cl.scn[i].service === 'auto' ? ' <span class="hint">(авто)</span>' : ''}`;
}
// два фото у сценария: «персонаж в локации» (первый кадр, главный референс) и развёртка героя (только «ингредиент» Flow и Vids)
function scnRefHTML(s, i) {
  const vid = s.kind === 'video';
  // 📎 при загруженных в «Сценариях» кадрах «персонаж в локации» — выбрать из них (уже взятые другими сценариями — бледнее)
  const pick = !s.ref && cl.pickFor === i && wr.locs.length ? `<div class="scn-pick">
    ${wr.locs.map((src, k) => `<button data-loc-pick="${k}" class="${cl.scn.some(x => x.ref === src) ? 'used' : ''}" title="Кадр ${k + 1} из «Сценариев»"><img src="${src}" alt=""><i>${k + 1}</i></button>`).join('')}
    <button class="btn small" data-ref-file>📁 Другое фото</button><button class="btn small" data-pick-x>Отмена</button></div>` : '';
  const add = pick || [
    !s.ref && `<button class="btn small" data-ref-add title="Герой уже на месте съёмки (шаг 2): видео начнётся с этого кадра, картинка будет сделана по нему">📎 ${vid ? 'Персонаж в локации' : 'Фото-референс'}</button>`,
    !s.sheet && `<button class="btn small" data-sheet-add title="${wr.sheet ? 'Возьму развёртку из «Сценариев»' : 'Развёртка героя: вид спереди, сбоку, сзади, лицо, одежда'}">🧍 Развёртка</button>`,
  ].filter(Boolean).join('');
  const photo = (src, text, rm) => `<div class="scn-ref"><img src="${src}" alt=""><span>${text}</span><button class="scn-rm" ${rm} title="Убрать фото">✕</button></div>`;
  return `<div class="scn-refs">
    ${s.ref ? photo(s.ref, vid ? '<b>Персонаж в локации</b> — первый кадр: Flow и Vids возьмут его «ингредиентом», Arena оживит' : 'Картинка будет сделана по этому фото', 'data-ref-rm') : ''}
    ${s.sheet ? photo(s.sheet, '<b>Развёртка</b> — внешность героя для Flow и Vids (Arena и Dola берут только первое фото)', 'data-sheet-rm') : ''}
    ${pick || (add ? `<div class="btns">${add}</div>` : '')}</div>`;
}
// фото → JPEG до 1600 px (чтобы быстро уходило на компьютер) → data URL
async function refDataUrl(blob) {
  const small = await downscale(blob, 1600);
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(small); });
}
// из галереи: картинка → новый сценарий с этим фото (по умолчанию — оживить в видео)
async function refToScenario(blob) {
  const ref = await refDataUrl(blob);
  const empty = cl.scn.findIndex(scnEmpty);
  const scn = {...(empty >= 0 ? cl.scn[empty] : scnLike(cl.scn.at(-1))), kind: 'video', ref};
  if (scn.model && !scnModel('video', scn.service, scn.model)) delete scn.model;   // была модель для фото
  if (empty >= 0) cl.scn[empty] = scn; else if (cl.scn.length < CL_MAX) cl.scn.push(scn); else return toast(`Уже ${CL_MAX} сценариев — уберите лишний`, {type: 'err'});
  cl.save();
  setView('create');
  setCreateMode('scn');
  toast('Фото добавлено в сценарий — опишите, что происходит в кадре', {type: 'ok'});
  $$('#scnCreate [data-prompt]')[empty >= 0 ? empty : cl.scn.length - 1]?.focus();
}
function setCreateMode(m) {
  const prev = cl.mode;
  cl.mode = ['scn', 'write', 'chars', '3d', 'edit', 'voice'].includes(m) ? m : 'one';
  if (prev === 'edit' && cl.mode !== 'edit') mtPause();
  if (cl.mode === 'scn' && prev !== 'scn') { const t = scnTrim(cl.scn); if (t.length !== cl.scn.length) { cl.scn = t; cl.sel = null; cl.save(); } }
  ls.set('freefield.create.cm', cl.mode);
  document.body.dataset.cm = cl.mode;
  $$('#createMode [data-cm]').forEach(b => b.classList.toggle('on', b.dataset.cm === cl.mode));
  if (cl.mode !== 'scn') cl.sel = null;
  if (cl.mode === 'scn') { renderScn(); if (hubLink.key && hubLink.local()) hubLink.refresh(); }
  else if (cl.mode === 'write') renderWrite();
  else if (cl.mode === 'chars') renderChars();
  else if (cl.mode === '3d') renderM3dPanel();
  else if (cl.mode === 'edit') renderMt();
  else if (cl.mode === 'voice') renderEcho();
  else setAssetSvc(asset.svc);
  styleSync();
  updateGenButton();
}
// большая кнопка внизу в режиме сценариев: отправить на компьютер, а без него — карточки для сайтов сервисов
// own — свой список сценариев (кнопка «🎬 Видео» у персонажа): уходит только он, «Видео» остаются как были
async function scnGo(own) {
  if (peek.on) {
    const list = own || cl.ready();
    if (!list.length) return toast('Напишите хотя бы один сценарий', {type: 'err'});
    const out = await clTasks(list), plan = clPlan(list);
    return peekShow('Видео', {prompts: out.map((t, i) => [`Сценарий ${i + 1} → ${SITE_SHORT[plan[i]?.site] || plan[i]?.site || t.service} · ${plan[i]?.model || t.model || ''}`, t.prompt]),
      request: {куда: 'программа на компьютере: POST /api/batch', body: {scenarios: out}}});
  }
  return (await hubReady()) ? clSend(own) : scnPhone(own);
}
// большая кнопка «Создать»: в каждой вкладке — своё действие
function createGo() { return cl.mode === 'chars' ? vcOpenChar(null, 'chars') : cl.mode === '3d' ? m3dGo() : cl.mode === 'edit' ? mtGo() : cl.mode === 'voice' ? echoEnsure() : cl.mode === 'scn' ? scnGo() : cl.mode === 'write' ? writeGo() : assetGo(); }
