'use strict';
/* ---- «Создание ассетов»: фото через Google Flow / Dola / Arena на компьютере, с фото-референсами ---- */
const ASSET_SVC = {
  flow: {what: 'Nano Banana 2.1 · без кредитов · до 4 фото · берёт несколько референсов'},
  dola: {what: 'Seedream 5.0 · без кредитов · обычно 4 варианта'},
  arena: {what: '2 фото от двух разных моделей · бесплатно'},
};
const ASSET_MAX_REFS = 4;
// «Что создаём» — ассеты рилса по шагам (пользователь 2026-09-27): готовый английский промпт с [ПОЛЯМИ], формат и количество.
// Промпт — шаблон: пользователь меняет [ПОЛЯ] на своё, больше ничего не дописывается
const ASSET_KINDS = {
  // Пользователь 2026-10-08: «когда нажимаю „Создать инфографику“, появлялся промпт для создания инфографики» — промпт готовый,
  // без [ПОЛЕЙ]; тема и заголовок — по желанию у каждой картинки (infoPrompt), пустые выбирает модель
  info: {ico: 'chart', name: 'Создать инфографику', sub: 'о чём ролик · 9:16', aspect: '9:16', many: 'Инфографики',
    ask: 'Сколько инфографик нужно?', note: 'Тему и заголовок можно вписать у каждой — или оставить пустыми, их выберет модель. Дальше откроется выбор фото-примера стиля (не обязателен).',
    hint: 'Промпт инфографики уже в поле. Тема и заголовок — по желанию у каждой картинки; пример стиля — по желанию',
    prompt: 'Vertical infographic poster for a short video: a bold headline at the top, 3–5 key points, each with a simple flat icon and a short label, large readable typography, clean modern layout, strong visual hierarchy, high contrast, consistent color palette, generous spacing, no watermark.',
    legacy: ['Vertical infographic poster for a short video about [TOPIC]. Bold headline at the top: "[HEADLINE]". 3–5 key points, each with a simple flat icon and a short label, large readable typography, clean modern layout, strong visual hierarchy, high contrast, consistent color palette, generous spacing, no watermark.'],
    opt: [['TOPIC', 'Тема — по желанию'], ['HEADLINE', 'Заголовок — по желанию']]},
  // Пользователь 2026-10-08: «при нажатии на „Развёртка героя“ в поле сразу же вводился промпт, который нужен для развёртки» —
  // промпт готовый, без [ПОЛЕЙ]: развёртка — по фото героя (своё у каждой развёртки или общий референс)
  sheet: {ico: 'user', name: 'Развёртка героя', sub: 'спереди, сбоку, сзади · 16:9', aspect: '16:9', many: 'Развёртки героев',
    ask: 'Сколько развёрток героя нужно?', note: 'По одной на героя. Дальше откроется выбор фото: по одному фото на героя, по порядку.',
    hint: 'Промпт развёртки уже в поле — добавьте фото героя, развёртка будет по нему',
    prompt: 'Character turnaround sheet of the same person as in the reference photo, keeping the face, hair and clothing exactly: full-body views from the front, left side, back and right side in one row, plus a face close-up and close-ups of clothing details and accessories. The same person and outfit in every view, consistent proportions, neutral light-gray studio background, even soft lighting, photorealistic, high detail, no text, no watermark.',
    // прежний шаблон с [ПОЛЕМ] — если он остался в поле, это тоже шаблон, а не свой промпт
    legacy: ['Character turnaround sheet of [CHARACTER: age, face, hair, clothing]: full-body views from the front, left side, back and right side in one row, plus a face close-up and close-ups of clothing details and accessories. The same person and outfit in every view, consistent proportions, neutral light-gray studio background, even soft lighting, photorealistic, high detail, no text, no watermark.']},
  // Пользователь 2026-09-29: обязательны развёртка И инфографика; что делает герой и где — не вписывать: модель сама выбирает
  // обстановку по теме инфографики, у каждого кадра — своя (LOC_SCENES)
  // Пользователь 2026-10-07: место и действие можно вписать у каждого кадра (необязательно); инфографика желательна, но не обязательна.
  // Промпт кадра собирает assetItemPrompt: вписанное место и действие, а чего нет — модель выбирает по теме инфографики или сама
  loc: {ico: 'pin', name: 'Персонаж в локации', sub: 'по развёртке · место и действие по желанию · 3:4 ×4', aspect: '3:4', count: 4, many: 'Кадры героя в локациях',
    ask: 'Сколько кадров «персонаж в локации» нужно?', note: 'Один кадр на сценарий. У каждого кадра можно вписать место и действие — или оставить пустыми: их подберут по инфографике (если она есть) или выберет модель.',
    hint: 'Нужна развёртка героя; инфографика желательна. Место и действие — по желанию у каждого кадра',
    prompt: 'Photorealistic vertical portrait of the same character as in the reference turnaround sheet, keeping the face, hair, clothing and details exactly. Natural body posture, cinematic lighting and shadows, documentary photography, high detail, vertical composition, no text, no watermark.',
    opt: [['LOCATION', 'Место — по желанию'], ['ACTION', 'Действие — по желанию']]},
};
// у каждого кадра «персонаж в локации» — своя сцена по теме инфографики (кадры одного запуска не повторяются)
const LOC_SCENES = ['the key moment of the topic: he is doing the main action it is about', 'a close-up moment with a prop, tool or product from the topic',
  'an everyday home setting connected to the topic', 'an outdoor setting connected to the topic', 'a workplace, workshop or shop typical for the topic',
  'he explains something to the camera in a place typical for the topic', 'a moment of success or result that the topic promises',
  'a common problem or mistake from the topic, shown in a real situation', 'a calm evening or morning scene connected to the topic', 'a lively scene with the atmosphere of the topic'];
// без инфографики темы нет — сцены без неё
const LOC_SCENES_FREE = ['a calm everyday moment at home', 'walking along a city street', 'at work in a typical workplace', 'a close-up moment with an object in his hands',
  'he talks to the camera', 'a moment of joy or success', 'outdoors in nature', 'sitting in a cozy cafe', 'by a window in soft evening light', 'a lively scene with people in the background'];
