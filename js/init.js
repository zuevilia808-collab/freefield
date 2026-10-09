'use strict';
/* =============================== установка (PWA) =============================== */
const pwa = {
  prompt: null,   // системное окно установки (Chrome/Edge/Android)
  standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  ios: () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  android: () => /android/i.test(navigator.userAgent),
  mobile: () => pwa.ios() || pwa.android(),
  hosted: () => location.protocol === 'https:' && !/^(localhost|127\.)/.test(location.hostname),
};

function initPwa() {
  if (native.on()) {
    $('#installOpen').classList.add('hidden');
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="http"]');
      if (a && new URL(a.href).host !== location.host) { e.preventDefault(); native.open(a.href); }
    }, true);
    return;
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.)/.test(location.hostname)))
    navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pwa.prompt = e; });
  window.addEventListener('appinstalled', () => {
    pwa.prompt = null; closeSheets(); updateInstallBtn();
    toast('Freefield установлен 🎉 Иконка — на главном экране', {type: 'ok', ms: 6000});
  });
  $('#installOpen').addEventListener('click', openInstall);
  $('#installBody').addEventListener('click', async e => {
    if (e.target.closest('[data-install]')) runInstallPrompt();
    if (e.target.closest('[data-copy-home]')) toast(await clCopyText(hubLinkHome()) ? 'Ссылка скопирована — откройте её на телефоне. Никому не пересылайте' : 'Не удалось скопировать', {type: 'ok', ms: 6000});
  });
  // «📱 На телефон» из строки связи с компьютером — то же окно с QR-кодами
  document.addEventListener('click', e => { if (e.target.closest('[data-phone-qr]')) { closeSheets(); openInstall(); } });
  updateInstallBtn();
}

function updateInstallBtn() { $('#installOpen')?.classList.toggle('hidden', pwa.standalone() || native.on()); }

async function runInstallPrompt() {
  if (!pwa.prompt) return;
  pwa.prompt.prompt();
  await pwa.prompt.userChoice.catch(() => null);
  pwa.prompt = null;
  renderInstall();
}

function openInstall() {
  if (pwa.android() && pwa.prompt) return runInstallPrompt();   // Android: сразу системное окно
  renderInstall();
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#installSheet').classList.remove('hidden');
}

