// Freefield Автопилот — мост между страницей Freefield и расширением.
// Страница шлёт задания через window.postMessage ({ff: 'app'}), расширение отвечает ходом работы и результатами ({ff: 'autopilot'}).
// Запрос с rid ждёт ответа: так сайт Freefield говорит с Freefield на компьютере (type: 'hub') — только со страниц самого Freefield.
const VERSION = chrome.runtime.getManifest().version;
const hello = () => window.postMessage({ff: 'autopilot', type: 'hello', version: VERSION}, '*');
const ours = location.hostname !== 'zuevilia808-collab.github.io' || /^\/freefield(\/|$)/.test(location.pathname);
hello();
window.addEventListener('message', e => {
  if (e.source !== window || e.data?.ff !== 'app') return;
  if (e.data.type === 'ping') return hello();
  const {ff, rid, ...msg} = e.data;
  if (msg.type === 'hub' && !ours) return;
  chrome.runtime.sendMessage({from: 'app', ...msg}).then(res => {
    if (rid) window.postMessage({ff: 'autopilot', type: 'reply', rid, res}, '*');
  }, err => { if (rid) window.postMessage({ff: 'autopilot', type: 'reply', rid, res: {error: String(err?.message || err)}}, '*'); });
});
chrome.runtime.onMessage.addListener(m => {
  if (m?.to === 'app') window.postMessage({ff: 'autopilot', ...m.msg}, '*');
});