// промпт кадра «персонаж в локации»: основа (поле «Что на фото») + вписанные место и действие; чего нет — по инфографике или на выбор модели
function locPrompt(base, it, i) {
  const place = (it.vals.LOCATION || '').trim(), action = (it.vals.ACTION || '').trim();
  const miss = !place && !action ? 'a real-life setting, props and an action for the character' : !place ? 'a real-life setting and props' : !action ? 'an action for the character' : '';
  const one = place && !action;   // не хватает только действия — одно, остальное — несколько
  const parts = [base];
  if (place) parts.push(`Location: ${place}.`);
  if (action) parts.push(`Action: ${action}.`);
  if (asset.info) parts.push(`The reference infographic shows what the video is about: read it only to understand the topic${miss ? `, then choose yourself ${miss} that clearly ${one ? 'fits' : 'fit'} this topic` : ''}. Never show the infographic itself, its text, icons or charts in the image.`);
  else if (miss) parts.push(`Choose yourself ${miss} that ${one ? 'looks' : 'look'} natural and believable.`);
  if (!place && !action) parts.push(`Scene idea for this shot: ${(asset.info ? LOC_SCENES : LOC_SCENES_FREE)[Math.max(0, i) % LOC_SCENES.length]}.`);
  return parts.join(' ');
}
// промпт инфографики: основа (поле «Что на фото») + вписанные тема и заголовок; пустые — на выбор модели (если основа — шаблон:
// свой промпт пользователя, видимо, уже говорит, о чём инфографика)
function infoPrompt(base, it) {
  const topic = (it.vals.TOPIC || '').trim(), head = (it.vals.HEADLINE || '').trim(), tpl = isAssetTpl(base);
  const parts = [base];
  if (topic) parts.push(`Topic: ${topic}.`);
  else if (tpl) parts.push('Choose yourself a useful, popular topic for a short video.');
  if (head) parts.push(`Headline text exactly: "${head}".`);
  else if (tpl) parts.push(`Write a short, catchy headline for ${topic ? 'this' : 'the'} topic.`);
  return parts.join(' ');
}
const asset = {
  svc: ['flow', 'dola', 'arena'].includes(ls.get('freefield.asset.svc', 'flow')) ? ls.get('freefield.asset.svc', 'flow') : 'flow',   // flow | dola | arena
  model: ls.get('freefield.asset.model', {flow: 'nano-banana-2.1', dola: 'seedream-5-pro'}),
  aspect: ls.get('freefield.asset.aspect', '3:4'),
  count: ls.get('freefield.asset.count', 4),
  refs: [],   // data URL фото-референсов (только в этой вкладке); у «Персонажа в локации» первое — развёртка героя
  info: null,   // инфографика для «Персонажа в локации» — по ней подбирается место и действие
  kind: null,   // выбранная кнопка «Что создаём» (ASSET_KINDS) или null — свой промпт
  n: 1, items: [],   // сколько картинок и у каждой — поля промпта и своё фото ({vals, ref})
  tookSheet: false,
  sending: false,
  save() { ls.set('freefield.asset.svc', this.svc); ls.set('freefield.asset.model', this.model); ls.set('freefield.asset.aspect', this.aspect); ls.set('freefield.asset.count', this.count); },
};
// формат ассета — ближайший из тех, что есть у выбранного сервиса (2:3 есть только в Dola)
const assetAspect = () => fitAr(SITE_AR.image[asset.svc] || SITE_AR.image.flow, asset.aspect);
function setAssetSvc(svc) {
  asset.svc = ['flow', 'dola', 'arena'].includes(svc) ? svc : 'flow';
  asset.save();
  document.body.dataset.asvc = asset.svc;
  renderAsset();
  updateLabels();
}
function assetLocHTML() {
  const slot = (key, ico, name, img) => `<div class="asset-slot ${img ? 'has' : key === 'sheet' ? 'need' : ''}" data-aslot-box="${key}">${img ? `<img src="${img}" alt="">` : `<span>${ico}</span>`}
    <b>${name}</b><small>${img ? 'есть' : key === 'sheet' ? 'обязательно' : 'желательно'}</small>
    <button class="btn small" data-aslot="${key}">${img ? 'Другая' : '＋ Добавить'}</button>${img ? `<button class="asset-slot-rm" data-aslot-rm="${key}" title="Убрать">✕</button>` : ''}</div>`;
  const chars = vc.chars.filter(c => c.sheet);
  return `<div class="asset-slots">${slot('sheet', '🧍', 'Развёртка героя', asset.refs[0])}${slot('info', '📊', 'Инфографика', asset.info)}</div>
    ${asset.refs.slice(1).map((r, i) => `<div class="asset-ref"><img src="${r}" alt=""><button data-aref-rm="${i + 1}" title="Убрать фото">✕</button></div>`).join('')}
    ${chars.length ? `<div class="asset-chars"><span class="hint">Взять у персонажа:</span>${chars.map(c => `<button class="btn small" data-aslot-char="${c.id}">🎭 ${esc(c.name)}</button>`).join('')}</div>` : ''}
    <span class="hint">${asset.info ? 'Пустые место и действие подберутся по теме инфографики — у каждого кадра свои.' : 'Без инфографики пустые место и действие выберет модель.'}</span>`;
}
function assetRefsHTML() {
  if (asset.kind === 'loc') return assetLocHTML();
  const note = !asset.refs.length ? (ASSET_KINDS[asset.kind]?.hint || 'Фото героя (например, полная развёртка персонажа) или сцены — перетащите сюда, вставьте Ctrl+V или нажмите «Добавить референс»')
    : asset.svc === 'flow' ? `Flow возьмёт ${asset.n > 1 ? 'эти фото для каждой картинки' : 'все фото'} как «ингредиенты»: внешность героя сохранится, а сцена будет по промпту`
    : `${SITE_SHORT[asset.svc]} возьмёт ${asset.refs.length > 1 ? 'только первое фото' : 'это фото'} и сделает картинку по нему`;
  return asset.refs.map((r, i) => `<div class="asset-ref"><img src="${r}" alt=""><button data-aref-rm="${i}" title="Убрать фото">✕</button></div>`).join('') +
    `<span class="hint">${note}</span>`;
}
// кнопки «Что создаём»: инфографика, развёртка, герой в локации — и просто «Добавить референс»
function assetKindsHTML() {
  const full = asset.refs.length >= ASSET_MAX_REFS;
  return Object.entries(ASSET_KINDS).map(([k, K]) => `<button class="asset-kind ${asset.kind === k ? 'on' : ''}" data-akind="${k}" aria-pressed="${asset.kind === k}">${ic(K.ico)}<b>${K.name}${asset.kind === k ? `<span class="n-badge">${asset.n} шт.</span>` : ''}</b><small>${K.sub}</small><span class="peek-mini" data-akind-peek="${k}" title="⟨/⟩ Шаблон промпта этой кнопки">⟨/⟩</span></button>`).join('') +
    `<button class="asset-kind add" data-aref-add ${full ? 'disabled' : ''}>${ic('plus')}<b>Добавить референс</b><small>${full ? 'уже 4 фото — больше нельзя' : 'фото героя или сцены · до 4'}</small></button>`;
}

