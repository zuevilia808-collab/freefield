// Окна профилей Chrome (просьба пользователя): у каждого профиля — своё окно с Flow, Dola и Arena вкладками, окна разных
// профилей открыты рядом (ничего не закрывается). В каждом сервисе, где вход не выполнен, открыто окно входа. Входит сам
// пользователь: Freefield только открывает окна — пароли не вводит и аккаунт Google за него не выбирает.
//   «↪ Открыть этот профиль» — окно одного профиля; «＋ Добавить профиль для входа» — окно нового профиля Chrome;
//   «🪟 Открыть все профили» — окна всех профилей сразу.
// Работает через «сырой» протокол отладки Chrome (bridge.rawCdp): он различает вкладки разных профилей, а playwright — нет.
import fs from 'node:fs';
import path from 'node:path';
import {rawCdp, openWindow, chromeProfiles, startChrome, profileDirOf, PROFILE, blankUrl as blank, openProfilesNow} from './bridge.js';
import {withProfile, readAcct, writeAcct, writeState, readState, profileName} from './state.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
export const SITE_URLS = {flow: 'https://flow.google.com/', dola: 'https://www.dola.com/chat/', arena: 'https://arena.ai/video', vids: 'https://docs.google.com/videos/?authuser=0'};
const NAMES = {flow: 'Flow', dola: 'Dola', arena: 'Arena', vids: 'Vids'};
const SITE_COUNT = Object.keys(SITE_URLS).length;
const siteOf = url => /accounts\.google\./.test(url) ? null : /flow\.google\.com/.test(url) ? 'flow' : /dola\.com/.test(url) ? 'dola' : /arena\.ai/.test(url) ? 'arena' : /docs\.google\.com\/videos/.test(url) ? 'vids' : null;
// ролик в Vids (свой у пользователя или «Freefield»): такие вкладки не закрываем — невставленные ИИ-клипы в них пропали бы
const vidsFile = url => /docs\.google\.com\/videos\/(u\/\d+\/)?d\//.test(url);
const FLOW_LOGIN = 'https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(SITE_URLS.flow);
const VIDS_LOGIN = 'https://accounts.google.com/AccountChooser?continue=' + encodeURIComponent(SITE_URLS.vids);

// Страница сервиса: что на ней видно (act — что нажать: cookies, expand, login, google)
const pageJs = (site, act) => `(() => {
  const site = ${JSON.stringify(site)}, act = ${JSON.stringify(act || '')};
  // вкладка в фоне: Arena тогда не рисует страницу (у кнопок нулевой размер) — смотрим только на скрытие стилями
  const bg = document.visibilityState === 'hidden';
  const vis = e => {
    if (e.checkVisibility && !e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && (bg || (r.width > 0 && r.height > 0));
  };
  const label = b => (b.innerText || b.getAttribute('aria-label') || b.textContent || '').trim();
  const btn = re => [...document.querySelectorAll('button,[role=button],a')].filter(vis).find(b => re.test(label(b)));
  const text = document.body ? document.body.innerText : '';
  const B = {
    cookies: btn(/^(Accept Cookies|Accept all( cookies)?|Принять все( файлы cookie)?)$/i),
    expand: site === 'arena' ? btn(/^Expand sidebar$/i) : null,
    google: btn(/^(Continue with Google|Продолжить с Google|Войти через Google|Sign in with Google)$/i),
    login: btn(/^(Log ?in|Sign ?in|Войти)$/i),
  };
  if (act) { if (B[act]) { B[act].click(); return true; } return false; }
  const google = /accounts\\.google\\./.test(location.host);
  // явные признаки: вошли (Flow — список проектов, Dola — «Настройки» в боковой панели, Arena — кнопка с почтой)
  // или не вошли (Flow — страница /about, Dola и Arena — кнопка «Войти» / окно входа)
  const inMark = !google && (site === 'flow' ? /Новый проект|New project/i.test(text)
    : site === 'vids' ? !!document.querySelector('[aria-label*="Аккаунт Google" i],[aria-label*="Google Account" i]')
    : site === 'dola' ? !!btn(/^(Настройки|Settings)$/i) : !!btn(/@/));
  // Vids без входа уходит на страницу входа Google (google = true) или на рекламную страницу /about
  const outMark = google || (site === 'vids' ? /\\/about/.test(location.pathname) : site === 'flow' ? /\\/about/.test(location.pathname)
    : !!(B.login || B.google) || (site === 'dola' && /Войдите, чтобы разблокировать|Log in to unlock/i.test(text)));
  return {
    ready: document.readyState === 'complete' && document.querySelectorAll('button,a').length > 2,
    url: location.href, google, inMark, outMark,
    cookies: !!B.cookies, expand: !!B.expand && !inMark && !outMark, hasGoogle: !!B.google, login: !!B.login,
  };
})()`;

