// Генерация через сайты Google Flow, Dola и Arena в браузере Freefield (профиль, где пользователь сам вошёл в аккаунт).
// Работает как человек в видимом окне: промпты отправляет по одному, а результатов ждёт сразу нескольких.
// Если сайт просит войти, пройти проверку «я не робот» или жалуется на подозрительную активность —
// останавливается и сообщает пользователю, ничего не обходит.
import {context, humanCheck, leaseProfile, profilePages, newProfilePage, downloadCapture} from './bridge.js';
import {imageSize} from './media.js';
// данные аккаунтов — у каждого профиля Chrome свои (state.js: withProfile)
import {HERE, readAcct as readState, writeAcct as writeState, currentProfile} from './state.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class PortalError extends Error { constructor(msg, kind = 'other') { super(msg); this.kind = kind; } }

// ---- очереди ----
// Отправка промпта (клики и ввод текста) — по одной за раз: окно у всех сайтов общее, а между процессами Freefield
// сайт делят через файл-замок. Ждать же можно сразу нескольких генераций: во Flow — несколько плиток в одном проекте,
// в Dola и Arena — каждая генерация в своей вкладке. PARALLEL — сколько генераций одного сайта идут одновременно.
export const PARALLEL = {flow: 4, dola: 2, arena: 2, vids: 1};   // Vids: панель ИИ-видео делает одно видео за раз
// очереди — у каждого профиля Chrome свои (разные окна и аккаунты работают параллельно)
const slots = {};
function siteSlot(site, fn) {
  const s = slots[`${site}@${currentProfile()}`] ||= {n: 0, q: []};
  // генерация держит свой профиль Chrome: пока она идёт, Chrome не переключится на другой профиль
  const go = () => { s.n++; return leaseProfile().then(release => Promise.resolve().then(fn).finally(release)).finally(() => { s.n--; s.q.shift()?.(); }); };
  return s.n < PARALLEL[site] ? go() : new Promise(r => s.q.push(r)).then(go);
}
const siteChains = {};
export function siteRun(site, fn) {
  const key = `${site}@${currentProfile()}`;
  const run = (siteChains[key] || Promise.resolve()).then(() => leaseProfile()).then(release => withFileLock(site, fn).finally(release));
  siteChains[key] = run.catch(() => {});
  return run;
}
let uiChain = Promise.resolve();
export function ui(fn) {
  const run = uiChain.then(fn);
  uiChain = run.catch(() => {});
  return run;
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function withFileLock(site, fn) {
  const file = path.join(HERE, `.lock-${site}${currentProfile() > 1 ? '-' + currentProfile() : ''}`);
  for (const t0 = Date.now(); ;) {
    try { fs.writeFileSync(file, JSON.stringify({pid: process.pid, at: Date.now()}), {flag: 'wx'}); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let lock = {};
      try { lock = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      if (!alive(lock.pid) || Date.now() - (lock.at || 0) > 20 * 60e3) { fs.rmSync(file, {force: true}); continue; }
      if (Date.now() - t0 > 20 * 60e3) throw new PortalError(`${SITES[site].name} занят другой генерацией Freefield`, 'busy');
      await sleep(2000);
    }
  }
  try { return await fn(); } finally { fs.rmSync(file, {force: true}); }
}

// ---- учёт: что сделано сегодня на каждом сайте (сайты считают кредиты по-своему — ведём свой счётчик) ----
const today = () => new Date().toLocaleDateString('sv');
export function usageToday() {
  const u = readState().usage;
  return u?.date === today() ? {vids: {}, ...u} : {date: today(), flow: {}, dola: {}, arena: {}, vids: {}};
}
function track(site, add) {
  const u = usageToday();
  const cur = u[site] ||= {};
  for (const [k, v] of Object.entries(add)) cur[k] = (cur[k] || 0) + v;
  writeState({usage: u});
}
const num = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
// Короткий отчёт для Claude и приложения
export function usageReport() {
  const u = usageToday(), c = readState();
  const flow = [u.flow.videos && num(u.flow.videos, 'видео', 'видео', 'видео'), u.flow.images && num(u.flow.images, 'картинка', 'картинки', 'картинок')].filter(Boolean);
  const dolaLeft = c.dolaCredits?.date === today() ? c.dolaCredits.left : null;
  return {
    flow: `осталось ${flowLeft()} из ${FLOW_DAILY} кредитов${c.flowCredits?.date === today() ? '' : ' (ещё не проверено сегодня)'}` + (flow.length ? ` · сегодня через Freefield: ${flow.join(', ')}` : ''),
    dola: (dolaLeft != null ? `осталось ${dolaLeft} кредитов · ` : '') +
      (u.dola.requests ? `сегодня через Freefield: ${num(u.dola.requests, 'запрос', 'запроса', 'запросов')} → ${num(u.dola.images || 0, 'картинка', 'картинки', 'картинок')}` : 'сегодня через Freefield ещё ничего'),
    vids: u.vids?.videos ? `сегодня через Freefield: ${num(u.vids.videos, 'видео', 'видео', 'видео')}` : 'сегодня через Freefield ещё ничего',
    arena: u.arena.requests ? `сегодня через Freefield: ${num(u.arena.requests, 'запрос', 'запроса', 'запросов')} → ${[u.arena.videos && num(u.arena.videos, 'видео', 'видео', 'видео'), u.arena.images && num(u.arena.images, 'картинка', 'картинки', 'картинок')].filter(Boolean).join(', ') || 'пока ничего'}` : 'сегодня через Freefield ещё ничего',
    raw: u,
  };
}

export const SITES = {
  flow: {name: 'Google Flow', home: 'https://flow.google.com/', match: 'flow.google.com'},
  dola: {name: 'Dola', home: 'https://www.dola.com/chat/', match: 'dola.com'},
  arena: {name: 'Arena', home: 'https://arena.ai/video', match: 'arena.ai'},
  vids: {name: 'Google Vids', home: 'https://docs.google.com/videos/?authuser=0', match: 'docs.google.com/videos'},
};

// По одной вкладке на сервис: Freefield работает с ней, а лишние вкладки того же сайта закрывает.
// Вкладки — только своего профиля Chrome (у каждого открытого профиля своё окно).
async function sitePage(site, front = true) {
  const cfg = SITES[site];
  const pages = await profilePages();
  const tabs = pages.filter(p => p.url().includes(cfg.match) && !p.url().includes('accounts.google'));
  let page = tabs[0];
  if (site === 'vids') {
    // в Vids у пользователя могут быть открыты свои ролики (а невставленные ИИ-клипы пропадают при закрытии вкладки) —
    // их не трогаем: берём вкладку ролика Freefield или главной Vids, иначе открываем свою
    const file = readState().vidsFile;
    page = tabs.find(p => file && p.url().startsWith(file));
    for (const p of tabs) if (!page && VIDS_FILE.test(p.url()) && /^Freefield/.test(await p.title().catch(() => ''))) page = p;
    page ||= tabs.find(p => !VIDS_FILE.test(p.url()));
  } else for (const extra of tabs.slice(1)) await extra.close().catch(() => {});
  if (!page) {
    page = (site !== 'vids' && pages.find(p => p.url().includes(cfg.match))) || pages.find(p => /^(about:blank|chrome:\/\/new-?tab)/.test(p.url())) || await newTab();
    if (!page.url().includes(cfg.match)) await page.goto(cfg.home, {waitUntil: 'domcontentloaded', timeout: 60000});
  }
  if (front) {
    await page.bringToFront().catch(() => {});
    await sleep(1200);   // дать странице «проснуться» после переключения вкладки
    await wakeWindow(page);
  }
  return page;
}
// Окно профиля свёрнуто — страница «спит» (Flow и Arena тогда не рисуют кнопки): разворачиваем окно.
// Окна, закрытые другими окнами, Chrome Freefield не усыпляет (флаги запуска в bridge.js).
async function wakeWindow(page) {
  if (await page.evaluate(() => document.visibilityState).catch(() => 'visible') === 'visible') return;
  const s = await page.context().newCDPSession(page).catch(() => null);
  if (!s) return;
  try {
    const {windowId} = await s.send('Browser.getWindowForTarget');
    const {bounds} = await s.send('Browser.getWindowBounds', {windowId});
    // окно закрыто другими окнами (Chrome, запущенный без флагов из bridge.js, его усыпляет) — свернуть и развернуть:
    // развёрнутое окно Windows показывает поверх остальных
    if (bounds.windowState !== 'minimized') { await s.send('Browser.setWindowBounds', {windowId, bounds: {windowState: 'minimized'}}); await sleep(300); }
    await s.send('Browser.setWindowBounds', {windowId, bounds: {windowState: bounds.windowState === 'maximized' ? 'maximized' : 'normal'}});
    await page.bringToFront().catch(() => {});
    await sleep(800);
  } catch {} finally { await s.detach().catch(() => {}); }
}

// Все сервисы профиля — вкладками в ОДНОМ окне Chrome (просьба пользователя): новую вкладку открывает страница этого
// же окна (bridge.newProfilePage).
const isSiteTab = p => Object.values(SITES).some(s => p.url().includes(s.match)) && !/accounts\.google\./.test(p.url());
const newTab = () => newProfilePage();
// Вкладки сервисов, которые оказались в других окнах, переезжают в окно, где их больше (открываются там заново).
// Вызывать, когда генерации не идут.
export async function oneWindow() {
  const ctx = await context();
  const tabs = (await profilePages()).filter(isSiteTab);
  if (tabs.length < 2) return 0;
  const win = async p => { const s = await ctx.newCDPSession(p); try { return (await s.send('Browser.getWindowForTarget')).windowId; } catch { return null; } finally { await s.detach().catch(() => {}); } };
  const ids = [];
  for (const p of tabs) ids.push(await win(p));
  const count = ids.reduce((m, id) => m.set(id, (m.get(id) || 0) + 1), new Map());
  const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  let moved = 0;
  for (const [i, p] of tabs.entries()) {
    if (ids[i] === main || ids[i] == null) continue;
    const url = p.url();
    await tabs[ids.indexOf(main)].bringToFront().catch(() => {});
    const np = await newTab();
    await np.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000}).catch(() => {});
    await p.close().catch(() => {});
    moved++;
  }
  return moved;
}

// Dola и Arena: каждая генерация — в своём чате той же вкладки. Отправили промпт — запомнили адрес чата; дальше
// Freefield по очереди заходит в свои чаты и проверяет, готово ли (сайт генерирует и когда чат не открыт).
function inChat(site, url, fn) {
  return siteRun(site, async () => {
    const page = await sitePage(site, false);
    if (page.url().split('#')[0] !== url) {
      await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000});
      await sleep(3000);
    }
    return fn(page);
  });
}
// после отправки сайт переходит на адрес нового чата (Dola: /chat/<номер>, Arena: /c/<id>)
async function chatUrlAfterSend(page, re) {
  await page.waitForURL(re, {timeout: 30000}).catch(() => {});
  if (!re.test(page.url())) throw new PortalError('сайт не принял промпт — чат не создался. Посмотрите в окно Chrome Freefield.', 'busy');
  const url = page.url().split('#')[0], id = chatId(url);
  if (id) markOurs(id.site, [id.id]);   // этот чат создал Freefield — синхронизация заберёт из него результат
  return url;
}
const chatId = url => { const m = url.match(/dola\.com\/chat\/(\d+)|arena\.ai\/c\/([\w-]+)/); return m ? {site: m[1] ? 'dola' : 'arena', id: m[1] || m[2]} : null; };

// Что сделал сам Freefield (чаты Dola и Arena, плитки Flow). Синхронизация с сайтами забирает только это:
// пользователь попросил класть в галерею только сделанное через Freefield, а не всё подряд с сайтов.
export const oursSet = site => new Set(readState().ours?.[site] || []);
function markOurs(site, ids) {
  const st = readState(), cur = new Set(st.ours?.[site] || []);
  ids.forEach(i => i && cur.add(i));
  writeState({ours: {...st.ours, [site]: [...cur].slice(-3000)}});
}

// Окно про куки — принимаем (просьба пользователя): Arena — «Accept Cookies», Dola — «Принять все»
async function acceptCookies(page) {
  const b = page.getByRole('button', {name: /^(Accept Cookies|Accept all( cookies)?|Принять все( файлы cookie)?)$/i}).first();
  if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await sleep(700); }
}

const hideGoogleCookieBar = page => page.evaluate(() => {
  for (const el of document.querySelectorAll('.glue-cookie-notification-bar, [id^="glue-cookie-notification-bar"]')) el.style.setProperty('display', 'none', 'important');
}).catch(() => {});
async function assertReady(page, site) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(800);
  if (site === 'arena' || site === 'dola') await acceptCookies(page);
  // Google (Flow, Vids): полоска «…использует файлы cookie от Google» перекрывает кнопки внизу («Добавить ингредиенты»)
  // и срывала задания. Ничего не принимаем — только прячем полоску на этой странице
  if (site === 'flow' || site === 'vids') await hideGoogleCookieBar(page);
  const url = page.url();
  const h = await humanCheck(page);
  const visible = loc => loc.first().isVisible().catch(() => false);
  const loggedOut = h === 'login' ||
    (site === 'flow' && /flow\.google\.com\/(about|$)/.test(url) && !(await visible(page.getByText(/Новый проект|New project/i)))) ||
    (site === 'arena' && await visible(page.getByRole('button', {name: /^(Log ?in|Sign ?in|Sign up|Войти)$/i}))) ||
    (site === 'vids' && /accounts\.google\.|ServiceLogin/.test(url)) ||
    // Dola без входа показывает окно «Войдите, чтобы разблокировать больше функций» и кнопку «Войти» вверху
    (site === 'dola' && (await visible(page.getByText(/Войдите, чтобы разблокировать|Log in to unlock/i)) ||
      await visible(page.getByRole('button', {name: /^(Войти|Log ?in|Sign ?in)$/i}))));
  // последний известный статус входа — его показывает приложение (раздел «Мои сервисы»)
  const login = readState().login || {};
  if (login[site]?.ok !== !loggedOut || Date.now() - (login[site]?.at || 0) > 5 * 60e3) writeState({login: {...login, [site]: {ok: !loggedOut, at: Date.now()}}});
  if (loggedOut) throw new PortalError(`Нужно войти в ${SITES[site].name}: окно Chrome Freefield открыто — войдите в аккаунт и повторите.`, 'login');
  if (h === 'captcha') throw new PortalError(`${SITES[site].name} просит пройти проверку «я не робот» — пройдите её в окне Chrome Freefield и повторите.`, 'captcha');
}

