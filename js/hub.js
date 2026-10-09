'use strict';
/* =============================== Для Клода =============================== */
// Сервисы, которые Claude запускает сам через MCP-сервер Freefield на компьютере — в отдельном окне Chrome,
// где пользователь один раз вошёл в аккаунты. Сценарии пишутся здесь: с телефона они уходят на компьютер по домашнему
// Wi-Fi (Freefield открыт по QR-коду с компьютера), а без подключения копируются заданием для чата с Claude.
const CLAUDE_SVC = [
  {id: 'flow', what: '50 кредитов в день. Видео — Omni 1.1 Flash по умолчанию (20 кредитов), Veo 3.1 Lite — 10; картинки Nano Banana 2.1 — без кредитов.'},
  {id: 'arena', what: 'Бесплатно. Один запрос = 2 видео или 2 картинки от двух случайных топ-моделей; умеет оживлять картинку. Arena может публиковать промпты для исследований — не пишите личное.'},
  {id: 'dola', what: 'Картинки Seedream 5.0 — без кредитов, обычно 4 варианта за раз; видео Seedance 2.5 — за баллы Dola.'},
  {id: 'vids', what: 'Бесплатно. Видео Omni · 720p · 10 с · со звуком, вертикально или горизонтально, около минуты на видео. Фото героя — «ингредиенты» (Google один раз попросит вас принять правила).'},
];
const SITE_NAMES = {flow: 'Google Flow', arena: 'Arena', dola: 'Dola', vids: 'Google Vids', freefield: 'Freefield', upscale: '🔍 Увеличение'};
const CL_MAX = 10;
const plur = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
const blankScn = () => ({prompt: '', kind: 'video', service: 'auto'});   // формат (aspect) — свой у каждого сценария, по умолчанию последний выбранный
// пустой сценарий — без текста и кадра (развёртка и выбор модели — это настройки, не содержимое)
const scnEmpty = x => !String(x.prompt || '').trim() && !x.ref;
// «＋ Сценарий»: новый — с настройками последнего (видео/фото, сервис и модель, формат, стиль, развёртка), текст и кадр — свои
const scnLike = s => s ? {...blankScn(), kind: s.kind, service: s.service, ...(s.model && {model: s.model}), aspect: scnAspect(s),
  ...(s.style != null && {style: s.style}), ...(s.camera && {camera: s.camera}), ...(s.sheet && {sheet: s.sheet}), ...(s.char && {char: s.char}), ...(s.voice && {voice: s.voice})} : blankScn();
// раздел «Видео» открывается с одним сценарием: лишние пустые убираем, заполненные остаются
const scnTrim = list => { const keep = list.filter(x => !scnEmpty(x)); return keep.length ? keep : [list[0] || blankScn()]; };
const cl = {
  scn: scnTrim((ls.get('freefield.claude.scn', null) || [blankScn()])
    .map(s => ({...s, service: ['auto', 'flow', 'dola', 'arena', 'vids'].includes(s.service) ? s.service : 'auto'}))),
  aspect: ls.get('freefield.claude.aspect', '9:16'),
  seconds: ls.get('freefield.claude.seconds', 10),   // длина видео; во Flow по умолчанию Omni 1.1 Flash (20 кр.) — умеет и 10, и 8 с
  vcost() { return 20; },
  sending: false,
  sel: null,   // сценарий, выбранный кнопкой 🎨: стиль из сетки назначается только ему
  mode: ls.get('freefield.create.cm', 'chars'),   // раздел «Создать»: chars — персонажи (первый по порядку работы), one — фото, write — сценарии, scn — видео…
  save() { ls.set('freefield.claude.scn', this.scn.map(({ref, sheet, ...x}) => x)); ls.set('freefield.claude.aspect', this.aspect); ls.set('freefield.claude.seconds', this.seconds); },
  ready() { return this.scn.filter(s => s.prompt.trim().length >= 3); },
};