// В одной вкладке сервиса: вход уже выполнен → 'in'; иначе открыть окно входа → 'login' (не дольше ~45 с).
// dry — только проверить: 'in' или 'out', окно входа не открывать.
async function openLoginIn(c, targetId, site, {dry = false} = {}) {
  const until = Date.now() + 45000;
  const probe = () => c.evalIn(targetId, pageJs(site)).catch(() => null);
  const click = act => c.evalIn(targetId, pageJs(site, act)).catch(() => false);
  // Arena в фоновой вкладке прячет страницу целиком — выводим её вкладку вперёд (в окне этого профиля)
  if (site === 'arena') { await c.send('Target.activateTarget', {targetId}).catch(() => {}); await sleep(1000); }
  let st = null;
  // ждём явного признака «вошли» или «не вошли» (сайты дорисовывают кнопки входа после загрузки);
  // по пути принимаем куки и раскрываем свёрнутую боковую панель Arena (кнопка входа — в ней)
  while (Date.now() < until) {
    st = await probe();
    if (st?.ready && st.cookies) { await click('cookies'); await sleep(800); continue; }
    if (st?.ready && st.expand) { await click('expand'); await sleep(800); continue; }
    if (st?.ready && (st.inMark || st.outMark)) break;
    await sleep(1000);
  }
  if (!st?.ready) return 'страница не загрузилась';
  if (!st.inMark && !st.outMark) return 'не понял, выполнен ли вход';
  if (st.inMark) return 'in';
  if (dry) return 'out';
  if (st.google) return 'login';   // окно входа Google уже открыто в этой вкладке
  if (site === 'flow') { await c.navigate(targetId, FLOW_LOGIN); return 'login'; }
  if (site === 'vids') { await c.navigate(targetId, VIDS_LOGIN); return 'login'; }
  if (!st.hasGoogle) { await click('login'); await sleep(2000); st = await probe() || st; }
  if (st.hasGoogle) await click('google');   // окно Google с выбором аккаунта (Dola — окошком или в вкладке, Arena — в этой вкладке)
  return 'login';
}

// Вкладки профиля dir, если его окно уже открыто (по запомненному окну профиля)
async function profilePages(c, dir) {
  const ctx = readState().profileCtx?.[dir];
  return ctx ? (await c.pages()).filter(t => t.browserContextId === ctx) : [];
}
// вкладка каждого сервиса; если сервис сейчас на странице входа Google (в адресе — домен сервиса), то она
const siteTabs = pages => {
  const tabs = {};
  for (const t of pages) { const s = siteOf(t.url); if (s && !tabs[s]) tabs[s] = t.targetId; }
  for (const t of pages) {
    if (!/accounts\.google\./.test(t.url)) continue;
    const u = (() => { try { return decodeURIComponent(t.url); } catch { return t.url; } })();   // адрес сервиса — в параметре continue
    const s = /flow\.google\.com/.test(u) ? 'flow' : /dola\.com/.test(u) ? 'dola' : /arena\.ai/.test(u) ? 'arena' : /docs\.google\.com\/videos/.test(u) ? 'vids' : null;
    if (s && !tabs[s]) tabs[s] = t.targetId;
  }
  return tabs;
};