// ---- несколько картинок сразу: у каждой свой промпт (поля шаблона) и, по желанию, своё фото ----
const AKIND_MAX = 10;   // за один раз компьютер принимает до 10 заданий
// поля шаблона: [TOPIC], [HEADLINE], [CHARACTER: …], [ACTION], [LOCATION]
const FIELD_RE = /\[([A-Z][A-Z ]*?)(?::[^\]]*)?\]/g;
const FIELD_RU = {TOPIC: 'Тема ролика', HEADLINE: 'Заголовок на картинке', CHARACTER: 'Герой: возраст, лицо, волосы, одежда', ACTION: 'Что делает герой', LOCATION: 'Где: место, обстановка'};
const assetFields = p => [...new Set([...String(p).matchAll(FIELD_RE)].map(m => m[1]))];
const blankItem = () => ({vals: {}, ref: null});
// основа промпта картинки — общий промпт из поля «Что на фото»
const assetItemBase = () => $('#prompt').value.trim();
// шаблон кнопки «Что создаём» (или прежняя его версия), а не свой промпт пользователя
const isAssetTpl = t => Object.values(ASSET_KINDS).some(x => x.prompt === t || x.legacy?.includes(t));
const assetItemPrompt = it => asset.kind === 'loc' ? locPrompt(assetItemBase(), it, asset.items.indexOf(it)) : asset.kind === 'info' ? infoPrompt(assetItemBase(), it) : assetItemBase().replace(FIELD_RE, (a, key, off, str) => {
  let v = (it.vals[key] || '').trim();
  if (!v) return a;
  if (/(^|[.!?]s+)$/.test(str.slice(0, off))) v = v[0].toUpperCase() + v.slice(1);   // в начале предложения — с большой буквы
  return v;
});
const assetItemFields = () => assetFields(assetItemBase());
// сколько аккаунтов возьмётся сразу: во Flow 4 генерации на аккаунт, в Dola и Arena — 2
const assetCap = () => ({flow: 4, dola: 2, arena: 2})[asset.svc] || 4;
const splitPlan = (n, cap) => Array.from({length: Math.ceil(n / cap)}, (_, i) => Math.min(cap, n - i * cap)).join(' + ');

function assetItemsHTML() {
  const K = ASSET_KINDS[asset.kind];
  if (!K) return '';
  const cards = asset.items.slice(0, asset.n).map((it, i) => {
    const f = assetItemFields(), opt = K.opt;
    // у «Персонажа в локации» — место и действие, у инфографики — тема и заголовок: все необязательные
    const fieldsHTML = opt ? opt.map(([key, ph]) => `<input data-ai-f="${key}" data-ai-i="${i}" value="${esc(it.vals[key] || '')}" placeholder="${ph}" aria-label="${ph}" enterkeyhint="next" autocomplete="off">`).join('') : '';
    return `<div class="asset-item"><b class="n">${i + 1}</b>
      <button class="asset-item-ph ${it.ref ? 'has' : ''}" data-ai-ph="${i}" title="${it.ref ? 'Убрать фото этой картинки' : 'Своё фото для этой картинки (например, герой для развёртки)'}">${it.ref ? `<img src="${it.ref}" alt="">` : ic('plus')}</button>
      <div class="asset-item-f">${opt ? fieldsHTML : f.length ? f.map(key => `<input data-ai-f="${key}" data-ai-i="${i}" value="${esc(it.vals[key] || '')}" placeholder="${esc(FIELD_RU[key] || key)}" aria-label="${esc(FIELD_RU[key] || key)}" enterkeyhint="next" autocomplete="off">`).join('')
        : `<span class="hint">${asset.kind === 'loc' ? 'место и действие — по инфографике, у этого кадра своё' : it.ref ? 'по этому фото — промпт общий'
          : asset.kind === 'sheet' ? (asset.refs.length ? 'по общему фото героя' : 'нужно фото героя — нажмите ＋') : 'промпт общий — поле «Что на фото» ниже'}</span>`}</div>
      ${asset.n > 1 ? `<button class="asset-item-rm" data-ai-rm="${i}" title="Убрать эту картинку" aria-label="Убрать картинку ${i + 1}">✕</button>` : ''}</div>`;
  }).join('');
  return `<div class="block-head asset-items-head" style="margin-top:14px"><span class="lbl">${K.many} · ${asset.n}</span>
      <span class="hint">у каждой — свой промпт · <button data-akind-n title="Поменять, сколько картинок нужно">сколько</button> · <button data-akind-off title="Убрать карточки и писать один свой промпт">свой промпт</button></span></div>
    <div class="asset-items">${cards}</div>`;
}
function renderAssetItems() { const box = $('#assetItems'); if (box) box.innerHTML = assetItemsHTML(); }

// промпт-шаблон — в поле «Что на фото» (общая часть); поля каждой картинки вписываются в её карточке
function fillAssetPrompt(text) {
  const box = $('#prompt');
  box.value = text;
  box.dispatchEvent(new Event('input', {bubbles: true}));
}
function setAssetKind(k) {
  if (asset.kind === k) return openAkindSheet();   // та же кнопка ещё раз — поменять количество
  const K = ASSET_KINDS[k];
  asset.kind = k;
  asset.n = 1;
  asset.items = [blankItem()];
  asset.aspect = K.aspect;
  if (K.count) asset.count = K.count;
  asset.save();
  // «Персонаж в локации» — по развёртке и инфографике: берём их из «Создания сценария» (или у его персонажа), если там уже есть
  asset.tookSheet = false;
  if (k === 'loc') {
    const c = vc.char(wr.char), sheet = wr.sheet || c?.sheet, info = wr.info || c?.info;
    if (!asset.refs.length && sheet) { asset.refs.push(sheet); asset.tookSheet = true; }
    if (!asset.info && info) { asset.info = info; asset.tookSheet = true; }
  }
  // промпт кнопки — сразу в поле «Что на фото»; там был свой промпт — его можно вернуть
  const cur = $('#prompt').value.trim();
  fillAssetPrompt(K.prompt);
  if (cur && !isAssetTpl(cur)) toast(`Промпт «${K.name}» — в поле «Что на фото»`, {ms: 9000, action: 'Вернуть мой', onAction: () => { fillAssetPrompt(cur); renderAssetItems(); }});
  renderAsset();
  updateLabels();
  openAkindSheet();
}
// окно «Сколько нужно?» (1…10) — общее: картинки в «Создании ассетов» и сценарии в «Видео сервисах».
// nums: [{n, sub — подпись под числом, on — выбрано сейчас, off — нельзя, warn — не хватит}]; onPick(n) — нажали число
const countSheet = {onPick: null};
function openCountSheet({title, note, nums, plan, onPick}) {
  $('#akindTitle').textContent = title;
  $('#akindNote').textContent = note;
  $('#akindNums').innerHTML = nums.map(x => `<button data-an="${x.n}" class="${x.on ? 'on' : ''} ${x.warn ? 'warn' : ''}" ${x.off ? 'disabled' : ''}><b>${x.n}</b><small>${x.sub}</small></button>`).join('');
  $('#akindPlan').textContent = plan;
  countSheet.onPick = onPick;
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#akindSheet').classList.remove('hidden');
}
const oneToTen = () => Array.from({length: AKIND_MAX}, (_, i) => i + 1);

