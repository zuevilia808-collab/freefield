// Freefield Автопилот — фон: очередь заданий, вкладка Google Flow, пересылка хода и результатов на страницу Freefield.
// Сами задания выполняет flow.js во вкладке Flow (он живёт, пока открыта вкладка); очередь — в chrome.storage.local,
// чтобы пережить перезагрузку вкладки и засыпание фона.
const FLOW_URL = 'https://labs.google/fx/tools/flow';
const isFlow = url => /^https:\/\/labs\.google\/fx\/([a-z-]+\/)?tools\/flow/.test(url || '');
const get = k => chrome.storage.local.get(k).then(r => r[k]);
const set = o => chrome.storage.local.set(o);

async function flowTab(activate) {
  const {flowTab: id} = await chrome.storage.local.get('flowTab');
  let tab = id && await chrome.tabs.get(id).catch(() => null);
  if (!tab || !isFlow(tab.url || tab.pendingUrl)) tab = (await chrome.tabs.query({url: 'https://labs.google/*'})).find(t => isFlow(t.url));
  if (!tab) tab = await chrome.tabs.create({url: FLOW_URL, active: activate});
  else if (activate) await chrome.tabs.update(tab.id, {active: true});
  await set({flowTab: tab.id});
  return tab;
}
async function toApp(msg) {
  const id = await get('appTab');
  if (id) chrome.tabs.sendMessage(id, {to: 'app', msg}).catch(() => {});
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    if (m.from === 'app') {
      await set({appTab: sender.tab.id});
      if (m.type === 'tasks') {
        const q = (await get('queue')) || [];
        const add = m.tasks.filter(t => !q.some(x => x.id === t.id));
        await set({queue: [...q, ...add]});
        const tab = await flowTab(true);
        chrome.tabs.sendMessage(tab.id, {type: 'kick'}).catch(() => {});   // вкладка ещё грузится — flow.js заберёт очередь сам
        for (const t of add) toApp({type: 'progress', id: t.id, text: 'в очереди — открываю Google Flow'});
      }
      if (m.type === 'cancel') {
        await set({queue: ((await get('queue')) || []).filter(x => !m.ids.includes(x.id))});
        const id = await get('flowTab');   // вкладку не открываем — только сообщаем уже открытой
        if (id) chrome.tabs.sendMessage(id, {type: 'cancel', ids: m.ids}).catch(() => {});
      }
      if (m.type === 'status') toApp({type: 'queue', ids: ((await get('queue')) || []).map(x => x.id)});
      return reply({ok: true});
    }
    if (m.from === 'flow') {
      if (m.type === 'claim') {   // очередь ведёт одна вкладка Flow — та, что открыта для неё (или первая живая)
        let id = await get('flowTab');
        const tab = id && await chrome.tabs.get(id).catch(() => null);
        if (!tab || !isFlow(tab.url || tab.pendingUrl)) { id = sender.tab.id; await set({flowTab: id}); }
        return reply({mine: id === sender.tab.id});
      }
      if (m.type === 'fetch') {   // файл, который странице Flow не отдали (другой домен) — забираем с правами расширения
        try {
          const r = await fetch(m.url, {credentials: 'include'});
          const b = await r.blob(), buf = new Uint8Array(await b.arrayBuffer());
          let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          return reply({ok: true, mime: b.type, data: btoa(s)});
        } catch (e) { return reply({ok: false, error: String(e.message || e)}); }
      }
      if (m.type === 'done') await set({queue: ((await get('queue')) || []).filter(x => x.id !== m.id)});
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