function renderInstall() {
  const url = location.origin + location.pathname;
  const steps = list => list.map((t, i) => `<div class="inst-step"><b class="n">${i + 1}</b><div>${t}</div></div>`).join('');
  let html = '';
  if (pwa.mobile()) {
    if (pwa.ios()) html += steps([
      'Откройте этот адрес в <b>Safari</b> (из Chrome на iPhone установить нельзя).',
      'Нажмите кнопку <b>«Поделиться»</b> ⬆️ внизу экрана.',
      'Выберите <b>«На экран „Домой“»</b> → «Добавить». Иконка Freefield появится на главном экране.']);
    else if (pwa.prompt) html += '<button class="inst-big" data-install>📲 Установить Freefield</button>';
    else html += steps([
      'Откройте меню браузера <b>⋮</b> справа вверху.',
      'Нажмите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.',
      'Подтвердите — иконка Freefield появится на главном экране.']);
    if (pwa.android()) html += '<div class="set-h">📦 Или отдельное приложение</div>' +
      '<a class="inst-big" style="display:grid;place-items:center;text-decoration:none" href="Freefield.apk" download>Скачать Freefield.apk (4 МБ)</a>' +
      '<p class="inst-note">Откройте скачанный файл и разрешите установку из этого источника. Android может предупредить о неизвестном разработчике — это нормально для приложений не из Google Play: нажмите «Всё равно установить».</p>';
    // версия с GitHub до компьютера не достаёт: Flow, Dola и Arena — вручную на сайтах (карточки), или Freefield «с компьютера»
    if (pwa.hosted() || native.on()) html += '<div class="set-h">📱 Без компьютера</div>' +
      '<p class="set-p">Flow, Dola и Arena работают и отсюда — вручную: «Подготовить» в «Видео» или «Создать» в «Ассетах» кладёт в галерею карточку с фото и промптом. На ней: 💾 сохранить фото → «Скопировать промпт и открыть» сайт → там «Создать» → «📥 Загрузить файл». Google Vids с телефона видео не создаёт.</p>' +
      '<div class="set-h">📡 Чтобы запускалось само — через компьютер</div>' + steps([
      'На компьютере откройте Freefield и нажмите <b>«📱 На телефон»</b> — в зелёной строке «Приложение подключено к компьютеру».',
      'Отсканируйте верхний QR-код этим телефоном. Телефон — в той же сети Wi-Fi, что и компьютер (или компьютер подключён к точке доступа телефона).',
      'Добавьте и ту страницу на экран «Домой» — будет вторая иконка Freefield: она запускает видео и фото через Google Flow, Vids, Dola и Arena на компьютере.']) +
      '<p class="inst-note">Эта версия (с GitHub) работает где угодно, но до компьютера не достаёт: телефон не пускает защищённый сайт к домашнему компьютеру.</p>';
    if (!pwa.hosted()) html += `<p class="inst-note">⚠ Сейчас Freefield открыт с вашего компьютера по Wi-Fi — с вашими аккаунтами Flow, Vids, Dola и Arena. Работает, пока компьютер включён и телефон в той же сети. Вне дома — версия с GitHub: <b>${esc(SITE_URL)}</b> (без ваших аккаунтов).</p>`;
  } else {
    // на компьютере: QR «телефон с вашими аккаунтами» (ссылка с секретным ключом — её отдаёт только сам компьютер) и QR версии с GitHub
    const home = hubLink.local() && hubLinkHome(), port = hubLink.info?.port || 5180;
    if (home) html += '<div class="set-h">📱 Телефон с вашими аккаунтами</div>' +
      `<div class="inst-qr"><div id="qrHome"></div><div class="inst-url">http://${esc(hubLink.info.lan[0])}:${port}/?k=••••••</div>
        <button class="btn small" data-copy-home>📋 Скопировать ссылку</button></div>` + steps([
      'Телефон — в той же сети Wi-Fi, что и компьютер (или компьютер подключён к точке доступа этого телефона).',
      'Наведите камеру телефона на QR-код и откройте ссылку — Freefield будет запускать видео через ваши Flow, Vids, Dola и Arena.',
      'Добавьте на главный экран (iPhone: Safari → «Поделиться» → «На экран „Домой“»; Android: меню ⋮ → «Добавить на главный экран»). Сменилась сеть — отсканируйте код отсюда заново.']) +
      '<p class="inst-note">🔒 Ссылка секретная: с ней можно генерировать на ваших аккаунтах. Не пересылайте и не показывайте этот QR-код.</p>';
    html += `<div class="set-h">🌐 Телефон где угодно${home ? ' — без ваших аккаунтов' : ''}</div>` +
      `<div class="inst-qr"><div id="qrBox"></div><div class="inst-url">${esc(pwa.hosted() ? url : SITE_URL)}</div></div>` + steps([
      'Наведите камеру телефона на QR-код и откройте ссылку.',
      'Нажмите <b>📲</b> в приложении и следуйте подсказке (Android — «Установить», iPhone — Safari → «Поделиться» → «На экран „Домой“»).']) +
      '<p class="inst-note">Там работают модели по вашим ключам и бесплатные генераторы; видео через Flow, Vids, Dola и Arena — только по ссылке с компьютера выше.</p>';
    html += '<div class="set-h">💻 На этот компьютер</div>' + (pwa.prompt
      ? '<button class="inst-big" data-install>Установить на компьютер</button>'
      : '<p class="set-p">В Chrome или Edge: значок установки в адресной строке или меню ⋮ → «Установить Freefield».</p>');
  }
  html += '<p class="inst-note">Галерея, ключи и настройки хранятся на каждом устройстве отдельно — на телефоне их нужно ввести заново.</p>';
  $('#installBody').innerHTML = html;
  if ($('#qrHome')) drawQR($('#qrHome'), hubLinkHome());
  if ($('#qrBox')) drawQR($('#qrBox'), pwa.mobile() || pwa.hosted() ? url : SITE_URL);
}
// Перед отправкой на компьютер: ответа от него ещё не было (страница только открылась, компьютер занят генерациями) —
// спрашиваем ещё раз и ждём, а не сразу «компьютер не подключён». Версия с GitHub / из APK до компьютера не достаёт вовсе —
// тогда задания становятся карточками для сайтов (phoneCards)
async function hubReady() {
  if (hubLink.ok) return true;
  if (!hubLink.local() && hubLink.pcSite() && hubLink.pcUp === null) return hubLink.tryDirect();   // сайт с GitHub — программа на этом компьютере
  if (!hubLink.local() && await hubLink.tryLan()) return true;   // телефон, связанный с компьютером по QR — напрямую по Wi-Fi
  if (!hubLink.local()) return false;
  if (!hubLink.key && !(hubLink.onPc() && await hubLink.localKey())) return false;
  await hubLink.refresh();
  return hubLink.ok;
}
// ссылка «телефон с вашими аккаунтами»: адрес компьютера в домашней сети + секретный ключ (как в QR от Claude — phone_link)
const hubLinkHome = () => { const lan = hubLink.info?.lan?.[0]; return lan && hubLink.key ? `http://${lan}:${hubLink.info.port || 5180}/?k=${encodeURIComponent(hubLink.key)}#claude` : ''; };
const SITE_URL = 'https://zuevilia808-collab.github.io/freefield/';   // Freefield на GitHub Pages — открывается где угодно
// превью стиля не нашлось рядом со страницей (копия страницы без папки img) — берём с GitHub; и там нет — остаётся значок
function styleImgFail(img) {
  if (img.dataset.gh) return img.remove();
  img.dataset.gh = 1;
  img.src = SITE_URL + img.getAttribute('src');
}

function drawQR(box, text) {
  const draw = () => { const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); box.innerHTML = qr.createImgTag(6, 0); };
  if (window.qrcode) return draw();
  const sc = document.createElement('script');
  sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  // хэш файла: если CDN подменит библиотеку, браузер её не выполнит (ключи и связь с компьютером в безопасности)
  sc.integrity = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
  sc.crossOrigin = 'anonymous';
  sc.onload = draw;
  sc.onerror = () => { box.textContent = 'QR-код не загрузился — откройте адрес ниже на телефоне вручную'; };
  document.head.append(sc);
}

/* =============================== init =============================== */
(async function init() {
  buildControls();
  bindControls();
  setStyle(state.style);
  state.mode = 'image'; document.body.dataset.mode = 'image';
  $('#prompt').value = state.prompts.image || '';
  initPwa();
  autoImport.init().then(render);
  setView('create');
  railMount();
  setCreateMode(cl.mode);
  renderWallet();
  try {
    await DB.open();
    items = ((await DB.all()) || []).filter(i => (i.status === 'done' && i.blob) || i.status === 'external').sort((a, b) => b.createdAt - a.createdAt);
    wrLocsLoad();
    vcLoad().then(serLoad);
    scrLoad();
  } catch {
    toast('Браузер не даёт сохранять галерею — работы пропадут после закрытия вкладки', {type: 'err', ms: 8000});
  }
  render();
  hubLink.init();
})();