// Связь с компьютером: сервер Freefield на ПК отдаёт это приложение по Wi-Fi; в ссылке из QR-кода — секретный ключ
const HUB_PC = 'http://127.0.0.1:5180';
// адрес компьютера в домашней сети из QR-кода — только адрес домашней сети (192.168.x.x, 10.x.x.x, 172.16–31.x.x, имя.local) и порт
function pcLanAddr(a) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9-]+\.local):(\d{2,5})$/i.exec(String(a || ''));
  if (!m) return null;
  const o = m[1].split('.').map(Number);
  return /\.local$/i.test(m[1]) || o.every(x => x <= 255) && (o[0] === 10 || o[0] === 192 && o[1] === 168 || o[0] === 172 && o[1] >= 16 && o[1] <= 31) ? m[0] : null;
}
// Freefield с компьютера по Wi-Fi (там «Эхо» и всё остальное работает само); to — вкладка
function pcLanOpen(to) {
  const p = ls.get('freefield.pcLan', null);
  if (!p) return false;
  const url = `http://${p.addr}/?k=${encodeURIComponent(p.key)}#${to}`;
  if (native.on()) native.open(url); else location.assign(url);
  return true;
}   // программа Freefield на компьютере (запускается ярлыком или вместе с Claude Desktop)
const hubLink = {
  key: null, ok: false, denied: false, info: null, batches: [], timer: null,
  since: ls.get('freefield.hubSince', 0),
  imported: ls.get('freefield.claude.imported', {}),
  // base — адрес программы Freefield на этом компьютере, когда сайт открыт с GitHub (иначе — тот же сайт, путь относительный)
  base: '', direct: false, pcUp: null,
  url(p) { return this.base + p + (p.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(this.key); },
  local: () => location.protocol === 'http:' || hubLink.direct || hubLink.viaLan,   // есть путь к компьютеру: открыто с него или сайт достучался сам
  viaLan: false, lanTry: null,
  // Freefield с GitHub на телефоне, связанный с компьютером по QR: напрямую к программе по Wi-Fi. Chrome так пускает с разрешения
  // «Доступ к локальной сети» (адрес домашней сети, запрос с targetAddressSpace); не пустил — «Озвучка» откроется с компьютера (pcLanOpen)
  // одна попытка на всех (вкладка, задания ждут её же); «Проверить снова» — новая
  tryLan() {
    const p = ls.get('freefield.pcLan', null);
    if (!p || location.protocol !== 'https:' || this.pcSite()) return Promise.resolve(false);
    return this.lanTry ||= (async () => {
      try {
        const r = await fetch(`http://${p.addr}/api/hub?k=${encodeURIComponent(p.key)}`, {signal: AbortSignal.timeout(15000), targetAddressSpace: 'local'});
        if (!r.ok) return false;
      } catch { return false; }
      Object.assign(this, {base: 'http://' + p.addr, key: p.key, viaLan: true});
      await this.refresh();
      return this.ok;
    })();
  },
  // открыто на самом компьютере (localhost / 127.0.0.1 — для браузера это разные сайты со своим хранилищем):
  // ключ связи Freefield отдаёт такой странице сам — без QR-кода
  onPc: () => location.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || hubLink.direct,
  pcSite: () => location.protocol === 'https:' && !pwa.mobile() && !isMobile(),   // сайт с GitHub на компьютере
  // Сайт с GitHub на компьютере — сразу к программе Freefield на нём (пользователь 2026-09-29: «в Профилях с сайта должны быть
  // профили, а не кнопка, которая ведёт на ошибку»). Программа пустила — профили здесь же; не пустила или не запущена — pcUp скажет
  async tryDirect() {
    if (!this.pcSite()) return false;
    Object.assign(this, {base: HUB_PC, direct: true});
    if (await this.localKey() || this.key) await this.refresh();
    if (this.ok) { this.pcUp = true; return true; }
    clearTimeout(this.timer);
    Object.assign(this, {base: '', direct: false, ok: false});
    this.pcUp = await fetch(HUB_PC + '/', {mode: 'no-cors'}).then(() => true, () => false);   // запущена ли вообще (ответ не читаем)
    // Chrome пускает https-сайт к программам на компьютере только с разрешения «Доступ к локальной сети» — без него запрос
    // падает так же, как будто программы нет (пользователь 2026-09-29: «через папку всё работает, а с GitHub — „не запущена“»)
    this.lna = null;
    for (const name of ['loopback-network', 'local-network-access', 'local-network']) {
      const st = await navigator.permissions?.query({name}).then(p => p.state, () => null);
      if (st) { this.lna = st; break; }
    }
    return false;
  },
  async localKey() {
    try {
      const r = await fetch(this.base + '/api/local-key');
      const k = r.ok && (await r.json()).key;
      if (!k) return false;
      this.key = k; ls.set('freefield.hubKey', k);
      return true;
    } catch { return false; }
  },
  init() {
    const q = new URLSearchParams(location.search);
    if (q.get('k')) {
      if (q.get('k') !== ls.get('freefield.hubKey', null)) ls.set('freefield.hubSince', this.since = Date.now() - 10 * 60e3);
      ls.set('freefield.hubKey', q.get('k'));
      q.delete('k');
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    }
    // Телефон ↔ компьютер (пользователь 2026-10-08: «озвучка с телефона не работает»): Freefield с GitHub на телефоне до
    // компьютера не достаёт. QR из «Озвучки» на компьютере ведёт сюда с адресом компьютера в домашней сети и ключом после #
    // (эта часть адреса на сервер не уходит): запоминаем и сразу открываем «Озвучку» с компьютера; дальше в «Озвучке» — кнопка
    const pair = new URLSearchParams(location.hash.slice(1)), addr = pcLanAddr(pair.get('pc'));
    if (pair.has('pc')) history.replaceState(null, '', location.pathname + location.search);
    if (addr && pair.get('k')) {
      ls.set('freefield.pcLan', {addr, key: pair.get('k')});
      // телефон пускает к компьютеру напрямую — «Озвучка» прямо здесь; нет — Freefield с компьютера по Wi-Fi
      if (pair.get('to') === 'voice' && location.protocol === 'https:') return this.tryLan().then(ok => ok ? (setView('create'), setCreateMode('voice')) : pcLanOpen('voice'));
    }
    this.tryLan();
    this.key = ls.get('freefield.hubKey', null);
    if (this.key && this.local()) this.refresh();
    else if (this.onPc()) this.localKey().then(ok => ok && this.refresh());
    // старые ссылки на раздел «Для Клода» ведут в «Сценарии» (адрес чистим, чтобы перезагрузка не перекидывала туда снова)
    if (location.hash === '#claude') { setView('create'); setCreateMode('scn'); history.replaceState(null, '', location.pathname + location.search); }
    // ссылка с телефона «Открыть „Озвучку“» — сразу во вкладку («Эхо» программа на компьютере запустит сама)
    if (/^#(voice|edit)$/.test(location.hash)) { setView('create'); setCreateMode(location.hash.slice(1)); history.replaceState(null, '', location.pathname + location.search); }
  },
  refresh() {
    // одно обновление за раз — иначе один и тот же файл импортировался бы дважды
    return this.loading ||= this.load().finally(() => { this.loading = null; });
  },
  async load() {
    clearTimeout(this.timer);
    try {
      const h = await fetch(this.url('/api/hub'));
      this.denied = h.status === 403;
      // ключ устарел, а страница открыта на самом компьютере — берём новый сам
      if (this.denied && this.onPc() && !this.keyRetried) { this.keyRetried = true; if (await this.localKey()) return this.load(); }
      this.ok = h.ok;
      if (h.ok) {
        this.info = await h.json();
        // приложение на компьютере обновилось, а эта страница открыта со старой версией — предложить перезагрузить
        const v = this.info.app;
        if (v && !this.appVer) this.appVer = v;
        else if (v && v !== this.appVer && v !== this.appToldVer) {
          this.appToldVer = v;
          toast('Вышла новая версия Freefield', {type: 'ok', ms: 120000, action: '↻ Обновить', onAction: () => location.reload()});
        }
        const b = await fetch(this.url('/api/batches'));
        if (b.ok) { this.batches = await b.json(); await this.importDone(); }
      }
    } catch { this.ok = false; }
    renderHubJobs();   // задания на компьютере — живые карточки в галерее
    renderPcBtn();
    if (this.ok && eh.state === 'nohub' && cl.mode === 'voice') renderEcho();   // связь появилась — «Озвучка» оживает сама
    $$('.cl-live').forEach(el => { el.innerHTML = clLiveHTML(el.dataset.where); });
    $$('.cl-plan').forEach(el => { el.innerHTML = clPlanText(); });
    $$('.scn-intro').forEach(el => { el.innerHTML = scnIntroText(); });
    if (!items.length) renderEmpty();
    if (!accState.checking) renderScnAcc();
    $$('#scnCreate [data-to]').forEach(el => { el.innerHTML = scnToHTML(+el.dataset.to); });
    updateGenButton();
    if (!$('#accSheet').classList.contains('hidden')) renderHub();
    if (!$('#mcpSheet').classList.contains('hidden')) renderMcp();
    this.timer = setTimeout(() => this.refresh(), this.batches.some(b => !b.done) ? 4000 : 20000);
  },
  // один файл с компьютера → в галерею (каждый файл один раз: помним по имени)
  async importFile(url, name, meta, got) {
    if (this.imported[name]) return false;
    const r = await fetch(this.url(url));
    if (!r.ok) return false;
    const blob = await r.blob();
    const kind = (meta.mime || blob.type).startsWith('video/') ? 'video' : 'image';
    const d = kind === 'video' ? await videoDims(blob) : await dims(blob);
    const duration = kind === 'video' ? await new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata';
      v.onloadedmetadata = () => res(Math.round(v.duration * 10) / 10 || null); v.onerror = () => res(null); v.src = urlOf(blob); }) : undefined;
    const prompt = meta.prompt || name.replace(/^freefield-|-\d+(-\d+)?\.\w+$/g, '').replace(/-/g, ' ');
    const site = meta.site || 'freefield';
    const item = {id: uid(), type: kind, status: 'done', statusText: '', createdAt: meta.mtime || Date.now(), importedAt: Date.now(),
      prompt, userPrompt: prompt, finalPrompt: prompt, model: meta.appModel || `ext:${site}-${kind}`, tier: String(meta.appModel).startsWith('pol:') ? 'paid' : 'free',
      modelTitle: `${SITE_NAMES[site] || site}${meta.model ? ' · ' + meta.model : ''}${meta.label ? ' · ' + meta.label : ''}`,
      seed: 0, cost: 0, source: 'text', aspect: meta.aspect || '16:9', w: d?.[0] || 1280, h: d?.[1] || 720, duration, blob, viaClaude: true, pcName: name};
    items.push(item);
    items.sort((a, b) => b.createdAt - a.createdAt);
    await DB.put(item);
    this.imported[name] = Date.now();
    ls.set('freefield.claude.imported', this.imported);
    got[kind]++;
    return true;
  },
  gotToast(got, prefix) {
    if (got.video || got.image || got.model) toast(`${prefix}: ${[got.video && `${got.video} видео`,
      got.image && `${got.image} ${plur(got.image, 'картинка', 'картинки', 'картинок')}`, got.model && `${got.model} ${plur(got.model, '3D-модель', '3D-модели', '3D-моделей')}`].filter(Boolean).join(' и ')}`, {type: 'ok', ms: 6000});
  },
  // готовая 3D-модель с компьютера → карточка в галерее (картинка, из которой её сделали, — обложкой)
  async importModel(b, it, got) {
    const f = it.files?.[0];
    const name = f && (f.name || f.url);
    if (!f || this.imported[name]) return false;
    const r = await fetch(this.url(f.url));
    if (!r.ok) return false;
    const blob = await r.blob();
    const src = items.find(x => x.id === ls.get('freefield.m3d.src', {})[b.id]);
    const m = it.meta3d || {};
    const item = {id: uid(), type: 'model', status: 'done', statusText: '', createdAt: b.created, importedAt: Date.now(),
      prompt: it.prompt, userPrompt: it.prompt, finalPrompt: it.prompt, model: 'pc:3d', tier: 'free',
      modelTitle: `${it.siteLabel || '3D'}${it.model ? ' · ' + it.model : ''}`, seed: 0, cost: 0, source: 'image',
      aspect: src?.aspect || '1:1', w: src?.w || 1024, h: src?.h || 1024, blob, posterBlob: src?.blob || null, m3d: m, note: it.note || '', viaClaude: true, pcName: name};
    items.push(item);
    items.sort((a, b) => b.createdAt - a.createdAt);
    await DB.put(item);
    this.imported[name] = Date.now();
    ls.set('freefield.claude.imported', this.imported);
    got.model = (got.model || 0) + 1;
    return true;
  },
  // готовые файлы новых генераций — в галерею сами
  async importDone() {
    const got = {video: 0, image: 0, model: 0};
    for (const b of this.batches) {
      // только сделанное через Freefield: старые синхронизации тащили с сайтов всё подряд — их не берём
      if (b.created < this.since || (b.source === 'sync' && !b.ours)) continue;
      for (const it of b.items) {
        if (it.kind === '3d') { if (it.status === 'done') try { await this.importModel(b, it, got); } catch { /* в следующий раз */ } continue; }
        for (const f of it.files || []) {
        try { await this.importFile(f.url, f.name || f.url, {...it, mime: f.mime, label: f.label, mtime: b.created}, got); } catch { /* попробуем в следующий раз */ }
        }
      }
    }
    if (got.video || got.image || got.model) render();   // один раз за все новые файлы, а не на каждый
    this.gotToast(got, 'С компьютера в галерею');
  },
  // кнопка «Забрать всё»: все файлы из Freefield/outputs за 2 дня, которых ещё нет в галерее
  async importAll(btn) {
    btn.disabled = true;
    const got = {video: 0, image: 0};
    try {
      // сначала компьютер проходит по сайтам (Flow…) и забирает то, чего ещё нет в Freefield
      btn.textContent = '🔄 Проверяю сервисы…';
      try {
        const s = await (await fetch(this.url('/api/sync'), {method: 'POST'})).json();
        if (s.errors?.length) toast('Не со всех сервисов: ' + s.errors.join('; '), {type: 'err', ms: 8000});
      } catch { /* компьютер без синхронизации — забираем то, что уже есть */ }
      const list = await (await fetch(this.url('/api/outputs'))).json();
      const todo = list.filter(f => !this.imported[f.name]);
      if (!todo.length) toast('В галерее уже всё, что есть на компьютере за 2 дня', {type: 'ok'});
      for (const [i, f] of todo.entries()) {
        btn.textContent = `📥 Забираю ${i + 1} из ${todo.length}…`;
        try { await this.importFile(f.url, f.name, {...(f.meta || {}), mtime: f.mtime}, got); } catch {}
      }
      render();
      this.gotToast(got, 'Добавлено в галерею');
    } catch (e) { toast('Компьютер не отвечает: ' + e.message, {type: 'err'}); }
    btn.disabled = false;
    btn.textContent = '🔄 Забрать всё из сервисов';
  },
};
// связь с программой Freefield на ПК — одним описанием для всех разделов: ok, denied (ключ сменился), down (компьютер по Wi-Fi
// не отвечает), pc-off (сайт с GitHub на компьютере, программа не отвечает), none (компьютера нет — телефон без связки)
// «● Компьютер» в верхней полосе: точка — состояние связи, нажатие — проверить и что делать
function renderPcBtn() {
  const b = $('#pcBtn'), st = pcStatus();
  if (!b) return;
  b.dataset.pc = st.k;
  b.title = st.k === 'none' ? (pwa.mobile() || isMobile() ? 'Компьютер не подключён — на компьютере во Freefield: «📱 На телефон»' : 'Программа Freefield на компьютере не найдена') : st.text;
}
async function pcBtnClick() {
  const b = $('#pcBtn');
  b.dataset.pc = 'wait';
  if (!hubLink.ok && hubLink.pcSite()) { hubLink.pcUp = null; await hubLink.tryDirect(); }
  await hubLink.refresh();
  const st = pcStatus();
  renderPcBtn();
  if (st.k === 'ok') return toast(`🟢 Компьютер подключён${hubLink.info?.flowLeft != null ? ` · во Flow осталось ${hubLink.info.flowLeft} из 50 кредитов` : ''}`, {type: 'ok',
    ...(hubLink.onPc() && {action: '📱 На телефон', onAction: () => { closeSheets(); openInstall(); }})});
  if (st.k !== 'none') return toast(`${st.icon} ${st.text}`, {type: 'err', ms: 9000});
  toast(pwa.mobile() || isMobile() ? 'Компьютер не подключён. На компьютере откройте Freefield → «📱 На телефон» и наведите камеру на QR-код — задания пойдут на компьютер'
    : 'Программа Freefield на компьютере не найдена — откройте Claude Desktop или запустите Freefield из папки', {type: 'err', ms: 10000});
}
function pcStatus() {
  if (hubLink.ok) return {k: 'ok', icon: '🟢', text: 'Приложение подключено к компьютеру'};
  if (hubLink.denied) return {k: 'denied', icon: '🔑', text: 'Ключ связи сменился — отсканируйте новый QR-код: на компьютере во Freefield кнопка «📱 На телефон»'};
  if (hubLink.key && hubLink.local()) return {k: 'down', icon: '🔴', text: 'Компьютер не отвечает. Проверьте: компьютер включён, Claude Desktop открыт, телефон в той же сети Wi-Fi'};
  if (hubLink.pcSite()) return {k: 'pc-off', icon: '💻', text: 'Программа Freefield на этом компьютере не отвечает — откройте Claude Desktop'};
  return {k: 'none', icon: '', text: ''};
}

