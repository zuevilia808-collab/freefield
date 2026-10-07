// Мост к браузеру: отдельный Chrome для Freefield (папка .browser-profile), в котором пользователь сам входит в
// Google / Dola / Arena. Freefield подключается к нему по локальному порту отладки (только 127.0.0.1) и работает с
// сайтами как человек в видимом окне. Пароли не вводит, проверки «я не робот» не обходит.
//
// Профили: обычные профили Google Chrome внутри этого окна («Ваш Chrome», «alan», …) — у каждого свои аккаунты.
// Номер профиля Freefield: 1 = «Default», N = «Profile N−1». У каждого открытого профиля своё окно, и работают они
// одновременно: нужен профиль, окно которого закрыто, — Freefield открывает его окно рядом с остальными (leaseProfile),
// Chrome при этом не закрывается.
import {chromium} from 'playwright-core';
import {currentProfile, readState, writeState} from './state.js';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROFILE = process.env.FREEFIELD_BROWSER_PROFILE || path.join(HERE, '..', '.browser-profile');
const PORT = +process.env.FREEFIELD_BROWSER_PORT || 9333;
const CHROME = process.env.FREEFIELD_CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => fs.existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const profileDirOf = p => p > 1 ? `Profile ${p - 1}` : 'Default';
const localState = () => { try { return JSON.parse(fs.readFileSync(path.join(PROFILE, 'Local State'), 'utf8')); } catch { return {}; } };

let browser = null;
let activeDir = null;   // профиль Chrome, который сейчас открыт (если знаем)

async function cdpUp() {
  try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`, {signal: AbortSignal.timeout(1500)})).ok; } catch { return false; }
}

// Запуск Chrome с профилем dir. Если Chrome Freefield уже открыт, Chrome сам передаёт команду открытому окну —
// так открывается новое окно в другом профиле (urls — его вкладки).
function runChrome(dir, urls = []) {
  if (!CHROME) throw new Error('не найден Chrome или Edge — укажите путь в FREEFIELD_CHROME');
  fs.mkdirSync(PROFILE, {recursive: true});
  const args = [`--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${PROFILE}`, `--profile-directory=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,900',
    // окна профилей открыты рядом и перекрывают друг друга: Chrome не должен усыплять закрытые другими окна
    // (иначе Flow и Arena перестают рисовать страницу, и Freefield не находит кнопки)
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    ...urls];
  if (process.platform === 'win32') {
    // через «cmd start»: Chrome не становится дочерним процессом Freefield — перезапуск связи или Claude
    // (они закрывают процесс вместе с дочерними) больше не закрывает окно Chrome пользователя
    const q = s => `"${s}"`;
    spawn('cmd.exe', ['/d', '/s', '/c', `"start "" ${[CHROME, ...args].map(q).join(' ')}"`],
      {windowsVerbatimArguments: true, detached: true, stdio: 'ignore', windowsHide: true}).unref();
  } else spawn(CHROME, args, {detached: true, stdio: 'ignore'}).unref();
}
function launch(dir) {
  runChrome(dir);
  activeDir = dir;
  writeState({chromeProfile: dir});
}

// Новое окно Chrome Freefield в профиле dir с вкладками urls (Chrome уже открыт — окно добавится к нему)
export const openWindow = (dir, urls) => runChrome(dir, urls);
// Открыть Chrome Freefield (в профиле dir), если он закрыт — без подключения playwright
export async function startChrome(dir) {
  if (await cdpUp()) return;
  launch(dir);
  for (let i = 0; i < 40 && !(await cdpUp()); i++) await sleep(500);
  if (!(await cdpUp())) throw new Error('Chrome не запустился');
}

