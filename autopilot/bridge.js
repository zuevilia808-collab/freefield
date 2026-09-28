// Freefield Автопилот — мост между страницей Freefield и расширением.
// Страница шлёт задания через window.postMessage ({ff: 'app'}), расширение отвечает ходом работы и результатами ({ff: 'autopilot'}).
const VERSION = chrome.runtime.getManifest().version;
const hello = () => window.postMessage({ff: 'autopilot', type: 'hello', version: VERSION}, '*');
hello();
window.addEventListener('message', e => {
  if (e.source !== window || e.data?.ff !== 'app') return;
  if (e.data.type === 'ping') return hello();
  const {ff, ...msg} = e.data;
  chrome.runtime.sendMessage({from: 'app', ...msg}).catch(() => {});
});
chrome.runtime.onMessage.addListener(m => {
  if (m?.to === 'app') window.postMessage({ff: 'autopilot', ...m.msg}, '*');
});