// Недостающие вкладки сервисов — в уже открытое окно профиля: новую вкладку открывает страница этого окна (window.open)
async function addTabs(c, had, missing, tabs) {
  const from = had.find(t => /^https:/.test(t.url)) || had[0];
  for (const site of missing) {
    const before = new Set((await c.pages()).map(t => t.targetId));
    await c.evalIn(from.targetId, `window.open(${JSON.stringify(SITE_URLS[site])}, '_blank'), true`).catch(() => {});
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const t = (await c.pages()).find(x => !before.has(x.targetId) && x.browserContextId === from.browserContextId);
      if (t) { tabs[site] = t.targetId; break; }
    }
  }
}

// Окно профиля pr с сервисами (Flow, Dola, Arena, Vids). Вкладки этого профиля, которые уже были открыты (пустые и те же сервисы в других
// окнах), закрываются — у профиля одно окно с тремя сервисами. Возвращает {ctx, tabs: {site: targetId}}.
async function profileWindow(c, pr) {
  const before = await c.pages();
  openWindow(pr.dir, Object.values(SITE_URLS));
  let fresh = [];
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    fresh = (await c.pages()).filter(t => !before.some(b => b.targetId === t.targetId));
    if (Object.keys(siteTabs(fresh)).length >= SITE_COUNT) break;
  }
  if (!fresh.length) throw new Error('окно не открылось');
  const ctx = fresh[0].browserContextId;
  for (const t of before) {
    if (t.browserContextId !== ctx) continue;
    if ((blank(t.url) || siteOf(t.url)) && !vidsFile(t.url)) await c.send('Target.closeTarget', {targetId: t.targetId}).catch(() => {});
  }
  writeState({profileCtx: {...readState().profileCtx, [pr.dir]: ctx}});
  return {ctx, tabs: siteTabs(fresh)};
}

// Открыть окна профилей profs и окна входа в них (профили — параллельно). reuse — окно профиля уже открыто:
// не дублируем, только выводим его вперёд.
async function openProfiles(profs, {reuse = true} = {}) {
  await startChrome(profs[0]?.dir || 'Default');
  const c = await rawCdp();
  try {
    const opened = [];
    for (const pr of profs) {
      const had = reuse ? await profilePages(c, pr.dir) : [];
      const tabs = siteTabs(had);
      // окно профиля открыто, но какого-то сервиса нет (например, Vids появился позже) — добавляем вкладку в это же окно
      const missing = Object.keys(SITE_URLS).filter(x => !tabs[x]);
      if (missing.length && missing.length < SITE_COUNT && had.length) await addTabs(c, had, missing, tabs);
      if (Object.keys(tabs).length === SITE_COUNT) {
        await c.send('Target.activateTarget', {targetId: tabs.flow}).catch(() => {});
        opened.push({pr, tabs, already: true});
        continue;
      }
      try { opened.push({pr, ...(await profileWindow(c, pr))}); }
      catch (e) { opened.push({pr, error: e.message}); }
    }
    const out = await Promise.all(opened.map(async o => {
      if (o.error) return {id: o.pr.id, name: o.pr.name, error: o.error};
      const sites = {};
      await Promise.all(Object.keys(SITE_URLS).map(async s => {
        sites[s] = o.tabs[s] ? await openLoginIn(c, o.tabs[s], s).catch(e => 'ошибка: ' + e.message) : 'вкладка не открылась';
      }));
      // впереди в окне профиля — первый сервис, где открыто окно входа (иначе Flow)
      const front = ['flow', 'dola', 'arena', 'vids'].find(s => sites[s] === 'login') || 'flow';
      if (o.tabs[front]) await c.send('Target.activateTarget', {targetId: o.tabs[front]}).catch(() => {});
      // статус входа — в приложение (раздел «Профили»)
      withProfile(o.pr.id, () => {
        const login = {...(readAcct().login || {})};
        for (const [s, r] of Object.entries(sites)) if (r === 'in' || r === 'login') login[s] = {ok: r === 'in', at: Date.now()};
        writeAcct({login});
      });
      return {id: o.pr.id, name: o.pr.name, sites, already: !!o.already};
    }));
    const line = p => p.error ? `«${p.name}»: ${p.error}` :
      `«${p.name}»${p.already ? ' (окно уже было открыто)' : ''}: ` +
      Object.entries(p.sites).map(([s, r]) => `${NAMES[s]} — ${r === 'in' ? 'вход выполнен' : r === 'login' ? 'окно входа открыто' : r}`).join(', ');
    return {ok: out.some(p => !p.error), profiles: out, message: out.map(line).join('\n')};
  } finally { c.close(); }
}

