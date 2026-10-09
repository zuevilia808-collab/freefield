'use strict';
/* =============================== generation =============================== */
function composePrompt(text, styleId, kind = 'image') {
  const s = styleOf(styleId);
  const suffix = kind === 'video' ? s.suffix.replace(/film still,?\s*/, 'film look, ') : s.suffix;
  if (!suffix) return text;
  return isBlockPrompt(text) ? `${text}\nStyle: ${suffix}` : `${text}, ${suffix}`;   // в эталонном (блочном) промпте стиль — отдельной строкой
}
function modelFields(m) {
  return {model: m.id, api: m.api, modelTitle: m.title, tier: m.tier};
}
function newItem(fields) {
  const it = {id: uid(), status: 'queued', statusText: 'В очереди…', createdAt: Date.now(), ...fields};
  items.unshift(it);
  return it;
}
function setStatus(it, text, status) {
  it.statusText = text;
  if (status) it.status = status;
  const el = document.querySelector(`.card[data-id="${it.id}"] [data-status]`);
  if (el) el.textContent = text;
}
function finish(it, error) {
  if (error) { it.status = 'error'; it.statusText = 'Ошибка: ' + error.message; it.errorKind = error.kind || null; }
  else {
    it.status = 'done'; it.statusText = '';
    DB.put(it);
    if (it.tier === 'paid') wallet.add(it.cost || 0);
  }
  refreshCard(it);
  updateCounts();
}






function extLeft(m) {
  if (!m?.count) return null;
  const now = new Date(), same = t => { const d = new Date(t);
    return m.count.per === 'day' ? d.toDateString() === now.toDateString() : d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); };
  const used = items.filter(i => i.status === 'done' && i.importedAt && same(i.importedAt) &&
    (allModels().find(x => x.id === i.model) || {}).service === m.service).length;
  return Math.max(0, m.count.n - used);
}

function videoDims(blob) {
  return new Promise(res => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => res(v.videoWidth ? [v.videoWidth, v.videoHeight] : null);
    v.onerror = () => res(null);
    v.src = urlOf(blob);
  });
}

async function attachExternal(it, file, quiet = false) {   // quiet — несколько файлов сразу, общее сообщение даст вызывающий
  const want = it.type === 'video' ? 'video/' : 'image/';
  if (!file || !file.type.startsWith(want)) return toast(it.type === 'video' ? 'Нужен видеофайл (обычно .mp4)' : 'Нужна картинка (png, jpg, webp)', {type: 'err'});
  it.blob = file;
  it.status = 'done';
  it.importedAt = Date.now();
  const d = it.type === 'video' ? await videoDims(file) : await dims(file);
  if (d) [it.w, it.h] = d;
  DB.put(it);
  render();
  if (ser.jobs.some(serLive)) serTick();   // карточка серии — следующий шаг начнётся сам
  if (!quiet) toast(`${it.type === 'video' ? 'Видео' : 'Картинка'} из ${(allModels().find(x => x.id === it.model) || {}).site || 'Google'} добавлено в галерею 🎉`, {type: 'ok'});
}

// ---- открыть сайт сервиса в окне рядом с Freefield (на телефоне — вкладкой) ----
// ---- внутри APK (Capacitor) ----
const native = {
  on: () => !!window.Capacitor?.isNativePlatform?.(),
  plugin: name => window.Capacitor?.Plugins?.[name],
  // внешние сайты — во вкладке Chrome внутри приложения (вход общий с Chrome на телефоне)
  open(url) {
    const b = this.plugin('Browser');
    if (b) return b.open({url, toolbarColor: '#0a0a0c'}).catch(() => window.open(url, '_blank'));
    window.open(url, '_blank');
  },
  // сохранить файл в «Документы/Freefield» и предложить «Поделиться»
  async save(blob, name) {
    const fsys = this.plugin('Filesystem');
    if (!fsys) throw new Error('нет доступа к файлам');
    const data = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
    const out = await fsys.writeFile({path: 'Freefield/' + name, data, directory: 'DOCUMENTS', recursive: true});
    const share = this.plugin('Share');
    toast(`Сохранено: Документы/Freefield/${name}`, {type: 'ok', ms: 7000,
      ...(share ? {action: 'Поделиться', onAction: () => share.share({files: [out.uri]}).catch(() => {})} : {})});
  },
};