async function captchaCheck(page, site) {
  if ((await humanCheck(page)) === 'captcha')
    throw new PortalError(`${SITES[site].name} просит пройти проверку «я не робот» — пройдите её в окне Chrome Freefield и повторите.`, 'captcha');
}

// Скачивает файл по ссылке со страницы (с куками вошедшего пользователя)
// Сбой сети бывает разовым — пробуем дважды и разными способами; в ошибке — что ответил сервер.
async function download(page, src) {
  const errs = [], mimeOf = h => (h || '').split(';')[0];
  const origin = (() => { try { return new URL(page.url()).origin; } catch { return ''; } })();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(3000);
    try {
      const r = await page.request.get(src, {timeout: 120000});
      if (r.ok()) return {buf: await r.body(), mime: mimeOf(r.headers()['content-type'])};
      errs.push('HTTP ' + r.status());
    } catch (e) { errs.push(e.message.split('\n')[0]); }
    // некоторые адреса (Flow: …/asb/…) отдают файл только так, как его просит сам плеер страницы
    try {
      const r = await page.request.get(src, {timeout: 120000, headers: {Referer: origin + '/', 'Sec-Fetch-Dest': 'video', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Site': 'same-origin', Range: 'bytes=0-'}});
      const total = +(r.headers()['content-range'] || '').split('/')[1] || 0;
      const buf = r.ok() ? await r.body() : null;
      if (buf && (!total || buf.length >= total)) return {buf, mime: mimeOf(r.headers()['content-type'])};
    } catch {}
    // напрямую (картинки Dola и Arena лежат по открытым подписанным ссылкам)
    if (/^https:/.test(src)) try {
      const r = await fetch(src, {headers: {Referer: origin + '/'}, signal: AbortSignal.timeout(120000)});
      if (r.ok) return {buf: Buffer.from(await r.arrayBuffer()), mime: mimeOf(r.headers.get('content-type'))};
      errs.push('HTTP ' + r.status);
    } catch (e) { errs.push(e.message); }
  }
  try {
    const d = await page.evaluate(async s => {
      const r = await fetch(s);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const b = await r.blob();
      return {type: b.type, b64: await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = () => rej(fr.error); fr.readAsDataURL(b); })};
    }, src);
    return {buf: Buffer.from(d.b64, 'base64'), mime: d.type};
  } catch (e) { errs.push(e.message.replace(/^page\.evaluate: /, '')); }
  throw new PortalError(`не удалось скачать файл (${[...new Set(errs)].join('; ').slice(0, 200)})`, 'busy');
}
// Скачать несколько файлов: неудачный пропускаем, остальные сохраняем (все не скачались — ошибка)
// (list — [{src, w, h}] или адреса; extra(m, i) — что добавить к результату, например подпись модели)
async function downloadAll(page, list, onStatus, extra = () => ({})) {
  const out = [];
  let last = null;
  for (const [i, x] of list.entries()) {
    const m = typeof x === 'string' ? {src: x} : x;
    onStatus?.(`скачиваю ${i + 1} из ${list.length}`);
    try { out.push({...(await download(page, m.src)), ...(m.w ? {width: m.w, height: m.h} : {}), ...extra(m, i)}); } catch (e) { last = e; }
  }
  if (!out.length && last) throw last;
  return out;
}

// Проверка входа во все сайты (для инструмента portal_status)
export async function status(open = false) {
  const release = await leaseProfile();   // проверяем в своём профиле Chrome
  try { return await statusIn(open); } finally { release(); }
}
// «Проверить баланс» → Google Flow: остаток кредитов прямо с сайта (панель аккаунта) в текущем профиле Chrome.
// Возвращает число кредитов или null (панель не открылась); не вошли — ошибка из assertReady
export async function flowCheck() {
  const release = await leaseProfile();
  try {
    return await ui(async () => { const page = await sitePage('flow'); await assertReady(page, 'flow'); return flowReadCredits(page); });
  } finally { release(); }
}
async function statusIn(open) {
  const out = {};
  for (const site of Object.keys(SITES)) {
    try {
      const has = (await profilePages()).some(p => p.url().includes(SITES[site].match));
      if (!has && !open) { out[site] = 'вкладка не открыта (откроется при первой генерации)'; continue; }
      const left = await ui(async () => {
        const page = await sitePage(site);
        await assertReady(page, site);
        return site === 'flow' ? flowReadCredits(page).catch(() => null) : null;
      });
      out[site] = 'вход выполнен' + (left != null ? ` · осталось ${left} из ${FLOW_DAILY} кредитов на сегодня` : '');
    } catch (e) { out[site] = e.message; }
  }
  return out;
}

// ============================== Google Flow ==============================
export const FLOW_IMAGE_MODELS = {
  'nano-banana-2-lite': {label: 'Nano Banana 2 Lite', re: /Nano Banana 2 Lite/, credits: 0},   // по счётчику Flow — бесплатно
  'nano-banana-2': {label: 'Nano Banana 2', re: /Nano Banana 2(?![.\d]| Lite)/, credits: 0},     // тоже бесплатно
  // новая версия (появилась во Flow в октябре 2026). Нет в меню аккаунта или Flow просит за неё кредиты без
  // разрешения — генерация идёт на Nano Banana 2, и в результате это видно (поле model)
  'nano-banana-2.1': {label: 'Nano Banana 2.1', re: /Nano Banana 2\.1(?! Lite)/, credits: 0, fallback: 'nano-banana-2'},
  'nano-banana-pro': {label: 'Nano Banana Pro', re: /Nano Banana Pro/, credits: 8},
};
export const FLOW_VIDEO_MODELS = {
  'veo-3.1-lite': {label: 'Veo 3.1 Lite', re: /Veo 3\.1 - Lite/, credits: 10},
  'veo-3.1-fast': {label: 'Veo 3.1 Fast', re: /Veo 3\.1 - Fast/, credits: 20},
  'veo-3.1-quality': {label: 'Veo 3.1 Quality', re: /Veo 3\.1 - Quality/, credits: 100},
  'omni-1.1-flash': {label: 'Omni 1.1 Flash', re: /Omni 1\.1 Flash/, credits: 20},
};
export const FLOW_DAILY = 50;

// Остаток кредитов Flow («бонусы» в меню аккаунта). Freefield читает его с сайта после каждой генерации;
// до первого чтения за день считает, что доступны все 50.
export const flowLeft = () => { const c = readState().flowCredits; return c?.date === today() ? c.left : FLOW_DAILY; };
const flowSpend = n => writeState({flowCredits: {date: today(), left: Math.max(0, flowLeft() - n), at: Date.now()}});
async function flowReadCredits(page) {
  // панель аккаунта — всплывающий слой; в ней же кнопка выхода, поэтому закрываем только кнопкой «Закрыть панель»
  const read = () => page.evaluate(() => document.querySelector('.cdk-overlay-container')?.innerText || '').catch(() => '');
  let text = await read();
  if (!/\d+\s*(бонус|credit)/i.test(text)) {
    const btn = page.getByRole('button', {name: /Сведения об аккаунте|Account info/i}).first();
    if (!(await btn.isVisible().catch(() => false))) return null;
    await btn.click({timeout: 5000});
    await sleep(1200);
    text = await read();
  }
  await page.getByRole('button', {name: /Закрыть панель аккаунта|Close account panel/i}).first().click({timeout: 3000})
    .catch(() => page.keyboard.press('Escape'));
  await sleep(400);
  const m = text.match(/(\d+)\s*(бонус|credit)/i);
  if (!m) return null;
  writeState({flowCredits: {date: today(), left: +m[1], at: Date.now()}});
  return +m[1];
}

