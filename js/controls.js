'use strict';
/* =============================== controls =============================== */


function updateGenButton() {
  if (cl.mode === 'voice') return;   // в «Озвучке» большой кнопки нет — всё в самом «Эхо»
  if (cl.mode === 'edit') {
    const btn = $('#genBtn'), segs = mtSegs(), n = segs.length;
    btn.classList.remove('paid');
    btn.disabled = false;
    $('#genLabel').textContent = mt.job ? `⏳ Склеиваю… ${Math.round(mt.job.pct * 100)}%` : n ? '🎞 Склеить видео' : '🎞 Добавьте видео';
    $('#genSub').textContent = n ? `${n} ${plur(n, 'клип', 'клипа', 'клипов')} · ${mtFmt(mtTotal(segs))}` : 'из галереи';
    $('#etaLine').textContent = '';
    return;
  }
  if (cl.mode === '3d') {
    const btn = $('#genBtn');
    btn.classList.remove('paid');
    btn.disabled = m3d.sending;
    $('#genLabel').textContent = m3d.sending ? '⏳ Отправляю…' : m3d.src ? '🧊 Сделать 3D-модель' : '🧊 Выберите картинку';
    $('#genSub').textContent = 'на компьютере';
    $('#etaLine').textContent = '';
    return;
  }
  if (cl.mode === 'chars') {
    const n = vc.chars.length, btn = $('#genBtn');
    btn.classList.remove('paid');
    btn.disabled = false;
    $('#genLabel').textContent = '＋ Новый персонаж';
    $('#genSub').textContent = n ? `${n} ${plur(n, 'персонаж', 'персонажа', 'персонажей')}` : 'первый';
    $('#etaLine').textContent = 'Персонажи хранятся в этом браузере · выберите героя в «Сценариях» — всё встанет в ячейки';
    return;
  }
  if (cl.mode === 'write') {
    const who = writerNow(), btn = $('#genBtn'), have = who === 'chat' || wr.info && wr.sheet, gap = wrLocGap();
    btn.classList.toggle('paid', who === 'claude');
    btn.disabled = wr.busy;
    if (wrNeedKey()) {
      $('#genLabel').textContent = '🔑 Подключить Gemini — бесплатно';
      $('#genSub').textContent = 'один раз';
      $('#etaLine').textContent = 'Чтобы ИИ писал сценарии прямо здесь, нужен бесплатный ключ Google — около минуты';
      return;
    }
    $('#genLabel').textContent = wr.busy ? '⏳ ИИ пишет сценарии…' : !have ? '✍️ Загрузите инфографику и развёртку'
      : gap > 0 ? `📍 Нужно ещё ${gap} ${plur(gap, 'кадр', 'кадра', 'кадров')} в локациях` : gap < 0 ? `📍 Лишних кадров в локациях: ${-gap}`
      : who === 'chat' ? `📋 Скопировать задание: ${wr.count} ${plur(wr.count, 'сценарий', 'сценария', 'сценариев')}`
      : `✍️ Написать ${wr.count} ${plur(wr.count, 'сценарий', 'сценария', 'сценариев')}`;
    $('#genSub').textContent = who === 'chat' ? 'скопировать' : WRITERS[who].name;
    $('#etaLine').textContent = who === 'sub' ? `Claude Code на вашем компьютере · по подписке, без доплат${writerReady('sub') ? '' : ' · нужен Freefield на компьютере'}`
      : who === 'free' ? 'Бесплатный ИИ без ключа · картинки не видит, пишет слабее'
      : who === 'claude' ? `${CLAUDE_MODELS.find(m => m[0] === wr.claudeModel)?.[1] || wr.claudeModel} · платно, с вашего счёта Anthropic${wallet.anthropic ? '' : ' · нужен ключ'}`
      : who === 'gemini' ? 'Gemini · бесплатно по вашему ключу Google'
      : 'Скопирую эталонный промпт и просьбу написать сценарии — вставьте в чат с ИИ (Gemini, Claude, ChatGPT)';
    return;
  }
  if (cl.mode === 'scn') {
    const n = cl.ready().length, btn = $('#genBtn');
    btn.classList.remove('paid');
    btn.disabled = cl.sending;
    $('#genLabel').textContent = cl.sending ? (hubLink.ok ? '⏳ Отправляю…' : '⏳ Готовлю…') : `${hubLink.ok ? '🚀 Запустить' : '📱 Подготовить'} ${n ? n + ' ' + plur(n, 'сценарий', 'сценария', 'сценариев') : 'сценарии'}`;
    $('#genSub').textContent = hubLink.ok ? 'на компьютере' : 'вручную на сайтах';
    $('#etaLine').textContent = hubLink.ok ? 'Google Vids · Google Flow · Arena · Dola — бесплатные кредиты' : 'Без компьютера: подготовлю фото и промпты — «Создать» на сайтах нажмёте сами';
    return;
  }
  // «Фото»
  const btn = $('#genBtn'), m = scnModel('image', asset.svc, asset.model[asset.svc]) || scnModel('image', asset.svc, scnDefault('image', asset.svc));
  btn.classList.remove('paid');
  btn.disabled = asset.sending;
  const n = asset.kind ? asset.n : 1;   // несколько картинок со своими промптами — «Создать 10 картинок · Google Flow ×4»
  $('#genLabel').textContent = asset.sending ? '⏳ Отправляю…' : `🖼 Создать ${n > 1 ? `${n} ${plur(n, 'картинку', 'картинки', 'картинок')} · ` : 'в '}${SITE_SHORT[asset.svc]}${asset.svc === 'flow' ? ' ×' + asset.count : ''}`;
  $('#genSub').textContent = hubLink.ok ? 'на компьютере' : 'вручную на сайте';
  $('#etaLine').textContent = (asset.svc === 'arena' ? 'Arena · 2 фото от двух моделей' : m ? m[2] + ' · ' + m[3] : '') +
    (asset.kind === 'loc' ? (asset.refs[0] ? ` · развёртка ✓${asset.info ? ' · инфографика ✓' : ''}` : ' · нужна развёртка')
      : asset.refs.length ? ` · референсов: ${asset.refs.length}` : '') + (hubLink.ok ? '' : ' · без компьютера — «Создать» на сайте нажмёте сами');
}