// «🪟 Открыть все профили»
export const openAllProfiles = () => openProfiles(chromeProfiles());

// «↪ Открыть этот профиль» — окно профиля id рядом с остальными
export const openProfileWindow = id => openProfiles([{id, dir: profileDirOf(id), name: profileName(id)}]);

// «＋ Добавить профиль для входа» — новый профиль Chrome (Chrome создаёт его сам) в новом окне рядом с остальными
export async function newProfileWindow() {
  const taken = new Set(chromeProfiles().map(p => p.dir));
  let n = 1;
  while (taken.has(`Profile ${n}`) || fs.existsSync(path.join(PROFILE, `Profile ${n}`))) n++;
  const r = await openProfiles([{id: n + 1, dir: `Profile ${n}`, name: 'новый профиль'}], {reuse: false});
  return {...r, id: n + 1};
}

// Кнопка «Войти» у сервиса, когда открыто несколько профилей: окно входа в этом сервисе этого профиля
export async function openSiteLogin(id, site) {
  const dir = profileDirOf(id);
  const c = await rawCdp();
  try {
    const tab = siteTabs(await profilePages(c, dir))[site];
    if (!tab) return (await openProfiles([{id, dir, name: profileName(id)}]));
    await c.send('Target.activateTarget', {targetId: tab}).catch(() => {});
    const r = await openLoginIn(c, tab, site);
    return {ok: true, message: `${NAMES[site]}: ${r === 'in' ? 'вход уже выполнен' : r === 'login' ? 'окно входа открыто — войдите в окне Chrome' : r}`};
  } finally { c.close(); }
}

// «Проверить» / «Я вошёл», когда открыто несколько профилей: вход по окнам профилей ids (баланс Flow — когда останется один)
export async function checkProfiles(ids) {
  const c = await rawCdp();
  try {
    const lines = await Promise.all(ids.map(async id => {
      const tabs = siteTabs(await profilePages(c, profileDirOf(id)));
      const sites = {};
      await Promise.all(Object.entries(tabs).map(async ([s, t]) => { sites[s] = await openLoginIn(c, t, s, {dry: true}).catch(() => null); }));
      withProfile(id, () => {
        const login = {...(readAcct().login || {})};
        for (const [s, r] of Object.entries(sites)) if (r === 'in' || r === 'out') login[s] = {ok: r === 'in', at: Date.now()};
        writeAcct({login});
      });
      const got = Object.entries(sites).filter(([, r]) => r === 'in' || r === 'out');
      return `«${profileName(id)}»: ` + (got.length ? got.map(([s, r]) => `${NAMES[s]} — ${r === 'in' ? 'вход выполнен' : 'не вошли'}`).join(', ') : 'окно не найдено');
    }));
    return lines.join('\n');
  } finally { c.close(); }
}

// Какие профили сейчас открыты в Chrome Freefield — номера; unknown — окна, профиль которых узнать не получилось
export async function openProfileIds() {
  const {map, count, unknown} = await openProfilesNow();
  return {ids: Object.keys(map).map(dir => dir === 'Default' ? 1 : +dir.split(' ')[1] + 1), count, unknown};
}
