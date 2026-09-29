// Freefield Автопилот — фон: очередь заданий, вкладка Google Flow, пересылка хода и результатов на страницу Freefield.
// Сами задания выполняет flow.js во вкладке Flow (он живёт, пока открыта вкладка); очередь — в chrome.storage.local,
// чтобы пережить перезагрузку вкладки и засыпание фона.
const FLOW_URL = 'https://labs.google/fx/tools/flow';
const isFlow = url => /^https:\/\/labs\.google\/fx\/([a-z-]+\/)?tools\/flow/.test(url || '');
const onGoogle = url => /^https:\/\/(labs\.google|accounts\.google\.com)\//.test(url || '');   // вкладка Flow, пока в ней вход или смена аккаунта
const tabUrl = t => t.url || t.pendingUrl || '';
const get = k => chrome.storage.local.get(k).then(r => r[k]);
const set = o => chrome.storage.local.set(o);

// Очередь и аккаунты меняем строго по одному: сообщения приходят почти одновременно, и каждое читало старую очередь —
// из трёх заданий в очереди оставалось одно (а вкладок Flow открывалось три)
let chain = Promise.resolve();
function serial(fn) { const run = chain.then(fn); chain = run.catch(() => {}); return run; }

// Одна вкладка Flow на всё. Задания приходят почти одновременно (несколько карточек, серия) — без очереди каждое открывало
// свою вкладку (пользователь 2026-09-29: «создаёт три вкладки»). Вкладка остаётся нашей и пока в ней идёт вход в Google.
let tabLock = Promise.resolve();
function flowTab(activate) {
  const run = tabLock.then(() => openFlow(activate));
  tabLock = run.catch(() => {});
  return run;
}
async function openFlow(activate) {
  const id = await get('flowTab');
  let tab = id && await chrome.tabs.get(id).catch(() => null);
  if (tab && !onGoogle(tabUrl(tab))) tab = null;   // в этой вкладке ушли на другой сайт — она больше не для Flow
  tab ||= (await chrome.tabs.query({})).find(t => isFlow(tabUrl(t)));
  if (!tab) tab = await chrome.tabs.create({url: FLOW_URL, active: activate});
  else if (activate) await chrome.tabs.update(tab.id, {active: true});
  await set({flowTab: tab.id});
  return tab;
}