function openSide(url, name) {
  if (!url) return;
  if (native.on()) return native.open(url);
  if (isMobile()) { window.open(url, '_blank', 'noopener'); return; }
  const w = Math.round(screen.availWidth * 0.58), h = screen.availHeight;
  const left = (screen.availLeft || 0) + screen.availWidth - w, top = screen.availTop || 0;
  const win = window.open(url, 'ff-' + (name || 'site'), `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (win) { try { win.opener = null; } catch {} } else window.open(url, '_blank', 'noopener');
}

// ---- подключённые сервисы: «я вошёл на сайте» (сам вход хранит браузер, не Freefield) ----
const connected = ls.get('freefield.connected', {});
const isConnected = id => !!connected[id];
function markConnected(id, on = true) {
  if (!id) return;
  if (on) connected[id] = connected[id] || Date.now(); else delete connected[id];
  ls.set('freefield.connected', connected);
}
function usedToday(serviceId) {
  const today = new Date().toDateString();
  return items.filter(i => i.importedAt && new Date(i.importedAt).toDateString() === today &&
    (allModels().find(x => x.id === i.model) || {}).service === serviceId).length;
}

// ---- маленькое хранилище «ключ-значение» (для доступа к папке «Загрузки») ----
const KV = {
  db: null,
  async open() {
    if (!this.db) this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('freefield-kv', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async get(k) { const db = await this.open(); return new Promise(res => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); },
  async set(k, v) { const db = await this.open(); return new Promise(res => { const r = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); r.onsuccess = r.onerror = () => res(); }); },
};

// ---- автоимпорт: следим за папкой «Загрузки» и забираем скачанный результат в ждущую карточку ----
const autoImport = {
  supported: 'showDirectoryPicker' in window,
  dir: null, perm: 'none', seen: null, since: Date.now(), target: null,
  active() { return !!this.dir && this.perm === 'granted'; },
  async init() {
    if (!this.supported) return;
    try { this.dir = await KV.get('downloadsDir'); } catch {}
    if (this.dir) this.perm = await this.dir.queryPermission({mode: 'read'}).catch(() => 'prompt');
    setInterval(() => this.scan().catch(() => {}), 3000);
  },
  async connect() {
    try {
      this.dir = await window.showDirectoryPicker({id: 'freefield-downloads', startIn: 'downloads', mode: 'read'});
      await KV.set('downloadsDir', this.dir);
      this.perm = 'granted'; this.seen = null;
      await this.scan();
      toast(`Автоимпорт включён: слежу за папкой «${this.dir.name}»`, {type: 'ok'});
    } catch (e) { if (e.name !== 'AbortError') toast('Не удалось подключить папку: ' + e.message, {type: 'err'}); }
    render();
  },
  async allow() {
    if (!this.dir) return this.connect();
    this.perm = await this.dir.requestPermission({mode: 'read'}).catch(() => 'denied');
    if (this.perm === 'granted') { this.seen = null; await this.scan(); }
    render();
  },
  async scan() {
    if (!this.active()) return;
    const first = !this.seen;
    if (first) this.seen = new Set();
    else if (!items.some(i => i.status === 'external' && !i.statusText)) return;
    for await (const [name, h] of this.dir.entries()) {
      if (h.kind !== 'file' || this.seen.has(name) || /\.(crdownload|part|tmp|download)$/i.test(name)) continue;
      this.seen.add(name);
      if (first) continue;                       // всё, что уже лежало в папке, не трогаем
      const f = await h.getFile();
      if (f.lastModified < this.since - 10000) continue;
      const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : null;
      const it = kind && extTarget(kind);
      if (it) { await attachExternal(it, f); try { window.focus(); } catch {} }
    }
  },
};

function extTarget(kind) {
  const waiting = items.filter(i => i.status === 'external' && !i.statusText && i.type === kind);
  return waiting.find(i => i.id === autoImport.target) || waiting[0] || null;
}

function autoImportBarHTML() {
  if (!autoImport.supported) return '<div class="ext-auto off">Автоимпорт работает в Chrome и Edge на компьютере. Здесь — «Загрузить файл» или «Вставить».</div>';
  if (!autoImport.dir) return '<div class="ext-auto">📂 <span>Подключите папку «Загрузки» — скачанный результат сам появится в галерее</span><button data-act="auto-connect">Подключить</button></div>';
  if (autoImport.perm !== 'granted') return '<div class="ext-auto">📂 <span>Разрешите доступ к «Загрузкам» — браузер спрашивает после перезапуска</span><button data-act="auto-allow">Разрешить</button></div>';
  return `<div class="ext-auto on"><div class="spin"></div><span>Жду файл в папке «${esc(autoImport.dir.name)}» — просто скачайте результат на сайте</span></div>`;
}

// ---- «Мои сервисы»: центр для ежедневной работы с бесплатными кредитами ----
function renderHub() {
  const row = x => {
    const on = isConnected(x.id), used = usedToday(x.id);
    const fresh = on && x.period === 'day' && !used;
    return `<div class="hub-row ${on ? 'on' : ''}" data-svc="${x.id}">
      <span class="mc-ico" style="background:${x.color};color:#fff">${esc(x.ico)}</span>
      <div class="hub-main">
        <div class="hub-name"><b>${esc(x.name)}</b> <span class="hint">${PERIODS[x.period]}</span>${fresh ? ' <span class="hub-fresh">✨ кредиты ждут</span>' : ''}</div>
        <div class="svc-cr">💳 ${esc(x.credits)}${used ? ` · сегодня уже: <b>${used}</b>` : ''}</div>
        <div class="hub-acts">
          ${x.image ? `<button data-use="image">🖼 ${esc(x.image.models)}</button>` : ''}
          ${x.video ? `<button data-use="video">🎬 ${esc(x.video.models)}</button>` : ''}
          <button data-open>${on ? '↗ Открыть' : '🔑 Войти на сайте'}</button>
          <label class="toggle"><input type="checkbox" data-conn ${on ? 'checked' : ''}><span></span>вход выполнен</label>
        </div>
      </div>
    </div>`;
  };
  // Flow, Arena и Dola Freefield запускает сам в окне Chrome Freefield на компьютере — у них статус входа оттуда, а не ручной переключатель
  const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : `${Math.round(m / 60)} ч назад`; };
  const autoRow = x => {
    const lg = hubLink.ok && hubLink.info?.login?.[x.id];
    const st = !hubLink.ok ? 'Вход — в окне Chrome Freefield на компьютере'
      : !lg ? 'Вход ещё не проверялся — Freefield проверит при первой генерации'
      : lg.ok ? `🟢 Вход на компьютере выполнен · проверено ${ago(lg.at)}` : '🔴 Нужно войти заново — в окне Chrome Freefield на компьютере';
    const use = clUseText(x.id);
    return `<div class="hub-row on" data-svc="${x.id}">
      <span class="mc-ico" style="background:${x.color};color:#fff">${esc(x.ico)}</span>
      <div class="hub-main">
        <div class="hub-name"><b>${esc(x.name)}</b> <span class="hub-claude">⚡ сам</span></div>
        <div class="svc-cr">💳 ${esc(CLAUDE_SVC.find(c => c.id === x.id).what)}</div>
        <div class="hint">${st}</div>${use ? `<div class="hint">${use}</div>` : ''}
        <div class="hub-acts">
          <button data-hub-asset>🖼 Ассеты</button>
          <button data-hub-scn>🎬 Видео</button>
          <button data-hub-acc>👤 Сменить аккаунт</button>
          <button data-open>↗ Сайт</button>
        </div>
      </div>
    </div>`;
  };
  const cids = CLAUDE_SVC.map(c => c.id), other = SERVICES.filter(x => !cids.includes(x.id));
  const mine = other.filter(x => isConnected(x.id)), rest = other.filter(x => !isConnected(x.id));
  $('#hubBody').innerHTML =
    `<div class="hub-intro">Войдите в каждый сервис <b>один раз</b> — браузер запомнит вход, и дальше они будут открываться уже с вашим аккаунтом. Пароли Freefield не видит и не хранит. Отметьте «вход выполнен» — сервис появится в быстром переключателе на панели создания.</div>` +
    `<div class="svc-group">⚡ Freefield запускает сам — ${cids.length}</div>` + SERVICES.filter(x => cids.includes(x.id)).map(autoRow).join('') +
    (mine.length ? `<div class="svc-group">⭐ Мои сервисы — ${mine.length}</div>` + mine.map(row).join('') : '') +
    `<div class="svc-group">${mine.length ? 'Ещё сервисы' : 'Все сервисы'}</div>` + rest.map(row).join('');
}

// «Мои сервисы» → 🖼 / 🎬 у сайта: карточка в галерее — промпт из поля «Что на фото», «Открыть сайт», «📥 Загрузить файл»
function useService(id, kind) {
  if (!EXT_MODELS.some(x => x.service === id && x.kind === kind)) return;
  closeSheets();
  phoneCards([{prompt: $('#prompt').value.trim(), kind, service: id, aspect_ratio: kind === 'video' ? '9:16' : '1:1'}], {quiet: true});
  toast(`Карточка ${SERVICES.find(x => x.id === id)?.name || ''} — в галерее: скопируйте промпт, создайте на сайте и загрузите результат`, {type: 'ok', ms: 7000});
}


function pickFile(accept, multiple = false) {   // multiple — массив файлов
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = () => res(multiple ? [...i.files] : i.files[0] || null);
    i.oncancel = () => res(multiple ? [] : null);
    i.click();
  });
}


function nudge(msg) {
  toast(msg);
  if (isMobile()) setView('create');
  const box = $('.prompt-box');
  box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
  $('#prompt').focus();
  return false;
}