// «Сырой» протокол отладки всего Chrome: видит вкладки всех открытых профилей по отдельности
// (playwright складывает их в один общий контекст и профили не различает).
export async function rawCdp() {
  const {webSocketDebuggerUrl} = await (await fetch(`http://127.0.0.1:${PORT}/json/version`, {signal: AbortSignal.timeout(3000)})).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('нет связи с Chrome Freefield')); });
  let seq = 0;
  const wait = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (!m.id || !wait.has(m.id)) return;
    const [res, rej] = wait.get(m.id);
    wait.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  };
  const send = (method, params = {}, sessionId, ms = 30000) => new Promise((res, rej) => {
    const id = ++seq;
    wait.set(id, [res, rej]);
    ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    setTimeout(() => { if (wait.delete(id)) rej(new Error(`${method}: Chrome не ответил`)); }, ms);
  });
  // вкладки (без служебных страниц расширений и DevTools)
  const pages = async () => (await send('Target.getTargets')).targetInfos
    .filter(t => t.type === 'page' && !/^(devtools|chrome-extension):/.test(t.url));
  // выполнить JS во вкладке; userGesture — как нажатие человеком (сайт сможет открыть окно входа)
  const evalIn = async (targetId, expression) => {
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    try {
      const r = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, userGesture: true}, sessionId, 10000);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    } finally { send('Target.detachFromTarget', {sessionId}).catch(() => {}); }
  };
  const navigate = async (targetId, url) => {
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    try { await send('Page.navigate', {url}, sessionId); } finally { send('Target.detachFromTarget', {sessionId}).catch(() => {}); }
  };
  return {send, pages, evalIn, navigate, close: () => ws.close()};
}

// Закрыть Chrome Freefield целиком (через протокол отладки — работает и когда открыто несколько профилей)
async function closeChrome() {
  try {
    const {webSocketDebuggerUrl} = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    await new Promise(res => {
      const ws = new WebSocket(webSocketDebuggerUrl);
      ws.onopen = () => ws.send(JSON.stringify({id: 1, method: 'Browser.close'}));
      ws.onmessage = ws.onclose = ws.onerror = () => res();
      setTimeout(res, 3000);
    });
  } catch {}
  for (let i = 0; i < 40 && await cdpUp(); i++) await sleep(250);
  browser = null;
  activeDir = null;
}

// Запускает (или находит уже открытый) Chrome Freefield и подключается к нему. Если Chrome не запущен —
// открывает последний профиль, в котором работал Freefield. Открытых профилей может быть несколько (у каждого своё окно):
// playwright видит их вкладки вместе, поэтому вкладки своего профиля Freefield берёт через profilePages().
export async function ensureBrowser() {
  if (browser?.isConnected()) return browser;
  if (!(await cdpUp())) {
    launch(readState().chromeProfile || localState().profile?.last_used || 'Default');
    for (let i = 0; i < 40 && !(await cdpUp()); i++) await sleep(500);
    if (!(await cdpUp())) throw new Error('Chrome не запустился');
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  return browser;
}

export async function context() {
  const b = await ensureBrowser();
  return b.contexts()[0] || b.newContext();
}

// ---- окна профилей ----
// Окно профиля = его «контекст» в протоколе отладки Chrome (browserContextId); state.profileCtx: папка профиля → контекст.
export const blankUrl = url => /^(about:blank|chrome:\/\/(new-?tab|new-tab-page)|$)/.test(url);
// Окно, открытое не через Freefield (из меню Chrome): какой это профиль — по странице chrome://version («Путь к профилю»),
// открытой на секунду в пустой вкладке этого окна (потом вкладка возвращается). Вкладки с сайтами не трогаем.
const tried = new Set();
export async function identifyProfile(c, pages) {
  const t = pages.find(p => blankUrl(p.url));
  if (!t) return null;
  tried.add(t.browserContextId);
  const back = /^chrome:\/\/new/.test(t.url) ? t.url : 'chrome://newtab/';
  try {
    await c.navigate(t.targetId, 'chrome://version/');
    let p = '';
    for (let i = 0; i < 10 && !p; i++) {
      await sleep(300);
      p = await c.evalIn(t.targetId, `document.getElementById('profile_path')?.textContent || ''`).catch(() => '');
    }
    const dir = (p || '').trim().split(/[\\/]/).pop();
    return /^(Default|Profile \d+)$/.test(dir) ? dir : null;
  } finally { await c.navigate(t.targetId, back).catch(() => {}); }
}
const remember = (dir, ctx) => { writeState({profileCtx: {...readState().profileCtx, [dir]: ctx}}); ctxCache[dir] = {id: ctx, at: Date.now()}; };
// Все окна профилей сейчас: {map: папка → контекст (только открытые), count, unknown}. Неузнанные окна пробуем узнать.
export async function openProfilesNow() {
  const c = await rawCdp();
  try {
    const pages = await c.pages();
    const ctxs = new Set(pages.map(t => t.browserContextId));
    const map = Object.fromEntries(Object.entries(readState().profileCtx || {}).filter(([, ctx]) => ctxs.has(ctx)));
    const known = new Set(Object.values(map));
    // один профиль открыт и Freefield сам запустил Chrome в нём — это он
    if (ctxs.size === 1 && !known.size && activeDir) { const [ctx] = ctxs; map[activeDir] = ctx; remember(activeDir, ctx); known.add(ctx); }
    for (const ctx of ctxs) {
      if (known.has(ctx) || tried.has(ctx)) continue;
      const dir = await identifyProfile(c, pages.filter(t => t.browserContextId === ctx)).catch(() => null);
      if (dir) { map[dir] = ctx; remember(dir, ctx); known.add(ctx); }
    }
    return {map, count: ctxs.size, unknown: [...ctxs].filter(x => !known.has(x)).length};
  } finally { c.close(); }
}
// Контекст окна профиля dir (null — окно не открыто); запоминаем на несколько секунд
const ctxCache = {};
async function profileCtx(dir) {
  const hit = ctxCache[dir];
  if (hit && Date.now() - hit.at < 5000) return hit.id;
  const id = (await openProfilesNow()).map[dir] || null;
  ctxCache[dir] = {id, at: Date.now()};
  return id;
}
// Окно профиля dir не открыто — открываем его рядом с остальными (Chrome закрыт — запускаем в этом профиле)
async function ensureProfileWindow(dir) {
  if (!(await cdpUp())) {
    launch(dir);
    for (let i = 0; i < 40 && !(await cdpUp()); i++) await sleep(500);
    if (!(await cdpUp())) throw new Error('Chrome не запустился');
    await sleep(1000);
  }
  delete ctxCache[dir];
  if (await profileCtx(dir)) return;
  const c = await rawCdp();
  try {
    const before = new Set((await c.pages()).map(t => t.targetId));
    openWindow(dir, ['about:blank']);
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const fresh = (await c.pages()).filter(t => !before.has(t.targetId));
      if (fresh.length) { remember(dir, fresh[0].browserContextId); return; }
    }
    throw new Error('окно профиля Chrome не открылось');
  } finally { c.close(); }
}