// Сколько заданий возьмёт каждый аккаунт — так же, как считает компьютер (mcp/batch.js planBatch): сразу — не больше,
// чем сайт делает одновременно (Flow 4, Dola 2, Arena 2, Vids 1), и не больше, чем хватит кредитов Flow / баллов Dola.
// Пример пользователя: 50 кредитов Flow = 2 видео Omni 1.1 Flash (по 20) → 10 видео = 5 аккаунтов по 2.
// Открытые окна Chrome получают задания поровну, дальше следующий аккаунт заполняется до конца. null — компьютер не подключён
const SITE_PAR = {flow: 4, dola: 2, arena: 2, vids: 1};
function accSim(n, site, kind, model) {
  const info = hubLink.ok && hubLink.info;
  if (!info?.profiles?.length || !SITE_PAR[site]) return null;
  const m = scnModel(kind, site, model) || scnModel(kind, site, scnDefault(kind, site));
  const cost = m?.[4] || 0, open = info.open || [];
  const acc = info.profiles.filter(p => p.login?.[site]?.ok !== false && !p.siteOut?.[site]).map(p => {
    const left = site === 'flow' ? p.flowLeft : site === 'dola' && kind === 'video' ? p.dolaPoints : null;
    return {id: p.id, name: p.name, open: open.includes(p.id), load: 0,
      room: Math.min(SITE_PAR[site], cost && left != null ? Math.floor(left / cost) : SITE_PAR[site])};
  }).filter(a => a.room > 0).sort((a, b) => (b.open - a.open) || (open.indexOf(a.id) - open.indexOf(b.id)) || a.id - b.id);
  let placed = 0;
  for (; placed < n; placed++) {
    const roomy = acc.filter(a => a.load < a.room), o = roomy.filter(a => a.open);
    if (!roomy.length) break;
    (o.length ? o.reduce((b, c) => c.load < b.load ? c : b) : roomy.find(a => a.load > 0) || roomy[0]).load++;
  }
  return {placed, total: acc.reduce((s, a) => s + a.room, 0), used: acc.filter(a => a.load).length, acc, cost, m};
}
// подпись под числом: сколько аккаунтов; не хватает кредитов — «не хватит» (лишние уйдут в следующий бесплатный сервис)
const simSub = (r, n) => r.placed < n ? 'не хватит' : `${r.used} акк.`;
// пояснение: сколько сегодня влезает и в какие аккаунты (по последней проверке баланса)
function simPlan(site, kind, model, what) {
  const r = accSim(99, site, kind, model);
  if (!r) return '';
  const S = SITE_SHORT[site] || site, per = r.acc.map(a => `${a.name} — ${a.room}`).join(', ');
  const price = r.cost && site === 'flow' ? `${r.m[2]} — ${r.cost} кредитов: на аккаунте с 50 кредитами — ${Math.min(SITE_PAR.flow, Math.floor(50 / r.cost))} ${what}. `
    : r.cost && site === 'dola' && kind === 'video' ? `${r.m[2]} — ${r.cost} ${plur(r.cost, 'балл', 'балла', 'баллов')} Dola за видео. ` : '';
  return `${price}Под числом — сколько аккаунтов возьмутся сразу. Сегодня в ${S} можно запустить ${r.total} одновременно: ${per || 'нет свободных аккаунтов'}.` +
    ` Нужно больше — лишние сразу уйдут в следующий бесплатный сервис.`;
}

// «Что создаём» → сколько картинок; под числом — сколько аккаунтов сразу возьмутся за работу
function openAkindSheet() {
  const K = ASSET_KINDS[asset.kind];
  if (!K) return;
  const cap = assetCap(), model = asset.model[asset.svc];
  const sim = n => accSim(n, asset.svc, 'image', model);
  openCountSheet({title: K.ask, note: K.note, onPick: setAssetCount,
    nums: oneToTen().map(n => { const r = sim(n); return {n, on: asset.n === n, warn: r && r.placed < n, sub: r ? simSub(r, n) : `${Math.ceil(n / cap)} акк.`}; }),
    plan: (simPlan(asset.svc, 'image', model, 'картинки') || `Под числом — сколько аккаунтов возьмутся сразу. В ${SITE_SHORT[asset.svc]} одновременно идут ${cap} ${plur(cap, 'генерация', 'генерации', 'генераций')} на аккаунт; если нужно больше, Freefield тут же подключит другие профили Chrome: например, 10 = ${splitPlan(10, cap)}.`) +
      ' Если окон Chrome открыто больше — задания разойдутся по всем открытым поровну, так ещё быстрее.' +
      (asset.svc === 'flow' && asset.count > 1 ? ` У каждой картинки будет ×${asset.count} варианта — это меняется ниже, в «Вариантов каждой».` : '')});
}
// «Видео сервисы» → «＋ Сценарий»: сколько сценариев нужно всего (новые — с настройками последнего)
function openScnCount() {
  const have = cl.scn.length, last = cl.scn.at(-1);
  const site = last && last.service !== 'auto' ? last.service : null, kind = last?.kind || 'video', model = last?.model;
  const sim = n => site ? accSim(n, site, kind, model) : null;
  openCountSheet({title: 'Сколько сценариев нужно?', onPick: n => addScenarios(n - have),
    note: `Сейчас — ${have}. Новые получат настройки последнего: ${kind === 'image' ? 'фото' : 'видео'}, сервис и модель, формат, стиль, камеру и развёртку; текст у каждого свой.`,
    nums: oneToTen().map(n => {
      if (n <= have) return {n, on: n === have, off: true, sub: 'уже есть'};
      const r = sim(n);
      return {n, warn: r && r.placed < n, sub: r ? simSub(r, n) : `+${n - have}`};
    }),
    plan: (site && simPlan(site, kind, model, kind === 'image' ? 'картинки' : 'видео')) ||
      'Freefield запустит все сразу и разложит по аккаунтам: во Flow — до 4 на аккаунт и не больше, чем хватит кредитов (50 кредитов = 2 видео Omni 1.1 Flash), в Dola и Arena — до 2, в Google Vids — 1; нужно больше — тут же подключит другие профили Chrome.'});
}
/* ---- «💳 Проверить баланс» в «Видео сервисах»: какие сервисы проверить и на сколько сценариев хватит ----
   Flow — остаток кредитов компьютер читает прямо с сайта в каждом открытом окне Chrome; сценарии = кредиты ÷ цена видео
   (Omni 1.1 Flash — 20: 50 кредитов = 2 сценария). Dola называет баллы только после видео, Vids и Arena остаток заранее
   не показывают — для них вход, лимиты и что известно. */