function setView(v) {
  if (v !== 'create' && mtPv.playing) mtPause();   // ушли в галерею — предпросмотр «Монтажа» не играет за кадром
  state.view = v;
  document.body.dataset.view = v;
  $$('#bottomNav [data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === v));
  if (v === 'gallery') requestAnimationFrame(() => { if (colCount() !== lastCols) render(); });
}
// стиль: общий (для всех) или — если в «Сценариях» выбран сценарий кнопкой 🎨 — только для этого сценария
const styleTarget = () => cl.mode === 'scn' && cl.sel != null ? cl.scn[cl.sel] : null;
function setStyle(id) {
  const s = styleTarget();
  if (s) { s.style = id; cl.save(); renderScn(); }
  else { state.style = id; saveSettings(); }
  styleSync();
}
function styleSync() {
  const s = styleTarget(), cur = s?.style ?? state.style;
  $$('.style-card[data-id]').forEach(c => c.classList.toggle('on', c.dataset.id === cur));
  $('#styleName').innerHTML = s
    ? `для сценария ${cl.sel + 1}: <b>${esc(styleOf(cur).name)}</b>${s.style == null ? ' (как у всех)' : ' · <button class="wr-link" data-style-common>↺ как у всех</button>'} · <button class="wr-link" data-style-unsel>✕ отменить выбор</button>`
    : esc(styleOf(cur).name) + (cl.mode === 'scn' ? ' — для всех сценариев' : '');
  $$('.cl-plan').forEach(el => { el.innerHTML = clPlanText(); });   // в режиме сценариев план пишет, какой стиль добавится
}
function renderStyleGrid() {
  $('#styleGrid').innerHTML = allStyles().map(s =>
    `<button class="style-card" data-id="${s.id}" title="${esc(s.custom ? s.text || s.suffix : s.suffix || 'Без добавок к промпту')}"><div class="th" style="background:${s.bg}">${s.emoji}${s.custom
      ? `<span class="style-del" data-style-del="${s.id}" title="Удалить этот стиль">✕</span>` : `<img src="img/styles/${s.id}.webp" alt="" loading="lazy" onerror="styleImgFail(this)">`}</div><div class="nm">${esc(s.name)}</div></button>`).join('') +
    '<button class="style-card style-add" data-style-add title="Добавить свой стиль: название и описание"><div class="th">＋</div><div class="nm">Свой стиль</div></button>';
  styleSync();
}
async function addCustomStyle() {
  const name = $('#styleFormName').value.trim(), text = $('#styleFormText').value.trim(), btn = $('#styleFormSave');
  if (!name || text.length < 3) return toast('Впишите название и описание стиля', {type: 'err'});
  btn.disabled = true; btn.textContent = 'Сохраняю…';
  let suffix = text;
  try { suffix = await translateKeepQuotes(text); } catch { /* останется как написано */ }
  btn.disabled = false; btn.textContent = 'Сохранить стиль';
  const st = {id: 'my-' + uid(), name, emoji: '✨', bg: STYLE_BG[customStyles.length % STYLE_BG.length], suffix: suffix.trim().replace(/[.\s]+$/, ''), text, custom: true};
  customStyles.push(st);
  ls.set('freefield.styles.custom', customStyles);
  $('#styleForm').hidden = true; $('#styleFormName').value = $('#styleFormText').value = '';
  renderStyleGrid();
  const s = styleTarget();
  setStyle(st.id);
  toast(`Стиль «${name}» добавлен${s ? ` и назначен сценарию ${cl.sel + 1}` : ' и выбран'}`, {type: 'ok'});
}
function delCustomStyle(id) {
  const st = customStyles.find(s => s.id === id);
  if (!st || !confirm(`Удалить стиль «${st.name}»?`)) return;
  customStyles = customStyles.filter(s => s.id !== id);
  ls.set('freefield.styles.custom', customStyles);
  cl.scn.forEach(s => { if (s.style === id) delete s.style; });
  cl.save();
  if (state.style === id) { state.style = 'none'; saveSettings(); }
  renderStyleGrid();
  if (cl.mode === 'scn') renderScn();
}
// группы пресетов камеры (вкладки над сеткой) и сама сетка с живыми превью
const motionGroupsHTML = cur => MOTION_GROUPS.map(([id, name, icon]) =>
  `<button class="mv-group ${cur === id ? 'on' : ''}" data-g="${id}">${ic(icon)}${name}<small>${motionsOf(id).length}</small></button>`).join('');
const motionCardsHTML = (g, sel) => motionsOf(g).map((m, i) =>
  `<button class="motion-card ${m.id === sel ? 'on' : ''}" data-id="${m.id}" title="${esc(m.desc)}" style="animation-delay:${i * 28}ms"><div class="mv"><canvas></canvas></div><span class="mv-tick">${ic('check')}</span><div class="nm">${esc(m.name)}</div></button>`).join('');
// «Видео»: у видео-сценария своё движение камеры (окно с теми же живыми превью)
const camPick = {i: null, g: 'top'};
function openCamPick(i) {
  const s = cl.scn[i];
  if (!s) return;
  const cur = s.camera && MOTIONS.find(m => m.id === s.camera);
  Object.assign(camPick, {i, g: cur ? (cur.top ? 'top' : cur.g) : 'top'});
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#camSheet').classList.remove('hidden');
  renderCamPick();
}
function renderCamPick() {
  const s = cl.scn[camPick.i];
  $('#camFor').textContent = `сценарий ${camPick.i + 1}`;
  $('#camGroups').innerHTML = motionGroupsHTML(camPick.g);
  $('#camGrid').innerHTML = motionCardsHTML(camPick.g, s?.camera);
  CamPreview.mount($('#camGrid'));
}
// движение из пресета — в строку «Camera & framing» эталона (нет строки — новой строкой), в обычный промпт — в конец
function withCamera(p, id) {
  const m = id && MOTIONS.find(x => x.id === id);
  if (!m) return p;
  if (isBlockPrompt(p)) {
    const re = /^([ \t]*Camera & framing[ \t]*:)[ \t]*(.*)$/mi;
    return re.test(p) ? p.replace(re, (a, l, v) => `${l} ${v.trim() ? v.trim().replace(/[.;,\s]+$/, '') + '; ' : ''}${m.prompt}`) : `${p}\nCamera & framing: ${m.prompt}`;
  }
  return `${String(p).trim().replace(/[.,;\s]+$/, '')}, ${m.prompt}`;
}
function updateLabels() {
  $('#promptLabel').textContent = asset.kind ? 'Общий промпт — поля из карточек выше' : 'Что на фото';
  $('#prompt').placeholder = 'Например: тот же герой с развёртки сидит за столом в старой мастерской, в руке ноутбук, тёплый свет… Можно по-русски — кнопка «🌐 На английский» переведёт';
  updateGenButton();
}

function buildControls() {
  renderStyleGrid();
}
// пустая галерея: открыта файлом — подсказать, где настоящая; есть связь с компьютером — забрать готовое
function renderEmpty() {
  const el = $('#emptyAct');
  if (!el) return;
  // с чего начать: программа на компьютере → вход в аккаунты Google → персонаж (сделанное — с галочкой)
  const profs = hubLink.info?.profiles?.length ? hubLink.info.profiles : hubLink.info ? [hubLink.info] : [];
  const logged = profs.some(p => ['flow', 'dola', 'arena', 'vids'].some(id => p.login?.[id]?.ok));
  const phone = pwa.mobile() || isMobile();
  const step = (n, done, ico, title, text, attr) => `<button class="feat ${done ? 'done' : ''}" ${attr}><b><svg class="ic"><use href="#i-${ico}"/></svg>${n}. ${title}<i class="fs-ok">${done ? '✓' : ''}</i></b><span>${text}</span></button>`;
  $('#firstSteps').innerHTML =
    step(1, hubLink.ok, 'plug', phone ? 'Компьютер' : 'Программа Freefield', hubLink.ok ? 'Подключена — задания уходят на компьютер.'
      : phone ? 'На компьютере во Freefield: «📱 На телефон» → наведите камеру на QR-код.' : 'Откройте Claude Desktop или запустите Freefield из папки — она делает фото и видео.', 'data-step="pc"') +
    step(2, logged, 'users', 'Аккаунты Google', logged ? 'Вход выполнен — кредиты Flow, Dola, Arena ваши.' : 'Войдите в Google Flow, Dola и Arena в окне Chrome Freefield — один раз.', 'data-step="acc"') +
    step(3, vc.chars.length > 0, 'image', 'Персонаж', vc.chars.length ? `Есть: ${vc.chars.map(c => esc(c.name || 'без имени')).slice(0, 3).join(', ')}${vc.chars.length > 3 ? '…' : ''}. Дальше — «🚀 Серия роликов» у персонажа.`
      : 'Развёртка, инфографика, кадры и голос — один раз, для всех роликов.', 'data-step="char"');
  el.innerHTML = /^(file|data):$/.test(location.protocol) && !native.on()
    ? '<div class="cl-conn">Эта страница открыта файлом — у неё своя, пустая галерея. Ваши фото и видео — в Freefield с компьютера: <a href="http://localhost:5180/">localhost:5180</a></div>'
    : hubLink.ok ? '<button class="btn" data-import-all title="Компьютер проверит сервисы (Flow…) и отдаст все картинки и видео за сегодня и вчера">🔄 Забрать всё из сервисов</button>' : '';
}

function bindControls() {
  // окно движения камеры для сценария: группа, выбор пресета, «без пресета»
  $('#camSheet').addEventListener('click', e => {
    const s = cl.scn[camPick.i], g = e.target.closest('[data-g]'), card = e.target.closest('.motion-card');
    if (g) { camPick.g = g.dataset.g; return renderCamPick(); }
    if (!s || !(card || e.target.closest('[data-cam-none]'))) return;
    if (card) s.camera = card.dataset.id; else delete s.camera;
    cl.save(); closeSheets(); renderScn();
    toast(card ? `Сценарий ${camPick.i + 1}: камера — «${byId(MOTIONS, s.camera).name}»` : `Сценарий ${camPick.i + 1}: без пресета камеры`, {type: 'ok'});
  });
  $('#styleGrid').addEventListener('click', e => {
    const del = e.target.closest('[data-style-del]');
    if (del) { e.stopPropagation(); return delCustomStyle(del.dataset.styleDel); }
    if (e.target.closest('[data-style-add]')) { $('#styleForm').hidden = false; return $('#styleFormName').focus(); }
    const c = e.target.closest('.style-card[data-id]');
    if (c) setStyle(c.dataset.id);
  });
  $('#styleName').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !styleTarget()) return;
    if (b.hasAttribute('data-style-common')) { delete styleTarget().style; cl.save(); }
    else if (b.hasAttribute('data-style-unsel')) cl.sel = null;
    renderScn(); styleSync();
  });
  $('#styleFormSave').addEventListener('click', addCustomStyle);
  $('#styleFormCancel').addEventListener('click', () => { $('#styleForm').hidden = true; });
  $('#prompt').addEventListener('input', e => { state.prompts[state.mode] = e.target.value; saveSettings(); });
  $('#prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); createGo(); } });
  $('#genBtn').addEventListener('click', createGo);
  $('#accBtn').addEventListener('click', openAcc);
  $('#mcpOpen').addEventListener('click', openMcp);
  // «Режим разработчика»: кнопки ⟨/⟩ видны только с ним
  $('#devMode').checked = document.body.classList.toggle('dev', !!ls.get('freefield.dev', false));
  $('#devMode').addEventListener('change', e => { ls.set('freefield.dev', e.target.checked); document.body.classList.toggle('dev', e.target.checked); });
  $('#pcBtn').addEventListener('click', pcBtnClick);
  $('#mcpBody').addEventListener('change', e => {   // адрес туннеля → ссылка коннектора
    if (!e.target.matches('[data-mcp-tunnel]')) return;
    const v = e.target.value.trim().replace(/\/+$/, '').replace(/\/mcp.*$/, '');
    if (v && !/^https:\/\/[\w.-]+(:\d+)?$/.test(v)) return toast('Нужен адрес вида https://….trycloudflare.com', {type: 'err'});
    ls.set('freefield.mcpTunnel', v);
    renderMcp();
  });
  $('#mcpBody').addEventListener('click', async e => {
    const b = e.target.closest('[data-mcp-copy]');
    if (b) toast(await clCopyText(mcpVals[+b.dataset.mcpCopy]) ? 'Скопировано' : 'Не удалось скопировать', {type: 'ok'});
  });
  $('#scnAcc').addEventListener('click', async e => {   // «↻ Проверить ещё раз» — искать программу Freefield на компьютере
    const b = e.target.closest('[data-acc-find]');
    if (!b) return;
    hubLink.pcUp = null; renderScnAcc();
    await hubLink.tryDirect(); renderScnAcc();
    toast(hubLink.ok ? 'Freefield на компьютере найден — профили Chrome здесь' : hubLink.pcUp ? 'Программа запущена, но сайт к себе не пускает — откройте Freefield с компьютера' : 'Программа Freefield на компьютере не запущена', {type: hubLink.ok ? 'ok' : 'err', ms: 7000});
  });
  bindClaude();
  bindAsset();
  bindTok();
  bindWrite();
  bindVoices();
  bindChars();
  $('#hubBody').addEventListener('click', e => {
    const r = e.target.closest('.hub-row'); if (!r) return;
    const x = SERVICES.find(v => v.id === r.dataset.svc);
    const use = e.target.closest('[data-use]');
    if (use) return useService(x.id, use.dataset.use);
    if (e.target.closest('[data-hub-scn]')) { closeSheets(); setView('create'); return setCreateMode('scn'); }
    if (e.target.closest('[data-hub-asset]')) { closeSheets(); setView('create'); setCreateMode('one'); return setAssetSvc(x.id); }
    const acc = e.target.closest('[data-hub-acc]');
    if (acc) return clSwitchAccount(x.id, acc);
    if (e.target.closest('[data-open]') && CLAUDE_SVC.some(c => c.id === x.id)) return openSide(x.url, x.id);
    if (e.target.closest('[data-open]')) { openSide(x.url, x.id); if (!isConnected(x.id)) toast(`Войдите в ${x.name} в открывшемся окне, затем отметьте «вход выполнен»`, {ms: 6000}); }
  });
  $('#hubBody').addEventListener('change', e => {
    const c = e.target.closest('[data-conn]'); if (!c) return;
    markConnected(c.closest('.hub-row').dataset.svc, c.checked);
    renderHub();
  });
  $('#settingsBtn').addEventListener('click', () => openSheet('settings'));

  $('#diceBtn').addEventListener('click', () => {
    const cur = $('#prompt').value;
    let next; do { next = IDEAS[Math.floor(Math.random() * IDEAS.length)]; } while (next === cur);
    $('#prompt').value = state.prompts[state.mode] = next;
    saveSettings();
  });
  $('#empty').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.step === 'pc') return pcBtnClick();
    if (b.dataset.step === 'acc') return openAcc();
    if (b.dataset.step === 'char') { setView('create'); setCreateMode('chars'); if (!vc.chars.length) vcOpenChar(null, 'chars'); return; }
    else if (b.hasAttribute('data-import-all')) hubLink.importAll(b);
  });

  $('#copyPromptBtn').addEventListener('click', async () => {
    const t = $('#prompt').value.trim();
    if (!t) return toast('Промпт пока пустой', {type: 'err'});
    toast(await clCopyText(t) ? 'Промпт скопирован' : 'Не удалось скопировать', {type: 'ok'});
  });
  $('#translateBtn').addEventListener('click', async () => {
    const btn = $('#translateBtn'), ta = $('#prompt');
    const raw = ta.value.trim();
    if (!raw) return nudge('Сначала напишите промпт — переведу его на английский');
    if (!/[а-яё]/i.test(raw)) return toast('Промпт уже на английском', {type: 'ok'});
    btn.classList.add('loading'); btn.textContent = '🌐 Перевожу…';
    try {
      ta.value = state.prompts[state.mode] = await translatePrompt(raw);
      saveSettings();
      toast('Переведено на английский', {type: 'ok', ms: 6000, action: 'Отменить', onAction: () => { ta.value = state.prompts[state.mode] = raw; saveSettings(); }});
    } catch (e) { toast('Не удалось перевести: ' + e.message, {type: 'err'}); }
    finally { btn.classList.remove('loading'); btn.textContent = '🌐 На английский'; }
  });

  // вставка фото из буфера
  document.addEventListener('paste', e => {
    const any = [...(e.clipboardData?.files || [])].find(f => /^(image|video)\//.test(f.type));
    const waiting = any && extTarget(any.type.startsWith('video/') ? 'video' : 'image');
    if (waiting) { e.preventDefault(); attachExternal(waiting, any); return; }
    const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    // «Сценарии» — в свободную ячейку (сначала инфографика); «Сценарии» — фото в сценарий; «Фото» — в референсы
    if (cl.mode === 'write') return writeAddImage(!wr.info ? 'info' : !wr.sheet ? 'sheet' : 'loc', f);   // дальше — кадры локаций по порядку
    if (cl.mode === 'scn') return refToScenario(f);
    setView('create');
    assetAddRefs([f]);
  });

  // gallery
  $('#filterSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.filter = b.dataset.v;
    $$('#filterSeg button').forEach(x => x.classList.toggle('on', x === b));
    render();
  });
  $('#search').addEventListener('input', render);
  $('#extStrip').addEventListener('dragover', e => { if (e.target.closest('.card.ext')) e.preventDefault(); });
  $('#extStrip').addEventListener('drop', e => {
    const card = e.target.closest('.card.ext'); if (!card) return;
    e.preventDefault();
    const it = items.find(i => i.id === card.dataset.id);
    if (it) attachExternal(it, [...e.dataTransfer.files].find(f => /^(image|video)\//.test(f.type)));
  });
  // карточки заданий на компьютере: «Убрать» неудачное, «Убрать неудачные», «Забрать всё из сервисов»
  $('#hubJobs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-import-all')) return hubLink.importAll(b);
    const hide = keys => { keys.forEach(k => jobHidden.add(k)); ls.set('freefield.jobs.hidden', [...jobHidden].slice(-500)); renderHubJobs(); };
    if (b.dataset.jobHide) return hide([b.dataset.jobHide]);
    if (b.hasAttribute('data-job-hide-err')) return hide(hubJobs().filter(j => j.it.status === 'error').map(j => j.key));
  });
  $('#extStrip').addEventListener('click', e => {
    const card = e.target.closest('.card'); const act = e.target.closest('[data-act]');
    const it = card && items.find(i => i.id === card.dataset.id);
    if (it && act) doAction(act.dataset.act, it, act);
  });
  $('#grid').addEventListener('click', e => {
    const card = e.target.closest('.card'); if (!card) return;
    const it = items.find(i => i.id === card.dataset.id); if (!it) return;
    const act = e.target.closest('[data-act]');
    if (act) { e.stopPropagation(); doAction(act.dataset.act, it); }
    else if (it.status === 'done') openLB(it.id);
  });
  new ResizeObserver(() => { if (colCount() !== lastCols) render(); }).observe($('#feed'));

  // mobile nav
  $('#bottomNav').addEventListener('click', e => {
    const b = e.target.closest('[data-nav]'); if (!b) return;
    setView(b.dataset.nav);
  });

  // sheets
  $$('.sheet').forEach(s => s.addEventListener('click', e => {
    if (e.target === s || e.target.closest('[data-close]')) closeSheets();
    if (e.target.closest('[data-open-settings]')) openSheet('settings');
  }));

  // settings

  // keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSheets(); if (!$('#lightbox').classList.contains('hidden')) closeLB(); }
    if ($('#lightbox').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') stepLB(-1);
    if (e.key === 'ArrowRight') stepLB(1);
  });
  $('#lbClose').addEventListener('click', closeLB);
  $('#lbPrev').addEventListener('click', () => stepLB(-1));
  $('#lbNext').addEventListener('click', () => stepLB(1));
  $('#lightbox').addEventListener('click', e => { if (e.target.classList.contains('lb-media')) closeLB(); });
  $('#lbInfo').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    doAction(b.dataset.act, lbList[lbIndex]);
  });
}