// Вкладки профиля p (playwright складывает вкладки всех профилей вместе — различаем по контексту вкладки)
const pageCtxOf = new WeakMap();
async function pageCtx(page) {
  if (pageCtxOf.has(page)) return pageCtxOf.get(page);
  try {
    const s = await page.context().newCDPSession(page);
    const {targetInfo} = await s.send('Target.getTargetInfo');
    await s.detach().catch(() => {});
    pageCtxOf.set(page, targetInfo.browserContextId);
    return targetInfo.browserContextId;
  } catch { return null; }
}
export async function profilePages(p = currentProfile()) {
  const ctx = await context();
  const id = await profileCtx(profileDirOf(p));
  if (!id) throw new Error('окно этого профиля Chrome не открыто');
  const out = [];
  for (const x of ctx.pages()) if (!x.isClosed() && await pageCtx(x) === id) out.push(x);
  return out;
}
// Новая вкладка в окне профиля p: открывает её сама страница этого профиля (window.open «как нажатие человеком»),
// поэтому вкладка появляется в том же окне; вкладок нет — Chrome открывает окно профиля.
export async function newProfilePage(p = currentProfile()) {
  const ctx = await context();
  const dir = profileDirOf(p);
  const id = await profileCtx(dir);
  const anchor = id ? (await profilePages(p)).find(x => /^https?:/.test(x.url())) : null;
  const got = new Promise(res => {
    const on = async pg => { if (await pageCtx(pg) === id || !id) { ctx.off('page', on); clearTimeout(t); res(pg); } };
    const t = setTimeout(() => { ctx.off('page', on); res(null); }, 15000);
    ctx.on('page', on);
  });
  if (anchor) {
    const s = await ctx.newCDPSession(anchor);
    await s.send('Runtime.evaluate', {expression: `void window.open('about:blank', '_blank')`, userGesture: true}).catch(() => {});
    await s.detach().catch(() => {});
  } else openWindow(dir, ['about:blank']);
  const pg = await got;
  if (!pg) throw new Error('новая вкладка в окне профиля не открылась');
  return pg;
}

// Работа в профиле p: его окно открыто (если нет — Freefield открывает его рядом с остальными). Профили работают
// одновременно; счётчик — чтобы не закрыть окно профиля, пока в нём идут генерации.
const users = {}, opening = {};
export async function leaseProfile(p = currentProfile()) {
  const dir = profileDirOf(p);
  await (opening[dir] ||= ensureProfileWindow(dir).finally(() => { delete opening[dir]; }));
  users[dir] = (users[dir] || 0) + 1;
  let done = false;
  return () => { if (done) return; done = true; users[dir]--; };
}
const busy = dir => dir ? users[dir] > 0 || !!opening[dir] : Object.values(users).some(n => n > 0) || Object.keys(opening).length > 0;