const TOK = {sites: ls.get('freefield.tok.sites', ['flow']), model: ls.get('freefield.tok.model', 'omni-1.1-flash'), busy: false, res: null};
const TOK_WHAT = {flow: 'кредиты — прямо с сайта', dola: 'баллы на видео Seedance', vids: 'Omni · 720p · бесплатно', arena: 'битва двух моделей · бесплатно'};
function openTok() {
  if (!hubLink.ok) return toast(hubLink.local() ? 'Компьютер не отвечает — проверьте, что Freefield на нём запущен' : 'Баланс проверяет компьютер — откройте Freefield по ссылке с компьютера (📱 На телефон)', {type: 'err', ms: 7000});
  renderTok();
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#tokSheet').classList.remove('hidden');
}
const tokAgo = t => {
  if (!t) return 'ещё не проверяли';
  if (new Date(t).toDateString() !== new Date().toDateString()) return 'новый день — полный запас';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : `${Math.round(m / 60)} ч назад`;
};
function tokCard(site, total, rows, note) {
  const x = SERVICES.find(v => v.id === site);
  return `<div class="tok-card"><h4><span class="mc-ico" style="background:${x.color}">${esc(x.ico)}</span>${SITE_SHORT[site]}</h4>
    <div class="tok-total">${total}</div>${rows.join('')}${note ? `<div class="tok-note">${note}</div>` : ''}</div>`;
}
const tokRow = (name, value, cls = '') => `<div class="tok-acc"><b>${esc(name)}</b><span class="${cls}">${value}</span></div>`;
function tokResultHTML() {
  const info = hubLink.info, profs = info?.profiles || [];
  if (!profs.length) return '<p class="tok-note">Компьютер ещё не прислал данные об аккаунтах.</p>';
  const err = TOK.res?.errors || {}, open = info.open || [];
  const win = p => open.includes(p.id) ? '' : ' · окно закрыто';
  const out = [];
  if (TOK.sites.includes('flow')) {
    const m = scnModel('video', 'flow', TOK.model) || SCN_MODELS.video[0], cost = m[4];
    let videos = 0, credits = 0, accs = 0;
    const rows = profs.map(p => {
      if (p.login?.flow?.ok === false) return tokRow(p.name, 'не вошли во Flow', 'bad');
      if (p.siteOut?.flow) return tokRow(p.name, 'пауза до завтра', 'bad');
      const n = Math.floor((p.flowLeft ?? 0) / cost);
      videos += n; credits += p.flowLeft ?? 0; if (n) accs++;
      const why = err[p.id] ? ` · ⚠ ${esc(err[p.id])}` : ` · ${tokAgo(p.flowChecked)}${win(p)}`;
      return tokRow(p.name, `${p.flowLeft} кр. → <b>${n}</b> ${plur(n, 'сценарий', 'сценария', 'сценариев')}${why}`, n ? 'ok' : '');
    });
    out.push(tokCard('flow', `<b>${videos}</b> ${plur(videos, 'сценарий', 'сценария', 'сценариев')} ${esc(m[2])} · ${cost} кредитов за видео<br>На ${accs} ${plur(accs, 'аккаунте', 'аккаунтах', 'аккаунтах')} · всего кредитов: ${credits}; одновременно — до 4 на аккаунт`,
      rows, 'Кредиты Flow обновляются каждый день (50 на аккаунт). Закрытые окна не проверяются — для них остаток по последней проверке.'));
  }
  if (TOK.sites.includes('dola')) {
    const mm = SCN_MODELS.video.filter(x => x[0] === 'dola');
    let accs = 0;
    const rows = profs.map(p => {
      if (p.login?.dola?.ok === false) return tokRow(p.name, 'не вошли в Dola', 'bad');
      if (p.siteOut?.dola) return tokRow(p.name, 'лимит на сегодня', 'bad');
      accs++;
      return tokRow(p.name, p.dolaPoints != null ? `${p.dolaPoints} ${plur(p.dolaPoints, 'балл', 'балла', 'баллов')} → ${mm.map(x => `${x[2].replace('Seedance ', '')}: ${Math.floor(p.dolaPoints / x[4])}`).join(', ')}` : `вход есть${win(p)}`, 'ok');
    });
    out.push(tokCard('dola', `<b>${accs}</b> ${plur(accs, 'аккаунт', 'аккаунта', 'аккаунтов')} с Dola · одновременно — до 2 на аккаунт`, rows,
      'Баллы на видео Dola называет только после видео за день — до этого остаток неизвестен. Картинки в Dola — без баллов.'));
  }
  if (TOK.sites.includes('vids')) {
    let accs = 0;
    const rows = profs.map(p => {
      if (p.login?.vids?.ok === false) return tokRow(p.name, 'не вошли в Google Vids', 'bad');
      if (p.siteOut?.vids) return tokRow(p.name, 'лимит ИИ-видео исчерпан', 'bad');
      if (p.vidsWait === 'smart') return tokRow(p.name, 'ждёт: включите «умные функции»', 'bad');
      accs++;
      const used = /(\d+)\s*видео/.exec(p.usage?.vids || '')?.[1];
      // «правила для фото» мешают только видео с фото — видео по тексту идут
      return tokRow(p.name, `доступно${used ? ` · сегодня сделано ${used}` : ''}${p.vidsWait === 'terms' ? ' · для фото — примите правила' : ''}${win(p)}`, 'ok');
    });
    out.push(tokCard('vids', `<b>${accs}</b> ${plur(accs, 'аккаунт', 'аккаунта', 'аккаунтов')} · по 1 видео Omni за раз на аккаунт, бесплатно`, rows,
      'Google Vids даёт около 10 ИИ-видео в месяц на аккаунт; сколько осталось, сайт заранее не показывает — только когда лимит кончится.'));
  }
  if (TOK.sites.includes('arena')) {
    let accs = 0;
    const rows = profs.map(p => {
      if (p.login?.arena?.ok === false) return tokRow(p.name, 'не вошли в Arena', 'bad');
      if (p.siteOut?.arena) return tokRow(p.name, 'дневной лимит исчерпан', 'bad');
      accs++;
      return tokRow(p.name, `доступно${win(p)}`, 'ok');
    });
    out.push(tokCard('arena', `<b>${accs}</b> ${plur(accs, 'аккаунт', 'аккаунта', 'аккаунтов')} · до 2 запросов сразу, 2 видео за запрос, бесплатно`, rows,
      'Дневной лимит Arena сайт показывает, только когда он исчерпан.'));
  }
  const when = TOK.res ? `Проверено ${tokAgo(TOK.res.at)} · окна: ${(TOK.res.checked || []).length}${err.login ? ` · ⚠ ${esc(err.login)}` : ''}` : 'Пока показаны данные последней проверки — нажмите «Проверить», чтобы обновить';
  return out.join('') + `<div class="tok-when">${when}</div>`;
}
function renderTok() {
  const tile = id => { const x = SERVICES.find(v => v.id === id), on = TOK.sites.includes(id);
    return `<button class="asset-svc ${on ? 'on' : ''}" data-tok-svc="${id}" aria-pressed="${on}"><b><span class="mc-ico" style="background:${x.color}">${esc(x.ico)}</span>${SITE_SHORT[id]}</b>${TOK_WHAT[id]}</button>`; };
  $('#tokSvcs').innerHTML = ['flow', 'dola', 'vids', 'arena'].map(tile).join('');
  $('#tokModel').innerHTML = SCN_MODELS.video.filter(m => m[0] === 'flow').map(m => `<option value="${m[1]}" ${TOK.model === m[1] ? 'selected' : ''}>${m[2]} — ${m[4]} кредитов за видео</option>`).join('');
  $('#tokModel').closest('label').classList.toggle('hidden', !TOK.sites.includes('flow'));
  $('#tokGo').disabled = TOK.busy || !TOK.sites.length;
  $('#tokGo').textContent = TOK.busy ? '⏳ Проверяю — во Flow по очереди в каждом окне…' : TOK.sites.length ? `Проверить: ${TOK.sites.map(s => SITE_SHORT[s]).join(', ')}` : 'Выберите сервис';
  $('#tokOut').innerHTML = tokResultHTML();
}
async function runTok() {
  TOK.busy = true; renderTok();
  try {
    const r = await fetch(hubLink.url('/api/balance?sites=' + TOK.sites.join(',')), {method: 'POST'});
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) throw new Error('на компьютере старая версия Freefield — перезапустите Claude Desktop');
    if (!r.ok) throw new Error(j.error || `компьютер ответил ${r.status}`);
    const {ok, checked, errors, ...info} = j;
    hubLink.info = {...hubLink.info, ...info};
    TOK.res = {at: Date.now(), checked, errors: errors || {}};
  } catch (e) { toast('Не удалось проверить: ' + e.message, {type: 'err', ms: 9000}); }
  TOK.busy = false;
  renderTok();
}
function bindTok() {
  $('#tokSheet').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tokSvc) {
      const s = b.dataset.tokSvc;
      TOK.sites = TOK.sites.includes(s) ? TOK.sites.filter(x => x !== s) : [...TOK.sites, s];
      ls.set('freefield.tok.sites', TOK.sites);
      return renderTok();
    }
    if (b.id === 'tokGo' && !TOK.busy) runTok();
  });
  $('#tokModel').addEventListener('change', e => { TOK.model = e.target.value; ls.set('freefield.tok.model', TOK.model); renderTok(); });
}

