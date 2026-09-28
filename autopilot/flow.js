// Freefield Автопилот — водитель Google Flow. Берёт задания из очереди и делает их на странице Flow, как человек:
// проект → режим (картинка / видео по кадру / по ингредиентам / по тексту) → формат, модель, количество → фото-референсы →
// промпт → «Создать» → ждёт результат → отдаёт файлы в Freefield. Интерфейс Flow меняется, поэтому элементы ищем по надписям,
// подсказкам и значкам (Material Symbols), а не по жёстким селекторам. Не нашёл шаг — панель просит сделать его вручную и ждёт;
// «📋 Отчёт для Claude» собирает, что было на странице, чтобы доработать автопилот.
(() => {
  if (window.__ffAutopilot) return;
  window.__ffAutopilot = true;
  const onFlow = () => /\/tools\/flow/.test(location.pathname);   // Flow — одностраничное приложение: путь может смениться без перезагрузки

  const state = {busy: false, cancel: false, task: null, step: '', text: '', manual: null, resume: null, log: [], total: 0, done: 0, skip: new Set()};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const low = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('#ff-ap');
  const labelOf = el => low([el.getAttribute?.('aria-label'), el.getAttribute?.('title'), el.getAttribute?.('placeholder'), el.getAttribute?.('data-tooltip'),
    el.innerText || el.textContent].filter(Boolean).join(' | ')).slice(0, 160);
  const CLICKABLE = 'button, [role=button], [role=menuitem], [role=menuitemradio], [role=option], [role=tab], [role=radio], [role=combobox], [aria-haspopup], a[href], label, li';
  const clickables = (root = document) => [...root.querySelectorAll(CLICKABLE)].filter(visible);
  const log = t => { state.log.push(`${new Date().toLocaleTimeString()} ${state.step}: ${t}`); state.log = state.log.slice(-60); };
  // первый видимый кликабельный элемент, чья надпись подходит под правило (правила — по порядку)
  function find(rules, root) {
    const els = clickables(root);
    for (const re of [].concat(rules)) { const el = els.find(e => re.test(labelOf(e))); if (el) return el; }
    return null;
  }
  async function waitFor(fn, ms = 15000, step = 300) {
    const t = Date.now();
    while (Date.now() - t < ms && !state.cancel) { const v = await fn(); if (v) return v; await sleep(step); }
    return null;
  }
  function press(el) {   // как у человека: наведение, нажатие, отпускание, клик — меню Flow открываются на pointerdown
    el.scrollIntoView?.({block: 'center'});
    const o = {bubbles: true, cancelable: true, view: window};
    for (const t of ['pointerover', 'pointerenter', 'pointerdown']) el.dispatchEvent(new PointerEvent(t, o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }
  const escape = () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true}));
  const rx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---- поле промпта: подсказка про генерацию — в приоритете, иначе самое большое поле ввода
  function promptField() {
    const els = [...document.querySelectorAll('textarea, [contenteditable="true"], [role=textbox], input[type=text]')].filter(visible);
    const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    const score = el => (/prompt|generate|create|describe|what do you want|video|image|опиш|созд|промпт|видео|изображ|что/.test(labelOf(el)) ? 1e7 : 0) + area(el);
    return els.sort((a, b) => score(b) - score(a))[0] || null;
  }
  const fieldText = el => low(el?.value ?? el?.innerText ?? '');
  function setText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);   // так видит React
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
    } else {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      if (!fieldText(el).includes(low(text).slice(0, 30))) { el.textContent = text; el.dispatchEvent(new InputEvent('input', {bubbles: true, data: text, inputType: 'insertText'})); }
    }
    return fieldText(el).includes(low(text).slice(0, 30));
  }

  // ---- проект: на странице проекта есть поле промпта; нет — «Новый проект»
  async function ensureProject() {
    if (promptField()) return true;
    if (find([/^sign in$|войти/])) await manual('Войдите в Google Flow своим аккаунтом — дальше я сам');
    const np = await waitFor(() => find([/new project|новый проект|create (a )?(new )?project|создать проект/, /^add$|^\+$|start creating|начать/]), 12000);
    if (np) { log('новый проект: ' + labelOf(np)); press(np); if (await waitFor(promptField, 15000)) return true; }
    await manual('Откройте проект во Flow (или создайте новый) — дальше я сам');
    return !!(await waitFor(promptField, 30000));
  }

  // ---- режим: картинка, видео по кадру (1 фото), по ингредиентам (2+ фото), по тексту
  const MODE = {
    image: /create image|image generation|^images?\b|изображени|картин|nano banana/,
    frames: /frames? to video|кадр(ы|ов)? в видео|по кадр/,
    ingredients: /ingredients? to video|ингредиент/,
    text: /text to video|текст в видео|по тексту/,
  };
  async function setMode(kind, refs) {
    const want = kind === 'image' ? 'image' : refs >= 2 ? 'ingredients' : refs === 1 ? 'frames' : 'text';
    const any = new RegExp(Object.values(MODE).map(r => r.source).join('|'));
    const ctl = clickables().find(el => any.test(labelOf(el)) && (el.getAttribute('aria-haspopup') || el.getAttribute('role') === 'combobox' || el.tagName === 'BUTTON'));
    if (ctl && MODE[want].test(labelOf(ctl)) && !ctl.getAttribute('role')?.match(/option|tab|radio/)) { log('режим уже: ' + labelOf(ctl)); return true; }
    const direct = find(MODE[want]);   // вкладки / кнопки режимов видны сразу
    if (direct && direct !== ctl) { press(direct); log('режим: ' + labelOf(direct)); await sleep(500); return true; }
    if (!ctl) return false;
    press(ctl); await sleep(600);
    const opt = await waitFor(() => find(MODE[want]), 3000);
    if (opt) { press(opt); log('режим: ' + labelOf(opt)); await sleep(500); return true; }
    escape();
    return false;
  }

  // ---- настройки: формат, количество, модель — открываем панель, ищем подходящие варианты
  const ASPECT = {'9:16': [/9\s*:\s*16/, /portrait|вертикал/], '16:9': [/16\s*:\s*9/, /landscape|горизонтал/], '1:1': [/1\s*:\s*1/, /square|квадрат/],
    '3:4': [/3\s*:\s*4/, /portrait|вертикал/], '4:3': [/4\s*:\s*3/, /landscape|горизонтал/]};
  const engineRe = e => new RegExp(low(e).split(/[\s·,]+/).filter(Boolean).map(rx).join('.{0,14}'));
  const isDD = el => el.hasAttribute('aria-haspopup') || el.getAttribute('role') === 'combobox';
  // подпись рядом с выпадающим списком: aria-labelledby или текст ближайшего предка, где этот список — единственный
  function near(el) {
    const ids = el.getAttribute('aria-labelledby');
    let t = ids ? ids.split(/\s+/).map(i => document.getElementById(i)?.innerText || '').join(' ') : '';
    for (let p = el.parentElement, i = 0; p && i < 3; p = p.parentElement, i++) {
      if ([...p.querySelectorAll('[aria-haspopup], [role=combobox]')].some(x => x !== el && visible(x))) break;
      if ((p.innerText || '').length > 120) break;
      t += ' ' + p.innerText;
    }
    return low(t);
  }
  function findField(rules) {
    const els = clickables().filter(isDD);
    for (const re of rules) { const el = els.find(e => re.test(labelOf(e))) || els.find(e => re.test(near(e))); if (el) return el; }
    return null;
  }
  async function pick(labelRules, valueRules) {
    const direct = find(valueRules[0]);   // вариант уже на виду (чипы, радио) или список уже показывает нужное
    if (direct && isDD(direct)) return labelOf(direct) + ' (уже)';
    if (direct) { if (direct.getAttribute('aria-checked') !== 'true' && direct.getAttribute('aria-selected') !== 'true') press(direct); await sleep(300); return labelOf(direct); }
    const dd = findField(labelRules);
    if (!dd) return null;
    press(dd); await sleep(500);
    const opt = await waitFor(() => find(valueRules), 3000);
    if (opt) { press(opt); await sleep(400); return labelOf(opt); }
    escape();
    return null;
  }
  const FIELDS = {aspect: [/aspect|ratio|формат|соотношени|ориентац/], model: [/model|модель/], count: [/outputs?|results?|количеств|вариант/]};
  async function setSettings(t) {
    let opener = null;
    if (!findField([...FIELDS.aspect, ...FIELDS.model, ...FIELDS.count])) {   // панель ещё закрыта — открыть
      opener = find([/^tune$|tune\b|settings|настройк|параметр/]);
      if (opener) { press(opener); await sleep(700); log('настройки: ' + labelOf(opener)); }
    }
    const got = {};
    if (t.aspect) got.aspect = await pick(FIELDS.aspect, ASPECT[t.aspect] || [new RegExp(rx(t.aspect).replace(':', '\\s*:\\s*'))]);
    if (t.engine) got.model = await pick(FIELDS.model, [engineRe(t.engine)]);
    if (t.count) got.count = await pick(FIELDS.count, [new RegExp(`^${t.count}$|^${t.count}\\b|× ?${t.count}\\b`)]);
    if (opener) { escape(); await sleep(300); if (opener.getAttribute('aria-expanded') === 'true') press(opener); }
    log('настройки: ' + JSON.stringify(got));
    return got;
  }

  // ---- фото-референсы: в скрытое поле файла, как если бы их выбрали на компьютере
  const fileInput = () => [...document.querySelectorAll('input[type=file]')].find(i => !i.disabled && (!i.accept || /image|\*/.test(i.accept)));
  function dataFile(d, name) {
    const [head, b64] = String(d).split(','), type = head.match(/^data:([^;,]+)/)?.[1] || 'image/jpeg';
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], `${name}.${type.split('/')[1] || 'jpg'}`, {type});
  }
  const imgCount = () => [...document.querySelectorAll('img')].filter(visible).length;
  async function putFiles(files) {
    let input = fileInput();
    if (!input) {
      const add = find([/add_photo|add_a_photo|add image|add media|add frame|add ingredient|upload|загруз|добав.*(фото|изображ|кадр|медиа)/, /^add$|^\+$|add_circle|^add /]);
      if (add) { press(add); log('добавить: ' + labelOf(add)); await sleep(800); }
      input = await waitFor(fileInput, 4000);
      if (!input) { const up = find([/upload|from (your )?(computer|device)|browse|с компьютера|загрузить/]); if (up) { press(up); input = await waitFor(fileInput, 4000); } }
    }
    if (!input) return 0;
    const dt = new DataTransfer();
    (input.multiple ? files : files.slice(0, 1)).forEach(f => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return dt.files.length;
  }
  async function attach(images) {
    const files = images.map((d, i) => dataFile(d, `freefield-${i + 1}`));
    const before = imgCount();
    let put = 0;
    for (let tries = 0; put < files.length && tries < files.length + 1; tries++) {
      const n = await putFiles(files.slice(put));
      if (!n) break;
      put += n;
      await sleep(1200);
      const ok = find([/^(done|confirm|use|save|ok|готово|подтвердить|использовать|сохранить)$/]);   // окно «обрезать / подтвердить»
      if (ok) { press(ok); await sleep(600); }
    }
    if (put) await waitFor(() => imgCount() > before, 20000);
    log(`фото приложено: ${put} из ${files.length}`);
    return put === files.length;
  }

  // ---- «Создать»: кнопка рядом с полем промпта (стрелка / отправить / создать), нет — Enter
  async function submit(field) {
    const rules = [/^(send|generate|create|submit|run|отправить|создать|сгенерировать)$/, /arrow_forward|arrow_upward|\bsend\b|generate|сгенер|создать|отправ/];
    let btn = null;
    for (let p = field?.parentElement, i = 0; p && i < 7 && !btn; p = p.parentElement, i++) btn = find(rules, p);
    btn ||= find(rules);
    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') { log('создать: ' + labelOf(btn)); press(btn); return true; }
    field?.focus();
    field?.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
    log('создать: Enter');
    return false;
  }

  // ---- результат: новые картинки / видео, которых не было до «Создать»
  function mediaUrl(m) {
    if (!visible(m) && m.tagName !== 'VIDEO') return '';
    if (m.tagName === 'VIDEO') return m.currentSrc || m.src || m.querySelector('source')?.src || '';
    const r = m.getBoundingClientRect();
    if (Math.max(m.naturalWidth || 0, r.width) < 200) return '';   // значки и аватары — мимо
    return m.currentSrc || m.src || '';
  }
  const snapshot = () => new Set([...document.querySelectorAll('video, img')].map(mediaUrl).filter(Boolean));
  function errorText(since) {
    const el = [...document.querySelectorAll('[role=alert], [aria-live], .error, [class*=error], [class*=toast], [class*=snack]')].filter(visible)
      .find(e => /error|failed|couldn.t|unable|policy|violat|try again|не удалось|ошибк|наруш|попробуйте/.test(low(e.innerText)) && !since.has(low(e.innerText)));
    return el ? el.innerText.trim().slice(0, 200) : '';
  }
  const alertsNow = () => new Set([...document.querySelectorAll('[role=alert], [aria-live], [class*=toast], [class*=snack]')].map(e => low(e.innerText)));
  async function waitResults(kind, want, before, alerts) {
    const tag = kind === 'video' ? 'video' : 'img', limit = (kind === 'video' ? 12 : 5) * 60e3, t0 = Date.now();
    const calm = (kind === 'video' ? 120 : 60) * 1e3;   // часть вариантов есть, а новые давно не появляются — Flow отдал сколько смог
    let found = [], changed = t0;
    while (Date.now() - t0 < limit && !state.cancel) {
      const now = [...new Set([...document.querySelectorAll(tag)].map(mediaUrl).filter(u => u && !before.has(u) && !/^data:image\/svg/.test(u)))];
      if (now.length !== found.length) changed = Date.now();
      found = now;
      if (found.length >= want || (found.length && Date.now() - changed > calm)) break;
      const err = errorText(alerts);
      if (err) throw new Error('Flow: ' + err);
      status(`жду ${kind === 'video' ? 'видео' : 'картинку'} от Flow · ${Math.round((Date.now() - t0) / 1000)} с`);
      await sleep(3000);
    }
    if (found.length) await sleep(kind === 'video' ? 4000 : 1500);   // пусть допишется
    return found.slice(0, want);
  }
  const b64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  async function grab(url) {
    try {
      const r = await fetch(url, {credentials: 'include'});
      if (!r.ok) throw new Error(r.status);
      const b = await r.blob();
      return {mime: b.type, data: await b64(b)};
    } catch {   // другой домен без CORS — забирает фон расширения
      const res = await chrome.runtime.sendMessage({from: 'flow', type: 'fetch', url});
      if (res?.ok) return {mime: res.mime, data: res.data};
      throw new Error('не удалось скачать результат: ' + (res?.error || url.slice(0, 60)));
    }
  }

  // ---- одно задание
  async function run(t) {
    step('Проект');
    if (!await ensureProject()) throw new Error('не открылся проект Flow');
    step('Режим');
    if (!await setMode(t.kind, (t.images || []).length)) log('режим не нашёл — оставил как есть');
    step('Настройки');
    await setSettings(t);
    if (t.images?.length) {
      step('Фото');
      if (!await attach(t.images)) {
        t.images.forEach((d, i) => { const a = document.createElement('a'); a.href = d; a.download = `freefield-${i + 1}.jpg`; document.body.append(a); a.click(); a.remove(); });
        await manual(`Приложите к запросу ${t.images.length === 1 ? 'фото' : t.images.length + ' фото'} (кнопка «+» во Flow) — я сохранил ${t.images.length === 1 ? 'его' : 'их'} в «Загрузки»`);
      }
    }
    step('Промпт');
    const field = await waitFor(promptField, 10000);
    if (!field || !setText(field, t.prompt)) await manual('Вставьте промпт в поле Flow — кнопка «📋 Промпт» ниже скопирует его');
    step('Создать');
    const before = snapshot(), alerts = alertsNow(), f = promptField();
    await submit(f);
    const started = await waitFor(() => !fieldText(f) || document.querySelector('[role=progressbar], progress') || snapshot().size > before.size, 15000);
    if (!started) await manual('Нажмите «Создать» во Flow — дальше я сам');
    step('Жду результат');
    let urls = await waitResults(t.kind, Math.max(1, t.count || 1), before, alerts);
    if (!urls.length && !state.cancel) {
      await manual(`Не вижу готов${t.kind === 'video' ? 'ое видео' : 'ую картинку'} — если оно есть, откройте его на странице, я поищу ещё раз`);
      urls = await waitResults(t.kind, 1, before, alerts);
    }
    if (!urls.length) throw new Error('результат не найден на странице Flow');
    step('Забираю');
    const files = [];
    for (const u of urls) files.push(await grab(u));
    return files;
  }

  // ---- очередь: по одному заданию, результат и ход — в Freefield через фон
  const send = msg => chrome.runtime.sendMessage({from: 'flow', type: 'msg', msg}).catch(() => {});
  let lastSent = 0;
  function status(text) {
    state.text = text; draw();
    if (state.task && Date.now() - lastSent > 2500) { lastSent = Date.now(); send({type: 'progress', id: state.task.id, text: `${state.step} — ${text}`}); }
  }
  function step(name) { state.step = name; log('…'); status(name); lastSent = 0; }
  async function next() {
    if (state.busy) return;
    if (!onFlow()) { setTimeout(next, 3000); return; }
    const {mine = true} = await chrome.runtime.sendMessage({from: 'flow', type: 'claim'}).catch(() => ({}));
    if (!mine || state.busy) return;
    const {queue = []} = await chrome.storage.local.get('queue');
    const todo = queue.filter(t => !state.skip.has(t.id));
    state.total = Math.max(state.total, state.done + todo.length);
    const t = todo[0];
    if (!t) { state.task = null; draw(); return; }
    Object.assign(state, {busy: true, task: t, cancel: false, log: []});
    let msg;
    try { msg = {type: 'result', id: t.id, files: await run(t)}; }
    catch (e) { msg = {type: 'error', id: t.id, message: state.cancel ? 'остановлено' : e.message, log: state.log.slice(-15)}; }
    await chrome.runtime.sendMessage({from: 'flow', type: 'done', id: t.id, msg}).catch(() => {});
    state.done++;
    Object.assign(state, {busy: false, task: null, manual: null});
    draw();
    setTimeout(next, 1500);
  }
  chrome.runtime.onMessage.addListener(m => {
    if (m?.type === 'kick') next();
    if (m?.type === 'cancel' && state.task && m.ids.includes(state.task.id)) { state.cancel = true; state.resume?.(); }
  });

  // ---- панель: что делаю, помощь человека, отчёт
  function manual(msg) {
    state.manual = msg; draw();
    if (state.task) send({type: 'progress', id: state.task.id, text: '✋ нужна помощь во вкладке Flow: ' + msg});
    return new Promise(r => { state.resume = () => { state.manual = null; state.resume = null; draw(); r(); }; });
  }
  function reportText() {
    const t = state.task || {};
    const fields = [...document.querySelectorAll('textarea, [contenteditable="true"], [role=textbox], input')].filter(visible)
      .map(e => `  ${e.tagName.toLowerCase()}${e.type ? '[' + e.type + ']' : ''}: ${labelOf(e).slice(0, 80)}`);
    const btns = clickables().slice(0, 120).map(e => `  ${e.tagName.toLowerCase()}${e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''}${e.getAttribute('aria-haspopup') ? '[menu]' : ''}: ${labelOf(e).slice(0, 70)}`);
    return [`Freefield Автопилот ${chrome.runtime.getManifest().version} — отчёт`, `URL: ${location.href}`, `Шаг: ${state.step}${state.manual ? ' — ' + state.manual : ''}`,
      `Задание: ${t.kind || ''} · ${t.engine || ''} · ${t.aspect || ''} · фото: ${(t.images || []).length}`, `Файловых полей: ${document.querySelectorAll('input[type=file]').length}; img: ${document.querySelectorAll('img').length}; video: ${document.querySelectorAll('video').length}`,
      'Поля ввода:', ...fields, 'Кнопки:', ...btns, 'Журнал:', ...state.log.map(l => '  ' + l)].join('\n');
  }
  function draw() {
    let p = document.getElementById('ff-ap');
    if (!state.task && !state.manual) { p?.remove(); return; }
    if (!p) {
      p = document.createElement('div');
      p.id = 'ff-ap';
      p.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;max-width:calc(100vw - 32px);background:#101014;color:#f3f3f6;border:1px solid rgba(212,255,58,.45);border-radius:16px;padding:12px 14px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.55)';
      p.addEventListener('click', onPanel);
      document.documentElement.append(p);
    }
    const t = state.task, btn = (a, txt, main) => `<button data-ap="${a}" style="margin:6px 6px 0 0;padding:6px 10px;border-radius:10px;border:1px solid ${main ? '#d4ff3a' : 'rgba(255,255,255,.2)'};background:${main ? '#d4ff3a' : 'transparent'};color:${main ? '#0a0a0c' : '#f3f3f6'};font:600 12px system-ui;cursor:pointer">${txt}</button>`;
    p.innerHTML = `<div style="font-weight:700;margin-bottom:4px">🤖 Freefield Автопилот${state.total > 1 ? ` · ${Math.min(state.done + 1, state.total)} из ${state.total}` : ''}</div>
      ${t ? `<div style="color:#9a9aa7;font-size:12px">${t.kind === 'video' ? '🎬 видео' : '🖼 картинка'}${t.engine ? ' · ' + t.engine : ''}${t.aspect ? ' · ' + t.aspect : ''}</div>` : ''}
      <div style="margin-top:6px">${state.manual ? '✋ ' + state.manual : '⏳ ' + (state.text || state.step)}</div>
      <div>${state.manual ? btn('go', '✓ Сделал — продолжай', true) + btn('prompt', '📋 Промпт') : ''}${btn('report', '📋 Отчёт для Claude')}${t ? btn('skip', '⏭ Пропустить') : ''}</div>`;
  }
  async function onPanel(e) {
    const a = e.target.closest('[data-ap]')?.dataset.ap;
    if (!a) return;
    if (a === 'go') state.resume?.();
    if (a === 'prompt' && state.task) navigator.clipboard.writeText(state.task.prompt).catch(() => {});
    if (a === 'report') { await navigator.clipboard.writeText(reportText()).catch(() => {}); e.target.textContent = '✓ Скопировано — пришлите Claude'; }
    if (a === 'skip' && state.task) { state.skip.add(state.task.id); state.cancel = true; state.resume?.(); }
  }

  // вкладка открылась или перезагрузилась — продолжаем очередь
  setTimeout(next, 2500);
})();