// Открыт ли сейчас Chrome Freefield
export const chromeOpen = cdpUp;
// Кнопка «Закрыть этот профиль»: закрыть окно этого профиля (последний открытый профиль — весь Chrome Freefield)
export async function closeProfile(dir) {
  if (!(await cdpUp())) return 'Chrome Freefield уже закрыт';
  if (busy(dir)) throw new Error('В этом профиле сейчас идут генерации — закройте его, когда они закончатся');
  const {map, count} = await openProfilesNow();
  const ctx = map[dir];
  if (!ctx) return 'Окно этого профиля сейчас не открыто';
  delete ctxCache[dir];
  if (count <= 1) { await closeChrome(); return 'Профиль закрыт — окно Chrome Freefield закрыто'; }
  const c = await rawCdp();
  try {
    for (const t of (await c.pages()).filter(t => t.browserContextId === ctx)) await c.send('Target.closeTarget', {targetId: t.targetId}).catch(() => {});
  } finally { c.close(); }
  return 'Окно профиля закрыто';
}
// Кнопка «Закрыть все профили»: закрыть все окна Chrome Freefield (когда не идут генерации)
export async function closeAllProfiles() {
  if (!(await cdpUp())) return 'Chrome Freefield уже закрыт';
  if (busy()) throw new Error('Сейчас идут генерации — закройте профили, когда они закончатся');
  await closeChrome();
  for (const k of Object.keys(ctxCache)) delete ctxCache[k];
  return 'Все профили закрыты — окна Chrome Freefield закрыты';
}

// Профили Chrome в окне Freefield (из «Local State»): [{id, dir, name}]
export function chromeProfiles() {
  const cache = localState().profile?.info_cache || {};
  const list = Object.keys(cache).map(dir => ({dir, name: cache[dir].name || dir, id: dir === 'Default' ? 1 : (+(dir.match(/^Profile (\d+)$/)?.[1]) + 1) || 0}))
    .filter(x => x.id > 0).sort((a, b) => a.id - b.id);
  return list.length ? list : [{id: 1, dir: 'Default', name: 'Default'}];
}

// Находит открытую вкладку по адресу или открывает новую.
export async function pageFor(url, match = url) {
  const ctx = await context();
  let page = ctx.pages().find(p => p.url().includes(match));
  if (!page) {
    page = ctx.pages().find(p => p.url() === 'about:blank') || await ctx.newPage();
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
  }
  await page.bringToFront().catch(() => {});
  return page;
}

// Признаки проверки «я не робот» / входа — здесь Freefield останавливается и зовёт человека.
export async function humanCheck(page) {
  const url = page.url();
  if (/accounts\.google\.com|\/login|\/signin/i.test(url)) return 'login';
  // сайты Google держат на странице невидимый reCAPTCHA — считаем только видимое окно проверки
  const captcha = await page.evaluate(() => [...document.querySelectorAll('iframe')].some(f => {
    if (!/recaptcha|hcaptcha|turnstile|challenge/i.test((f.src || '') + ' ' + (f.title || ''))) return false;
    const st = getComputedStyle(f), r = f.getBoundingClientRect();
    return st.visibility !== 'hidden' && st.display !== 'none' && f.offsetParent !== null && r.width >= 200 && r.height >= 60;
  })).catch(() => false);
  return captcha ? 'captcha' : null;
}