// ---- Аккаунты Google во Flow. Вход во Flow общий для всего профиля Chrome: во всех вкладках — один и тот же аккаунт,
// три аккаунта в трёх вкладках сразу Chrome не держит. А кредитов у аккаунта 50 в день — поэтому аккаунты идут по очереди:
// в этом кредитов на задание не хватает — вкладка Flow выходит и входит следующим (пользователь 2026-09-29).
// Аккаунт запоминается, как только во Flow им вошли; кредиты считаем сами (цену задания присылает Freefield),
// а «кредиты кончились» от самого Flow — главнее счёта.
const DAY_CREDITS = 50;
const today = () => new Date().toLocaleDateString('sv');   // 2026-09-29 — по часам компьютера
const room = a => a.out ? 0 : Math.max(0, DAY_CREDITS - a.spent);
async function accounts() {
  const list = (await get('accounts')) || [];
  list.forEach(a => { if (a.day !== today()) Object.assign(a, {day: today(), spent: 0, out: false}); });
  return list;
}
async function accSave(list) { await set({accounts: list}); toApp({type: 'accounts', list, me: await get('me')}); }   // только внутри serial()
async function accOf(email) {
  const list = await accounts();
  let a = list.find(x => x.email === email);
  if (!a && email) list.push(a = {email, day: today(), spent: 0, out: false});
  return {list, a};
}
// ---- Мост к Freefield на компьютере: программа рядом с Claude Desktop (http://127.0.0.1:5180) открывает профили Chrome
// и делает всё в Flow, Dola, Arena и Vids. Сайт Freefield с GitHub браузер к ней не пускает — ходим за него.
const HUB_PORTS = [5180, 5181, 5182];
let hubPort = 0;
const b64 = buf => { let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); };
async function hub(m) {
  const path = String(m.path || '');
  if (!/^\/api\//.test(path)) return {error: 'не тот адрес'};
  for (const port of hubPort ? [hubPort, ...HUB_PORTS.filter(p => p !== hubPort)] : HUB_PORTS) {
    let r;
    try { r = await fetch(`http://127.0.0.1:${port}${path}`, {method: m.method || 'GET', headers: m.headers || {}, body: m.body ?? undefined}); }
    catch { continue; }   // на этом порту никого
    hubPort = port;
    return {status: r.status, type: r.headers.get('content-type') || '', body: b64(new Uint8Array(await r.arrayBuffer()))};
  }
  hubPort = 0;
  return {error: 'Freefield на компьютере не запущен — откройте Claude Desktop'};
}
async function toApp(msg) {
  const id = await get('appTab');
  if (id) chrome.tabs.sendMessage(id, {to: 'app', msg}).catch(() => {});
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    if (m.from === 'app') {
      if (m.type === 'hub') return reply(await hub(m));
      await set({appTab: sender.tab.id});
      if (m.type === 'tasks') {
        const add = await serial(async () => {
          const q = (await get('queue')) || [];
          const add = m.tasks.filter(t => !q.some(x => x.id === t.id));
          await set({queue: [...q, ...add]});
          return add;
        });
        const tab = await flowTab(true);
        chrome.tabs.sendMessage(tab.id, {type: 'kick'}).catch(() => {});   // вкладка ещё грузится — flow.js заберёт очередь сам
        for (const t of add) toApp({type: 'progress', id: t.id, text: 'в очереди — открываю Google Flow'});
      }
      if (m.type === 'cancel') {
        await serial(async () => set({queue: ((await get('queue')) || []).filter(x => !m.ids.includes(x.id))}));
        const id = await get('flowTab');   // вкладку не открываем — только сообщаем уже открытой
        if (id) chrome.tabs.sendMessage(id, {type: 'cancel', ids: m.ids}).catch(() => {});
      }
      if (m.type === 'status') {
        toApp({type: 'queue', ids: ((await get('queue')) || []).map(x => x.id)});
        toApp({type: 'accounts', list: await accounts(), me: await get('me')});
      }
      if (m.type === 'acct-add') {   // войти во Flow ещё одним аккаунтом: вкладка Flow откроет выбор аккаунта Google
        const tab = await flowTab(true);
        await set({addAcct: m.email || true});   // почта — войти именно им, иначе — выбор аккаунта Google
        chrome.tabs.sendMessage(tab.id, {type: 'signin'}).catch(() => {});   // вкладка ещё грузится — flow.js увидит addAcct сам
      }
      if (m.type === 'acct-del' || m.type === 'acct-reset') await serial(async () => {
        const list = await accounts(), a = list.find(x => x.email === m.email);
        if (m.type === 'acct-del') list.splice(list.indexOf(a), a ? 1 : 0);
        else if (a) Object.assign(a, {spent: 0, out: false});
        await accSave(list);
      });
      return reply({ok: true});
    }
    if (m.from === 'flow') {
      if (m.type === 'claim') {   // очередь ведёт одна вкладка Flow — та, что открыта для неё (или первая живая вкладка Flow)
        let id = await get('flowTab');
        const tab = id && await chrome.tabs.get(id).catch(() => null);
        if ((!tab || !onGoogle(tabUrl(tab))) && isFlow(sender.tab.url)) { id = sender.tab.id; await set({flowTab: id}); }
        return reply({mine: id === sender.tab.id});
      }
      // кто вошёл во Flow и хватит ли ему кредитов на задание: go — делать здесь, to — войти этим аккаунтом, иначе — кредитов нет нигде
      if (m.type === 'plan') return reply(await serial(async () => {
        const {list, a} = await accOf(m.email);
        await set({me: m.email});
        await accSave(list);
        if (!m.need || room(a) >= m.need) return {go: true, left: room(a)};
        const b = list.find(x => x !== a && room(x) >= m.need);
        return b ? {to: b.email} : {none: list.map(x => ({email: x.email, left: room(x)}))};
      }));
      if (m.type === 'spent' || m.type === 'out') {   // задание ушло во Flow — кредиты потрачены; Flow сказал «кредитов нет»
        await serial(async () => {
          const {list, a} = await accOf(m.email);
          if (a) { if (m.type === 'spent') a.spent += m.credits || 0; else a.out = true; }
          await accSave(list);
        });
        return reply({ok: true});
      }
      if (m.type === 'fetch') {   // файл, который странице Flow не отдали (другой домен) — забираем с правами расширения
        try {
          const r = await fetch(m.url, {credentials: 'include'});
          const b = await r.blob();
          return reply({ok: true, mime: b.type, data: b64(new Uint8Array(await b.arrayBuffer()))});
        } catch (e) { return reply({ok: false, error: String(e.message || e)}); }
      }
      if (m.type === 'done') await serial(async () => set({queue: ((await get('queue')) || []).filter(x => x.id !== m.id)}));
      toApp(m.msg);
      reply({ok: true});
    }
  })();
  return true;
});

// значок расширения — открыть Freefield
chrome.action.onClicked.addListener(async () => {
  const id = await get('appTab'), tab = id && await chrome.tabs.get(id).catch(() => null);
  if (tab) chrome.tabs.update(tab.id, {active: true});
  else chrome.tabs.create({url: 'https://zuevilia808-collab.github.io/freefield/'});
});