function addScenarios(k) {
  closeSheets();
  const first = cl.scn.length;
  for (let i = 0; i < k && cl.scn.length < CL_MAX; i++) cl.scn.push(scnLike(cl.scn.at(-1)));
  const added = cl.scn.length - first;
  if (!added) return;
  cl.save(); renderScn(); updateGenButton();
  const box = $$('#scnCreate [data-prompt]')[first];   // к первому новому сценарию
  box?.scrollIntoView({block: 'center', behavior: 'smooth'});
  box?.focus({preventScroll: true});
  toast(`Добавлено ${added} ${plur(added, 'сценарий', 'сценария', 'сценариев')} — впишите текст каждому`, {type: 'ok'});
}
function setAssetCount(n) {
  asset.n = Math.max(1, Math.min(AKIND_MAX, n));
  while (asset.items.length < asset.n) asset.items.push(blankItem());
  closeSheets();
  renderAsset();
  updateGenButton();
  // «Персонаж в локации»: обе картинки есть — выбирать ничего не нужно; нет — окно выбора той, которой не хватает
  if (asset.kind === 'loc') {
    const need = !asset.refs[0] ? 'sheet' : null, took = asset.tookSheet;
    asset.tookSheet = false;
    if (!need) return toast(`${took ? `Развёртку${asset.info ? ' и инфографику' : ''} взял из «Создания сценария». ` : ''}Место и действие — по желанию у каждого кадра; пустые ${asset.info ? 'подберутся по инфографике' : 'выберет модель'}`, {type: 'ok', ms: 6000});
    toast('Выберите фото развёртки героя', {ms: 6000});
    return assetPick(need);
  }
  // сразу — окно выбора фото (нажатие на число — жест пользователя, браузер откроет окно)
  const to = asset.kind === 'sheet' ? 'items' : 'common';
  toast(asset.kind === 'sheet' ? 'Выберите фото героев — по одному на развёртку, по порядку'
    : asset.kind === 'loc' ? 'Выберите фото развёртки героя' : 'Выберите фото-пример стиля — или закройте окно, он не обязателен', {ms: 6000});
  assetPick(to);
}