// Перехват скачивания, которое запускает сам сайт (кнопка «Скачать», меню Flow «2K»): файл ложится в папку dir, а не в
// «Загрузки» пользователя, и Chrome не спрашивает, куда сохранить. Два способа сразу:
//  • в странице: ссылка-«скачать» (blob:, data: или с атрибутом download) перехватывается до того, как Chrome начнёт
//    скачивание, — так скачивают Flow и большинство сайтов; файл берём из самой страницы (даже если сайт сразу «отозвал» blob);
//  • через протокол отладки: обычное скачивание по адресу ложится в dir (для контекста вкладки, иначе — для окна по умолчанию).
// Перехват включён только на время ожидания. start() → {started(), wait(ms) → {path, name, url}, stop()}.
const DL_HOOK = () => {
  window.__ffDlOn = true;
  window.__ffDl = null;
  if (window.__ffDlHook) return;
  window.__ffDlHook = true;
  window.__ffBlobs = new Map();
  const create = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const u = create.call(this, obj);
    try { if (window.__ffDlOn && obj instanceof Blob) { window.__ffBlobs.set(u, obj); if (window.__ffBlobs.size > 20) window.__ffBlobs.delete(window.__ffBlobs.keys().next().value); } } catch {}
    return u;
  };
  const take = a => {
    const href = a.href || '';
    if (!window.__ffDlOn || !(a.hasAttribute('download') || /^(blob|data):/.test(href))) return false;
    window.__ffDl = {href, name: a.getAttribute('download') || ''};
    return true;
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (take(this)) return; return click.apply(this, arguments); };
  document.addEventListener('click', e => { const a = e.target?.closest?.('a'); if (a && take(a)) e.preventDefault(); }, true);
};
export async function downloadCapture(page, dir) {
  fs.mkdirSync(dir, {recursive: true});
  await page.evaluate(DL_HOOK).catch(() => {});
  // протокол отладки: скачивание по адресу — в dir
  let cdp = null, set = null;
  const begun = new Map();
  let done = null, failed = null;
  try {
    const b = await ensureBrowser();
    cdp = await b.newBrowserCDPSession();
    let ctxId;
    try {
      const s = await page.context().newCDPSession(page);
      ctxId = (await s.send('Target.getTargetInfo')).targetInfo.browserContextId;
      await s.detach().catch(() => {});
    } catch {}
    cdp.on('Browser.downloadWillBegin', e => begun.set(e.guid, e));
    cdp.on('Browser.downloadProgress', e => {
      if (!begun.has(e.guid)) return;
      if (e.state === 'completed' && !done) { const w = begun.get(e.guid); done = {path: path.join(dir, e.guid), name: w.suggestedFilename || '', url: w.url || ''}; }
      if (e.state === 'canceled') failed = new Error('скачивание отменено');
    });
    const tryCtx = async id => { await cdp.send('Browser.setDownloadBehavior', {behavior: 'allowAndName', downloadPath: dir, eventsEnabled: true, ...(id ? {browserContextId: id} : {})}); return id; };
    // контекст профиля Chrome не всегда принимается («Failed to find browser context») — тогда окно по умолчанию
    const used = await tryCtx(ctxId).catch(() => tryCtx(undefined)).catch(() => null);
    if (used !== null) set = behavior => cdp.send('Browser.setDownloadBehavior', {behavior, eventsEnabled: false, ...(used ? {browserContextId: used} : {})});
  } catch {}
  // из страницы: перехваченная ссылка → файл
  const fromPage = async () => {
    const d = await page.evaluate(async () => {
      const d = window.__ffDl;
      if (!d) return null;
      window.__ffDl = null;
      let blob = window.__ffBlobs?.get(d.href);
      if (!blob && /^(blob|data):/.test(d.href)) blob = await (await fetch(d.href)).blob();
      if (!blob) return {href: d.href, name: d.name};
      const b64 = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = () => no(fr.error); fr.readAsDataURL(blob); });
      return {b64, type: blob.type, name: d.name};
    }).catch(() => null);
    if (!d) return null;
    let buf = d.b64 ? Buffer.from(d.b64, 'base64') : null;
    if (!buf) { const r = await page.request.get(d.href, {timeout: 180000}); if (!r.ok()) throw new Error(`сайт не отдал файл (HTTP ${r.status()})`); buf = await r.body(); }
    const name = d.name || decodeURIComponent((d.href || '').split('?')[0].split('/').pop() || '') || 'download';
    const file = path.join(dir, 'page-' + Date.now() + '-' + name.replace(/[^\w.\-]+/g, '_').slice(-80));
    fs.writeFileSync(file, buf);
    return {path: file, name, url: d.href && !/^(blob|data):/.test(d.href) ? d.href : ''};
  };
  let stopped = false;
  return {
    started: () => begun.size > 0 || !!done,
    async wait(ms) {
      const t0 = Date.now();
      for (;;) {
        if (done) return done;
        const p = await fromPage();
        if (p) return (done = p);
        if (failed) throw failed;
        if (Date.now() - t0 >= ms) return null;
        await sleep(Math.min(700, Math.max(50, ms - (Date.now() - t0))));
      }
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await page.evaluate(() => { window.__ffDlOn = false; window.__ffBlobs?.clear(); }).catch(() => {});
      if (set) await set('default').catch(() => {});
      await cdp?.detach().catch(() => {});
    },
  };
}

export async function screenshot(page, file) {
  await page.screenshot({path: file});
  return file;
}