async function flowProject(page) {
  // из режима редактирования видео (…/project/<id>/edit/…) — обратно в сетку проекта
  const edit = page.url().match(/^(https:\/\/flow\.google\.com\/project\/[^/?#]+)\/edit\//);
  if (edit) { await page.goto(edit[1], {waitUntil: 'domcontentloaded', timeout: 60000}); await sleep(2500); }
  if (/\/project\/[^/?#]+\/?(\?|#|$)/.test(page.url())) return;
  const st = readState();
  if (st.flowProject) {
    await page.goto(st.flowProject, {waitUntil: 'domcontentloaded', timeout: 60000}).catch(() => {});
    await sleep(2500);
    if (/\/project\//.test(page.url())) return;
  }
  if (!/flow\.google\.com\/?$/.test(page.url())) await page.goto(SITES.flow.home, {waitUntil: 'domcontentloaded', timeout: 60000});
  await assertReady(page, 'flow');
  await page.getByText(/Новый проект|New project/i).first().click();
  await page.waitForURL(/\/project\//, {timeout: 30000});
  await sleep(2500);
  writeState({flowProject: page.url()});
}

async function flowSettings(page, {kind, aspect, count, model, seconds, quality = '720p', allowCredits = true}) {
  // у некоторых аккаунтов справа открыта панель агента («Здравствуйте, … Что вы хотите создать?») — закрываем её
  if (await page.getByRole('button', {name: /Открыть историю сеансов|Open session history/i}).isVisible().catch(() => false)) {
    await page.getByRole('button', {name: /^(Закрыть|Close)$/}).last().click({timeout: 5000}).catch(() => {});
    await sleep(1200);
  }
  // прямой режим (без агента): у агента своя кнопка «Инструкции для агента»
  if (await page.getByRole('button', {name: /Инструкции для агента|Agent instructions/i}).isVisible().catch(() => false))
    await page.getByRole('button', {name: /^(Агент|Agent)$/}).click({timeout: 5000}).catch(() => {});   // у некоторых аккаунтов переключателя нет
  const family = page.getByRole('button', {name: /Выбрать семейство моделей|model family/i});
  // панель настроек иногда закрывается сама сразу после переключения вкладки — открываем, пока не откроется
  for (let i = 0; i < 4 && !(await family.isVisible().catch(() => false)); i++) {
    await page.getByRole('button', {name: /Триггер настроек|Settings trigger/i}).click();
    await sleep(1000);
  }
  if (!(await family.isVisible().catch(() => false))) throw new PortalError('не удалось открыть настройки генерации Flow — возможно, сайт изменил интерфейс', 'ui');
  await page.getByRole('radio', {name: kind === 'video' ? /Видео|Video/ : /Изображение|Image/}).click();
  await sleep(400);
  await page.getByRole('radio', {name: new RegExp(`(^|\\s)${aspect}$`)}).first().click();
  await page.getByRole('radio', {name: `x${count}`, exact: true}).click();
  // модель; нет её в меню этого аккаунта — запасная (Nano Banana 2.1 → 2)
  const pick = async m => {
    await family.click();
    await sleep(500);
    const item = page.getByRole('menuitem', {name: m.re}).first();
    await item.waitFor({state: 'visible', timeout: 8000}).catch(() => {});
    if (!(await item.isVisible().catch(() => false))) { await page.keyboard.press('Escape'); await sleep(300); return false; }
    await item.click();
    await sleep(800);
    return true;
  };
  const backup = model.fallback ? (kind === 'video' ? FLOW_VIDEO_MODELS : FLOW_IMAGE_MODELS)[model.fallback] : null;
  let used = model;
  if (!(await pick(model))) {
    if (!backup || !(await pick(backup))) throw new PortalError(`во Flow нет модели ${model.label} — возможно, сайт изменил список моделей`, 'ui');
    used = backup;
  }
  // видео: качество (никогда не 360p — по умолчанию 720p) и длина, если модель их предлагает (Omni: 360p/720p, 4–10 с)
  if (kind === 'video') {
    const opt = async re => { const r = page.getByRole('radio', {name: re}).first(); if (await r.isVisible().catch(() => false)) { await r.click(); await sleep(400); return true; } return false; };
    if (!(await opt(new RegExp(`^${quality}`)))) await opt(/^720p/);
    if (seconds) await opt(new RegExp(`^${seconds} сек|^${seconds}s`));
  }
  // цена — как её пишет сам Flow («Стоимость генерации в бонусах: N»); нет строки — по таблице моделей
  const readCost = async () => {
    const txt = await page.evaluate(() => document.querySelector('.cdk-overlay-container')?.innerText || '').catch(() => '');
    const n = txt.match(/Стоимость генерации в бонусах:\s*(\d+)|cost[^:]*:\s*(\d+)/i)?.slice(1).find(Boolean);
    return n != null ? +n : null;
  };
  let cost = await readCost();
  // без разрешения тратить кредиты: платная модель с запасной — берём запасную, без неё — стоп с ценой
  if (!allowCredits && (cost ?? (used.credits || 0) * count) > 0) {
    if (used !== backup && backup && await pick(backup)) { used = backup; cost = await readCost(); }
    const price = cost ?? (used.credits || 0) * count;
    if (price > 0) {
      await page.keyboard.press('Escape');
      throw new PortalError(`${used.label} во Flow стоит ${price} кредитов (бонусов) за эту генерацию — без allow_credits=true Freefield их не тратит`, 'credits');
    }
  }
  await page.keyboard.press('Escape');
  await sleep(500);
  return {cost, model: used};
}

// адрес файла Flow: раньше flow-content.google/(image|video)/<id>, теперь и flow.google.com/asb/<токен>
export const flowMedia = page => page.evaluate(() => [...document.querySelectorAll('img, video')].map(e => ({
  tag: e.tagName, src: e.currentSrc || e.src || e.querySelector('source')?.src || '',
  w: e.naturalWidth || e.videoWidth || 0, h: e.naturalHeight || e.videoHeight || 0,
})).filter(m => /^https:\/\/(flow-content\.google\/|flow\.google\.com\/asb\/)/.test(m.src)));
// одна и та же плитка бывает то картинкой-превью, то видео — сравниваем по id, а не по адресу
export const flowId = src => src.match(/\/(?:image|video)\/([0-9a-f-]{8,})/)?.[1] || src.split('?')[0];

// Несколько генераций в одном проекте Flow сразу. Пока генерация идёт, её плитка показывает текст промпта и процент —
// по тексту Freefield находит и помечает свои плитки (data-ff), а потом забирает из них готовый результат или ошибку.
// Если Flow перерисует сетку и метка пропадёт, берётся новая готовая плитка, которую ещё не забрала другая генерация.
const flowClaimed = new Set();
// Свою плитку Flow узнаём по кусочку текста промпта, которого нет в других промптах, идущих в этот момент
// (промпты одного пакета часто начинаются одинаково — по началу их не различить).
const flowInflight = new Set();
function flowKey(p) {
  const others = [...flowInflight].filter(x => x !== p);
  for (let i = 0; i + 50 <= p.length; i += 20) { const w = p.slice(i, i + 50); if (!others.some(o => o.includes(w))) return w; }
  return p.slice(0, 60);
}
const flowScan = (page, {tag, key, count}) => page.evaluate(({tag, key, count}) => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  let tiles = [...document.querySelectorAll('flow-grid-tile-container')];
  if (!tiles.length) tiles = [...document.querySelectorAll('[class*="tile-row"] > *')];
  const media = t => [...t.querySelectorAll('img, video')].map(e => ({tag: e.tagName, src: e.currentSrc || e.src || e.querySelector('source')?.src || '',
    w: e.naturalWidth || e.videoWidth || 0, h: e.naturalHeight || e.videoHeight || 0})).find(x => /^https:\/\/(flow-content\.google\/|flow\.google\.com\/asb\/)/.test(x.src)) || null;
  // плитка-ошибка текста промпта не содержит («warning Ошибка … refresh»); сам промпт может содержать слово error
  const failed = text => !text.includes(key) && /(^|\s)(warning|error)(\s|$)|Ошибка|не удалось|failed/i.test(text) && !/\d\s?%/.test(text);
  const mineNow = () => tiles.filter(t => t.dataset.ff === tag).length;
  for (const t of tiles) if (mineNow() < count && !t.dataset.ff && !media(t) && norm(t.innerText).includes(key)) t.dataset.ff = tag;
  return {
    // готовое видео бывает плиткой без адреса файла (значок ▶, файл подгружается при наведении) — videoDone
    mine: tiles.filter(t => t.dataset.ff === tag).map(t => { const text = norm(t.innerText); const m = media(t); return {media: m, text, pct: text.match(/(\d{1,3})\s?%/)?.[1] || null, failed: !m && failed(text),
      videoDone: !m && /play_circle/.test(text) && !/\d\s?%/.test(text)}; }),
    fresh: tiles.filter(t => !t.dataset.ff).map(media).filter(Boolean).reverse(),   // сначала более старые
    errors: tiles.filter(t => !media(t) && failed(norm(t.innerText))).length,
    pending: tiles.filter(t => !media(t) && /\d\s?%/.test(norm(t.innerText))).length,   // идущие генерации (с процентом)
    toast: [...document.querySelectorAll('[role="alert"], .mat-mdc-snack-bar-label')].map(e => norm(e.innerText)).filter(Boolean).pop() || '',
  };
}, {tag, key, count});
const flowReady = m => m.tag === 'VIDEO' || m.w >= 512;
// навести курсор на свою плитку (data-ff) и дождаться адреса видеофайла
async function flowHoverSrc(page, tag) {
  await page.bringToFront().catch(() => {});
  const box = await page.evaluate(tag => {
    const t = document.querySelector(`[data-ff="${tag}"]`);
    if (!t) return null;
    t.scrollIntoView({block: 'center'});
    const r = t.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2};
  }, tag);
  if (!box) return null;
  await page.mouse.move(box.x, box.y);
  try {
    for (let i = 0; i < 12; i++) {
      await sleep(700);
      const src = await page.evaluate(tag => [...(document.querySelector(`[data-ff="${tag}"]`)?.querySelectorAll('video') || [])]
        .map(v => v.currentSrc || v.src || v.querySelector('source')?.src || '').find(s => /^https:/.test(s)), tag);
      if (src) return src;
    }
    return null;
  } finally { await page.mouse.move(5, 5).catch(() => {}); }
}   // готовое видео выглядит как картинка-превью с тем же id
const flowErrText = t => t.replace(/^(warning\s*)?(Ошибка|Error)\s*/i, '').replace(/\s*\b(refresh|undo|delete_forever|keyboard_return|warning)\b/g, '').trim();

// Flow пожаловался на подозрительную активность — полчаса не отправляем туда новые задания (их берут другие сайты)
export const flowPaused = () => (readState().flowPause || 0) > Date.now();
function flowFail(text) {
  const msg = flowErrText(text) || text;
  if (/подозрительн|suspicious|unusual activity/i.test(msg)) {
    writeState({flowPause: Date.now() + 30 * 60e3});
    return new PortalError(`Flow отклонил генерацию: «${msg}». Freefield не будет отправлять задания во Flow 30 минут — их возьмут другие сайты. ` +
      'Если сообщения повторяются, лучше сделать перерыв подольше.', 'flagged');
  }
  return new PortalError(`Flow: ${msg}`, /лимит|limit|quota|бонус/i.test(msg) ? 'quota' : 'busy');
}

// Фото-референс во Flow — «ингредиент»: «Добавить ингредиенты» → «Загрузить» → файл → «Добавить в запрос»
// сколько картинок-ингредиентов уже стоит в поле ввода (Flow оставляет их после отправки промпта)
const flowComposerRefs = page => page.evaluate(() => {
  let root = document.querySelector('[contenteditable="true"]');
  for (let i = 0; i < 5 && root; i++) root = root.parentElement;
  return root ? root.querySelectorAll('img').length : 0;
}).catch(() => 0);
// Ровно нужный набор фото-референсов в поле ввода Flow: старые (с прошлого промпта) убираем, свои добавляем по одному
async function flowSetRefs(page, files = []) {
  // Flow иногда теряет загруженное фото — прикрепляем заново ещё раз, прежде чем сдаться (иначе задание уехало бы в другой сервис)
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(300);
    for (let i = 0; i < 10 && (await flowComposerRefs(page)); i++) {
      await page.getByRole('button', {name: /^(Ингредиент|Ingredient)$/}).first().click({timeout: 3000}).catch(() => {});
      await sleep(500);
    }
    try { for (const f of files) await flowAttach(page, f); } catch (e) { if (attempt) throw e; continue; }
    if ((await flowComposerRefs(page)) >= files.length) return;
  }
  throw new PortalError('Flow не принял все фото-референсы — посмотрите в окно Chrome Freefield', 'ui');
}
async function flowAttach(page, file) {
  await page.keyboard.press('Escape').catch(() => {});
  await hideGoogleCookieBar(page);   // полоска cookie Google перекрывает «Добавить ингредиенты»
  await sleep(300);
  const refs0 = await flowComposerRefs(page);
  await page.getByRole('button', {name: /Добавить ингредиенты|Add ingredients/i}).click();
  await sleep(1000);
  const ov = page.locator('.cdk-overlay-container');
  // в списке панели сверху бывают идущие генерации — поэтому после загрузки явно выбираем свой файл
  const name = path.basename(file);
  const mine = () => ov.getByText(name, {exact: true});
  // это фото уже загружено в проект — просто выбираем его, иначе загружаем
  const had = await mine().count();
  if (!had) {
    const fc = page.waitForEvent('filechooser', {timeout: 10000});
    await ov.locator('button', {hasText: /Загрузить|Upload(?!s)/}).last().click();
    await (await fc).setFiles(file);
    for (let i = 0; i < 90 && (await mine().count()) <= had; i++) await sleep(1000);
  }
  await mine().first().click({timeout: 10000}).catch(() => { throw new PortalError('Flow не показал загруженное фото-референс', 'ui'); });
  await sleep(1200);
  const add = ov.getByRole('button', {name: /Добавить в запрос|Add to prompt/i});
  await add.click({timeout: 60000}).catch(async () => {
    await page.keyboard.press('Escape').catch(() => {});
    if ((await flowComposerRefs(page)) <= refs0) throw new PortalError(`Flow не принял фото-референс «${name}» — посмотрите в окно Chrome Freefield`, 'ui');
  });
  await sleep(1500);
}

async function flowGenerate(o) {
  const full = o.prompt.replace(/\s+/g, ' ').trim();
  flowInflight.add(full);
  try { return await flowGenerateIn(o, full); } finally { flowInflight.delete(full); }
}
async function flowGenerateIn({kind, prompt, aspect, count, model, seconds, imagePath, imagePaths, onStatus, timeoutMs, allowCredits = true, resolution = null}, full) {
  const tag = 'ff' + crypto.randomBytes(4).toString('hex');
  const key = () => flowKey(full);   // кусочек промпта, которого нет в других идущих промптах
  let spent = (model.credits || 0) * count;
  // отправка — по одной; ждём, пока появятся свои плитки, после этого можно отправлять следующий промпт
  const {page, before} = await siteRun('flow', () => ui(async () => {
    if (flowPaused()) throw new PortalError(`Flow недавно пожаловался на подозрительную активность — пауза до ${new Date(readState().flowPause).toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'})}`, 'flagged');
    const page = await sitePage('flow');
    await assertReady(page, 'flow');
    onStatus('открываю проект Flow');
    await flowProject(page);
    await assertReady(page, 'flow');
    // сначала фото (с ним Flow переключается в «Ингредиенты»), потом модель, 720p и длина
    // фото-референсы: ровно этот набор (старые из поля ввода убираются)
    const refs = [...new Set([...(imagePaths || []), ...(imagePath ? [imagePath] : [])])];
    if (refs.length) onStatus(`прикрепляю фото-референсы: ${refs.length}`);
    await flowSetRefs(page, refs);
    onStatus(`настраиваю: ${model.label}, ${aspect}${kind === 'video' ? `, 720p${seconds ? ', ' + seconds + ' с' : ''}` : ''}, x${count}`);
    const {cost, model: used} = await flowSettings(page, {kind, aspect, count, model, seconds, allowCredits});
    if (used !== model) { onStatus(`${model.label} сейчас не подходит — беру ${used.label}`); model = used; }
    spent = cost ?? (model.credits || 0) * count;
    const before = new Set((await flowMedia(page)).map(m => flowId(m.src)));
    const errors0 = (await flowScan(page, {tag: '-', key: '\u0000', count: 0})).errors;
    const box = page.locator('[contenteditable="true"]').first();
    await box.click();
    await box.fill(prompt);
    await sleep(400);
    await page.getByRole('button', {name: /Начать генерацию|Generate|Create/i}).last().click();
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const s = await flowScan(page, {tag, key: key(), count});
      if (s.mine.length >= count) break;
      if (s.errors > errors0 && !s.mine.length) throw flowFail((await page.evaluate(() => [...document.querySelectorAll('flow-grid-tile-container')]
        .map(t => t.innerText.replace(/\s+/g, ' ').trim()).find(t => /Ошибка|Error|warning/i.test(t) && !/\d\s?%/.test(t)) || '')));
      if (i >= 4 && !s.mine.length && s.toast && /лимит|limit|подозрительн|suspicious|не удалось|failed|error|ошибка/i.test(s.toast)) throw flowFail(s.toast);
    }
    return {page, before};
  }));
  onStatus(`Flow генерирует (${model.label})`);
  const res = (await flowCollect(page, {kind, count, tag, key, before, timeoutMs, onStatus, resolution, allowCredits})).map(r => ({...r, model: model.label}));
  // стоимость — как написал сам Flow в настройках («Стоимость генерации в бонусах: N»), иначе по таблице моделей
  flowSpend(spent);
  track('flow', {[kind === 'video' ? 'videos' : 'images']: res.length, credits: spent});
  await ui(async () => { await page.bringToFront().catch(() => {}); await flowReadCredits(page); }).catch(() => {});
  return res;
}

// Ждёт свои плитки, затем скачивает их; для видео — сам видеофайл
async function flowCollect(page, {kind, count, tag, key, before, timeoutMs, onStatus, resolution, allowCredits}) {
  const t0 = Date.now();
  const got = [];
  const take = m => { const id = flowId(m.src); if (!got.some(g => flowId(g.src) === id)) { got.push(m); flowClaimed.add(id); markOurs('flow', [id]); } };
  let lost = 0, failed = [], started = false;
  while (got.length < count) {
    if (Date.now() - t0 > timeoutMs) {
      if (got.length) break;
      throw new PortalError(`Flow не выдал результат за ${Math.round(timeoutMs / 1000)} с. Посмотрите в окно Chrome Freefield.`, 'busy');
    }
    await sleep(3000);
    await captchaCheck(page, 'flow');
    const s = await flowScan(page, {tag, key: key(), count});
    for (const x of s.mine) if (x.media && flowReady(x.media)) take(x.media);
    // видео готово, но адреса файла в плитке нет — наводим курсор на свою плитку и берём адрес
    if (got.length < count && s.mine.some(x => x.videoDone)) {
      const src = await ui(() => flowHoverSrc(page, tag)).catch(() => null);
      if (src) take({tag: 'VIDEO', src, w: 0, h: 0});
    }
    failed = s.mine.filter(x => x.failed);
    if (failed.length && got.length + failed.length >= count) break;
    // метка пропала (Flow перерисовал сетку): свои плитки уже не ждут — берём новые готовые, ничьи
    lost = s.mine.length ? 0 : lost + 1;
    if (lost >= 2) for (const m of s.fresh) if (got.length < count && flowReady(m) && !before.has(flowId(m.src)) && !flowClaimed.has(flowId(m.src))) take(m);
    // проверка, что генерация правда идёт: своя плитка или хоть одна плитка с процентом за 1,5 минуты
    started ||= s.mine.length > 0 || s.pending > 0 || got.length > 0;
    if (!started && Date.now() - t0 > 90000)
      throw new PortalError(`Flow не начал генерацию — промпт не принят${s.toast ? ': «' + s.toast + '»' : ''}. Посмотрите в окно Chrome Freefield.`, 'busy');
    const pct = s.mine.map(x => x.pct).filter(Boolean);
    onStatus(`Flow генерирует: готово ${got.length} из ${count}${pct.length ? ` · ${pct.join('%, ')}%` : ''} (${Math.round((Date.now() - t0) / 1000)} с)`);
  }
  if (!got.length) throw flowFail(failed[0]?.text || 'генерация не удалась');
  await sleep(1500);   // дать догрузиться финальным версиям
  const latest = new Map((await flowMedia(page)).map(m => [flowId(m.src), m]));
  const results = [];
  let lastErr = null;
  for (const m of got.slice(0, count)) {
    const cur = latest.get(flowId(m.src)) || m;
    onStatus(`скачиваю ${results.length + 1} из ${Math.min(count, got.length)}`);
    // у видео с <video> в плитке адрес файла уже есть — качаем сразу, без наведения
    // картинка в нужном размере — через меню плитки Flow («Скачать» → 1K / 2K / 4K): файл как его отдаёт Flow, без пережатия.
    // Не вышло — оригинал по ссылке плитки, с пометкой (warning)
    if (kind === 'image' && resolution) {
      try { results.push({...(await flowMenuDownload(page, cur, {resolution, allowCredits, onStatus})), id: flowId(cur.src)}); markSynced('flow', [flowId(cur.src)]); continue; }
      catch (e) {
        // размер стоит кредитов или недоступен аккаунту — запоминаем (следующий запрос остановится до генерации)
        if (e.kind === 'credits' || e.kind === 'plan') writeState({flowRes: {...readState().flowRes, [resolution]: {kind: e.kind, message: e.message, date: today()}}});
        try {
          const d = await download(page, cur.src);
          results.push({...d, width: cur.w, height: cur.h, resolution: null, upscaled: false, id: flowId(cur.src),
            ...(e.kind === 'credits' || e.kind === 'plan' ? {error: e.message, error_kind: e.kind} : {}),
            warning: `${resolution.toUpperCase()} через меню Flow не получилось (${e.message}) — сохранён оригинал по ссылке плитки`});
          markSynced('flow', [flowId(cur.src)]);
        } catch (e2) { lastErr = e2; }
        continue;
      }
    }
    const src = kind === 'video' && cur.tag !== 'VIDEO' ? await ui(async () => {
      await page.bringToFront().catch(() => {});
      await sleep(600);
      try { return await flowVideoSrc(page, cur.src); } finally { await page.mouse.move(5, 5).catch(() => {}); }
    }) : cur.src;
    try { results.push({...(await download(page, src)), width: cur.w, height: cur.h, id: flowId(cur.src)}); }
    catch (e) { lastErr = e; continue; }   // не скачался один вариант — сохраняем остальные (заберёт синхронизация)
    markSynced('flow', [flowId(cur.src), flowId(src)]);   // синхронизация не будет качать это второй раз
  }
  if (!results.length && lastErr) throw lastErr;
  return results;
}

// ---- скачивание картинки через меню плитки Flow: «⋮» → «Скачать» → «1K» / «2K» / «4K» ----
// 2K и 4K Flow не хранит: увеличивает по запросу своим кодом страницы (с reCAPTCHA) и сам начинает скачивание —
// поэтому Freefield нажимает пункты меню, как человек, а файл перехватывает (bridge.downloadCapture).
const FLOW_RES = {'1k': 1, '2k': 2, '4k': 4};
// размер уже отказал сегодня (стоит кредитов или недоступен аккаунту) — сообщение, иначе null
export function flowResBlocked(resolution, allowCredits) {
  const r = readState().flowRes?.[resolution];
  if (!r || r.date !== today()) return null;
  return r.kind === 'plan' || !allowCredits ? r.message : null;
}
const sniffMime = (buf, name = '') => ({png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif'})[imageSize(buf)?.format] ||
  ({'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'})[path.extname(name).toLowerCase()] || 'application/octet-stream';
export async function flowMenuDownload(page, media, {resolution = '1k', allowCredits = false, onStatus = () => {}} = {}) {
  const id = flowId(media.src), want = FLOW_RES[resolution] || 1;
  const dir = path.join(os.tmpdir(), 'freefield-dl', crypto.randomBytes(5).toString('hex'));
  let cap = null, chosen = '';
  const menuTexts = () => page.evaluate(() => [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')]
    .filter(e => e.getClientRects().length).map(e => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim())).catch(() => []);
  try {
    await ui(async () => {
      await page.bringToFront().catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(300);
      // плитка с этим результатом (по id файла в адресе картинки), её центр — навести курсор, чтобы появилась кнопка меню
      const box = await page.evaluate(id => {
        document.querySelectorAll('[data-ffdl]').forEach(e => e.removeAttribute('data-ffdl'));
        const el = [...document.querySelectorAll('img, video')].find(e => (e.currentSrc || e.src || '').includes(id));
        const tile = el?.closest('flow-grid-tile-container, flow-tile-container, [class*="tile-container"]') || el?.parentElement;
        if (!tile) return null;
        tile.scrollIntoView({block: 'center'});
        tile.setAttribute('data-ffdl', '1');
        const r = tile.getBoundingClientRect();
        return {x: r.x + r.width / 2, y: r.y + r.height / 2};
      }, id);
      if (!box) throw new PortalError('плитка с картинкой не найдена в сетке Flow', 'ui');
      await sleep(400);
      await page.mouse.move(box.x, box.y);
      await sleep(900);
      // кнопка меню плитки: по подписи («Ещё», «Другие действия», «More options»…), по aria-haspopup или значку more_vert
      const found = await page.evaluate(() => {
        const tile = document.querySelector('[data-ffdl]');
        const btns = [...(tile?.querySelectorAll('button, [role="button"]') || [])].filter(b => b.getClientRects().length);
        const lab = b => `${b.getAttribute('aria-label') || ''} ${b.title || ''} ${b.innerText || ''}`;
        const b = btns.find(b => /ещё|еще|больше|друг\S* действ|параметр|меню|more|option|menu|more_vert|more_horiz/i.test(lab(b))) ||
          btns.find(b => /^(menu|true)$/.test(b.getAttribute('aria-haspopup') || '')) || btns[btns.length - 1];
        document.querySelectorAll('[data-ffbtn]').forEach(e => e.removeAttribute('data-ffbtn'));
        if (b) b.setAttribute('data-ffbtn', '1');
        return !!b;
      });
      if (!found) throw new PortalError('у плитки Flow не появилась кнопка меню', 'ui');
      // пункт перекрыт другим слоем меню — нажимаем событием (меню Flow слушают click)
      const press = loc => loc.click({timeout: 6000}).catch(() => loc.dispatchEvent('click'));
      await press(page.locator('[data-ffbtn="1"]').first());
      await sleep(800);
      const dl = page.locator('[role="menuitem"]:visible', {hasText: /скачать|download|сохранить на (компьютер|устройство)/i}).first();
      if (!(await dl.isVisible().catch(() => false))) throw new PortalError(`в меню плитки Flow нет «Скачать» (есть: ${(await menuTexts()).join(' | ') || 'ничего'})`, 'ui');
      const seen = new Set(await menuTexts());
      cap = await downloadCapture(page, dir);
      await dl.hover({timeout: 3000}).catch(() => {});
      await press(dl);
      await sleep(1000);
      // подменю размеров; его нет — скачивание уже пошло (Flow не предлагает выбор размера)
      const sizes = (await menuTexts()).filter(t => !seen.has(t) && /(^|\D)[124]\s?K\b/i.test(t));
      if (!sizes.length) {
        if (want > 1) throw new PortalError(`Flow не предложил ${want}K для этой картинки`, 'nores');
        chosen = 'Скачать';
        return;
      }
      const text = sizes.find(t => new RegExp(`(^|\\D)${want}\\s?K\\b`, 'i').test(t));
      if (!text) throw new PortalError(`Flow не предлагает ${want}K (есть: ${sizes.join(' | ')})`, 'nores');
      const item = page.locator('[role="menuitem"]:visible, [role="menuitemradio"]:visible', {hasText: text}).first();
      const disabled = await item.evaluate(e => e.getAttribute('aria-disabled') === 'true' || e.hasAttribute('disabled')).catch(() => false);
      if (disabled || /upgrade|ultra|подписк|обнов|улучш\S* план|lock/i.test(text))
        throw new PortalError(`${want}K во Flow этого аккаунта недоступно (Flow: «${text}») — нужна подписка Google AI`, 'plan');
      const price = text.match(/(\d+)\s*(кредит|бонус|credit)/i);
      if (price && +price[1] > 0 && !allowCredits)
        throw new PortalError(`${want}K во Flow стоит ${price[1]} кредитов (бонусов) — без allow_credits=true Freefield их не тратит`, 'credits');
      await item.hover({timeout: 3000}).catch(() => {});
      await press(item);
      chosen = text;
    });
    onStatus(want > 1 ? `Flow увеличивает картинку до ${want}K` : 'скачиваю оригинал из Flow');
    const t0 = Date.now();
    let file = null;
    while (!file && Date.now() - t0 < 180000) {
      file = await cap.wait(3000);
      if (file) break;
      const toast = await page.evaluate(() => [...document.querySelectorAll('[role="alert"], [role="status"], .mat-mdc-snack-bar-label')]
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).pop() || '').catch(() => '');
      if (/не удалось|ошибк|failed|error|limit|лимит|попробуйте позже|try again/i.test(toast) && !cap.started())
        throw new PortalError(`Flow: «${toast}»`, /limit|лимит/i.test(toast) ? 'quota' : 'busy');
    }
    if (!file) throw new PortalError(`Flow не отдал файл за 3 минуты${want > 1 ? ` (увеличение до ${want}K)` : ''}`, 'busy');
    const buf = fs.readFileSync(file.path);
    const s = imageSize(buf);
    return {buf, mime: sniffMime(buf, file.name), name: file.name, width: s?.width ?? null, height: s?.height ?? null,
      resolution: `${want}K`, upscaled: want > 1, menu: chosen};
  } finally {
    await cap?.stop();
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.move(5, 5).catch(() => {});
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

// Какие файлы сделал Flow: путь → id файла во Flow и проект (для upscale_image). У каждого профиля Chrome — свой список
export function rememberFlowFile(file, id) {
  if (!id) return;
  const st = readState(), map = {...(st.flowFiles || {})};
  map[path.resolve(file)] = {id, project: st.flowProject || null, at: Date.now()};
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete map[k];
  writeState({flowFiles: map});
}
export const flowFileOf = file => readState().flowFiles?.[path.resolve(file)] || null;

// Увеличить картинку, которую раньше сделал Flow (upscale_image): открыть её проект и скачать через меню в 2K или 4K.
// id — id файла Flow (Freefield запоминает его для каждой своей картинки).
export const flowUpscaleById = ({id, project, resolution, allowCredits = false, onStatus = () => {}}) => siteSlot('flow', async () => {
  const page = await siteRun('flow', () => ui(async () => {
    const page = await sitePage('flow');
    await assertReady(page, 'flow');
    if (project && !page.url().startsWith(project)) { await page.goto(project, {waitUntil: 'domcontentloaded', timeout: 60000}); await sleep(3000); }
    else await flowProject(page);
    await assertReady(page, 'flow');
    return page;
  }));
  // сетка большая — прокручиваем, пока плитка с этим id не появится
  for (let i = 0; i < 40; i++) {
    const has = await page.evaluate(id => [...document.querySelectorAll('img, video')].some(e => (e.currentSrc || e.src || '').includes(id)), id).catch(() => false);
    if (has) break;
    if (i === 39) throw new PortalError('картинка не найдена в проекте Flow (её удалили или это другой аккаунт)', 'notfound');
    await page.mouse.wheel(0, 900).catch(() => {});
    await sleep(700);
  }
  const src = await page.evaluate(id => [...document.querySelectorAll('img, video')].map(e => e.currentSrc || e.src || '').find(s => s.includes(id)), id);
  return flowMenuDownload(page, {src}, {resolution, allowCredits, onStatus});
});

// Навести курсор на плитку и дождаться ссылки на сам видеофайл
export async function flowVideoSrc(page, tileSrc) {
  const id = tileSrc.match(/\/(?:image|video)\/([0-9a-f-]{8,})/)?.[1];
  if (!id) throw new PortalError('не удалось определить видео в сетке Flow', 'ui');
  if (tileSrc.includes('/video/')) return tileSrc;
  for (let i = 0; i < 10; i++) {
    const box = await page.evaluate(id => {
      const e = [...document.querySelectorAll('img, video')].find(x => (x.currentSrc || x.src || '').includes(id));
      if (!e) return null;
      e.scrollIntoView({block: 'center'});
      const r = e.getBoundingClientRect();
      return {x: r.x + r.width / 2, y: r.y + r.height / 2};
    }, id);
    if (box) await page.mouse.move(box.x, box.y);
    await sleep(800);
    const src = await page.evaluate(id => [...document.querySelectorAll('video')]
      .map(v => v.currentSrc || v.src || v.querySelector('source')?.src).find(s => s && s.includes(id)), id);
    if (src) return src;
  }
  throw new PortalError('Flow не отдал видеофайл — видео видно в окне Chrome Freefield, его можно скачать вручную', 'ui');
}

// ---- синхронизация: всё, что сгенерировано на сайтах, должно оказаться в Freefield ----
// Freefield помнит id уже забранных результатов (state.synced) и докачивает остальные — даже если генерацию
// запускали не через Freefield или она «потерялась» по дороге.
const syncedSet = site => new Set(readState().synced?.[site] || []);
export function markSynced(site, ids) {
  const st = readState(), cur = new Set(st.synced?.[site] || []);
  ids.forEach(i => i && cur.add(i));
  writeState({synced: {...st.synced, [site]: [...cur].slice(-5000)}});
}

// Flow: готовые картинки и видео проекта Freefield, которые сделал сам Freefield, но ещё не забрал (например, не скачались)
export const flowSync = ({onStatus = () => {}} = {}) => siteRun('flow', () => ui(async () => {
  const ours = oursSet('flow');
  if (!ours.size) return [];
  const page = await sitePage('flow');
  await assertReady(page, 'flow');
  await flowProject(page);
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(1500);
  const done = syncedSet('flow');
  const tiles = await page.evaluate(() => [...document.querySelectorAll('flow-grid-tile-container')].map((t, i) => {
    const m = [...t.querySelectorAll('img, video')].map(e => ({tag: e.tagName, src: e.currentSrc || e.src || '', w: e.naturalWidth || e.videoWidth || 0}))
      .find(x => /^https:\/\/(flow-content\.google\/|flow\.google\.com\/asb\/)/.test(x.src));
    const text = t.innerText.replace(/\s+/g, ' ');
    return {i, label: t.getAttribute('aria-label') || '', video: /play_circle/.test(text) || m?.tag === 'VIDEO', pending: /\d\s?%/.test(text), src: m?.src || '', w: m?.w || 0,
      tag: m?.tag || '', mid: t.querySelector('[data-media-id]')?.dataset.mediaId || null};
  }));
  const out = [];
  for (const t of tiles) {
    if (t.pending || /\.(jpe?g|png|webp|gif|heic)$/i.test(t.label)) continue;   // идёт генерация / загруженное фото
    let id = t.mid || (t.src ? flowId(t.src) : null);
    if (id && done.has(id)) continue;
    if (!ours.has(id) && !(t.src && ours.has(flowId(t.src)))) continue;   // не наше — пользователь делал сам на сайте
    let src = t.src;
    if (t.video && t.tag !== 'VIDEO') {
      // у видео файл появляется при наведении на плитку
      const box = await page.evaluate(i => { const e = document.querySelectorAll('flow-grid-tile-container')[i]; e?.scrollIntoView({block: 'center'});
        const r = e?.getBoundingClientRect(); return r && {x: r.x + r.width / 2, y: r.y + r.height / 2}; }, t.i);
      if (!box) continue;
      await page.mouse.move(box.x, box.y);
      src = null;
      for (let k = 0; k < 10 && !src; k++) {
        await sleep(700);
        src = await page.evaluate(i => [...document.querySelectorAll('flow-grid-tile-container')[i].querySelectorAll('video')]
          .map(v => v.currentSrc || v.src || v.querySelector('source')?.src).find(s => /flow-content\.google\/video\/|flow\.google\.com\/asb\//.test(s || '')), t.i);
      }
      await page.mouse.move(5, 5).catch(() => {});
      if (!src) continue;
      id = flowId(src);
      if (done.has(id)) continue;
    } else if (!src || (!t.video && t.w < 512)) continue;
    onStatus(`Flow: забираю ${t.video ? 'видео' : 'картинку'} «${t.label}»`);
    try { out.push({site: 'flow', kind: t.video ? 'video' : 'image', id, title: t.label, ...(await download(page, src))}); done.add(id); } catch {}
  }
  return out;
}));

export const flowImage = o => siteSlot('flow', () => flowGenerate({kind: 'image', timeoutMs: 180000, ...o}));
export const flowVideo = o => siteSlot('flow', () => flowGenerate({kind: 'video', timeoutMs: 600000, ...o}));

// ============================== Dola ==============================
export const DOLA_IMAGE_MODELS = {
  'seedream-4.5': {label: 'Seedream 4.5', re: /Seedream 4\.5/},
  'seedream-5-pro': {label: 'Seedream 5.0 Pro', re: /Seedream 5\.0 Pro/},
};

const dolaImages = page => page.evaluate(() => {
  const best = new Map();
  for (const i of document.images) {
    const src = i.currentSrc || i.src;
    if (!/rc_gen_image/.test(src)) continue;
    const key = src.split('~')[0].replace(/^https?:\/\/[^/]+/, '');   // одна картинка приходит с разных серверов (p16, p19…)
    if (!best.has(key) || i.naturalWidth > best.get(key).w) best.set(key, {src, w: i.naturalWidth, h: i.naturalHeight});
  }
  return [...best.entries()].map(([key, v]) => ({key, ...v}));
});
const dolaBusy = page => page.evaluate(() => !!document.querySelector('[class*="loading" i], [class*="generating" i], [aria-busy="true"]'));

export const dolaImage = o => siteSlot('dola', () => dolaRun(o));
const DOLA_CHAT = /dola\.com\/chat\/\d+/;
async function dolaRun({prompt, aspect, model, imagePath, onStatus}) {
  const chat = await siteRun('dola', () => ui(async () => {
    onStatus('открываю новый чат Dola');
    const page = await sitePage('dola');
    await page.goto(SITES.dola.home, {waitUntil: 'domcontentloaded', timeout: 60000});
    await sleep(2500);
    await assertReady(page, 'dola');
    await page.getByRole('button', {name: /Создание изображений|Image generation|Create image/i}).first().click();
    await sleep(800);
    onStatus(`настраиваю: ${model.label}, ${aspect}`);
    await page.getByRole('button', {name: /Модель|Model/}).first().click();
    await sleep(500);
    await menuItem(page, model.re).click();
    await sleep(500);
    await page.getByRole('button', {name: /Соотношение|Ratio|Aspect/i}).first().click();
    await sleep(500);
    await menuItem(page, new RegExp('^' + aspect)).click();
    await sleep(500);
    if (imagePath) {
      onStatus('прикрепляю фото-референс');
      await page.locator('input[type=file]').first().setInputFiles(imagePath);
      await sleep(4000);
    }
    const box = page.locator('[contenteditable="true"]').first();
    await box.click();
    await box.fill(prompt);
    await sleep(400);
    await page.keyboard.press('Enter');
    return chatUrlAfterSend(page, DOLA_CHAT);
  }));
  onStatus(`Dola генерирует (${model.label})`);
  const t0 = Date.now();
  // Seedream 5.0 думает дольше (1–3 мин); ждём, пока набор картинок в чате перестанет меняться
  let fresh = [], stable = 0, lastCount = -1, reply = '';
  while (Date.now() - t0 < 300000) {
    await sleep(5000);
    const st = await inChat('dola', chat, async page => {
      await captchaCheck(page, 'dola');
      return {imgs: await dolaImages(page), busy: await dolaBusy(page), reply: await dolaReplyText(page)};
    });
    fresh = st.imgs;
    reply = st.reply;
    if (!fresh.length && /Произошла ошибка\.? Повторите попытку|не могу (создать|сгенерировать)|нарушает|cannot (create|generate)/i.test(reply))
      throw new PortalError(`Dola не сделала картинку — «${reply.slice(-220)}»`, 'rejected');
    stable = !st.busy && fresh.length && fresh.length === lastCount ? stable + 1 : 0;
    lastCount = fresh.length;
    onStatus(`Dola генерирует: картинок ${fresh.length} (${Math.round((Date.now() - t0) / 1000)} с)`);
    if (stable >= 2) break;
  }
  if (!fresh.length) {
    if (/лимит|limit|quota|исчерпан|завтра|tomorrow/i.test(reply)) { markOut('dola'); throw new PortalError(`Dola: дневной лимит исчерпан — «${reply.slice(-200)}»`, 'quota'); }
    throw new PortalError(`Dola не выдала картинку за 5 минут${reply ? ` — последнее в чате: «${reply.slice(-200)}»` : ''}`, 'busy');
  }
  // оригиналы (2848 px) Dola подгружает, только когда вкладка на экране — выводим её вперёд и скачиваем
  return inChat('dola', chat, page => ui(async () => {
    await page.bringToFront().catch(() => {});
    let imgs = await dolaImages(page);
    for (let i = 0; i < 15 && imgs.some(m => m.w < 1000); i++) {
      await page.evaluate(k => [...document.images].find(img => (img.currentSrc || img.src).includes(k))?.scrollIntoView({block: 'center'}), imgs.find(m => m.w < 1000).key);
      await sleep(1000);
      imgs = await dolaImages(page);
    }
    const results = await downloadAll(page, imgs, onStatus);
    track('dola', {requests: 1, images: results.length});
    return results;
  }));
}

// ---- Dola: видео (Dreamina Seedance) ----
// Видео тратит баллы Dola (Seedance 2.0 — 2 балла); сколько осталось, Dola пишет в ответе — Freefield это запоминает.
// Фото реальных людей Dola оживлять отказывается — тогда видео делается по одному тексту.
export const DOLA_VIDEO_MODELS = {
  'seedance-2.0-fast': {label: 'Seedance 2.0 Fast', re: /Seedance 2\.0 Fast/},
  'seedance-2.5': {label: 'Seedance 2.5', re: /Seedance 2\.5/},
  'seedance-1.0': {label: 'Seedance 1.0', re: /Seedance 1\.0/},
};
export const dolaPoints = () => { const c = readState().dolaPoints; return c?.date === today() ? c.left : null; };
const dolaVideoSrcs = page => page.evaluate(() => [...document.querySelectorAll('video')]
  .map(v => v.currentSrc || v.src || v.querySelector('source')?.src || '').filter(s => /^https?:/.test(s)));
const dolaReplyText = page => page.evaluate(() => (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ').slice(-1200)).catch(() => '');
const menuItem = (page, re) => page.locator('[role=menuitem],[role=option],[role=menuitemradio]').filter({hasText: re}).first();
// ответы Dola: «Создаю видео…» (пошло), вопрос (надо подтвердить), отказ
const DOLA_STARTED = /Создаю видео|Видео будет создано|будет готово|генерир|Generating|I'?ll create|creating/i;
const DOLA_REFUSED = /В целях защиты права на образ|генерирование видео только с собой|Используйте другое изображение|нельзя генерировать|Произошла ошибка|не могу (создать|сгенерировать)|cannot (create|generate)/i;
const DOLA_ASKS = /nearest supported duration|I can generate it at|Would you like|Do you want|Could you confirm|Хотите,? чтобы|Подтвердите|Уточните|могу сделать (его|видео) (длительностью|на)/i;
async function dolaAnswer(page, seconds, aspect) {
  const box = page.locator('[contenteditable="true"]').first();
  await box.click();
  await box.fill(`Да, создай это видео: ${seconds} секунд, формат ${aspect}, по описанию выше.`);
  await sleep(300);
  await page.keyboard.press('Enter');
  await sleep(2500);
}

export const dolaVideo = o => siteSlot('dola', async () => {
  try { return await dolaVideoRun(o); } catch (e) {
    // «Произошла ошибка» — ещё раз в новом чате. Отказ по фото человека («защита права на образ») принимаем как есть:
    // Dola это видео не делает, Freefield переносит задание с тем же фото на другой сервис (runBatch → altSlot)
    if (e.kind !== 'retry') throw e;
    o.onStatus('Dola ответила «Произошла ошибка» — пробую ещё раз');
    return dolaVideoRun(o);
  }
});
async function dolaVideoRun({prompt, aspect = '9:16', seconds = 10, model = DOLA_VIDEO_MODELS['seedance-2.5'], imagePath, onStatus, timeoutMs = 900000}) {
  const chat = await siteRun('dola', () => ui(async () => {
    onStatus('открываю новый чат Dola (видео)');
    const page = await sitePage('dola');
    await page.goto(SITES.dola.home, {waitUntil: 'domcontentloaded', timeout: 60000});
    await sleep(2500);
    await assertReady(page, 'dola');
    await page.getByRole('button', {name: /^Создание видео$|^Video generation$/i}).first().click();
    await sleep(1000);
    onStatus(`настраиваю: ${model.label}, ${seconds} с, ${aspect}`);
    await page.getByRole('button', {name: /^(Модель|Model)/}).first().click();
    await sleep(600);
    await menuItem(page, model.re).click();
    await sleep(500);
    await page.getByRole('button', {name: /^\d+s$/}).first().click();
    await sleep(500);
    await menuItem(page, new RegExp(`^${seconds}s$`)).click();
    await sleep(500);
    await page.getByRole('button', {name: /^(Соотношение|Ratio|\d+:\d+)$/}).first().click();
    await sleep(500);
    await menuItem(page, new RegExp(`^${aspect}$`)).click();
    await sleep(500);
    if (imagePath) {
      onStatus('прикрепляю фото-референс');
      await page.locator('input[type=file]').first().setInputFiles(imagePath);
      await sleep(4000);   // загрузка фото в чат
    }
    const box = page.locator('[contenteditable="true"]').first();
    await box.click();
    await box.fill(prompt);
    await sleep(400);
    await page.keyboard.press('Enter');
    const url = await chatUrlAfterSend(page, DOLA_CHAT);
    // не уходим из чата, пока Dola не ответила: «Создаю видео…», вопрос (отвечаем «да») или отказ
    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      const reply = await dolaReplyText(page);
      if (DOLA_ASKS.test(reply)) { await dolaAnswer(page, seconds, aspect); continue; }
      if (DOLA_STARTED.test(reply) || DOLA_REFUSED.test(reply) || (await dolaVideoSrcs(page)).length) break;
    }
    return url;
  }));
  onStatus(`Dola генерирует видео (${model.label}, ${seconds} с)`);
  const t0 = Date.now();
  let vids = [], answered = 0;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(6000);
    const st = await inChat('dola', chat, async page => {
      await captchaCheck(page, 'dola');
      const r = {vids: await dolaVideoSrcs(page), reply: await dolaReplyText(page)};
      // Dola переспрашивает (например, про длительность) — отвечаем «да», но не больше двух раз
      if (!r.vids.length && DOLA_ASKS.test(r.reply) && answered < 2) { answered++; await ui(() => dolaAnswer(page, seconds, aspect)); r.reply = ''; }
      return r;
    });
    vids = st.vids;
    const reply = st.reply;
    const pts = reply.match(/остал\S* балл\S* на сегодня:\s*(\d+)|points? left today:\s*(\d+)/i);
    if (pts) writeState({dolaPoints: {date: today(), left: +(pts[1] ?? pts[2]), at: Date.now()}});
    if (vids.length) break;
    // Dola отказалась или сломалась — не ждём впустую, а сразу решаем, что делать
    if (/В целях защиты права на образ|генерирование видео только с собой|Используйте другое изображение|нельзя генерировать видео из изображений реальных людей|real (people|person)/i.test(reply))
      throw new PortalError('Dola не делает видео по фото людей («защита права на образ»)', 'refused');
    if (/Произошла ошибка\.? Повторите попытку|Something went wrong/i.test(reply)) throw new PortalError('Dola: «Произошла ошибка. Повторите попытку»', 'retry');
    if (/не могу (создать|сгенерировать)|не удалось создать видео|нарушает|правил[аи]? (сообщества|использования)|cannot (create|generate)|violat/i.test(reply))
      throw new PortalError(`Dola отказалась по содержанию промпта — «${reply.slice(-220)}»`, 'rejected');
    // генерация должна начаться: Dola отвечает «Создаю видео… будет готово через 1–3 минуты»
    if (Date.now() - t0 > 120000 && !/Создаю видео|Видео будет создано|будет готово|генерир|Generating|creating/i.test(reply))
      throw new PortalError(`Dola не начала генерацию за 2 минуты — «${reply.slice(-200)}»`, 'busy');
    if (/недостаточно балл|закончились балл|баллы на сегодня закончились|not enough points|out of points/i.test(reply)) {
      markOut('dola');
      throw new PortalError(`Dola: закончились баллы на сегодня — «${reply.slice(-200)}»`, 'quota');
    }
    onStatus(`Dola генерирует видео: ${Math.round((Date.now() - t0) / 1000)} с${dolaPoints() != null ? ` · осталось баллов: ${dolaPoints()}` : ''}`);
  }
  if (!vids.length) throw new PortalError(`Dola не выдала видео за ${Math.round(timeoutMs / 60000)} мин`, 'busy');
  return inChat('dola', chat, async page => {
    await sleep(2000);
    const all = await dolaVideoSrcs(page);
    const results = await downloadAll(page, all, onStatus);
    track('dola', {videos: results.length});
    return results;
  });
}

// ============================== Google Vids ==============================
// ИИ-видео в Google Vids (docs.google.com/videos): модель Omni, 720p, вертикально или горизонтально, 10 с, со звуком —
// бесплатно, в аккаунте Google пользователя (проверено 2026-09-26: ~40 с на видео). Генерации идут в ролике «Freefield»
// (Freefield один раз создаёт его сам). Готовое видео лежит в ленте панели «Видеоклип от ИИ», пока вкладка открыта, —
// Freefield сразу его скачивает, в сам ролик не вставляет. Vids просит промпт на английском.
// Два разовых шага — только сам пользователь: «умные функции Google Workspace» (если Google их попросит) и правила
// «Создание контента на основе изображений» для фото-ингредиентов. Freefield их не включает и не принимает.
export const VIDS_MODELS = {'omni': {label: 'Omni (Google Vids)', seconds: 10}};
const VIDS_FILE = /docs\.google\.com\/videos\/(u\/\d+\/)?d\/[\w-]+/;
const vidsSrcs = page => page.evaluate(() => [...document.querySelectorAll('video')].map(v => v.currentSrc || v.src || '')
  .filter(s => /usercontent\.google\.com\//.test(s)));
// текст панели «Видеоклип от ИИ» (там прогресс «Ваше видео генерируется… 35%» и ошибки)
const vidsPanelText = page => page.evaluate(() => {
  const side = [...document.querySelectorAll('div')].find(d => /^\s*Видеоклип от ИИ/.test(d.innerText || '') && d.getBoundingClientRect().width > 300 && d.getBoundingClientRect().width < 700);
  return (side?.innerText || '').replace(/\s+/g, ' ');
}).catch(() => '');
const VIDS_SMART = /включите умные функции|умные функции в Google Workspace|turn on smart features/i;
const VIDS_TERMS = /Создание контента на основе изображений|Generating content from images/i;
// Vids сегодня не готов: Google ждёт «умные функции» (тогда ничего) или правила фото-ингредиентов (тогда — задания с фото);
// пользователь может включить их в любой момент — отметка живёт до конца дня, а успешная генерация её снимает
export const vidsBlocked = (withPhoto = false) => { const st = readState(); return st.vidsNoSmart === today() || (withPhoto && st.vidsNoTerms === today()); };

// ролик «Freefield» этого профиля: запомненный, найденный на главной или новый (вертикальный, пустой)
async function vidsProject(page, onStatus) {
  const st = readState();
  if (VIDS_FILE.test(page.url()) && /^Freefield/.test(await page.title().catch(() => ''))) {
    const url = page.url().split('#')[0].replace(/\?.*$/, '');
    if (st.vidsFile !== url) writeState({vidsFile: url});
    return;
  }
  if (st.vidsFile) {
    await page.goto(st.vidsFile, {waitUntil: 'domcontentloaded', timeout: 60000}).catch(() => {});
    await sleep(6000);
    if (VIDS_FILE.test(page.url())) return;
  }
  await page.goto(SITES.vids.home, {waitUntil: 'domcontentloaded', timeout: 60000});
  await sleep(4000);
  await assertReady(page, 'vids');
  const mine = page.locator('.docs-homescreen-grid-item').filter({hasText: /^\s*Freefield/});
  if (await mine.count()) { onStatus('открываю ролик Freefield в Google Vids'); await mine.first().dblclick(); }
  else { onStatus('создаю ролик Freefield в Google Vids'); await page.locator('.docs-homescreen-templates-templateview').first().click({timeout: 15000}); }
  await page.waitForURL(VIDS_FILE, {timeout: 40000});
  await sleep(8000);
  // приветствие нового ролика: вертикальный, пустой файл
  if (await page.getByRole('dialog').filter({hasText: /Давайте начн/}).isVisible().catch(() => false)) {
    await page.getByRole('button', {name: /Создать вертикальное видео/}).click().catch(() => {});
    await sleep(800);
    await page.getByRole('button', {name: /Пустой файл Vids/}).click().catch(() => {});
    await sleep(3000);
  }
  if (!/^Freefield/.test(await page.title().catch(() => ''))) {
    const t = page.locator('input.docs-title-input').first();
    if (await t.isVisible().catch(() => false)) { await t.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('Freefield'); await page.keyboard.press('Enter'); await sleep(1500); }
  }
  writeState({vidsFile: page.url().split('#')[0].replace(/\?.*$/, '')});
}
// панель «Видеоклип от ИИ», вкладка «Создать»; окна «умных функций» и правил — не наше решение, останавливаемся
async function vidsPanel(page) {
  const open = () => page.getByRole('button', {name: /^Generation settings|^Настройки генерации/}).first().isVisible().catch(() => false);
  if (!(await open())) {
    await page.getByRole('button', {name: 'Сгенерировать видеоклип от ИИ'}).first().click({timeout: 15000});
    await sleep(3000);
  }
  await vidsDialogs(page);
  if (readState().vidsNoSmart) writeState({vidsNoSmart: null});   // панель открылась — «умные функции» уже включены
  await page.getByRole('tab', {name: 'Создать'}).first().click().catch(() => {});
  await sleep(500);
  // раскрыть поле ввода (настройки и «Ингредиенты» видны, когда оно раскрыто)
  const r = await page.evaluate(() => { const e = [...document.querySelectorAll('div[role=textbox]')].find(x => x.getBoundingClientRect().width > 0); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.x + 40, y: b.y + 10}; });
  if (!r) throw new PortalError('Google Vids: не нашёл поле для описания видео', 'busy');
  await page.mouse.click(r.x, r.y);
  await sleep(800);
}
async function vidsDialogs(page) {
  const text = await page.evaluate(() => [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(d => d.getBoundingClientRect().width > 0).map(d => d.innerText).join(' ')).catch(() => '');
  if (VIDS_SMART.test(text)) {
    writeState({vidsNoSmart: today()});
    throw new PortalError('Google Vids: для ИИ-видео Google просит включить «умные функции Google Workspace» в этом аккаунте. Это настройка приватности — включите её сами в окне Chrome Freefield (или скажите Claude, что разрешаете).', 'setup');
  }
  if (VIDS_TERMS.test(text)) {
    await page.getByRole('dialog').filter({hasText: VIDS_TERMS}).getByRole('button', {name: /^(Отмена|Cancel)$/}).click().catch(() => page.keyboard.press('Escape'));
    writeState({vidsNoTerms: today()});
    throw new PortalError('Google Vids: в этом аккаунте Google ещё не получил согласия на видео по фото (окно «Создание контента на основе изображений» — его принимаете вы сами). Задание переношу; видео по тексту Vids делает.', 'setup');
  }
}
// формат и качество: вертикальное (9:16 и прочие вертикальные) или горизонтальное; 720p по умолчанию
async function vidsSettings(page, aspect, quality = '720p') {
  const btn = page.getByRole('button', {name: /^Generation settings|^Настройки генерации/}).first();
  const label = await btn.getAttribute('aria-label', {timeout: 5000}).catch(() => '') || '';
  const [w, h] = String(aspect || '9:16').split(':').map(Number);
  const wantAr = w > h ? 'Горизонтальное' : 'Вертикальное';
  if (label.includes(wantAr) && label.includes(quality)) return label;
  await btn.click();
  await sleep(1000);
  if (!label.includes(wantAr)) { await page.getByRole('radio', {name: wantAr}).click({timeout: 5000}).catch(() => {}); await sleep(500); }
  if (!label.includes(quality)) {
    await page.getByRole('button', {name: /^(720p|1080p)$/}).first().click({timeout: 5000}).catch(() => {});
    await sleep(700);
    await page.getByRole('option', {name: quality}).first().click({timeout: 5000}).catch(() => page.keyboard.press('Escape'));
    await sleep(500);
  }
  await btn.click().catch(() => {});   // закрыть окно настроек (иначе оно перехватывает клики)
  await sleep(700);
  return await btn.getAttribute('aria-label').catch(() => label) || label;
}
// фото-ингредиенты (до 3): «Ингредиенты» → выбор файла
// прикреплённое фото — плитка «@Изображение1» с кнопкой «Удалить изображение»; первое фото — кнопка «Ингредиенты»,
// следующие — «Добавить» (aria «Добавить аватар или ингредиенты»)
async function vidsIngredients(page, files, onStatus) {
  // с 2026-09-28 Vids нумерует кнопки: «Удалить изображение 1», «Удалить изображение 2» — ищем по началу подписи
  const tiles = page.locator('button[aria-label^="Удалить изображение"], button[aria-label^="Remove image"]');
  const attached = () => tiles.count().catch(() => 0);
  for (let i = 0; i < 6 && await attached(); i++) { await tiles.first().click().catch(() => {}); await sleep(600); }   // фото от прошлого промпта
  for (const [i, file] of files.slice(0, 3).entries()) {
    onStatus(`прикрепляю фото-ингредиент ${i + 1} из ${Math.min(files.length, 3)}`);
    const had = await attached();
    const chooser = page.waitForEvent('filechooser', {timeout: 8000}).catch(() => null);
    await page.locator('button[aria-label="Ингредиенты"], button[aria-label="Ingredients"], button[aria-label="Добавить аватар или ингредиенты"]')
      .filter({visible: true}).first().click({timeout: 8000});
    await sleep(1500);
    await vidsDialogs(page);
    let fc = await chooser;
    if (!fc) {   // вместо окна выбора файла — меню («Загрузить» / «С компьютера»)
      const up = page.getByRole('menuitem', {name: /Загрузить|С компьютера|Upload|computer/i})
        .or(page.locator('button[aria-label="Загрузить"], button[aria-label="Upload"]')).filter({visible: true}).first();
      if (await up.isVisible().catch(() => false)) {
        const ch2 = page.waitForEvent('filechooser', {timeout: 8000}).catch(() => null);
        await up.click();
        fc = await ch2;
      }
    }
    if (fc) await fc.setFiles(file);
    else await page.locator('input[type=file][accept*="image"]').first().setInputFiles(file);
    for (let t = 0; t < 30 && (await attached()) <= had; t++) await sleep(1000);
    if ((await attached()) <= had) throw new PortalError('Google Vids: фото героя не прикрепилось — задание переношу', 'busy');
  }
  if (readState().vidsNoTerms) writeState({vidsNoTerms: null});
}

export const vidsVideo = o => siteSlot('vids', () => vidsRun(o));
async function vidsRun({prompt, aspect = '9:16', quality = '720p', imagePaths = [], onStatus = () => {}, timeoutMs = 480000}) {
  let before;
  await siteRun('vids', () => ui(async () => {
    onStatus('открываю Google Vids');
    const page = await sitePage('vids');
    if (!VIDS_FILE.test(page.url())) { await page.goto(SITES.vids.home, {waitUntil: 'domcontentloaded', timeout: 60000}); await sleep(3000); }
    await assertReady(page, 'vids');
    await vidsProject(page, onStatus);
    await assertReady(page, 'vids');
    await vidsPanel(page);
    const label = await vidsSettings(page, aspect, quality);
    onStatus(`настраиваю: ${label.replace(/^(Generation settings|Настройки генерации):\s*/, '') || 'Omni'}`);
    // поле ввода: прошлый промпт — стираем
    const clear = page.getByRole('button', {name: /^(Очистить|Clear)$/}).first();
    if (await clear.isVisible().catch(() => false)) { await clear.click().catch(() => {}); await sleep(600); }
    if (imagePaths.length) await vidsIngredients(page, imagePaths, onStatus);
    // с фото Vids сам ставит в начало поля плашку «@Изображение1» — клик туда попадает в плашку и текст не вписывается;
    // поэтому курсор ставим в конец поля без клика
    const boxLen = () => page.evaluate(() => [...document.querySelectorAll('div[role=textbox]')].map(e => e.innerText.trim()).join('').length);
    const had = await boxLen();
    await page.evaluate(() => {
      const e = [...document.querySelectorAll('div[role=textbox]')].find(x => x.getBoundingClientRect().width > 0);
      e.focus();
      const r = document.createRange(); r.selectNodeContents(e); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    // Vids рисует ёлочки «» прямо в кадре — текст для экрана даём в обычных кавычках "…" (так модель понимает, что это надпись)
    await page.keyboard.insertText(prompt.replace(/«([^«»\n]*)»/g, '"$1"'));   // без нажатий клавиш: перевод строки не отправит запрос раньше времени
    await sleep(800);
    if ((await boxLen()) - had < Math.min(20, prompt.length)) throw new PortalError('Google Vids: промпт не вписался в поле — посмотрите в окно Chrome Freefield', 'busy');
    before = new Set(await vidsSrcs(page));
    const go = page.locator('button.collapsiblePromptBoxGenerateButton, button[aria-label="Сгенерировать"]').last();
    for (let i = 0; i < 10 && !(await go.isEnabled().catch(() => false)); i++) await sleep(1000);
    await go.click({timeout: 8000});
    await sleep(2500);
    await vidsDialogs(page);
  }));
  onStatus('Google Vids генерирует (Omni)');
  const t0 = Date.now();
  let src = null, text = '';
  while (Date.now() - t0 < timeoutMs) {
    await sleep(5000);
    const st = await siteRun('vids', async () => {
      const page = await sitePage('vids', false);
      await captchaCheck(page, 'vids');
      return {srcs: await vidsSrcs(page), text: await vidsPanelText(page)};
    });
    text = st.text;
    const pct = text.match(/генерируется[^%]*?(\d{1,3})\s?%/i)?.[1];
    src = st.srcs.find(s => !before.has(s));
    if (src && !pct) break;
    if (/(исчерпал|достигли|закончил)\S*[^.]{0,60}(лимит|квот)|limit reached|quota/i.test(text)) { markOut('vids'); throw new PortalError(`Google Vids: лимит ИИ-видео на сегодня — «${text.match(/[^.]*(лимит|limit|квот)[^.]*\./i)?.[0] || ''}»`, 'quota'); }
    if (/Не удалось (создать|сгенерировать)|не можем создать|нарушает|Couldn.t generate|violat|Попробуйте другой запрос/i.test(text) && !pct)
      throw new PortalError(`Google Vids не сделал видео — «${text.match(/[^.]*(Не удалось|не можем|нарушает|Couldn.t|violat|другой запрос)[^.]*\.?/i)?.[0] || ''}»`, 'rejected');
    onStatus(`Google Vids генерирует: ${pct ? pct + '% · ' : ''}${Math.round((Date.now() - t0) / 1000)} с`);
  }
  if (!src) throw new PortalError(`Google Vids не выдал видео за ${Math.round(timeoutMs / 60000)} мин`, 'busy');
  return siteRun('vids', async () => {
    const page = await sitePage('vids', false);
    onStatus('скачиваю видео');
    const results = await downloadAll(page, [src], onStatus, () => ({label: 'Omni · Google Vids'}));
    track('vids', {videos: results.length});
    markSynced('vids', [vidsId(src)]);   // синхронизация второй раз его не заберёт
    return results;
  });
}
const vidsId = src => { try { return (new URL(src).searchParams.get('c') || src).slice(-48); } catch { return src.slice(-48); } };
// Синхронизация: видео из ленты «Видеоклип от ИИ» в ролике «Freefield», которые Freefield ещё не забрал (например, после
// перезапуска посреди генерации). В ролике «Freefield» — только генерации Freefield. Лента живёт, пока вкладка открыта.
export const vidsSync = ({onStatus = () => {}} = {}) => siteRun('vids', async () => {
  const file = readState().vidsFile;
  if (!file) return [];
  const page = (await profilePages()).find(p => p.url().startsWith(file));
  if (!page) return [];
  const done = syncedSet('vids'), out = [];
  for (const src of await vidsSrcs(page)) {
    const id = vidsId(src);
    if (done.has(id)) continue;
    onStatus('Google Vids: забираю видео');
    try { out.push({site: 'vids', kind: 'video', id, title: 'Google Vids', mime: 'video/mp4', ...(await download(page, src))}); } catch {}
  }
  return out;
});

// ============================== Arena (arena.ai) ==============================
// Видео на Arena — только «битва»: один промпт → два видео от двух случайных анонимных моделей
// (Veo, Kling, Seedance, Hailuo…). Имена моделей Arena показывает после голосования на сайте — Freefield не голосует.
// Картинки — тоже «битва»: две картинки от двух моделей, их имена Arena пишет над картинками сразу.
const arenaVideos = page => page.evaluate(() => [...document.querySelectorAll('video')]
  .map(v => v.currentSrc || v.src || v.querySelector('source')?.src || '')
  .filter(s => /^https:\/\/[^/]*cloudflarestorage\.com\/.+\.mp4/.test(s)));
// ответы моделей стоят в «карусели» (фото-референс пользователя — в его сообщении, не в ней); подпись — имя модели
const arenaImages = page => page.evaluate(() => [...document.images]
  .filter(i => /^https:\/\/[^/]*cloudflarestorage\.com\/.+\.(jpe?g|png|webp)(\?|$)/i.test(i.currentSrc || i.src) && i.naturalWidth >= 256 && i.closest('[class*="carousel"]'))
  .map(i => {
    let label = '';
    for (let e = i.parentElement, k = 0; e && k < 10; e = e.parentElement, k++) {
      const t = e.innerText.replace(/\s+/g, ' ').trim();
      if (t) { if (t.length < 120) label = t.replace(/\s*(Edit|Изменить)$/i, ''); break; }
    }
    return {src: i.currentSrc || i.src, key: (i.currentSrc || i.src).split('?')[0], label};
  }));
const arenaState = page => page.evaluate(() => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const main = document.querySelector('main') || document.body;
  const text = main.innerText || '';
  return {
    generating: /Generating (video|image)|Генерир/i.test(text) || [...document.querySelectorAll('button')].some(b => vis(b) && /Stop generation/i.test(b.getAttribute('aria-label') || b.innerText)),
    error: [...document.querySelectorAll('[role="alert"], [data-sonner-toast], [class*="error" i], [class*="toast" i]')].filter(vis)
      .map(e => e.innerText.trim()).filter(s => s && s.length < 400).pop() || '',
    tail: text.replace(/\s+/g, ' ').slice(-300),
    // «You've reached the video rate limit. Please try again in 10 hours.»
    limit: (text.replace(/\s+/g, ' ').match(/You'?ve reached [^.]*limit\.(?:\s*Please try again in [^.]*\.)?|лимит[^.]*\./i) || [''])[0],
  };
});

// новый чат Arena в нужном режиме (Video / Image): фото-референс, промпт, отправка — и ждём, пока «битва» начнётся
function arenaStart({mode, prompt, imagePath, onStatus, has}) {
  return siteRun('arena', () => ui(async () => {
    onStatus(`открываю новый чат Arena (${mode === 'Image' ? 'картинки' : 'видео'})`);
    const page = await sitePage('arena');
    await page.goto(`https://arena.ai/${mode.toLowerCase()}`, {waitUntil: 'domcontentloaded', timeout: 60000});
    await sleep(2500);
    await assertReady(page, 'arena');
    const modality = page.getByRole('button', {name: /^Modality/});
    if (!new RegExp(mode, 'i').test(await modality.getAttribute('aria-label').catch(() => '') || '')) {
      await modality.click();
      await sleep(500);
      await page.getByRole('button', {name: new RegExp('^' + mode)}).click();
      await sleep(800);
    }
    if (imagePath) {
      onStatus('прикрепляю картинку');
      await page.locator('input[type=file]').first().setInputFiles(imagePath);
      await page.getByRole('button', {name: 'Remove file'}).first().waitFor({timeout: 30000})
        .catch(() => { throw new PortalError('Arena не приняла картинку (нужен png, jpg или webp)', 'ui'); });
    }
    const box = page.locator(`textarea[placeholder^="Describe"], textarea[placeholder*="${mode}" i]`).first();
    await box.click();
    await box.fill(prompt.slice(0, 2500));
    await sleep(400);
    await page.getByRole('button', {name: 'Send message'}).click();
    // лимит Arena показывает сразу, вместо чата
    await sleep(2500);
    const lim = (await arenaState(page)).limit;
    if (lim) { markOut('arena'); throw new PortalError(`Arena: ${lim}`, 'quota'); }
    const url = await chatUrlAfterSend(page, /arena\.ai\/c\//);
    // не уходим из чата, пока «битва» не началась, — иначе Arena теряет сессию («Session not found»)
    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      const st = await arenaState(page);
      if (st.limit) { markOut('arena'); throw new PortalError(`Arena: ${st.limit}`, 'quota'); }
      if (/rate limit/i.test(st.error)) throw new PortalError(`Arena: ${st.error}`, 'busy');
      if (st.generating || await has(page)) break;
    }
    return url;
  }));
}

export const arenaImage = o => siteSlot('arena', () => arenaImageRun(o));
async function arenaImageRun({prompt, imagePath, onStatus, timeoutMs = 300000}) {
  const chat = await arenaStart({mode: 'Image', prompt, imagePath, onStatus, has: async page => (await arenaImages(page)).length > 0});
  const t0 = Date.now();
  let imgs = [], idle = 0;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(5000);
    const st = await inChat('arena', chat, async page => {
      await captchaCheck(page, 'arena');
      return {imgs: await arenaImages(page), ...(await arenaState(page))};
    });
    imgs = [...new Map(st.imgs.map(x => [x.key, x])).values()];
    onStatus(`Arena рисует 2 картинки: готово ${imgs.length} из 2 (${Math.round((Date.now() - t0) / 1000)} с)`);
    if (imgs.length >= 2 && !st.generating) break;
    if (st.limit) { markOut('arena'); throw new PortalError(`Arena: ${st.limit}`, 'quota'); }
    idle = st.generating ? 0 : idle + 1;
    if (idle >= 4 && Date.now() - t0 > 30000) {
      if (imgs.length) break;
      throw new PortalError(`Arena не нарисовала картинку${st.error ? ': ' + st.error : ` — в чате: «${st.tail.slice(-200)}»`}`, /limit|лимит|quota/i.test(st.error + st.tail) ? 'quota' : 'busy');
    }
  }
  if (!imgs.length) throw new PortalError(`Arena не выдала картинок за ${Math.round(timeoutMs / 1000)} с — посмотрите в окно Chrome Freefield`, 'busy');
  return inChat('arena', chat, async page => {
    await sleep(1000);
    const all = [...new Map((await arenaImages(page)).map(x => [x.key, x])).values()];
    const results = await downloadAll(page, all, onStatus, (x, i) => ({label: x.label || `Ассистент ${'AB'[i] || i + 1}`}));
    track('arena', {requests: 1, images: results.length});
    return {results, chat};
  });
}

export const arenaVideo = o => siteSlot('arena', () => arenaRun(o));
async function arenaRun({prompt, imagePath, onStatus, timeoutMs = 600000}) {
  const chat = await arenaStart({mode: 'Video', prompt, imagePath, onStatus, has: async page => (await arenaVideos(page)).length > 0});
  const t0 = Date.now();
  let vids = [], idle = 0;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(6000);
    const st = await inChat('arena', chat, async page => {
      await captchaCheck(page, 'arena');
      return {vids: [...new Set(await arenaVideos(page))], ...(await arenaState(page))};
    });
    vids = st.vids;
    onStatus(`Arena генерирует 2 видео: готово ${vids.length} из 2 (${Math.round((Date.now() - t0) / 1000)} с)`);
    if (vids.length >= 2 && !st.generating) break;
    if (st.limit) { markOut('arena'); throw new PortalError(`Arena: ${st.limit}`, 'quota'); }
    idle = st.generating ? 0 : idle + 1;
    // генерация не идёт и видео нет — ошибка или лимит; одно видео без второго — отдаём, что есть
    if (idle >= 4 && Date.now() - t0 > 30000) {
      if (vids.length) break;
      if (/limit|лимит|quota/i.test(st.error + st.tail)) markOut('arena');
      throw new PortalError(`Arena не сгенерировала видео${st.error ? ': ' + st.error : ` — в чате: «${st.tail.slice(-200)}»`}`, /limit|лимит|quota/i.test(st.error + st.tail) ? 'quota' : 'busy');
    }
  }
  if (!vids.length) throw new PortalError(`Arena не выдала видео за ${Math.round(timeoutMs / 1000)} с — посмотрите в окно Chrome Freefield`, 'busy');
  return inChat('arena', chat, async page => {
    await sleep(1500);
    const all = [...new Set(await arenaVideos(page))];
    const results = await downloadAll(page, all, onStatus, (x, i) => ({label: `Ассистент ${'AB'[i] || i + 1}`}));
    track('arena', {requests: 1, videos: results.length});
    return {results, chat};
  });
}

// Dola: готовые видео и картинки из последних чатов (список слева), которых ещё нет в Freefield.
// Чат, где видео ещё делается («Создаю видео…» без видео), не отмечаем — проверим в следующий раз.
export const dolaSync = ({onStatus = () => {}, limit = 12} = {}) => siteRun('dola', () => ui(async () => {
  const page = await sitePage('dola');
  await page.goto(SITES.dola.home, {waitUntil: 'domcontentloaded', timeout: 60000});
  await sleep(3000);
  await assertReady(page, 'dola');
  const chats = (await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/chat/"]')].map(a => a.getAttribute('href')).filter(h => /^\/chat\/\d+$/.test(h)))]))
    .slice(0, limit).map(h => 'https://www.dola.com' + h);
  const done = syncedSet('dola'), ours = oursSet('dola');
  const out = [];
  for (const url of chats) {
    const id = url.split('/chat/')[1];
    if (done.has(id) || !ours.has(id)) continue;   // чужие чаты (пользователь писал сам) не трогаем
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000}).catch(() => {});
    await sleep(4000);
    const vids = await dolaVideoSrcs(page);
    let imgs = await dolaImages(page);
    const reply = await dolaReplyText(page);
    if (!vids.length && DOLA_STARTED.test(reply) && !DOLA_REFUSED.test(reply)) continue;   // ещё генерируется
    // оригиналы картинок подгружаются, только когда вкладка на экране
    for (let i = 0; i < 10 && imgs.some(m => m.w < 1000); i++) {
      await page.evaluate(k => [...document.images].find(img => (img.currentSrc || img.src).includes(k))?.scrollIntoView({block: 'center'}), imgs.find(m => m.w < 1000).key);
      await sleep(1000);
      imgs = await dolaImages(page);
    }
    const title = (await page.title()).replace(/\s*[-—|]\s*Dola.*$/i, '').trim() || 'из Dola';
    for (const [i, src] of vids.entries()) {
      onStatus(`Dola: забираю видео «${title}»`);
      try { out.push({site: 'dola', kind: 'video', id: `${id}:v${i}`, title, ...(await download(page, src))}); } catch {}
    }
    for (const m of imgs) {
      onStatus(`Dola: забираю картинку «${title}»`);
      try { out.push({site: 'dola', kind: 'image', id: `${id}:${m.key}`, title, ...(await download(page, m.src))}); } catch {}
    }
    markSynced('dola', [id]);
  }
  return out;
}));

// Arena: готовые видео из последних чатов (боковая панель), которых ещё нет в Freefield
export const arenaSync = ({onStatus = () => {}, limit = 10} = {}) => siteRun('arena', async () => {
  const page = await sitePage('arena', false);
  await page.goto(SITES.arena.home, {waitUntil: 'domcontentloaded', timeout: 60000});
  await sleep(2500);
  await assertReady(page, 'arena');
  const links = () => page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/c/"]')].map(a => a.href.split('#')[0]))]);
  let chats = await links();
  if (!chats.length) {   // боковая панель свёрнута — берём список со страницы истории
    await page.goto('https://arena.ai/history/search', {waitUntil: 'domcontentloaded', timeout: 60000}).catch(() => {});
    await sleep(3500);
    chats = await links();
  }
  chats = chats.slice(0, limit);
  const done = syncedSet('arena'), ours = oursSet('arena');
  const out = [];
  for (const url of chats) {
    const id = chatId(url)?.id;
    if (!id || done.has(id) || !ours.has(id)) continue;   // только чаты, которые создал Freefield
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60000}).catch(() => {});
    await sleep(3500);
    const st = await arenaState(page);
    if (st.generating) continue;   // ещё генерируется — заберём в следующий раз
    const vids = [...new Set(await arenaVideos(page))];
    const imgs = [...new Map((await arenaImages(page)).map(x => [x.key, x])).values()];
    const title = (await page.title()).replace(/\s*[|—-]\s*Arena.*$/i, '').trim();
    for (const [i, src] of vids.entries()) {
      onStatus(`Arena: забираю видео «${title}» (${i + 1} из ${vids.length})`);
      try { out.push({site: 'arena', kind: 'video', id: `${id}:${i}`, title: title || 'из Arena', label: `Ассистент ${'AB'[i] || i + 1}`, ...(await download(page, src))}); } catch {}
    }
    for (const [i, x] of imgs.entries()) {
      onStatus(`Arena: забираю картинку «${title}» (${i + 1} из ${imgs.length})`);
      try { out.push({site: 'arena', kind: 'image', id: `${id}:i${i}`, title: title || 'из Arena', label: x.label || `Ассистент ${'AB'[i] || i + 1}`, ...(await download(page, x.src))}); } catch {}
    }
    markSynced('arena', [id]);   // готовый чат (с видео или без) больше не проверяем
  }
  return out;
});

// ============================== смена аккаунта ==============================
// Freefield открывает выбор аккаунта (Flow) или выходит из текущего (Arena, Dola) и показывает вход —
// другой аккаунт выбирает и вводит сам пользователь. Пароли Freefield не вводит.
export const switchAccount = site => siteRun(site, () => ui(async () => {
  const page = await sitePage(site);
  if (site === 'vids') {
    await page.goto('https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(SITES.vids.home), {waitUntil: 'domcontentloaded', timeout: 60000});
    writeState({vidsFile: null, vidsNoSmart: null, vidsNoTerms: null});
    return 'В окне Chrome Freefield открыт выбор аккаунта Google для Google Vids — выберите другой аккаунт. Freefield заведёт в нём свой ролик «Freefield».';
  }
  if (site === 'flow') {
    await page.goto('https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(SITES.flow.home), {waitUntil: 'domcontentloaded', timeout: 60000});
    writeState({flowProject: null, flowCredits: null});
    return 'В окне Chrome Freefield открыт выбор аккаунта Google для Flow — выберите другой аккаунт или «Добавить аккаунт». ' +
      'Freefield заведёт на нём новый проект и заново прочитает кредиты.';
  }
  if (site === 'arena') {
    const user = page.getByRole('button', {name: /@/}).first();   // кнопка с почтой внизу боковой панели
    if (await user.isVisible().catch(() => false)) {
      await user.click();
      await sleep(800);
      await page.getByRole('button', {name: /^(Sign Out|Выйти)$/i}).click({timeout: 5000});
      await sleep(2500);
    }
    await page.getByRole('button', {name: /^(Log ?in|Sign ?in|Войти)$/i}).first().click({timeout: 8000}).catch(() => {});
    writeState({siteOut: {...readState().siteOut, arena: null}});
    return 'Вышел из Arena. В окне Chrome Freefield войдите другим аккаунтом (например, «Continue with Google» → другой аккаунт).';
  }
  // Dola: «Настройки» → «Выйти» (+ подтверждение, если спросит)
  await page.getByRole('button', {name: /^(Настройки|Settings)$/}).first().click({timeout: 8000});
  await sleep(1200);
  await page.getByText(/^(Выйти|Log out|Sign out)$/i).last().click({timeout: 5000});
  await sleep(1200);
  const confirm = page.getByRole('dialog').getByRole('button', {name: /^(Выйти|Log out|Sign out|Подтвердить|Confirm|OK)$/i}).first();
  if (await confirm.isVisible().catch(() => false)) { await confirm.click(); await sleep(1500); }
  writeState({siteOut: {...readState().siteOut, dola: null}});
  return 'Вышел из Dola. В окне Chrome Freefield войдите другим аккаунтом.';
}));

// Подготовить сайт ко входу: открыть его; если вход не выполнен — сразу страницу входа (входит сам пользователь)
export const prepareLogin = site => siteRun(site, () => ui(async () => {
  const page = await sitePage(site);
  try {
    await assertReady(page, site);
    return {site, ok: true, message: `${SITES[site].name}: вход уже выполнен`};
  } catch (e) {
    if (e.kind !== 'login') return {site, ok: false, message: e.message};
  }
  if (site === 'flow') {
    await page.goto('https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(SITES.flow.home), {waitUntil: 'domcontentloaded', timeout: 60000});
    return {site, ok: false, login: true, message: `${SITES[site].name}: войдите`};
  }
  const r = await googleLogin(page, site);
  return {site, ...r, login: !r.loggedIn};
}));

// Первая видимая кнопка из подходящих (у Dola и Arena есть скрытые копии кнопок)
async function clickVisible(loc) {
  const n = await loc.count();
  for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible().catch(() => false)) { await loc.nth(i).click(); return true; }
  return false;
}
// Что сейчас на странице Google: выбор аккаунта (почты), пароль / код, подтверждение первого входа на сайт
const googleState = g => g.evaluate(() => {
  const v = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const emails = [...new Set([...document.querySelectorAll('[data-identifier],[data-email]')].filter(v)
    .map(e => e.getAttribute('data-identifier') || e.getAttribute('data-email')).filter(s => s && s.includes('@')))];
  const btn = [...document.querySelectorAll('button,[role=button]')].filter(v).map(b => b.innerText.trim());
  const text = document.body.innerText;
  return {url: location.href, emails, error: /That.s an error|Произошла ошибка/i.test(text),
    // «Повторный вход в приложение …» — сайт уже привязан к этому аккаунту, новых разрешений не просит
    relogin: /Повторный вход|Sign back in|Sign in again|Welcome back/i.test(text) && btn.some(t => /^(Продолжить|Continue)$/i.test(t)),
    password: !!document.querySelector('input[type=password]:not([aria-hidden=true])') || /\/challenge\//.test(location.pathname),
    email: [...document.querySelectorAll('input[type=email]')].some(v),
    consent: /consent/.test(location.pathname) || (!emails.length && btn.some(t => /^(Продолжить|Continue|Разрешить|Allow)$/i.test(t)))};
});
// Вход в Dola / Arena через Google: «Войти» → «Продолжить с Google» → аккаунт Google, в который уже вошли в этом профиле Chrome.
// Пароли Freefield не вводит и новые разрешения за пользователя не выдаёт: если Google просит пароль или код, подтвердить
// первый вход этим аккаунтом на сайт («Продолжить» — это ещё и создание аккаунта на сайте) или выбрать один из нескольких
// аккаунтов, а какой — не сказано, — окно Google остаётся открытым для пользователя (почты аккаунтов уходят в приложение кнопками).
async function googleLogin(page, site, email, retry = false) {
  const name = SITES[site].name;
  // недоделанные окна входа Google от прошлых попыток — закрываем (по одной вкладке на сервис)
  for (const x of await profilePages()) if (x !== page && /accounts\.google\.com\/signin\/oauth/.test(x.url())) await x.close().catch(() => {});
  await page.goto(SITES[site].home, {waitUntil: 'domcontentloaded', timeout: 60000});
  await sleep(3000);
  try { await assertReady(page, site); return {ok: true, loggedIn: true, message: `${name}: вход уже выполнен`}; }
  catch (e) { if (e.kind !== 'login') return {ok: false, message: e.message}; }
  const exp = page.getByRole('button', {name: /^Expand sidebar$/});   // у Arena кнопка входа — в свёрнутой боковой панели
  if (await exp.isVisible().catch(() => false)) { await exp.click().catch(() => {}); await sleep(800); }
  const google = /^(Continue with Google|Продолжить с Google|Войти через Google|Sign in with Google)$/i;
  if (!(await page.getByRole('button', {name: google}).first().isVisible().catch(() => false))) {
    await clickVisible(page.getByRole('button', {name: /^(Log ?In|Sign ?In|Войти)$/i})).catch(() => {});
    await sleep(1800);
  }
  const popup = page.context().waitForEvent('page', {timeout: 12000}).catch(() => null);
  if (!(await clickVisible(page.getByRole('button', {name: google})).catch(() => false)))
    return {ok: false, message: `${name}: не нашёл «Продолжить с Google» — войдите в окне Chrome Freefield`};
  let g = await Promise.race([popup, sleep(6000).then(() => null)]);
  if (!g && /accounts\.google\./.test(page.url())) g = page;   // вход без отдельного окна — переход на страницу Google
  for (let i = 0; g && i < 20; i++) {
    if (g.isClosed() || (g === page && !/accounts\.google\./.test(page.url()))) break;   // Google отпустил — вернулись на сайт
    await g.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(1200);
    if (g.isClosed()) break;
    const st = await googleState(g).catch(() => null);
    if (!st) continue;
    if (st.error) { if (g !== page) await g.close().catch(() => {}); break; }
    if (st.relogin) {   // повторный вход тем же аккаунтом — подтверждаем, как просил пользователь
      await g.getByRole('button', {name: /^(Продолжить|Continue)$/i}).first().click().catch(() => {});
      await sleep(2500);
      continue;
    }
    if (st.emails.length) {
      const pick = email ? st.emails.find(x => x.toLowerCase() === email.toLowerCase()) : st.emails.length === 1 ? st.emails[0] : null;
      if (!pick) {
        await g.bringToFront().catch(() => {});
        return {ok: false, choose: st.emails, message: `${name}: выберите аккаунт Google — в приложении или в окне Chrome Freefield`};
      }
      await g.locator(`[data-identifier="${pick}"], [data-email="${pick}"]`).first().click().catch(() => {});
      await sleep(2500);
      continue;
    }
    if (st.password || st.email) {
      await g.bringToFront().catch(() => {});
      return {ok: false, message: `${name}: Google просит ${st.password ? 'пароль или код' : 'почту аккаунта'} — введите сами в окне Chrome Freefield, потом нажмите «Я вошёл»`};
    }
    if (st.consent) {
      await g.bringToFront().catch(() => {});
      return {ok: false, message: `${name}: этим аккаунтом Google сюда ещё не входили — подтвердите вход («Продолжить») в окне Chrome Freefield, потом нажмите «Я вошёл»`};
    }
  }
  // вернулись на сайт — ждём, пока он узнает аккаунт (страницу Google не перезагружаем: одноразовая ссылка входа от этого ломается — «400»)
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    if (/accounts\.google\./.test(page.url())) {
      if (/That.s an error|Произошла ошибка/i.test(await page.innerText('body').catch(() => ''))) break;
      continue;
    }
    if (i === 4) await page.reload({waitUntil: 'domcontentloaded'}).catch(() => {});
    try { await assertReady(page, site); return {ok: true, loggedIn: true, message: `${name}: вход выполнен через Google${email ? ' (' + email + ')' : ''}`}; }
    catch (e) { if (e.kind !== 'login') return {ok: false, message: e.message}; }
  }
  // Google показал ошибку или вход повис — один раз начинаем заново
  if (!retry) return googleLogin(page, site, email, true);
  await page.bringToFront().catch(() => {});
  return {ok: false, message: `${name}: вход не завершился — проверьте окно Chrome Freefield`};
}

// «Открыть этот профиль»: во вкладке Flow — выбор аккаунта Google. Аккаунт выбирает пользователь; какой — узнаём по его клику
// в списке (почта), чтобы потом войти им же в Dola и Arena. wait() — ждёт выбора до 5 минут и отдаёт почту (или null).
let lastPick = null;
export const chooseGoogleAccount = ({gather = false} = {}) => siteRun('flow', () => ui(async () => {
  // три сервиса — тремя вкладками в одном окне: переносим отбившиеся (если генерации не идут) и открываем недостающие
  if (gather) await oneWindow().catch(() => {});
  for (const s of ['dola', 'arena']) await sitePage(s, false).catch(() => {});
  const page = await sitePage('flow');
  if (!page.__ffPick) {
    page.__ffPick = true;
    await page.exposeFunction('ffPicked', email => { lastPick = {email, at: Date.now()}; }).catch(() => {});
  }
  const t0 = Date.now();
  await page.goto('https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(SITES.flow.home), {waitUntil: 'domcontentloaded', timeout: 60000});
  await page.bringToFront().catch(() => {});
  await sleep(1500);
  const listen = () => page.evaluate(() => {
    if (window.__ffPickOn) return; window.__ffPickOn = true;
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-identifier],[data-email]');
      const email = el && (el.getAttribute('data-identifier') || el.getAttribute('data-email'));
      if (email && email.includes('@') && window.ffPicked) window.ffPicked(email);
    }, true);
  }).catch(() => {});
  await listen();
  return {page, async wait(timeoutMs = 300000) {
    while (Date.now() - t0 < timeoutMs) {
      await sleep(1500);
      if (page.isClosed()) return null;
      if (!/accounts\.google\./.test(page.url())) return lastPick?.at > t0 ? lastPick.email : null;   // выбрал — ушли на Flow
      await listen();   // страница Google могла смениться (например, «Сменить аккаунт»)
    }
    return null;
  }};
}));

// Кнопка «Войти» в приложении: Dola и Arena — вход через Google сам (email — какой аккаунт выбрать, если их несколько);
// Flow — открыть выбор аккаунта Google (Flow работает под аккаунтом Google этого профиля Chrome)
export const openLogin = (site, {email} = {}) => siteRun(site, () => ui(async () => {
  const page = await sitePage(site);
  if (site === 'vids') {   // Vids — тот же аккаунт Google: выбор аккаунта, потом Vids
    await page.goto('https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(SITES.vids.home), {waitUntil: 'domcontentloaded', timeout: 60000});
    return {ok: true, message: 'В окне Chrome Freefield открыт вход в Google для Google Vids — выберите аккаунт.'};
  }
  if (site === 'flow') {
    await page.goto('https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(SITES.flow.home), {waitUntil: 'domcontentloaded', timeout: 60000});
    return {ok: true, message: 'В окне Chrome Freefield открыт вход в Google для Flow — выберите аккаунт или добавьте новый.'};
  }
  return googleLogin(page, site, email);
}));

// Сайт сообщил, что дневной лимит исчерпан — до конца дня планировщик отправляет задания на другие сайты
export const siteOut = site => readState().siteOut?.[site] === today();
function markOut(site) { writeState({siteOut: {...readState().siteOut, [site]: today()}}); }