function renderAsset() {
  const box = $('#assetCreate');
  if (!box) return;
  const tile = id => { const x = SERVICES.find(v => v.id === id);
    return `<button class="asset-svc ${asset.svc === id ? 'on' : ''}" data-asvc="${id}"><b><span class="mc-ico" style="background:${x.color}">${esc(x.ico)}</span>${SITE_SHORT[id]}</b>${ASSET_SVC[id].what}</button>`; };
  const models = SCN_MODELS.image.filter(m => m[0] === asset.svc && asset.svc !== 'arena');
  box.innerHTML = `
    <div class="block-head"><span class="lbl">Сервис</span><span class="hint">фото делаются на компьютере, под вашими аккаунтами</span></div>
    <div class="asset-svcs">${['flow', 'dola', 'arena'].map(tile).join('')}</div>
    ${models.length ? `<select class="asset-model asset-svc-only" data-amodel aria-label="Модель">${models.map(m => `<option value="${m[1]}" ${asset.model[asset.svc] === m[1] ? 'selected' : ''}>${scnModelLabel('image', m)}</option>`).join('')}</select>` : ''}
    <div class="asset-svc-only">
      <div class="block-head" style="margin-top:14px"><span class="lbl">Что создаём</span><span class="hint">готовый промпт и формат — останется вписать своё</span></div>
      <div class="asset-kinds">${assetKindsHTML()}</div>
      <div class="asset-refs" id="assetRefs">${assetRefsHTML()}</div>
      <div id="assetItems">${assetItemsHTML()}</div>
    </div>`;
  const ar = SITE_AR.image[asset.svc] || SITE_AR.image.flow, cur = assetAspect();   // форматы — как на сайте выбранного сервиса
  $('#assetOpts').innerHTML = `
    <div class="block-head"><span class="lbl">Формат</span><span class="hint">${AR_NAME[cur] || ''}${asset.svc === 'arena' ? ' · Arena допишет формат в промпт' : ''}</span></div>
    <div class="chips">${ar.map(a => arChip(a, cur === a, 'data-aar')).join('')}</div>
    ${asset.svc === 'flow' ? `<div class="block-head" style="margin-top:12px"><span class="lbl">${asset.kind ? 'Вариантов каждой' : 'Количество'}</span></div>
      <div class="seg">${[1, 2, 3, 4].map(n => `<button data-acount="${n}" class="${asset.count === n ? 'on' : ''}">×${n}</button>`).join('')}</div>` : ''}
    <div class="cl-live" data-where="asset">${clLiveHTML('asset')}</div>`;
}
// to: 'common' / не задано — общие референсы; 'items' — фото героев развёрток по порядку; число — фото одной картинки
// окно выбора фото: to — куда они пойдут (общие референсы, фото героев развёрток, одной картинки, развёртка или инфографика)
const assetPick = to => pickFile('image/*', true).then(files => assetAddRefs(files, to));
async function assetAddRefs(files, to) {
  const list = [...files].filter(f => f && f.type?.startsWith('image/'));
  if (!list.length) return;
  // «Персонаж в локации»: фото без адреса (вставка, перетаскивание) — в пустое место: сначала развёртка, потом инфографика
  if (asset.kind === 'loc' && (to == null || to === 'common')) to = !asset.refs[0] ? 'sheet' : !asset.info ? 'info' : 'common';
  if (to === 'sheet' || to === 'info') {
    let d;
    try { d = await refDataUrl(list[0]); } catch { return toast('Не удалось прочитать фото', {type: 'err'}); }
    if (to === 'sheet') asset.refs[0] = d; else asset.info = d;
    renderAsset(); updateGenButton();
    if (to === 'sheet' && !asset.info) return toast('Развёртка есть. Теперь инфографика — по ней подберутся место и действие', {ms: 9000,
      action: '📊 Выбрать', onAction: () => assetPick('info')});
    return toast(to === 'sheet' ? 'Развёртка героя добавлена' : 'Инфографика добавлена — место и действие подберутся по ней', {type: 'ok'});
  }
  if (typeof to === 'number' && asset.items[to]) {
    try { asset.items[to].ref = await refDataUrl(list[0]); } catch { return toast('Не удалось прочитать фото', {type: 'err'}); }
    renderAsset(); updateGenButton();
    return toast(`Картинка ${to + 1}: своё фото добавлено`, {type: 'ok'});
  }
  if (to === 'items') {
    // фото k — развёртке k (по порядку, в свободные карточки); фото больше, чем развёрток, — развёрток станет больше (до 10)
    let k = 0, got = 0;
    for (const f of list) {
      while (k < AKIND_MAX && asset.items[k]?.ref) k++;
      if (k >= AKIND_MAX) break;
      asset.items[k] ||= blankItem();
      try { asset.items[k].ref = await refDataUrl(f); got++; } catch { toast('Не удалось прочитать фото', {type: 'err'}); }
      k++;
    }
    asset.n = Math.min(AKIND_MAX, Math.max(asset.n, k));
    while (asset.items.length < asset.n) asset.items.push(blankItem());
    renderAsset(); updateGenButton();
    if (list.length > got && k >= AKIND_MAX) toast(`Больше ${AKIND_MAX} развёрток за раз нельзя — лишние фото не взял`, {type: 'err'});
    return got && toast(`Фото героев: ${got} — развёртки будут по ним`, {type: 'ok'});
  }
  let added = 0;
  for (const f of list) {
    if (asset.refs.length >= ASSET_MAX_REFS) { toast(`Не больше ${ASSET_MAX_REFS} референсов`, {type: 'err'}); break; }
    try { asset.refs.push(await refDataUrl(f)); added++; } catch { toast('Не удалось прочитать фото', {type: 'err'}); }
  }
  renderAsset();
  updateGenButton();
  if (added) toast(added > 1 ? `Добавлено референсов: ${added}` : asset.kind ? 'Референс добавлен' : 'Референс добавлен — опишите, что должно быть на фото', {type: 'ok'});
}
function assetTask(prompt, images = asset.refs) {
  const m = scnModel('image', asset.svc, asset.model[asset.svc]) || scnModel('image', asset.svc, scnDefault('image', asset.svc));
  return {prompt, kind: 'image', service: asset.svc, model: asset.svc === 'arena' ? undefined : m?.[1], aspect_ratio: assetAspect(),
    count: asset.svc === 'flow' ? asset.count : undefined, images: images.length ? images : undefined};
}
async function assetGo() {
  const raw = $('#prompt').value.trim();
  if (raw.length < 3) return nudge('Опишите, что должно быть на фото: герой, место, действие, свет');
  const list = asset.kind ? asset.items.slice(0, asset.n) : null;
  // у каждой картинки должны быть вписаны её поля (у инфографики и «Персонажа в локации» они по желанию)
  for (const [i, it] of (ASSET_KINDS[asset.kind]?.opt ? [] : list || []).entries()) {
    const miss = assetItemFields().find(key => !(it.vals[key] || '').trim());
    if (!miss) continue;
    const inp = $(`#assetCreate [data-ai-i="${i}"][data-ai-f="${miss}"]`);
    inp?.classList.add('miss');
    inp?.scrollIntoView({block: 'center', behavior: 'smooth'});
    inp?.focus({preventScroll: true});
    return toast(`Картинка ${i + 1}: впишите «${FIELD_RU[miss] || miss}»`, {type: 'err'});
  }
  // поля по-русски — на английский как есть (заголовок инфографики — надпись на картинке — остаётся как написан)
  let items = list;
  if (list?.some(it => Object.entries(it.vals).some(([k, v]) => k !== 'HEADLINE' && /[а-яё]/i.test(v)))) {
    asset.sending = true; updateGenButton();
    items = await Promise.all(list.map(async it => ({...it, vals: Object.fromEntries(await Promise.all(Object.entries(it.vals)
      .map(async ([k, v]) => [k, k === 'HEADLINE' ? v : await asIs(v)])))})));
    asset.sending = false; updateGenButton();
  }
  const prompts = items ? items.map(assetItemPrompt) : [raw];
  // шаблон с незаполненными [ПОЛЯМИ]
  if (prompts.some(p => /\[[A-Z][A-Z ]*[\]:]/.test(p))) return nudge('Впишите своё вместо [ПОЛЕЙ] в промпте: тема, герой, место…');
  if (asset.kind === 'loc' && !asset.refs[0] && !list.every(it => it.ref)) {
    $(`#assetCreate [data-aslot-box="sheet"]`)?.classList.add('miss');
    return toast('Для «Персонажа в локации» нужна развёртка героя', {type: 'err', ms: 8000, action: '🧍 Выбрать развёртку', onAction: () => assetPick('sheet')});
  }
  // развёртка по шаблону делается по фото героя: у картинки своё фото или общий референс
  const noPh = asset.kind === 'sheet' && isAssetTpl(raw) && !asset.refs.length ? list.findIndex(it => !it.ref) : -1;
  if (noPh >= 0) {
    const ph = $(`#assetCreate [data-ai-ph="${noPh}"]`);
    ph?.classList.add('miss');
    ph?.scrollIntoView({block: 'center', behavior: 'smooth'});
    return toast(`${list.length > 1 ? `Развёртка ${noPh + 1}: нужно` : 'Нужно'} фото героя — развёртка делается по нему`, {type: 'err', ms: 8000,
      action: '🧍 Выбрать фото', onAction: () => assetPick(noPh)});
  }
  // фото картинки: своё (герой этой развёртки) + общие референсы — до 4 (столько «ингредиентов» берёт Flow);
  // у «Персонажа в локации» последней всегда идёт инфографика
  const imgsOf = it => asset.kind === 'loc' ? [...[...(it?.ref ? [it.ref] : []), ...asset.refs].slice(0, ASSET_MAX_REFS - (asset.info ? 1 : 0)), ...(asset.info ? [asset.info] : [])]
    : [...(it?.ref ? [it.ref] : []), ...asset.refs].slice(0, ASSET_MAX_REFS);
  const tasks = (list || [null]).map((it, i) => assetTask(composePrompt(prompts[i], state.style, 'image'), imgsOf(it)));
  if (peek.on) return peekShow('Создание ассетов', {prompts: tasks.map((t, i) => [`Картинка ${i + 1} → ${SITE_SHORT[t.service] || t.service} · ${t.model || ''}`, t.prompt]),
    request: {куда: 'программа на компьютере: POST /api/batch', body: {scenarios: tasks}}});
  // без компьютера — карточки для сайтов: «Создать» во Flow, Dola или Arena пользователь нажимает сам
  if (!(await hubReady())) return phoneCards(tasks);
  asset.sending = true;
  updateGenButton();
  try {
    // промпты уходят как написаны (без авто-улучшения); компьютер раскладывает их по аккаунтам: во Flow — до 4 на аккаунт сразу
    const r = await fetch(hubLink.url('/api/batch'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({scenarios: tasks})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `компьютер ответил ${r.status}`);
    const by = {};
    for (const x of j.items || []) { const k = `${SITE_SHORT[x.site] || x.site}${x.profileName ? ' · ' + x.profileName : ''}`; by[k] = (by[k] || 0) + 1; }
    const where = Object.entries(by).map(([k, n]) => `${k}: ${n}`).join(', ');
    toast(tasks.length > 1 ? `Отправлено ${tasks.length} ${plur(tasks.length, 'картинка', 'картинки', 'картинок')} — ${where || SITE_SHORT[asset.svc]}. Готовые фото сами появятся в галерее`
      : `Отправлено в ${SITE_SHORT[asset.svc]} — готовые фото сами появятся в галерее`, {type: 'ok', ms: 9000});
  } catch (e) { toast('Не удалось отправить: ' + e.message, {type: 'err'}); }
  asset.sending = false;
  updateGenButton();
  hubLink.refresh();
}
function bindAsset() {
  const onClick = e => {
    // ⟨/⟩ на кнопке «Что создаём» — её шаблон промпта (кнопку не нажимаем)
    const pk = e.target.closest('[data-akind-peek]');
    if (pk) {
      e.stopPropagation();
      const K = ASSET_KINDS[pk.dataset.akindPeek];
      const isLoc = pk.dataset.akindPeek === 'loc', isInfo = pk.dataset.akindPeek === 'info';
      return peekShow(K.name, {prompts: [[isLoc || isInfo ? 'Основа (поле «Что на фото»)' : 'Промпт', K.prompt],
        ...(isInfo ? [['Что дописывается к каждой картинке', ['Тема вписана → Topic: <тема>.', 'Нет темы → Choose yourself a useful, popular topic for a short video.',
          'Заголовок вписан → Headline text exactly: "<заголовок>".', 'Нет заголовка → Write a short, catchy headline for the topic.',
          'Основу в поле поменяли на свою — о пустых теме и заголовке ничего не дописывается.'].join('\n')]] : []),
        ...(isLoc ? [['Что дописывается к каждому кадру', ['Место вписано → Location: <место>.', 'Действие вписано → Action: <действие>.',
          'Есть инфографика → The reference infographic shows what the video is about: read it only to understand the topic, then choose yourself <чего не вписано> that clearly fit this topic. Never show the infographic itself, its text, icons or charts in the image.',
          'Нет инфографики, что-то не вписано → Choose yourself <чего не вписано> that look natural and believable.',
          'Ни места, ни действия → Scene idea for this shot: <сцена по очереди из списка ниже>.'].join('\n')],
          ['Сцены — с инфографикой', LOC_SCENES.map((x, i) => `${i + 1}. ${x}`).join('\n')], ['Сцены — без инфографики', LOC_SCENES_FREE.map((x, i) => `${i + 1}. ${x}`).join('\n')]] : [])],
        request: {формат: K.aspect, картинок_за_раз: K.count || asset.count, фото: pk.dataset.akindPeek === 'loc' ? ['развёртка героя', 'инфографика (последней, если есть)'] : pk.dataset.akindPeek === 'sheet' ? ['фото героя — своё у каждой развёртки или общее'] : ['пример стиля — по желанию'],
          куда: 'программа на компьютере: POST /api/batch → ' + SITE_SHORT[asset.svc]}});
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.asvc) return setAssetSvc(b.dataset.asvc);
    if (b.dataset.aar) { asset.aspect = b.dataset.aar; asset.save(); return renderAsset(); }
    if (b.dataset.acount) { asset.count = +b.dataset.acount; asset.save(); renderAsset(); return updateGenButton(); }
    if (b.dataset.akind) return setAssetKind(b.dataset.akind);
    if (b.hasAttribute('data-akind-n')) return openAkindSheet();
    // ✕ у картинки — убрать её (остальные сдвигаются, их поля и фото сохраняются)
    if (b.dataset.aiRm) { asset.items.splice(+b.dataset.aiRm, 1); asset.n = Math.max(1, asset.n - 1); renderAsset(); return updateGenButton(); }
    if (b.hasAttribute('data-akind-off')) { asset.kind = null; renderAsset(); updateLabels(); return; }   // обратно к одному своему промпту
    // своё фото картинки: есть — убрать, нет — выбрать
    if (b.dataset.aiPh) {
      const i = +b.dataset.aiPh;
      if (asset.items[i]?.ref) { asset.items[i].ref = null; renderAsset(); return updateGenButton(); }
      return assetPick(i);
    }
    if (b.hasAttribute('data-aref-add')) return assetPick('common');
    // «Персонаж в локации»: места «Развёртка» и «Инфографика», «Взять у персонажа»
    if (b.dataset.aslot) return assetPick(b.dataset.aslot);
    if (b.dataset.aslotRm) { if (b.dataset.aslotRm === 'info') asset.info = null; else asset.refs.splice(0, 1); renderAsset(); return updateGenButton(); }
    if (b.dataset.aslotChar) {
      const c = vc.char(b.dataset.aslotChar);
      if (!c) return;
      asset.refs[0] = c.sheet; asset.info = c.info || asset.info || null;
      renderAsset(); updateGenButton();
      return toast(`${c.name}: ${asset.info ? 'развёртка и инфографика' : 'развёртка'} на месте — жмите «Создать»`, {type: 'ok'});
    }
    if (b.dataset.arefRm) { asset.refs.splice(+b.dataset.arefRm, 1); renderAsset(); return updateGenButton(); }
    if (b.hasAttribute('data-import-all')) return hubLink.importAll(b);
  };
  $('#assetCreate').addEventListener('click', onClick);
  $('#assetOpts').addEventListener('click', onClick);
  $('#assetCreate').addEventListener('change', e => {
    if (!e.target.matches('[data-amodel]')) return;
    asset.model = {...asset.model, [asset.svc]: e.target.value};
    asset.save(); updateGenButton();
  });
  // поля картинок: значение — сразу в память (без перерисовки, чтобы не сбить ввод); Enter — к следующему полю
  $('#assetCreate').addEventListener('input', e => {
    const f = e.target.closest('[data-ai-f]');
    if (!f) return;
    const it = asset.items[+f.dataset.aiI];
    if (it) it.vals[f.dataset.aiF] = f.value;
    f.classList.remove('miss');
  });
  $('#assetCreate').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('[data-ai-f]')) return;
    e.preventDefault();
    const all = $$('#assetCreate [data-ai-f]'), next = all[all.indexOf(e.target) + 1];
    next ? next.focus() : $('#prompt').focus();
  });
  // поменяли общий промпт — поля в карточках могли измениться
  let itemsTimer = null;
  $('#prompt').addEventListener('input', () => { if (asset.kind) { clearTimeout(itemsTimer); itemsTimer = setTimeout(renderAssetItems, 300); } });
  $('#akindSheet').addEventListener('click', e => { const b = e.target.closest('[data-an]'); if (b && !b.disabled) countSheet.onPick?.(+b.dataset.an); });
  // перетаскивание фото на блок референсов
  const over = e => e.target.closest?.('#assetRefs');
  $('#assetCreate').addEventListener('dragover', e => { const z = over(e); if (z) { e.preventDefault(); z.classList.add('drag'); } });
  $('#assetCreate').addEventListener('dragleave', e => over(e)?.classList.remove('drag'));
  $('#assetCreate').addEventListener('drop', e => {
    const z = over(e); if (!z) return;
    e.preventDefault(); z.classList.remove('drag');
    assetAddRefs(e.dataTransfer.files);
  });
}