// Модели для сценариев: [сервис, ключ модели, название, цена/длина, кредиты Flow или баллы Dola]
const SCN_MODELS = {
  video: [
    ['flow', 'omni-1.1-flash', 'Omni 1.1 Flash', '10 с · 20 кредитов', 20],
    ['flow', 'veo-3.1-lite', 'Veo 3.1 Lite', '8 с · 10 кредитов', 10],
    ['flow', 'veo-3.1-fast', 'Veo 3.1 Fast', '8 с · 20 кредитов', 20],
    ['flow', 'veo-3.1-quality', 'Veo 3.1 Quality', '8 с · 100 кредитов', 100],
    ['dola', 'seedance-2.0-fast', 'Seedance 2.0 Fast', '10 с · 2 балла', 2],
    ['dola', 'seedance-2.5', 'Seedance 2.5', '10 с · в 5 раз дороже', 10],
    ['dola', 'seedance-1.0', 'Seedance 1.0', '10 с · для простых видео', 1],
    ['arena', 'battle', 'Битва двух моделей', '2 видео · бесплатно', 0],
    ['vids', 'omni', 'Omni', '10 с · 720p · бесплатно', 0],
  ],
  image: [
    ['flow', 'nano-banana-2.1', 'Nano Banana 2.1', 'без кредитов', 0],
    ['flow', 'nano-banana-2', 'Nano Banana 2', 'без кредитов', 0],
    ['flow', 'nano-banana-2-lite', 'Nano Banana 2 Lite', 'без кредитов', 0],
    ['flow', 'nano-banana-pro', 'Nano Banana Pro', '8 кредитов', 8],
    ['dola', 'seedream-5-pro', 'Seedream 5.0', 'без кредитов · обычно 4 варианта', 0],
    ['dola', 'seedream-4.5', 'Seedream 4.5', 'без кредитов', 0],
    ['arena', 'battle', 'Битва двух моделей', '2 фото · бесплатно', 0],
  ],
};
// форматы — ровно те, что предлагают сами сайты (проверено 26.09.2026): видео во Flow — только 9:16 и 16:9 (у всех моделей),
// в Dola — 6 (все Seedance); фото во Flow — 5, в Dola — 6. Arena формат не выбирает — Freefield пишет его словами в промпт.
const SITE_AR = {
  video: {flow: ['9:16', '16:9'], dola: ['9:16', '3:4', '1:1', '4:3', '16:9', '21:9'], arena: ['9:16', '1:1', '16:9'], vids: ['9:16', '16:9']},
  image: {flow: ['9:16', '3:4', '1:1', '4:3', '16:9'], dola: ['9:16', '2:3', '3:4', '1:1', '4:3', '16:9'], arena: ['9:16', '3:4', '1:1', '4:3', '16:9']},
};
const AR_ORDER = ['9:16', '2:3', '3:4', '1:1', '4:3', '16:9', '21:9'];
const AR_NAME = {'9:16': 'вертикально', '2:3': 'вертикально 2:3', '3:4': 'портрет', '1:1': 'квадрат', '4:3': 'альбом', '16:9': 'горизонтально', '21:9': 'широкий кадр'};
// у сценария с выбранным сервисом — его форматы; у «авто» — всё, что есть во Flow или в Dola (план отправит туда, где формат есть)
