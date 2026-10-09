'use strict';
/* ---- Голоса персонажей: у каждого персонажа (имя, развёртка) — свой голос ---- */
// Пользователь 2026-09-28: в рилсах — выбранный голос, у каждого персонажа свой. Flow (Veo, Omni), Vids, Dola (Seedance)
// и Arena делают звук сами — по тексту промпта, своего аудио они не принимают. Поэтому голос — это точное описание
// (кто говорит, высота, тембр, подача, темп): одно и то же описание в каждом ролике — и персонаж звучит узнаваемо.
// Описание уходит в строку «Spoken line» эталона (в обычный промпт — в конец). Голос, взятый одним персонажем, другому не дают.
// Голос персонажа — голос, сохранённый во Flow (обязательно), и по желанию точный образец: своя запись или файл (пользователь
// 2026-09-28: описания без звука и синтезированные образцы — убрать). Прежние голоса-описания — только чтобы у старых
// персонажей и сценариев голос остался; выбрать их больше нельзя.
const VOICE_PRESETS = [
  {id: 'm-baritone', g: 'm', name: 'Бархатный баритон', ru: 'мужчина ~40 · тёплый, уверенный, неспешный', en: 'a man in his 40s with a warm, velvety baritone voice, confident and friendly, unhurried pace, clear diction'},
  {id: 'm-bass', g: 'm', name: 'Глубокий бас', ru: 'мужчина ~50 · низкий, раскатистый, спокойный, весомый', en: 'a man in his 50s with a deep, resonant bass voice, calm and authoritative, slow measured pace'},
  {id: 'm-husky', g: 'm', name: 'Мужской с хрипотцой', ru: 'мужчина ~35 · низкий, с хрипотцой, расслабленный, чуть ироничный', en: 'a man in his mid-30s with a low, slightly husky, raspy voice, relaxed and a little ironic, medium pace'},
  {id: 'm-young', g: 'm', name: 'Молодой энергичный', ru: 'парень ~22 · звонкий, бодрый, быстрый', en: 'a young man in his early 20s with a bright, energetic tenor voice, upbeat and lively, fast pace'},
  {id: 'm-soft', g: 'm', name: 'Мягкий доверительный', ru: 'мужчина ~30 · мягкий, тёплый, говорит почти по секрету', en: 'a man in his 30s with a soft, gentle mid-pitched voice, warm and trustworthy, calm confiding tone, slow pace'},
  {id: 'm-expert', g: 'm', name: 'Чёткий эксперт', ru: 'мужчина ~45 · твёрдый, деловой, чёткая дикция', en: 'a man in his mid-40s with a firm, clear medium-low voice, businesslike and assertive, crisp articulation, steady pace'},
  {id: 'm-grandpa', g: 'm', name: 'Дедушка', ru: 'мужчина ~70 · с лёгкой хрипотцой, добрый, неторопливый', en: 'an elderly man in his 70s with a slightly gravelly, warm voice, kind grandfatherly tone, slow unhurried pace'},
  {id: 'f-velvet', g: 'f', name: 'Бархатное контральто', ru: 'женщина ~40 · низкий, бархатный, спокойный, уверенный', en: 'a woman in her 40s with a low, velvety contralto voice, calm and confident, unhurried pace'},
  {id: 'f-warm', g: 'f', name: 'Тёплый мягкий', ru: 'женщина ~30 · мягкий, дружелюбный, заботливый', en: 'a woman in her early 30s with a warm, soft mezzo-soprano voice, friendly and caring, calm pace'},
  {id: 'f-bright', g: 'f', name: 'Звонкий молодой', ru: 'девушка ~22 · высокий, звонкий, весёлый, быстрый', en: 'a young woman in her early 20s with a bright, clear, high voice, cheerful and energetic, fast lively pace'},
  {id: 'f-husky', g: 'f', name: 'Женский с хрипотцой', ru: 'женщина ~35 · с хрипотцой и придыханием, расслабленный, игривый', en: 'a woman in her mid-30s with a slightly husky, breathy voice, relaxed and a little playful, medium pace'},
  {id: 'f-expert', g: 'f', name: 'Деловой чёткий', ru: 'женщина ~45 · твёрдый, уверенный, чёткая дикция', en: 'a woman in her mid-40s with a crisp, clear medium-pitched voice, businesslike and assertive, precise articulation, steady pace'},
  {id: 'f-granny', g: 'f', name: 'Бабушка', ru: 'женщина ~70 · мягкий, чуть дрожащий, добрый, медленный', en: 'an elderly woman in her 70s with a soft, slightly shaky, warm voice, kind grandmotherly tone, slow pace'},
  {id: 'k-child', g: 'k', name: 'Ребёнок', ru: 'ребёнок ~8 лет · высокий, чистый, любопытный', en: 'a child about 8 years old with a high, clear voice, curious and lively, natural pace'},
];
// кто говорит: [значок, подпись, как ИИ называет героя в сценарии]
const VC_G = {m: ['М', 'Мужской', 'the man'], f: ['Ж', 'Женский', 'the woman'], k: ['Д', 'Детский', 'the child']};

// персонажи — отдельной записью в хранилище галереи (развёртки в localStorage не влезут; в галерею запись не попадает — нет status)
const VC_ID = 'freefield-chars';
const vc = {
  custom: ls.get('freefield.voices.custom', []),   // свои голоса
  chars: [],                                        // персонажи: {id, name, sheet, voice}
  all() { return [...VOICE_PRESETS, ...this.custom]; },
  voice(id) { return id ? this.all().find(v => v.id === id) || null : null; },
  char(id) { return id ? this.chars.find(c => c.id === id) || null : null; },
  owner(voiceId, except) { return this.chars.find(c => c.voice === voiceId && c.id !== except) || null; },   // у какого персонажа этот голос
  saveCustom() { ls.set('freefield.voices.custom', this.custom); },
  saveChars() { if (!items.length) renderEmpty(); return DB.put({id: VC_ID, chars: this.chars}); },   // пустая галерея — галочка «Персонаж»
};
async function vcLoad() {
  const rec = await DB.req('readonly', s => s.get(VC_ID)).catch(() => null);
  vc.chars = rec?.chars || [];
  // голоса-образцы из убранной библиотеки (lib-…) — у таких персонажей голос и образец сбрасываем
  const lib = vc.chars.filter(c => /^lib-/.test(c.voice || ''));
  lib.forEach(c => Object.assign(c, {voice: null, sample: null, sampleSec: 0}));
  if (lib.length) vc.saveChars();
  vcRefresh();
  if (!items.length) renderEmpty();
}
function vcRefresh() {
  if (cl.mode === 'write') renderWrite(); else if (cl.mode === 'scn') renderScn(); else if (cl.mode === 'chars') renderChars();
  updateGenButton();
}
// голос сценария: у персонажа — его текущий голос (сменили голос персонажу — у сценариев тоже), иначе — голос, выбранный сценарию
const scnVoice = s => vc.voice(vc.char(s?.char)?.voice || s?.voice);
const scnVoiceLabel = s => vc.char(s.char)?.name || vc.voice(s.voice)?.name || 'Голос';
// голос героя в «Сценариях» — у выбранного персонажа
const wrVoice = () => vc.voice(vc.char(wr.char)?.voice);

// голос → в промпт видео. В эталоне — в начало строки «Spoken line» (свою догадку о голосе ИИ из неё убираем), нет её —
// в «Sound design», нет и её — новой строкой; в обычный промпт — в конец. Уже вписан слово в слово — промпт не трогаем
const vcNorm = t => String(t || '').toLowerCase().replace(/\s+/g, ' ');
function withVoice(p, v) {
  if (!v || !String(p || '').trim() || vcNorm(p).includes(vcNorm(v.en))) return p;
  const line = `voice — ${v.en}`;
  if (isBlockPrompt(p)) {
    for (const label of ['Spoken line', 'Sound design']) {
      const re = new RegExp(`^([ \\t]*${label}[ \\t]*:)[ \\t]*(.*)$`, 'mi');
      if (re.test(p)) return p.replace(re, (a, l, rest) => { rest = dropVoice(rest); return `${l} ${line}${rest ? '; ' + rest : ''}`; });
    }
    return `${p}\nSpoken line: ${line}`;
  }
  return `${String(p).trim().replace(/[.,;\s]+$/, '')}. Voice: ${v.en}`;
}
// голос под сайт. Во Flow у персонажа сохранён голос или персонаж — ссылка на него (@Voice: Имя / @Имя) вместо описания:
// Flow держит один и тот же голос. В Dola с образцом голоса (карточка: файл загружают на сайте) — «голос из @Audio1» + описание
function voicePrompt(p, v, c, site, sample = false) {
  const flow = site === 'flow' && c?.flow?.name ? (c.flow.kind === 'char' ? '@' + c.flow.name : '@Voice: ' + c.flow.name) : '';
  const en = flow || (site === 'dola' && sample && c?.sample ? `the exact voice from @Audio1${v ? ` (${v.en})` : ''}` : '');
  if (!en) return withVoice(p, v);
  if (!v) return withVoice(p, {en});   // свой голос без описания — только ссылка на него
  // описание, которое вписал ИИ, — заменяем ссылкой
  const re = new RegExp(v.en.split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'i');
  return re.test(p) ? p.replace(re, () => en) : withVoice(p, {...v, en});
}
// чужое описание голоса («deep calm male voice») — долой; реплики в «» и "" не трогаем
function dropVoice(t) {
  const q = [], safe = String(t).replace(/«[^»]*»|"[^"]*"/g, m => `\u0001${q.push(m) - 1}\u0002`);
  return safe.split(/(?<=[,;])/).map(seg => /\u0001/.test(seg) ? seg.replace(/(?:\b[a-z-]+\s+){0,5}voice\b\s*/i, '') : /\bvoice\b/i.test(seg) ? '' : seg).join('')
    .replace(/\u0001(\d+)\u0002/g, (_, n) => q[+n]).replace(/\s*[,;]\s*(?=[,;]|$)/g, '').replace(/^[\s,;]+/, '').replace(/\s{2,}/g, ' ').trim();
}

// окно «Персонажи и голоса»: list — все; char — персонаж; voice — свой голос (конструктор); pick — голос сценария
// from — откуда открыт персонаж (list / pick / write): туда и вернёмся после «Сохранить»
const vcUi = {view: 'list', from: 'list', i: null, edit: null};
function vcShow() {
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#voiceSheet').classList.remove('hidden');
  renderVoices();
  $('#vcBody').scrollTop = 0;
}
function openVoices(view = 'list', o = {}) { Object.assign(vcUi, {view, from: view, ...o}); vcShow(); }
function vcOpenChar(c, from) {
  // новый персонаж — с развёрткой, которая уже есть и ещё ничья (у сценария или в «Сценариях»); голос выбирают на слух.
  // Голос во Flow обязателен (пользователь 2026-09-28): пока его не переименовали — это имя персонажа
  const guess = [from === 'pick' && cl.scn[vcUi.i]?.sheet, wr.sheet].find(x => x && !vc.chars.some(y => y.sheet === x)) || null;
  vcUi.edit = c ? {about: '', lang: 'ru', info: null, ...c, flow: {kind: c.flow?.kind === 'char' ? 'char' : 'voice', name: c.flow?.name || c.name}, flowAuto: !c.flow?.name, locs: [...(c.locs || [])]}
    : {id: null, name: '', sheet: guess, about: '', lang: 'ru', info: null, locs: [], voice: null, sample: null, sampleSec: 0, flow: {kind: 'voice', name: ''}, flowAuto: true};
  Object.assign(vcUi, {view: 'char', from});
  vcShow();
}
function vcBack() {
  if (vcUi.from === 'write' || vcUi.from === 'chars' || vcUi.from === 'series') return closeSheets();
  vcUi.view = vcUi.from === 'pick' ? 'pick' : 'list';
  renderVoices();
}
const vcThumb = c => c?.sheet ? `<img src="${c.sheet}" alt="">` : '<i class="vc-ph">🧍</i>';
function vcCharBtn(c, attr, on = false) {
  const v = vc.voice(c.voice);
  return `<button class="vc-char ${on ? 'on' : ''}" ${attr} title="${esc(v ? v.ru : c.sample ? 'Свой голос' : 'Голос не выбран')}">${vcThumb(c)}<span><b>${esc(c.name)}</b><small>🎙 ${esc(c.flow?.name ? (c.flow.kind === 'char' ? '@' : '@Voice: ') + c.flow.name : v?.name || 'голос не выбран')}${c.sample ? ' · 🎧 образец' : ''}</small></span></button>`;
}
function renderVoices() {
  const body = $('#vcBody');
  if (!body) return;
  const v = vcUi.view;
  if (rec.to && rec.view !== v) recCancel(false);
  $$('#vcBody audio').forEach(a => a.pause());
  $('#vcTitle').textContent = v === 'series' ? `Серия роликов · ${vc.char(vcUi.serChar)?.name || ''}` : v === 'scripts' ? 'Готовые сценарии' : v === 'tochar' ? 'В персонажа' : v === 'revoice' ? 'Заменить голос' : v === 'char' ? (vc.char(vcUi.edit?.id) ? 'Персонаж' : 'Новый персонаж') : v === 'pick' ? 'Кто говорит' : 'Персонажи и голоса';
  $('#vcFor').textContent = v === 'pick' ? `сценарий ${vcUi.i + 1}` : '';
  body.innerHTML = v === 'series' ? serHTML() : v === 'scripts' ? scrHTML() : v === 'tochar' ? vcToCharHTML() : v === 'revoice' ? vcRevoiceHTML() : v === 'char' ? vcCharHTML() : v === 'pick' ? vcPickHTML() : vcListHTML();
  if (v === 'char') echoCharFill();
}
function vcListHTML() {
  return `<p class="set-p">Голос персонажа — голос, сохранённый во Flow: его слушают и выбирают в самом Flow, и он одинаковый во всех роликах (@Voice). По желанию — точный образец (своя запись или файл): по нему Dola повторит голос (@Audio1), а «🎙 Заменить голос» сделает таким голос любого готового видео.</p>
    <div class="cl-sec" style="margin-top:0">🎭 Персонажи</div>
    <div class="vc-chars">${vc.chars.map(c => vcCharBtn(c, `data-vc-edit="${c.id}"`)).join('')}<button class="vc-char add" data-vc-new>＋ Новый персонаж</button></div>`;
}
function vcCharHTML() {
  const d = vcUi.edit, old = vc.char(d.id);
  return `<div class="vc-opt"><span>Имя</span><input class="vc-in" data-vc-name maxlength="40" value="${esc(d.name)}" placeholder="Например: Дедушка Иван"></div>
    <div class="vc-opt"><span>Развёртка — как выглядит: спереди, сбоку, сзади</span><div class="vc-sheet-row">${d.sheet ? `<img src="${d.sheet}" alt="">` : ''}
      <button class="btn small" data-vc-sheet>📁 ${d.sheet ? 'Другое фото' : 'Загрузить'}</button>
      ${!d.sheet && wr.sheet ? '<button class="btn small" data-vc-sheet-wr>🧍 Из «Сценариев»</button>' : ''}
      ${d.sheet ? '<button class="btn small" data-vc-sheet-rm>✕ Убрать</button>' : ''}</div></div>
    <div class="vc-opt"><span>Кто он — характер, манера речи, словечки (необязательно: ИИ учтёт в каждом сценарии)</span>
      <textarea class="vc-in" data-vc-about rows="2" maxlength="400" placeholder="Например: ворчливый, но добрый дед-огородник; говорит поговорками, обращается «внучок»">${esc(d.about || '')}</textarea></div>
    <div class="vc-opt"><span>Язык речи — на нём он говорит в роликах; на нём ИИ пишет реплики, надписи и субтитры</span>
      <div class="seg">${[['ru', 'Русский'], ['en', 'English']].map(([k, t]) => `<button data-vc-lang="${k}" class="${(d.lang || 'ru') === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    <div class="vc-opt"><span>📊 Инфографика — о чём ролики с ним (необязательно)</span><div class="vc-sheet-row">${d.info ? `<img src="${d.info}" alt="">` : ''}
      <button class="btn small" data-vc-img="info">📁 ${d.info ? 'Другая' : 'Загрузить'}</button>
      ${!d.info && wr.info ? '<button class="btn small" data-vc-info-wr>Из «Сценариев»</button>' : ''}
      ${d.info ? '<button class="btn small" data-vc-info-rm>✕ Убрать</button>' : ''}</div></div>
    <div class="vc-opt"><span>📍 Кадры «персонаж в локации» — по одному на сценарий (необязательно)</span>
      <div class="vc-locs">${(d.locs || []).map((x, i) => `<div class="vc-loc"><img src="${x}" alt=""><i>${i + 1}</i><button data-vc-loc-rm="${i}" title="Убрать кадр">✕</button></div>`).join('')}</div>
      <div class="vc-sheet-row"><button class="btn small" data-vc-img="locs" ${(d.locs || []).length >= CL_MAX ? 'disabled' : ''}>📁 Добавить кадры</button>
        ${wr.locs.length && !(d.locs || []).length ? `<button class="btn small" data-vc-locs-wr>Из «Сценариев» (${wr.locs.length})</button>` : ''}
        ${(d.locs || []).length ? '<button class="btn small" data-vc-locs-rm>✕ Убрать все</button>' : ''}</div></div>
    <div class="vc-opt"><span>🎙 Голос во Flow — один и тот же в каждом ролике (обязательно)</span>
      <div class="seg">${[['voice', '@Voice: голос'], ['char', '@Персонаж']].map(([k, t]) => `<button data-vc-flow-kind="${k}" class="${d.flow.kind === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <input class="vc-in vc-flow" data-vc-flow maxlength="40" value="${esc(d.flow.name || '')}" placeholder="${d.flow.kind === 'char' ? 'Имя персонажа во Flow — как сохранили' : 'Имя голоса во Flow — по умолчанию имя персонажа'}">
      <div class="hint vc-note">${d.flow.kind === 'char' ? 'Во Flow создайте персонажа с этим лицом и голосом (Add to Character) и сохраните под этим именем.' : 'Во Flow: Add voice → послушайте голоса Flow и выберите (или Create new voice — со своим образцом) → сохраните под этим именем.'} В промпт Flow Freefield впишет «<b data-vc-flow-tag>${d.flow.kind === 'char' ? '@' : '@Voice: '}${esc(d.flow.name || d.name || 'Имя')}</b>».</div></div>
    <div class="vc-opt"><span>Кто говорит</span>
      <div class="seg">${Object.entries(VC_G).map(([k, x]) => `<button data-vc-g="${k}" class="${(d.g || vc.voice(d.voice)?.g || 'm') === k ? 'on' : ''}">${x[1]}</button>`).join('')}</div></div>
    <div class="vc-opt"><span>🎧 Точный голос — образец 5–15 с чистой речи одного человека, без музыки (необязательно)</span>
      ${vcVoiceNow(d)}
      <div class="vc-src"><button class="btn small" data-vc-sample>📁 ${d.sample ? 'Другой файл' : 'Файл с голосом'}</button>${recBtn('sample', d.sample ? 'Записать заново' : 'Записать свой голос')}</div>${recPanel('sample')}
      <div class="vc-url"><input class="vc-in" data-vc-url placeholder="или прямая ссылка на файл .mp3 / .wav / .m4a" inputmode="url"><button class="btn small" data-vc-url-go>Взять</button></div>
      <div class="hint vc-note">Образец — ваша запись (тихая комната, телефон в 20–30 см) или файл с хорошим голосом, например скачанный с ElevenLabs. С ним Dola повторит голос (@Audio1), а «🎙 Заменить голос» сделает голос готового видео ровно таким.</div></div>
    <div class="vc-opt"><span>🎙 Голос в «Эхо» — озвучка текста его голосом</span><div class="eh-ch" id="ehChar"></div></div>
    <div class="vc-foot"><button class="btn free" data-vc-save>${old ? 'Сохранить' : 'Создать персонажа'}</button>
      ${old ? '<button class="btn" data-vc-export title="Файл персонажа — перенести на другое устройство или сохранить копию">📤 Экспорт</button><button class="btn danger" data-vc-del>🗑 Удалить</button>' : ''}<button class="btn" data-vc-back>${vcUi.from === 'write' || vcUi.from === 'chars' ? 'Отмена' : 'Назад'}</button></div>`;
}
// образец голоса персонажа (плеер) или прежнее описание — сверху раздела «Точный голос»
function vcVoiceNow(d) {
  const v = vc.voice(d.voice);
  if (d.sample) return `<div class="vc-sample"><audio controls src="${d.sample}"></audio><small>${d.sampleSec || ''} с</small><button class="btn small" data-vc-sample-save title="Сохранить образец файлом — например, чтобы создать с ним голос во Flow">💾</button><button class="btn small" data-vc-sample-rm title="Убрать образец">✕</button></div>`;
  return v ? `<div class="hint vc-note">Для других сервисов голос пока задан описанием «${esc(v.name)}».</div>` : '';
}
function vcPickHTML() {
  const s = cl.scn[vcUi.i];
  if (!s) return '';
  const ch = vc.char(s.char);
  return `<div class="cl-sec" style="margin-top:0">🎭 Персонаж <span class="hint">его голос и развёртка</span></div>
    <div class="vc-chars">${vc.chars.map(c => vcCharBtn(c, `data-vc-pick-char="${c.id}"`, c === ch)).join('')}<button class="vc-char add" data-vc-new>＋ Новый персонаж</button></div>
    <div class="vc-foot"><button class="btn" data-vc-pick-none>Без персонажа</button></div>
    <p class="hint" style="margin-top:12px">Голос персонажа впишется в промпт видео — в начало строки «Spoken line»: реплики в «» видео-модель озвучит им; во Flow — его сохранённый голос (@Voice).</p>`;
}
// сценарию — персонаж (его голос и развёртка), просто голос или ничего
function vcAssign(i, c, v) {
  const s = cl.scn[i];
  if (!s) return closeSheets();
  if (c) { s.char = c.id; s.voice = c.voice; if (c.sheet) s.sheet = c.sheet; }
  else { delete s.char; if (v) s.voice = v.id; else delete s.voice; }
  cl.save(); closeSheets(); renderScn(); updateGenButton();   // кто говорит — видно на самом сценарии, без всплывающего сообщения
}
async function vcSaveChar() {
  const d = vcUi.edit, name = d.name.trim();
  if (!name) { toast('Впишите имя персонажа', {type: 'err'}); return $('#vcBody [data-vc-name]')?.focus(); }
  if (vc.chars.some(c => c.id !== d.id && c.name.trim().toLowerCase() === name.toLowerCase())) return toast(`Персонаж «${name}» уже есть — дайте другое имя`, {type: 'err'});
  const owner = d.voice && vc.owner(d.voice, d.id);
  if (owner) return toast(`Этот голос уже у персонажа «${owner.name}» — у каждого свой`, {type: 'err'});
  const flow = {kind: d.flow?.kind === 'char' ? 'char' : 'voice', name: (d.flow?.name || '').trim().replace(/^@\s*(Voice:\s*)?/i, '') || name};
  const c = {id: d.id || 'ch-' + uid(), name, sheet: d.sheet || null, about: (d.about || '').trim(), lang: d.lang === 'en' ? 'en' : 'ru', info: d.info || null, locs: (d.locs || []).slice(0, CL_MAX),
    voice: d.voice || null, g: d.g || vc.voice(d.voice)?.g || 'm', sample: d.sample || null, sampleSec: d.sample ? d.sampleSec : 0, flow}, i = vc.chars.findIndex(x => x.id === c.id);
  const oldSheet = i >= 0 ? vc.chars[i].sheet : null;
  if (i >= 0) vc.chars[i] = c; else vc.chars.push(c);
  await vc.saveChars();
  // у сценариев с этим персонажем — его голос и новая развёртка
  cl.scn.forEach(s => { if (s.char === c.id) { s.voice = c.voice; if (c.sheet && (!s.sheet || s.sheet === oldSheet)) s.sheet = c.sheet; } });
  cl.save();
  // «Сценарии»: персонаж создан оттуда — сразу выбран; у выбранного сменилась развёртка — она и в ячейке
  if (vcUi.from === 'write' || wr.char === c.id) { wrUseChar(c); wr.save(); }
  toast(i >= 0 ? `Персонаж «${name}» сохранён` : `Персонаж «${name}» создан — голос во Flow: ${flow.kind === 'char' ? '@' : '@Voice: '}${flow.name}${c.sample ? ', есть образец' : ''}`, {type: 'ok', ms: 6000});
  if (vcUi.from === 'pick') return vcAssign(vcUi.i, c);
  if (vcUi.from === 'list') { vcUi.view = 'list'; renderVoices(); } else closeSheets();
  vcRefresh();
}
async function vcDelChar() {
  const c = vc.char(vcUi.edit?.id);
  if (!c || !confirm(`Удалить персонажа «${c.name}»? Его голос освободится`)) return;
  vc.chars = vc.chars.filter(x => x.id !== c.id);
  await vc.saveChars();
  if (wr.char === c.id) { wr.char = null; wr.save(); }
  cl.scn.forEach(s => { if (s.char === c.id) delete s.char; });   // голос у сценария остаётся
  cl.save();
  toast(`Персонаж «${c.name}» удалён`);
  vcBack(); vcRefresh();
}
// образец голоса персонажа: файл, ссылка или запись
const vcOwnSample = (d, r) => Object.assign(d, {sample: r.data, sampleSec: r.sec});
function bindVoices() {
  const box = $('#voiceSheet');
  box.addEventListener('click', e => {
    const b = e.target.closest('#vcBody button');
    if (!b || b.disabled) return;
    const d = vcUi.edit, x = b.dataset;
    if (x.vcEdit) return vcOpenChar(vc.char(x.vcEdit), 'list');
    if (b.hasAttribute('data-vc-new')) return vcOpenChar(null, vcUi.view === 'pick' ? 'pick' : 'list');
    if (x.vcG) { d.g = x.vcG; return renderVoices(); }
    if (b.hasAttribute('data-vc-sheet') || x.vcImg) {   // развёртка, инфографика или кадры в локациях (их — несколько сразу)
      return vcPickImg(x.vcImg || 'sheet');
    }
    if (x.vcLang) { d.lang = x.vcLang; return renderVoices(); }
    if (b.hasAttribute('data-vc-info-wr')) { d.info = wr.info; return renderVoices(); }
    if (b.hasAttribute('data-vc-info-rm')) { d.info = null; return renderVoices(); }
    if (b.hasAttribute('data-vc-locs-wr')) { d.locs = wr.locs.slice(0, CL_MAX); return renderVoices(); }
    if (b.hasAttribute('data-vc-locs-rm')) { d.locs = []; return renderVoices(); }
    if (x.vcLocRm) { d.locs.splice(+x.vcLocRm, 1); return renderVoices(); }
    if (b.hasAttribute('data-vc-sheet-wr')) { d.sheet = wr.sheet; return renderVoices(); }
    if (b.hasAttribute('data-vc-sheet-rm')) { d.sheet = null; return renderVoices(); }
    if (b.hasAttribute('data-vc-save')) return vcSaveChar();
    if (b.hasAttribute('data-vc-del')) return vcDelChar();
    if (b.hasAttribute('data-vc-export')) return charExport(vc.char(d.id));
    if (b.hasAttribute('data-vc-back')) return vcBack();
    if (x.vcPickChar) return vcAssign(vcUi.i, vc.char(x.vcPickChar));
    if (b.hasAttribute('data-vc-pick-none')) return vcAssign(vcUi.i);
    // точный голос персонажа: образец из файла или по ссылке, голос во Flow
    if (b.hasAttribute('data-vc-sample')) return vcPickAudio('sample');
    if (b.hasAttribute('data-vc-sample-rm')) { d.sample = null; d.sampleSec = 0; return renderVoices(); }
    if (b.hasAttribute('data-vc-sample-save')) return d.sample && saveFile(dataBlob(d.sample), `голос-${(d.name || 'образец').trim()}.wav`);
    // 🎤 запись с микрофона — образец персонажу или для замены голоса
    if (x.rec) return recStart(x.rec);
    if (b.hasAttribute('data-rec-stop')) return recStop();
    if (b.hasAttribute('data-rec-cancel')) return recCancel();
    if (b.hasAttribute('data-vc-url-go')) {
      const url = $('#vcBody [data-vc-url]')?.value.trim();
      if (!url) return toast('Вставьте ссылку на аудиофайл', {type: 'err'});
      b.disabled = true; b.textContent = '…';
      return voiceSampleUrl(url).then(r => { vcOwnSample(d, r); toast(`Образец голоса: ${r.sec} с`, {type: 'ok'}); },
        e => toast('Не получилось: ' + e.message, {type: 'err', ms: 8000})).finally(renderVoices);
    }
    if (x.vcFlowKind) { d.flow.kind = x.vcFlowKind; return renderVoices(); }
    // замена голоса у готового видео
    if (vcUi.view === 'series' && Object.keys(x).some(k => k.startsWith('ser'))) return serClick(b);
    if (x.scrF) { vcUi.scrF = x.scrF; return renderVoices(); }
    if (x.scrCopy) return scrCopy(x.scrCopy);
    if (x.scrScn) return scrToScn(x.scrScn);
    if (x.scrDel) return scrDel(x.scrDel);
    if (b.hasAttribute('data-scr-copy-all')) return scrCopy('all');
    if (b.hasAttribute('data-scr-video-all')) { closeSheets(); return scrVideo(scrShown().slice(0, CL_MAX).map(x => x.id)); }
    if (b.hasAttribute('data-scr-file')) return scrFile();
    if (x.tcChar) { vcUi.tcChar = x.tcChar; return renderVoices(); }
    if (x.tcAs) { vcUi.tcAs = x.tcAs; return renderVoices(); }
    if (b.hasAttribute('data-tc-go')) return toCharSave();
    if (x.rvChar) { Object.assign(vcUi, {rvChar: x.rvChar, rvFile: null, rvRec: false}); return renderVoices(); }
    if (b.hasAttribute('data-rv-file')) return vcPickAudio('rv');
    if (b.hasAttribute('data-rv-go')) return revoiceGo();
    if (b.hasAttribute('data-rv-upload')) return vcPickAudio('rv-upload');
    if (b.hasAttribute('data-rv-save-ref')) { const smp = rvSample(); return smp && saveFile(dataBlob(smp), `голос-${rvWho() || 'образец'}.wav`); }
    if (b.hasAttribute('data-rv-save-src')) {
      const it = rvItem();
      if (!it) return;
      return decodeAudio(it.blob).then(ab => audioMono(ab, 44100)).then(ab => saveFile(wavBlob(ab), `звук-${it.id}.wav`), e => toast('Не получилось: ' + e.message, {type: 'err'}));
    }
  });
  box.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('[data-vc-name]')) {   // имя голоса во Flow идёт за именем персонажа, пока его не меняли
      const d = vcUi.edit;
      d.name = t.value;
      if (d.flowAuto) { d.flow.name = t.value; const f = $('#vcBody [data-vc-flow]'); if (f) f.value = t.value; }
      const tag = $('#vcBody [data-vc-flow-tag]'); if (tag) tag.textContent = (d.flow.kind === 'char' ? '@' : '@Voice: ') + (d.flow.name || d.name || 'Имя');
    }
    else if (t.matches('[data-vc-about]')) vcUi.edit.about = t.value;
    else if (t.matches('[data-ser-idea]')) vcUi.serSet.idea = t.value;
    else if (t.matches('[data-vc-flow]') && vcUi.edit) {
      Object.assign(vcUi.edit, {flowAuto: false}); vcUi.edit.flow.name = t.value;
      const tag = $('#vcBody [data-vc-flow-tag]'); if (tag) tag.textContent = (vcUi.edit.flow.kind === 'char' ? '@' : '@Voice: ') + (t.value || vcUi.edit.name || 'Имя');
    }
  });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-vc-name]')) { e.preventDefault(); vcSaveChar(); } });
}
// аудио: образец голоса персонажа, образец для замены голоса или готовый новый звук ролика
async function vcPickAudio(to) {
  const file = await pickFile('audio/*,video/*');
  if (!file) return;
  if (to === 'rv-upload') return revoiceUpload(file);
  try {
    const r = await voiceSample(file);
    if (to === 'rv') Object.assign(vcUi, {rvFile: r.data, rvRec: false});
    else if (vcUi.edit) vcOwnSample(vcUi.edit, r);
    toast(`Образец голоса: ${r.sec} с`, {type: 'ok'});
  } catch (err) { toast('Не получилось: ' + err.message, {type: 'err', ms: 8000}); }
  renderVoices();
}
// фото персонажа: развёртка, инфографика или кадры в локациях (их — несколько сразу)
async function vcPickImg(to) {
  const files = [].concat(await pickFile('image/*', to === 'locs')).filter(f => f?.type.startsWith('image/')), d = vcUi.edit;
  if (!files.length || !d) return;
  try {
    if (to === 'locs') {   // кадры — по порядку, до 10 (больше сценариев за раз не пишется)
      const room = CL_MAX - d.locs.length;
      for (const f of files.slice(0, room)) d.locs.push(await refDataUrl(f));
      if (files.length > room) toast(`Взял ${room} ${plur(room, 'кадр', 'кадра', 'кадров')} — больше ${CL_MAX} не нужно`, {type: 'err'});
    } else d[to] = await refDataUrl(files[0]);
  } catch { return toast('Не удалось прочитать фото', {type: 'err'}); }
  renderVoices();
}

/* ---- Точный голос: образец голоса у персонажа и замена голоса в готовом видео ---- */
// Пользователь 2026-09-28: один и тот же голос во всех роликах. По описанию разные модели звучат по-разному, поэтому:
// • у персонажа — образец голоса (файл 5–15 с) и имя его голоса или персонажа, сохранённого во Flow (@Voice: Имя / @Имя —
//   Flow держит один и тот же голос); в Dola образец загружается аудио-референсом (@Audio1);
// • «🎙 Заменить голос» у готового видео: Seed-VC (открытая модель на Hugging Face, бесплатно в пределах лимита GPU)
//   переделывает голос ролика под образец — слова, интонации и тайминг остаются, поэтому губы совпадают.
const VC_SAMPLE_SEC = 15;   // столько берёт Seedance (Dola); Seed-VC хватает 1–30 с
let audioCtx = null;
const actx = () => audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
const blobDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function decodeAudio(blob) {
  try { return await actx().decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new Error('не удалось прочитать звук — нужен mp3, wav, m4a или видео со звуком'); }
}
// AudioBuffer → моно с нужной частотой, кусок [from, from + sec]
async function audioMono(ab, rate, from = 0, sec = ab.duration - from) {
  const len = Math.max(1, Math.round(Math.max(0, Math.min(sec, ab.duration - from)) * rate));
  const off = new OfflineAudioContext(1, len, rate), src = off.createBufferSource();
  src.buffer = ab; src.connect(off.destination); src.start(0, from);
  return off.startRendering();
}
function wavBlob(ab) {
  const n = ab.length, rate = ab.sampleRate, v = new DataView(new ArrayBuffer(44 + n * 2)), d = ab.getChannelData(0);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, d[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([v], {type: 'audio/wav'});
}
// файл (аудио или видео) → образец голоса: тишину в начале срезаем, до 15 с, моно 24 кГц WAV — его примут и Flow, и Dola, и Seed-VC
async function voiceSample(blob) {
  const mono = await audioMono(await decodeAudio(blob), 24000), d = mono.getChannelData(0);
  let i = 0;
  while (i < d.length && Math.abs(d[i]) < 0.02) i++;
  if (i >= d.length) throw new Error('в файле не слышно голоса');
  const from = Math.max(0, i / 24000 - 0.2), sec = Math.min(VC_SAMPLE_SEC, mono.duration - from);
  if (sec < 3) throw new Error('образец слишком короткий — нужно 5–15 секунд речи');
  return {data: await blobDataUrl(wavBlob(await audioMono(mono, 24000, from, sec))), sec: Math.round(sec)};
}
// образец по ссылке: только прямая ссылка на файл — страницы (YouTube, соцсети) браузер не скачает
async function voiceSampleUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('вставьте ссылку, начинающуюся с https://');
  if (/youtu\.?be|tiktok|instagram|vk\.com|t\.me|drive\.google/i.test(url)) throw new Error('это ссылка на страницу, а не на файл — скачайте 10–15 с речи и загрузите файлом');
  let r;
  try { r = await fetch(url); } catch { throw new Error('сайт не отдаёт файл другим сайтам — скачайте его и загрузите файлом'); }
  if (!r.ok) throw new Error(`по ссылке ошибка ${r.status}`);
  const b = await r.blob();
  if (/text\/html/i.test(b.type)) throw new Error('по ссылке страница, а не аудиофайл — скачайте файл и загрузите его');
  return voiceSample(b);
}
// сохранить файл: в APK — «Документы/Freefield», на iPhone — «Поделиться», в остальных — «Загрузки»
async function saveFile(blob, name) {
  if (native.on()) { try { await native.save(blob, name); } catch (e) { toast('Не удалось сохранить: ' + e.message, {type: 'err'}); } return; }
  const f = new File([blob], name, {type: blob.type});
  if (pwa.ios() && navigator.canShare?.({files: [f]})) return navigator.share({files: [f]}).catch(() => {});
  const a = document.createElement('a'), url = URL.createObjectURL(f);
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(`Сохранено в «Загрузки»: ${name}`, {type: 'ok'});
}
const dataBlob = d => { const f = dataUrlFile(d, 'x'); return new Blob([f], {type: f.type}); };

// Seed-VC на Hugging Face: функцию с двумя аудио-входами (исходник и образец) находим по /config — так переживём смену API
const SEED_VC = ['https://plachta-seed-vc.hf.space', 'https://sp2026-seed-vc.hf.space'];
async function seedVcFn(host) {
  let r;
  try { r = await fetch(host + '/config'); } catch { throw new GpuError('нет связи с Seed-VC', 'down'); }
  if (!r.ok) throw new GpuError(`Seed-VC сейчас недоступен (${r.status})`, 'down');
  const cfg = await r.json(), comp = new Map((cfg.components || []).map(c => [c.id, c])), deps = cfg.dependencies || [];
  const i = deps.findIndex(d => d.api_name && (d.inputs || []).filter(id => comp.get(id)?.type === 'audio').length >= 2);
  if (i < 0) throw new GpuError('Seed-VC изменил API', 'down');
  return {fn: deps[i].id ?? i, inputs: deps[i].inputs.map(id => comp.get(id) || {})};
}
const gradioUrl = (x, host) => !x ? null : Array.isArray(x) ? x.map(y => gradioUrl(y, host)).filter(Boolean).pop()
  : typeof x !== 'object' ? null : x.url ? (x.url.startsWith('/') ? host + x.url : x.url) : Object.values(x).map(y => gradioUrl(y, host)).filter(Boolean).pop();
async function seedVc(src, ref, onStatus) {
  let last;
  for (const host of SEED_VC) {
    try {
      const {fn, inputs} = await seedVcFn(host);
      onStatus('Загружаю звук на GPU…');
      const [a, b] = [await gradioUpload(host, src, 'source.wav'), await gradioUpload(host, ref, 'reference.wav')];
      let k = 0;
      // остальные входы — по умолчанию; шагов диффузии побольше (30): качество голоса лучше
      const data = inputs.map(c => c.type === 'audio' ? [a, b][k++] ?? null
        : c.type === 'slider' && /diffusion/i.test(c.props?.label || '') ? Math.min(c.props.maximum ?? 30, 30) : c.props?.value ?? null);
      const out = await gradioCall(host, fn, data, onStatus, 'GPU меняет голос…');
      const url = [...out].reverse().map(x => gradioUrl(x, host)).find(Boolean);
      if (!url) throw new GpuError('Seed-VC не вернул звук', 'busy');
      onStatus('Скачиваю звук…');
      const r = await fetch(url);
      if (!r.ok) throw new GpuError('не удалось скачать звук', 'busy');
      return r.blob();
    } catch (e) { last = e; if (e.kind !== 'down') throw e; }   // сервер лёг или сменил API — пробуем зеркало
  }
  throw last;
}

// ролик + новый звук → MP4: видео копируется как есть (без пережатия), звук кодируется заново (AAC, где его нет — Opus)
const MEDIABUNNY = 'https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/dist/bundles/mediabunny.min.mjs';
let mbLoad = null;
const mediabunny = () => mbLoad ||= import(MEDIABUNNY).catch(e => { mbLoad = null; throw new Error('не загрузилась библиотека видео — проверьте интернет'); });
async function muxVoice(videoBlob, audio) {
  const MB = await mediabunny();
  const input = new MB.Input({source: new MB.BlobSource(videoBlob), formats: MB.ALL_FORMATS});
  const vt = await input.getPrimaryVideoTrack();
  if (!vt) throw new Error('в файле нет видео');
  const sound = await audioMono(audio, 48000, 0, await vt.computeDuration());
  const codec = await MB.canEncodeAudio('aac', {numberOfChannels: 1, sampleRate: 48000}) ? 'aac' : 'opus';
  if (codec === 'opus' && !await MB.canEncodeAudio('opus', {numberOfChannels: 1, sampleRate: 48000})) throw new Error('браузер не умеет кодировать звук — обновите Chrome');
  const output = new MB.Output({format: new MB.Mp4OutputFormat({fastStart: 'in-memory'}), target: new MB.BufferTarget()});
  const vs = new MB.EncodedVideoPacketSource(vt.codec), as = new MB.AudioBufferSource({codec, bitrate: MB.QUALITY_HIGH});
  output.addVideoTrack(vs, {rotation: vt.rotation});
  output.addAudioTrack(as);
  await output.start();
  const decoderConfig = await vt.getDecoderConfig();
  let first = true;
  for await (const p of new MB.EncodedPacketSink(vt).packets()) { await vs.add(p, first ? {decoderConfig} : undefined); first = false; }
  vs.close();
  await as.add(sound);
  as.close();
  await output.finalize();
  return new Blob([output.target.buffer], {type: 'video/mp4'});
}
// готовый ролик с новым звуком — новой работой в галерее рядом с исходным (исходный остаётся)
async function revoiceSave(it, audio, who) {
  const blob = await muxVoice(it.blob, audio);
  const copy = newItem({...pick(it), blob, status: 'done', statusText: '', voiceOf: who});
  await DB.put(copy);
  render();
  return copy;
}

// окно «🎙 Заменить голос» (то же окно, что у персонажей: вид revoice)
function openRevoice(it) {
  const withSample = vc.chars.filter(c => c.sample);
  Object.assign(vcUi, {view: 'revoice', from: 'revoice', item: it.id, rvChar: vc.char(it.char)?.sample ? it.char : withSample[0]?.id || null, rvFile: null, rvRec: false, rvNote: ''});
  vcShow();
}
const rvItem = () => items.find(x => x.id === vcUi.item);
const rvSample = () => vcUi.rvFile || vc.char(vcUi.rvChar)?.sample || null;
const rvWho = () => vcUi.rvFile ? (vcUi.rvRec ? 'моя запись' : 'образец из файла') : vc.char(vcUi.rvChar)?.name || '';
function vcRevoiceHTML() {
  const it = rvItem(), smp = rvSample();
  if (!it) return '<p class="set-p">Ролик не найден — он удалён из галереи.</p>';
  const chars = vc.chars.filter(c => c.sample);
  return `<p class="set-p">Слова, интонации и движения губ останутся — голос станет как в образце. Фоновые звуки и музыка ролика при замене пропадут, останется голос.</p>
    <div class="cl-sec" style="margin-top:0">🎭 Чей голос</div>
    <div class="vc-chars">${chars.map(c => vcCharBtn(c, `data-rv-char="${c.id}"`, !vcUi.rvFile && vcUi.rvChar === c.id)).join('')}
      <button class="vc-char add ${vcUi.rvFile && !vcUi.rvRec ? 'on' : ''}" data-rv-file>📁 ${vcUi.rvFile && !vcUi.rvRec ? 'Образец из файла ✓' : 'Другой файл'}</button>
      <button class="vc-char add ${vcUi.rvRec ? 'on' : ''}" data-rec="rv" ${rec.to ? 'disabled' : ''}>🎤 ${vcUi.rvRec ? 'Моя запись ✓' : 'Записать голос'}</button></div>${recPanel('rv')}
    ${chars.length ? '' : '<p class="hint vc-note">Образец голоса можно сохранить у персонажа (🎙 → персонаж → «Точный голос»: файлом или записью с микрофона) — тогда он будет здесь всегда.</p>'}
    ${smp ? `<div class="vc-sample"><audio controls src="${smp}"></audio></div>` : ''}
    <div class="vc-foot"><button class="btn free" data-rv-go ${smp && !vcUi.busy ? '' : 'disabled'}>✨ Заменить голос — бесплатно</button></div>
    <div class="hint vc-note" id="rvNote">${vcUi.busy ? '⏳ ' + esc(vcUi.rvNote) : 'Seed-VC на Hugging Face, в пределах бесплатного лимита GPU (с токеном Hugging Face в «Лимитах» — больше). Ролик на 10 с — около минуты. Новый ролик появится в галерее рядом с исходным.'}</div>
    <details class="vc-manual"><summary>Вручную — если автоматически не вышло</summary><ol class="ext-steps">
      <li>Сохраните звук ролика и образец: <button class="wr-link" data-rv-save-src>💾 звук ролика</button> · <button class="wr-link" data-rv-save-ref ${smp ? '' : 'disabled'}>💾 образец</button></li>
      <li>Откройте <a href="https://huggingface.co/spaces/Plachta/Seed-VC" target="_blank" rel="noopener">Seed-VC</a> (бесплатно) или ElevenLabs → Voice Changer: звук ролика — в «Source», образец — в «Reference», и скачайте результат</li>
      <li><button class="wr-link" data-rv-upload>📥 Загрузите новый звук</button> — Freefield вставит его в ролик</li></ol></details>`;
}
function rvStatus(t) {
  vcUi.rvNote = t;
  const el = $('#rvNote');
  if (el) el.textContent = '⏳ ' + t;
}
// замена голоса: звук ролика → Seed-VC с образцом → новый звук в ролик
async function revoiceGo() {
  const it = rvItem(), smp = rvSample(), who = rvWho();
  if (!it || !smp || vcUi.busy) return;
  vcUi.busy = true; renderVoices();
  try {
    rvStatus('Достаю звук из ролика…');
    const src = wavBlob(await audioMono(await decodeAudio(it.blob), 24000));
    const out = await seedVc(src, dataBlob(smp), rvStatus);
    rvStatus('Собираю ролик с новым голосом…');
    await revoiceSave(it, await decodeAudio(out), who);
    toast(`Готово: ролик с голосом «${who}» — в галерее 🎉`, {type: 'ok', ms: 7000});
    if (!$('#voiceSheet').classList.contains('hidden') && vcUi.view === 'revoice') closeSheets();
  } catch (e) {
    toast('Голос не заменён: ' + e.message + (e.kind === 'quota' ? '. Можно вручную — раздел «Вручную» в этом окне' : ''), {type: 'err', ms: 10000});
  }
  vcUi.busy = false; vcUi.rvNote = '';
  if (vcUi.view === 'revoice') renderVoices();
}
// вручную: новый звук (с сайта Seed-VC, ElevenLabs…) — в ролик
async function revoiceUpload(file) {
  const it = rvItem();
  if (!it || !file) return;
  vcUi.busy = true; renderVoices(); rvStatus('Собираю ролик с новым голосом…');
  try {
    await revoiceSave(it, await decodeAudio(file), rvWho() || 'новый звук');
    toast('Готово: ролик с новым звуком — в галерее 🎉', {type: 'ok'});
    closeSheets();
  } catch (e) { toast('Не получилось: ' + e.message, {type: 'err', ms: 8000}); }
  vcUi.busy = false; vcUi.rvNote = '';
  if (vcUi.view === 'revoice') renderVoices();
}

/* ---- фото из галереи → в персонажа: кадр в локации (по умолчанию), развёртка или инфографика ---- */
// Пользователь 2026-09-28: у каждого персонажа хранятся его ассеты — созданные фото сохраняются прямо в него.
function openToChar(it) {
  const last = vc.char(vcUi.tcChar) ? vcUi.tcChar : vc.char(wr.char) ? wr.char : vc.chars[0]?.id || null;
  Object.assign(vcUi, {view: 'tochar', from: 'tochar', item: it.id, tcChar: last, tcAs: vcUi.tcAs || 'locs'});
  vcShow();
}
function vcToCharHTML() {
  const it = items.find(x => x.id === vcUi.item), c = vc.char(vcUi.tcChar);
  if (!it) return '<p class="set-p">Фото не найдено — оно удалено из галереи.</p>';
  if (!vc.chars.length) return '<p class="set-p">Персонажей пока нет — создайте первого, и фото можно будет сохранить в него.</p><div class="vc-foot"><button class="btn free" data-vc-new>＋ Новый персонаж</button></div>';
  const full = vcUi.tcAs === 'locs' && (c?.locs?.length || 0) >= CL_MAX;
  return `<div class="vc-sheet-row"><img src="${urlOf(it.blob)}" alt="" style="width:120px;height:120px;object-fit:cover"></div>
    <div class="cl-sec">🎭 Кому</div>
    <div class="vc-chars">${vc.chars.map(x => vcCharBtn(x, `data-tc-char="${x.id}"`, x === c)).join('')}</div>
    <div class="cl-sec">Как</div>
    <div class="seg">${[['locs', '📍 Кадр в локации'], ['sheet', '🧍 Развёртка'], ['info', '📊 Инфографика']].map(([k, t]) => `<button data-tc-as="${k}" class="${vcUi.tcAs === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="hint vc-note">${vcUi.tcAs === 'locs' ? `Кадры — по одному на видео: у персонажа сейчас ${c?.locs?.length || 0} из ${CL_MAX}.` : vcUi.tcAs === 'sheet' ? 'Заменит его развёртку — как он выглядит.' : 'Заменит его инфографику — о чём ролики.'}</div>
    <div class="vc-foot"><button class="btn free" data-tc-go ${c && !full ? '' : 'disabled'}>🧍 Сохранить${c ? ': ' + esc(c.name) : ''}</button></div>`;
}
async function toCharSave() {
  const it = items.find(x => x.id === vcUi.item), c = vc.char(vcUi.tcChar), as = vcUi.tcAs;
  if (!it?.blob || !c) return;
  let d;
  try { d = await refDataUrl(it.blob); } catch { return toast('Не удалось прочитать фото', {type: 'err'}); }
  if (as === 'locs') {
    c.locs ||= [];
    if (c.locs.length >= CL_MAX) return toast(`${c.name}: уже ${CL_MAX} кадров`, {type: 'err'});
    c.locs.push(d);
  } else c[as] = d;
  it.char = c.id; DB.put(it);   // фото — его: найдётся в галерее по имени
  await vc.saveChars();
  closeSheets(); vcRefresh();
  toast(`${c.name}: ${as === 'locs' ? `кадр в локации №${c.locs.length} сохранён` : as === 'sheet' ? 'развёртка обновлена' : 'инфографика обновлена'}`, {type: 'ok'});
}

/* ---- «📜 Готовые сценарии»: всё, что написал ИИ, — забрать в любой момент ---- */
// Пользователь 2026-09-28: «должно быть место, где можно забрать готовые сценарии». Каждый написанный сценарий
// (из «Сценариев» и по «🎬 Видео» у персонажа) сохраняется с персонажем, датой и своим кадром в локации.
const SCR_ID = 'freefield-scripts', SCR_MAX = 100;
const scr = {list: [], save() { return DB.put({id: SCR_ID, list: this.list}).catch(() => {}); }};
async function scrLoad() {
  const rec = await DB.req('readonly', s => s.get(SCR_ID)).catch(() => null);
  scr.list = rec?.list || [];
  if (cl.mode === 'chars') renderChars();
}
function scrAdd(list, by) {
  const c = vc.char(wr.char), at = Date.now();
  const add = list.map((s, i) => ({id: 'sc-' + uid(), at, by, char: c?.id || null, charName: c?.name || '', title: s.title, angle: s.angle,
    video_prompt: s.video_prompt, asset_prompt: s.asset_prompt, caption: s.caption || '', loc: wr.locs[i] || null}));
  scr.list = [...add, ...scr.list].slice(0, SCR_MAX);
  scr.save();
  return add;
}
const scrWho = x => vc.char(x.char)?.name || x.charName || '';
function scrShown() {
  const f = vcUi.scrF || 'all';
  return scr.list.filter(x => f === 'all' || (f === 'none' ? !x.char : x.char === f));
}
function openScripts(f = 'all') { Object.assign(vcUi, {view: 'scripts', from: 'scripts', scrF: f}); vcShow(); }
function scrHTML() {
  if (!scr.list.length) return '<p class="set-p">Здесь будут все сценарии, которые напишет ИИ, — из «Сценариев» и по кнопке «🎬 Видео» у персонажа. Забрать их можно в любой момент: скопировать, сохранить файлом или отправить в видео сервисы.</p>';
  const f = vcUi.scrF || 'all', count = k => scr.list.filter(x => k === 'none' ? !x.char : x.char === k).length;
  const chips = [['all', `Все · ${scr.list.length}`], ...vc.chars.filter(c => count(c.id)).map(c => [c.id, `${c.name} · ${count(c.id)}`]),
    ...(count('none') ? [['none', `Без персонажа · ${count('none')}`]] : [])];
  const list = scrShown(), when = t => new Date(t).toLocaleString('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
  return `<div class="scr-f chips">${chips.map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-scr-f="${k}">${esc(t)}</button>`).join('')}</div>
    <div class="cl-row" style="margin-bottom:10px"><button class="btn small free" data-scr-video-all ${list.length ? '' : 'disabled'}>🎬 Видео по всем (${Math.min(list.length, CL_MAX)})</button><button class="btn small" data-scr-copy-all>📋 Скопировать все (${list.length})</button><button class="btn small" data-scr-file>💾 Файлом .txt</button></div>
    ${list.map(x => `<div class="wr-card scr-card">
      <div class="scn-head">${x.loc ? `<img src="${x.loc}" alt="">` : ''}<span><b>${esc(x.title)}</b>${x.angle ? ` <span class="wr-tag">${esc(x.angle)}</span>` : ''}
        <div class="scr-meta">${[scrWho(x) && '🎭 ' + esc(scrWho(x)), when(x.at), x.by && esc(x.by), x.sent && '🎬 видео уже заказано'].filter(Boolean).join(' · ')}</div></span></div>
      <details><summary>Показать сценарий</summary><div class="wr-blocks">${blocksHTML(x.video_prompt)}</div>
        ${x.caption ? `<div class="scr-meta">✍ Подпись к посту: ${esc(x.caption)}</div>` : ''}${x.asset_prompt ? `<div class="scr-meta">Промпт ассета: ${esc(x.asset_prompt)}</div>` : ''}</details>
      <div class="cl-row"><button class="btn small" data-scr-copy="${x.id}">📋 Копировать</button><button class="btn small" data-scr-scn="${x.id}">🎬 В видео сервисы</button><button class="btn small danger" data-scr-del="${x.id}" title="Удалить сценарий">🗑</button></div>
    </div>`).join('') || '<p class="set-p">Здесь пока пусто.</p>'}`;
}
const scrText = x => `${x.title}${x.angle ? ` (${x.angle})` : ''}${scrWho(x) ? ` — ${scrWho(x)}` : ''}\n\n${fillBlocks(x.video_prompt)}${x.caption ? `\n\nПодпись к посту: ${x.caption}` : ''}`;
async function scrCopy(id) {
  const list = id === 'all' ? scrShown() : scr.list.filter(x => x.id === id);
  if (!list.length) return;
  const t = list.map((x, i) => (list.length > 1 ? `Сценарий ${i + 1}. ` : '') + scrText(x)).join('\n\n———\n\n');
  toast(await clCopyText(t) ? (list.length > 1 ? `Скопировано сценариев: ${list.length}` : 'Сценарий скопирован — по блокам, как эталон') : 'Не удалось скопировать', {type: 'ok'});
}
function scrFile() {
  const list = scrShown();
  if (!list.length) return;
  const f = vcUi.scrF || 'all', who = f === 'all' ? 'все' : f === 'none' ? 'без-персонажа' : vc.char(f)?.name || 'персонаж';
  saveFile(new Blob([list.map((x, i) => `Сценарий ${i + 1}. ${scrText(x)}${x.asset_prompt ? `\n\nПромпт ассета: ${x.asset_prompt}` : ''}`).join('\n\n———\n\n')], {type: 'text/plain;charset=utf-8'}),
    `сценарии-${who}-${new Date().toISOString().slice(0, 10)}.txt`);
}
// сценарий из архива → сценарий «Видео»: с его кадром в локации, развёрткой и голосом персонажа
function scrScn(x) {
  const c = vc.char(x.char);
  return {...blankScn(), kind: 'video', prompt: fillBlocks(x.video_prompt), aspect: '9:16', fixed: true, ...(x.service && {service: x.service}),
    ...(x.loc && {ref: x.loc}), ...(c?.sheet && {sheet: c.sheet}), ...(c && {char: c.id, voice: c.voice})};
}
// видео сразу по готовым сценариям: с компьютером — запуск, без него — карточки для сайтов («Видео» не трогаем)
async function scrVideo(ids) {
  const list = ids.map(id => scr.list.find(x => x.id === id)).filter(Boolean);
  if (!list.length) return;
  if (await scnGo(list.map(scrScn))) { list.forEach(x => { x.sent = Date.now(); }); scr.save(); }
}
function scrToScn(id) {
  const x = scr.list.find(y => y.id === id);
  if (!x) return;
  const scn = scrScn(x);
  const empty = cl.scn.findIndex(scnEmpty);
  if (empty >= 0) cl.scn[empty] = scn; else if (cl.scn.length < CL_MAX) cl.scn.push(scn);
  else return toast(`Уже ${CL_MAX} сценариев в «Видео» — уберите лишний`, {type: 'err'});
  cl.save();
  closeSheets(); setView('create'); setCreateMode('scn');
  toast(`«${x.title}» — в «Видео»${x.loc ? ', с его кадром в локации' : ''}`, {type: 'ok'});
}
function scrDel(id) {
  const i = scr.list.findIndex(x => x.id === id);
  if (i < 0) return;
  const [x] = scr.list.splice(i, 1);
  scr.save(); renderVoices();
  toast(`Сценарий «${x.title}» удалён`, {action: 'Вернуть', onAction: () => { scr.list.splice(i, 0, x); scr.save(); if (vcUi.view === 'scripts') renderVoices(); }});
}

// «▶ Голос» в карточке персонажа — его образец
const chPlay = {id: null, audio: null};
function charPlay(c) {
  const same = chPlay.id === c?.id;
  chPlay.audio?.pause();
  Object.assign(chPlay, {id: null, audio: null});
  if (c?.sample && !same) {
    const a = new Audio(c.sample);
    a.onended = () => { Object.assign(chPlay, {id: null, audio: null}); renderChars(); };
    a.play().catch(() => toast('Не получилось включить звук', {type: 'err'}));
    Object.assign(chPlay, {id: c.id, audio: a});
  }
  renderChars();
}

/* ---- персонаж файлом: «📤 Экспорт» и «📥 Импорт» (*.freefield.json) ---- */
// Пользователь 2026-09-28: свой персонаж — только себе, не в приложение для всех. Все данные приложения — в браузере,
// поэтому персонаж переезжает файлом: развёртка, инфографика, кадры, характер, язык, голос с образцом и его готовые сценарии.
// Тот же файл — чтобы перенести персонажа на другой телефон или компьютер.
function charExport(c) {
  if (!c) return;
  const v = vc.voice(c.voice), idx = d => (c.locs || []).indexOf(d);
  const pack = {freefield: 'character', v: 1, name: c.name, lang: c.lang || 'ru', g: c.g || v?.g || 'm', about: c.about || '', sheet: c.sheet || null, info: c.info || null,
    locs: c.locs || [], sample: c.sample || null, flow: c.flow || null,
    voice: v ? (v.custom ? {id: v.id, g: v.g, name: v.name, ru: v.ru, en: v.en, form: v.form} : {id: v.id}) : null,
    scenarios: scr.list.filter(x => x.char === c.id).map(x => ({title: x.title, angle: x.angle, video_prompt: x.video_prompt, asset_prompt: x.asset_prompt,
      service: x.service || null, ...(x.loc && (idx(x.loc) >= 0 ? {loc: idx(x.loc)} : {locData: x.loc}))}))};
  saveFile(new Blob([JSON.stringify(pack)], {type: 'application/json'}), `${c.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'персонаж'}.freefield.json`);
}
async function charImport(file) {
  if (!file) return;
  const wait = toast('Загружаю персонажа…', {ms: 20000});
  try {
    let pack;
    try { pack = JSON.parse(await file.text()); } catch { throw new Error('это не файл персонажа Freefield (.freefield.json)'); }
    if (pack?.freefield !== 'character' || !String(pack.name || '').trim()) throw new Error('это не файл персонажа Freefield');
    const img = async d => /^data:image\//.test(d || '') ? refDataUrl(dataBlob(d)) : null;
    const [sheet, info, locs, smp] = await Promise.all([img(pack.sheet), img(pack.info), Promise.all((pack.locs || []).slice(0, CL_MAX).map(img)),
      /^data:(audio|video)\//.test(pack.sample || '') ? voiceSample(dataBlob(pack.sample)).catch(() => null) : null]);
    // голос: свой из файла (тот же id — обновится) или готовый из списка; занят другим персонажем — первый свободный
    let voice = pack.voice?.id || null;
    if (pack.voice?.en) {
      const v = {id: pack.voice.id, g: pack.voice.g, name: pack.voice.name, ru: pack.voice.ru, en: pack.voice.en, form: pack.voice.form, custom: true};
      const i = vc.custom.findIndex(x => x.id === v.id);
      if (i >= 0) vc.custom[i] = v; else vc.custom.push(v);
      vc.saveCustom();
    }
    const name = String(pack.name).trim().slice(0, 40), old = vc.chars.find(c => c.name.trim().toLowerCase() === name.toLowerCase());
    if (!vc.voice(voice) || vc.owner(voice, old?.id)) voice = null;   // занят или неизвестен — без описания (голос — во Flow и образец)
    const c = {...(old || {}), id: old?.id || 'ch-' + uid(), name, sheet, info, locs: locs.filter(Boolean), about: String(pack.about || '').slice(0, 600),
      lang: pack.lang === 'en' ? 'en' : 'ru', voice, sample: 'sample' in pack ? smp?.data || null : old?.sample || null, sampleSec: 'sample' in pack ? smp?.sec || 0 : old?.sampleSec || 0,
      g: ['m', 'f', 'k'].includes(pack.g) ? pack.g : vc.voice(voice)?.g || 'm',
      flow: pack.flow?.name ? {kind: pack.flow.kind === 'char' ? 'char' : 'voice', name: String(pack.flow.name).slice(0, 40)} : old?.flow || {kind: 'voice', name}};
    if (old) vc.chars[vc.chars.indexOf(old)] = c; else vc.chars.push(c);
    await vc.saveChars();
    // свой голос-описание, который больше никому не нужен, — долой
    if (old?.voice && old.voice !== voice && vc.voice(old.voice)?.custom && !vc.owner(old.voice) && !cl.scn.some(s => s.voice === old.voice)) {
      vc.custom = vc.custom.filter(v => v.id !== old.voice); vc.saveCustom();
    }
    // его готовые сценарии → «📜 Готовые сценарии»; такой же по названию уже есть — обновляется, а не дублируется
    const at = Date.now(), scs = [];
    for (const [i, x] of (pack.scenarios || []).slice(0, SCR_MAX).entries()) {
      if (!x?.video_prompt) continue;
      const title = String(x.title || 'Сценарий'), same = scr.list.find(y => y.char === c.id && (y.title === title || y.video_prompt === x.video_prompt));
      const it = {...(same || {id: 'sc-' + uid(), at: at - i, by: pack.by || 'из файла', char: c.id, charName: c.name}), title, angle: String(x.angle || ''),
        video_prompt: String(x.video_prompt), asset_prompt: String(x.asset_prompt || ''), service: ['flow', 'dola', 'arena', 'vids'].includes(x.service) ? x.service : null,
        loc: Number.isInteger(x.loc) ? c.locs[x.loc] || null : await img(x.locData)};
      if (same) scr.list[scr.list.indexOf(same)] = it;
      scs.push(it);
    }
    scr.list = [...scs.filter(x => !scr.list.includes(x)), ...scr.list].slice(0, SCR_MAX);
    scr.save();
    wait.remove();
    setView('create'); setCreateMode('chars'); vcRefresh();
    const n = scs.length;
    toast(`${c.name} ${old ? 'обновлён' : 'добавлен'}: ${wrCharTook(c)}${c.sample ? ', образец голоса' : ''}${n ? `, ${n} ${plur(n, 'готовый сценарий', 'готовых сценария', 'готовых сценариев')}` : ''}`,
      {type: 'ok', ms: 30000, ...(n && {action: `🎬 ${n} видео`, onAction: () => scrVideo(scs.map(x => x.id))})});
  } catch (e) { wait.remove(); toast('Персонаж не загрузился: ' + e.message, {type: 'err', ms: 9000}); }
}

/* ---- «Персонажи» — 4-й раздел «Создать»: герои роликов со всем, что к ним нужно ---- */
// Пользователь 2026-09-28: отдельный раздел, где хранятся разные персонажи с их инфографикой, голосом и т. д.
// Персонаж: имя, развёртка, «кто он» (характер — ИИ держит его в сценариях), инфографика, кадры в локациях, голос
// (описание, образец файлом или записью, голос во Flow). «✍ Сценарий с ним» — всё встаёт в «Сценарии».
// чего не хватает, чтобы серия шла сама: [текст, кнопка-исправление]; кадры нужны только для «Мои кадры»
function charNeeds(c, mineFrames = 0) {
  const out = [];
  if (!c.sheet) out.push(['нет развёртки — как он выглядит', `<button class="wr-link" data-ser-fix>🧍 добавить</button>`]);
  if (!c.info) out.push(['нет инфографики — о чём ролики', `<button class="wr-link" data-ser-fix>📊 добавить</button>`]);
  if (mineFrames > (c.locs?.length || 0)) out.push([`кадров «в локации» у персонажа ${c.locs?.length || 0}, а видео — ${mineFrames}`, '<button class="wr-link" data-ser-frames="new">🖼 пусть Flow сделает новые</button>']);
  const who = writerNow(), gem = '<button class="wr-link" data-keys-open>🔑 подключить Gemini — бесплатно</button>';
  if (who === 'chat') out.push(wallet.gemini || wallet.anthropic ? ['в «Сценариях» выбран «ИИ в чате» — он сам не пишет', '<button class="wr-link" data-ser-auto>⚡ пусть пишет ИИ здесь</button>']
    : ['ИИ для сценариев не подключён', gem]);
  else if (who === 'gemini' && !wallet.gemini || who === 'claude' && !wallet.anthropic)   // выбран ИИ, а ключ удалён
    out.push([`выбран ${WRITERS[who].name}, но его ключа нет`, wallet.gemini || wallet.anthropic ? '<button class="wr-link" data-ser-auto>⚡ взять ИИ с ключом</button>' : gem]);
  return out;
}

/* ---- «🚀 Серия роликов»: одна кнопка у персонажа — сценарии → кадры → видео ---- */
// Пользователь 2026-09-28: «у персонажа кнопка — создать N видео (1–10), и дальше скрипт сам: ассеты, сценарии, видео».
// Дирижёр: ИИ пишет N сценариев (с подписью к посту) по инфографике, развёртке и характеру → кадры «герой в локации» во Flow
// (Nano Banana 2, без кредитов) по промптам ассетов → первый вариант — первый кадр видео → видео с его голосом. С компьютером
// всё идёт само (ждём пачки компьютера); без него — карточки для сайтов: «Создать» нажимает пользователь, а следующий шаг
// начинается сам, как только результат загружен в карточку. Состояние — в базе: закрытая вкладка серию не теряет.
const SER_ID = 'freefield-series', FFLATE = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
const ser = {jobs: [], busy: false, timer: 0, writing: new Set(), save() { return DB.put({id: SER_ID, jobs: this.jobs}).catch(() => {}); }};
const SER_STAGE = {write: '✍ ИИ пишет сценарии', frames: '🖼 Кадры во Flow', video: '🎬 Видео', done: '✅ Серия готова', error: '⚠ Серия остановлена'};
const serLive = j => j && !['done', 'error'].includes(j.stage);
const serOf = id => ser.jobs.filter(j => j.char === id).sort((a, b) => b.at - a.at)[0] || null;
async function serLoad() {
  const r = await DB.req('readonly', s => s.get(SER_ID)).catch(() => null);
  ser.jobs = r?.jobs || [];
  serKick();
}
function serKick() {
  clearInterval(ser.timer);
  if (ser.jobs.some(j => serLive(j) && !j.paused)) ser.timer = setInterval(serTick, 4000);
  serTick();
}
function serShow() {   // перерисовать экран серии и карточку персонажа
  if (vcUi.view === 'series' && !$('#voiceSheet').classList.contains('hidden') && !vcUi.serNew) renderVoices();
  if (cl.mode === 'chars') renderChars();
}
function serNote(j, note) { if (note != null) j.note = note; ser.save(); serShow(); }
function serFail(j, msg) {
  Object.assign(j, {failed: j.stage, stage: 'error', note: msg});   // failed — на каком шаге остановилась: «↻ Повторить» продолжит с него
  ser.save(); serShow();
  toast(`Серия «${vc.char(j.char)?.name || ''}»: ${msg}`, {type: 'err', ms: 9000});
}
async function serTick() {
  if (ser.busy) return;
  ser.busy = true;
  try { for (const j of ser.jobs.filter(j => serLive(j) && !j.paused)) await serStep(j); }
  catch (e) { console.warn('серия', e); }
  ser.busy = false;
  if (!ser.jobs.some(j => serLive(j) && !j.paused)) clearInterval(ser.timer);
}
async function serStep(j) {
  const c = vc.char(j.char);
  if (!c) return serFail(j, 'персонаж удалён');
  if (j.hub && (j.sentFrames || j.sentVideos)) await hubLink.refresh();   // пачки компьютера — свежие
  if (j.stage === 'write') return j.retryAt > Date.now() ? null : serWrite(j, c);
  if (j.stage === 'frames') return j.sentFrames ? serFramesWait(j, c) : serFramesSend(j, c);
  if (j.stage === 'video') return j.sentVideos ? serVideoWait(j) : serVideoSend(j, c);
}
// 1. сценарии: ячейки «Сценариев» на время — материалы персонажа (без кадров: кадры сделает Flow по сценариям).
// Пишем частями, не больше SER_CHUNK за раз, и дописываем недостающие: длинный ответ ИИ обрывался — и «↻ Повторить»
// снова давал «сценарии не написаны» (пользователь 2026-09-29). Написанное остаётся в серии.
const SER_CHUNK = 5;
async function serWrite(j, c) {
  if (ser.writing.has(j.id)) return;
  ser.writing.add(j.id);
  j.rows ||= [];
  const have = j.rows.length, k = Math.min(SER_CHUNK, j.n - have);
  const keep = {char: wr.char, info: wr.info, sheet: wr.sheet, locs: wr.locs, count: wr.count, idea: wr.idea};
  const was = have ? `\nУже написаны — придумай другие углы и темы, не повторяй их: ${j.rows.map(r => `«${r.title}»${r.angle ? ` (${r.angle})` : ''}`).join(', ')}` : '';
  Object.assign(wr, {char: c.id, info: c.info, sheet: c.sheet, locs: j.frames === 'mine' ? c.locs.slice(have, have + k) : [], count: k, idea: (j.idea || '') + was});
  serNote(j, `${WRITERS[writerNow()].name} пишет ${have ? 'ещё ' : ''}${k} ${plur(k, 'сценарий', 'сценария', 'сценариев')}${have ? ` (готово ${have} из ${j.n})` : ''}…`);
  try {
    const {r, list} = await writeRun();
    // не по формату или оборвался — у ИИ каждый раз другой ответ: повторяем сами, как при перегрузке
    if (!list?.length) throw Object.assign(new Error(r.cut ? 'ответ ИИ оборвался на полуслове' : 'ИИ ответил не по формату'), {transient: true});
    const add = scrAdd(list.slice(0, k), r.by);
    j.rows.push(...add.map((x, i) => ({scr: x.id, title: x.title, angle: x.angle, video_prompt: x.video_prompt, asset_prompt: x.asset_prompt, caption: x.caption,
      frame: j.frames === 'mine' ? c.locs[have + i] || null : null, alt: []})));
    Object.assign(j, {by: r.by, tries: 0, retryAt: 0});
    if (j.rows.length >= j.n) j.stage = j.frames === 'mine' ? 'video' : 'frames';
    serNote(j, j.rows.length < j.n ? `Готово ${j.rows.length} из ${j.n} — пишу остальные…` : '');
  } catch (e) {
    if (e.transient && (j.tries || 0) < 5) {
      j.tries = (j.tries || 0) + 1;
      j.retryAt = Date.now() + j.tries * 60000;
      serNote(j, `${e.message.split(' — ')[0]} — повторю сам через ${j.tries} мин (попытка ${j.tries + 1} из 6)`);
    } else serFail(j, 'сценарии не написаны: ' + e.message);
  }
  finally { Object.assign(wr, keep); ser.writing.delete(j.id); }
}
// 2. кадры «герой в локации» во Flow — по промпту ассета, с развёрткой героя; вертикально, как видео
const serFrameTask = (r, c, hub) => ({prompt: String(r.asset_prompt || r.title).replace(/vertical 3:4/gi, 'vertical 9:16'), kind: 'image', service: 'flow', model: 'nano-banana-2.1',
  aspect_ratio: '9:16', count: hub ? 2 : 1, images: [c.sheet]});
async function serFramesSend(j, c) {
  const rows = j.rows.filter(r => !r.frame && !r.skip);
  j.hub = await hubReady();
  if (j.hub) {
    const tasks = rows.map(r => serFrameTask(r, c, true));
    try {
      const res = await fetch(hubLink.url('/api/batch'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({scenarios: tasks})});
      const js = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(js.error || `компьютер ответил ${res.status}`);
    } catch (e) { return serFail(j, 'кадры не отправлены: ' + e.message); }
    rows.forEach((r, i) => Object.assign(r, {fprompt: tasks[i].prompt, fidx: i, err: null}));
    j.fsent = rows.length;
    j.sentFrames = Date.now();
    serNote(j, 'Компьютер делает кадры во Flow…');
    hubLink.refresh();
  } else {
    const cards = phoneCards(rows.map(r => serFrameTask(r, c, false)));
    rows.forEach((r, i) => Object.assign(r, {card: cards[i]?.id, err: null}));
    j.sentFrames = Date.now();
    serNote(j, 'Карточки кадров — в галерее: создайте фото во Flow и загрузите в карточку, дальше серия пойдёт сама');
  }
}
// пункт пачки компьютера: по промпту, а не нашёлся — по порядку в пачке того же размера
function serHubItem(since, prompt, idx, size, kind) {
  const fresh = hubLink.batches.filter(b => b.created >= since - 60000);
  for (const b of fresh) { const it = prompt && b.items.find(x => x.prompt === prompt); if (it) return it; }
  const b = fresh.find(b => b.items.length === size && b.items.every(x => (x.kind || kind) === kind));
  return b?.items[idx] || null;
}
async function serFramesWait(j, c) {
  for (const r of j.rows.filter(r => !r.frame && !r.skip && !r.err)) {
    if (j.hub) {
      const it = serHubItem(j.sentFrames, r.fprompt, r.fidx, j.fsent, 'image');
      if (it?.status === 'error') { r.err = it.message || 'Flow не сделал кадр'; continue; }
      if (it?.status !== 'done' || !it.files?.length) continue;
      const imgs = [];
      for (const f of it.files.filter(f => !f.mime || f.mime.startsWith('image/'))) {
        try { imgs.push(await refDataUrl(await (await fetch(hubLink.url(f.url))).blob())); } catch { /* следующий файл */ }
      }
      if (imgs.length) Object.assign(r, {frame: imgs[0], alt: imgs.slice(1)});
    } else {
      const it = items.find(x => x.id === r.card);
      if (!it) r.err = 'карточку кадра удалили';
      else if (it.status === 'done' && it.blob) r.frame = await refDataUrl(it.blob);
    }
  }
  const rows = j.rows.filter(r => !r.skip), ready = rows.filter(r => r.frame).length, left = rows.filter(r => !r.frame && !r.err).length;
  if (left) return serNote(j, `Кадры: ${ready} из ${rows.length}${j.hub ? ' — компьютер делает во Flow' : ' — загрузите результат в карточки в галерее'}`);
  if (!ready) return serFail(j, 'ни одного кадра — проверьте Flow и нажмите «↻ Повторить»');
  // кадры — и персонажу, пока есть место: пригодятся для новых роликов
  const room = CL_MAX - (c.locs?.length || 0);
  if (room > 0) { c.locs = [...(c.locs || []), ...rows.filter(r => r.frame).map(r => r.frame).filter(f => !(c.locs || []).includes(f)).slice(0, room)]; await vc.saveChars(); }
  j.stage = 'video';
  serNote(j, rows.some(r => r.err) ? 'Часть кадров не вышла — видео будут по остальным' : '');
}
// 3. видео: кадр + развёртка + голос персонажа; «Видео» пользователя не трогаем
async function serVideoSend(j, c) {
  const rows = j.rows.filter(r => r.frame && !r.skip);
  if (!rows.length) return serFail(j, 'нет ни одного сценария с кадром');
  j.hub = await hubReady();
  const res = await scnGo(rows.map(r => ({...blankScn(), kind: 'video', prompt: fillBlocks(r.video_prompt), aspect: '9:16', fixed: true, service: j.service === 'auto' ? 'auto' : 'flow',
    ref: r.frame, sheet: c.sheet, char: c.id, voice: c.voice})));
  if (!res) return serFail(j, 'видео не отправлены');
  rows.forEach((r, i) => Object.assign(r, {vidx: i, vcard: Array.isArray(res) ? res[i]?.id : null, vstate: 'queued'}));
  rows.forEach(r => { const x = scr.list.find(y => y.id === r.scr); if (x) x.sent = Date.now(); });
  scr.save();
  Object.assign(j, {vsent: rows.length, sentVideos: Date.now()});
  serNote(j, j.hub ? 'Компьютер делает видео…' : 'Карточки видео — в галерее: «Создать» на сайте и загрузите результат в карточку');
}
async function serVideoWait(j) {
  const rows = j.rows.filter(r => r.frame && !r.skip && r.vidx != null);
  for (const r of rows) {
    if (j.hub) {
      const it = serHubItem(j.sentVideos, null, r.vidx, j.vsent, 'video');
      if (!it) continue;
      r.vstate = it.status === 'done' ? 'done' : it.status === 'error' ? 'error' : 'queued';
      if (it.status === 'error') r.verr = it.message || 'ошибка';
      if (it.status === 'done') r.vfiles = (it.files || []).filter(f => !f.mime || f.mime.startsWith('video/')).map(f => f.url);
    } else {
      const it = items.find(x => x.id === r.vcard);
      r.vstate = !it ? 'error' : it.status === 'done' && it.blob ? 'done' : 'queued';
      if (!it) r.verr = 'карточку видео удалили';
    }
  }
  const done = rows.filter(r => r.vstate === 'done').length, left = rows.filter(r => r.vstate === 'queued').length;
  if (left) return serNote(j, `Видео: ${done} из ${rows.length}`);
  Object.assign(j, {stage: 'done', doneAt: Date.now()});
  serNote(j, `${done} из ${rows.length} видео готовы`);
  toast(`Серия «${vc.char(j.char)?.name || ''}» готова: ${done} ${plur(done, 'видео', 'видео', 'видео')} — «📦 Скачать всё» у персонажа`, {type: 'ok', ms: 9000});
}
// «📦 Скачать всё»: видео и подписи к постам — одним архивом (видео уже сжаты — кладём как есть)
async function serZip(j, btn) {
  const c = vc.char(j.char), slug = t => String(t || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 40) || 'ролик';
  btn.disabled = true; btn.textContent = '⏳ Собираю…';
  try {
    const {zipSync, strToU8} = await import(FFLATE);
    const files = {};
    let n = 0;
    for (const [i, r] of j.rows.entries()) {
      if (r.skip) continue;
      const base = `${String(i + 1).padStart(2, '0')} ${slug(r.title)}`;
      let blob = r.vcard ? items.find(x => x.id === r.vcard)?.blob || null : null;
      if (!blob && r.vfiles?.length) blob = await fetch(hubLink.url(r.vfiles[0])).then(x => x.ok ? x.blob() : null).catch(() => null);
      if (blob) { files[`${base}.mp4`] = [new Uint8Array(await blob.arrayBuffer()), {level: 0}]; n++; }
      files[`${base}.txt`] = strToU8(`${r.title}${r.angle ? ` (${r.angle})` : ''}\n\n${r.caption || ''}\n\n———\n${fillBlocks(r.video_prompt)}\n`);
    }
    await saveFile(new Blob([zipSync(files)], {type: 'application/zip'}), `серия ${slug(c?.name)} ${new Date().toISOString().slice(0, 10)}.zip`);
    if (!n) toast('Видео в архиве нет — только подписи: готовые видео ещё не в галерее', {type: 'err'});
  } catch (e) { toast('Архив не собрался: ' + e.message, {type: 'err'}); }
  btn.disabled = false; btn.textContent = '📦 Скачать всё';
}
// окно серии: настройки новой серии или ход последней
function openSeries(id, fresh = false) {
  const c = vc.char(id);
  if (!c) return;
  vcUi.serSet ||= {n: 5, frames: 'new', service: 'flow', idea: ''};
  Object.assign(vcUi, {view: 'series', from: 'series', serChar: id, serNew: fresh || !serOf(id)});
  vcShow();
}
function serHTML() {
  const c = vc.char(vcUi.serChar);
  if (!c) return '<p class="set-p">Персонаж не найден.</p>';
  const j = !vcUi.serNew && serOf(c.id);
  return j ? serJobHTML(j, c) : serSetupHTML(c);
}
function serSetupHTML(c) {
  const o = vcUi.serSet, hub = hubLink.ok, mine = c.locs?.length || 0, need = charNeeds(c, o.frames === 'mine' ? o.n : 0);
  const m = scnModel('video', 'flow', scnDefault('video', 'flow')), per = m?.[4] || 20, total = o.n * per, acc = Math.ceil(total / 50), left = hubLink.info?.flowLeft;
  return `<p class="set-p">Нажали — и дальше само: ${WRITERS[writerNow()]?.name || 'ИИ'} напишет сценарии (с подписью к посту), Flow сделает кадры «${esc(c.name)} в локации», по ним — видео с его голосом. ${hub
      ? '🟢 Компьютер подключён — всё пойдёт само, готовое появится в галерее.'
      : '📱 Без компьютера — полуавтомат: на каждый шаг — карточки в галерее, «Создать» на сайте нажимаете вы; следующий шаг начнётся сам, как только результат загружен в карточку.'}</p>
    <div class="vc-opt"><span>Сколько видео</span><div class="chips">${Array.from({length: CL_MAX}, (_, i) => `<button class="chip ${o.n === i + 1 ? 'on' : ''}" data-ser-n="${i + 1}">${i + 1}</button>`).join('')}</div></div>
    <div class="vc-opt"><span>Кадры «в локации» — первый кадр каждого видео</span>
      <div class="seg ser-seg"><button data-ser-frames="new" class="${o.frames === 'new' ? 'on' : ''}">🖼 Новые — Flow, без кредитов</button><button data-ser-frames="mine" class="${o.frames === 'mine' ? 'on' : ''}">📍 Мои кадры (${mine})</button></div></div>
    <div class="vc-opt"><span>Где делать видео</span>
      <div class="seg ser-seg"><button data-ser-svc="flow" class="${o.service === 'flow' ? 'on' : ''}">Google Flow</button><button data-ser-svc="auto" class="${o.service === 'auto' ? 'on' : ''}">Авто — Flow · Dola · Arena</button></div></div>
    <div class="vc-opt"><span>Пожелания к роликам (необязательно)</span><textarea class="vc-in" data-ser-idea rows="2" maxlength="400" placeholder="Например: про первые шаги в программировании, с юмором, без рекламы">${esc(o.idea)}</textarea></div>
    <div class="ser-cost">💳 ${o.service === 'flow'
      ? `Flow: ${o.n} × ${per} = <b>${total}</b> ${plur(total, 'кредит', 'кредита', 'кредитов')} — на сегодня ${acc} ${plur(acc, 'аккаунт', 'аккаунта', 'аккаунтов')} Google (по 50 в день)${left != null ? `; сейчас во Flow осталось <b>${left}</b>` : ''}.`
      : 'Авто: видео разойдутся по Flow, Dola и Arena — кредитов Flow уйдёт меньше.'} ${o.frames === 'new' ? 'Кадры Nano Banana 2.1 — без кредитов.' : ''}${c.flow?.name ? ` Голос во Flow — ${c.flow.kind === 'char' ? '@' : '@Voice: '}${esc(c.flow.name)}: он должен быть сохранён в каждом аккаунте Flow, где пойдут видео.` : ''}</div>
    ${need.length ? `<div class="ch-video"><b>Чтобы серия пошла, не хватает:</b><ul class="ch-need">${need.map(([t, a]) => `<li>${t} — ${a}</li>`).join('')}</ul></div>` : ''}
    <div class="vc-foot"><button class="btn free" data-ser-go ${need.length ? 'disabled' : ''}>▶ Запустить: ${o.n} ${plur(o.n, 'видео', 'видео', 'видео')}</button>${serOf(c.id) ? '<button class="btn" data-ser-last>Последняя серия</button>' : ''}<button class="btn" data-vc-back>Отмена</button></div>`;
}
// серия остановилась на сценариях, а у персонажа или ИИ чего-то не хватает — «↻ Повторить» без этого бесполезен
const serBlock = (j, c) => j.stage === 'error' && (j.failed === 'write' || !j.rows?.length) ? charNeeds(c) : [];
function serJobHTML(j, c) {
  const live = serLive(j), sent = !!j.sentVideos, st = s => s === 'done' ? '✓' : s === 'error' ? '⚠' : '⏳', block = serBlock(j, c);
  const steps = ['write', ...(j.frames === 'new' ? ['frames'] : []), 'video', 'done'], cur = steps.indexOf(j.stage);
  const rows = (j.rows || []).map((r, i) => {
    const f = r.frame ? 'done' : r.err ? 'error' : 'wait', v = r.skip ? '' : r.vstate || (sent ? 'queued' : '');
    return `<div class="ser-row ${r.skip ? 'skip' : ''}">${r.frame ? `<img src="${r.frame}" alt="">` : '<i class="ser-ph">🖼</i>'}
      <div class="ser-main"><b>${i + 1}. ${esc(r.title)}</b>${r.angle ? ` <span class="wr-tag">${esc(r.angle)}</span>` : ''}
        <small>✍ сценарий ✓ · 🖼 кадр ${f === 'done' ? '✓' : f === 'error' ? '⚠ ' + esc(r.err) : '⏳'} · 🎬 видео ${r.skip ? '— пропущено' : v ? st(v) + (r.verr ? ' ' + esc(r.verr) : '') : '—'}</small></div>
      ${!sent && !r.skip ? `${r.alt?.length ? `<button class="btn small" data-ser-alt="${i}" title="Взять другой вариант кадра">🔄 Кадр</button>` : ''}<button class="btn small" data-ser-skip="${i}" title="Не делать видео по этому сценарию">✕</button>` : ''}</div>`;
  }).join('');
  return `<div class="ser-head"><b>${SER_STAGE[j.stage]}${j.paused ? ' · ⏸ пауза' : ''}</b><span>${j.n} ${plur(j.n, 'видео', 'видео', 'видео')} · ${j.hub ? '💻 с компьютера' : '📱 карточки'} · ${new Date(j.at).toLocaleString('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}</span></div>
    <div class="ser-steps">${steps.map((s, i) => `<span class="${i < cur || j.stage === 'done' ? 'ok' : i === cur ? 'now' : ''}">${SER_STAGE[s].split(' ')[0]} ${['Сценарии', 'Кадры', 'Видео', 'Готово'][['write', 'frames', 'video', 'done'].indexOf(s)]}</span>`).join('<i>→</i>')}</div>
    ${j.note ? `<div class="wr-note">${live && !j.paused ? '⏳ ' : ''}${esc(j.note)}</div>` : ''}
    ${block.length ? `<div class="ch-video"><b>Повтор даст ту же ошибку — сначала:</b><ul class="ch-need">${block.map(([t, a]) => `<li>${t} — ${a}</li>`).join('')}</ul></div>` : ''}
    <div class="ser-rows">${rows || (live ? '<p class="hint">Сценарии появятся здесь, как только ИИ их напишет.</p>' : '')}</div>
    <div class="vc-foot">
      ${j.stage === 'done' ? '<button class="btn free" data-ser-zip>📦 Скачать всё</button><button class="btn" data-ser-caps>📋 Подписи к постам</button>' : ''}
      ${j.stage === 'error' ? `<button class="btn free" data-ser-retry ${block.length ? 'disabled' : ''}>↻ Повторить</button>` : ''}
      ${live ? `<button class="btn" data-ser-pause>${j.paused ? '▶ Продолжить' : '⏸ Пауза'}</button>` : ''}
      ${live && !j.hub && j.sentFrames ? '<button class="btn" data-ser-gallery>🖼 Карточки в галерее</button>' : ''}
      ${!live ? '<button class="btn" data-ser-new>＋ Новая серия</button>' : ''}
      <button class="btn danger" data-ser-del>${live ? '🗑 Отменить серию' : '🗑 Убрать'}</button></div>`;
}
function serStart(c) {
  const o = vcUi.serSet;
  if (charNeeds(c, o.frames === 'mine' ? o.n : 0).length) return renderVoices();
  const j = {id: 'ser-' + uid(), char: c.id, n: o.n, frames: o.frames, service: o.service, idea: o.idea.trim(), at: Date.now(), stage: 'write', rows: [], note: ''};
  ser.jobs = [j, ...ser.jobs.filter(x => x.char !== c.id || serLive(x))].slice(0, 20);
  ser.save();
  vcUi.serNew = false;
  renderVoices();
  serKick();
}
// кнопки окна серии
function serClick(b) {
  const x = b.dataset, c = vc.char(vcUi.serChar), o = vcUi.serSet, j = c && serOf(c.id);
  if (x.serN) { o.n = +x.serN; return renderVoices(); }
  if (x.serFrames) { o.frames = x.serFrames; return renderVoices(); }
  if (x.serSvc) { o.service = x.serSvc; return renderVoices(); }
  if (b.hasAttribute('data-ser-go')) return serStart(c);
  if (b.hasAttribute('data-ser-last')) { vcUi.serNew = false; return renderVoices(); }
  if (b.hasAttribute('data-ser-new')) { vcUi.serNew = true; return renderVoices(); }
  if (b.hasAttribute('data-ser-fix')) return vcOpenChar(c, 'chars');
  if (b.hasAttribute('data-ser-auto')) { wr.ai = 'auto'; wr.save(); return renderVoices(); }
  if (b.hasAttribute('data-ser-gallery')) { closeSheets(); setView('gallery'); return render(); }
  if (!j) return;
  if (b.hasAttribute('data-ser-pause')) { j.paused = !j.paused; ser.save(); renderVoices(); return serKick(); }
  if (b.hasAttribute('data-ser-retry')) {   // с того места, где остановилась
    if (serBlock(j, c).length) return renderVoices();
    const miss = j.rows?.filter(r => !r.frame && !r.skip);
    Object.assign(j, {tries: 0, retryAt: 0}, !j.rows?.length || j.failed === 'write' && j.rows.length < j.n ? {stage: 'write'} : miss.length && j.frames === 'new' ? {stage: 'frames', sentFrames: 0} : {stage: 'video', sentVideos: 0}, {note: ''});
    (j.rows || []).forEach(r => { r.err = null; if (!j.sentVideos) Object.assign(r, {vstate: null, verr: null}); });
    ser.save(); renderVoices(); return serKick();
  }
  if (b.hasAttribute('data-ser-del')) {
    if (serLive(j) && !confirm('Отменить серию? Уже созданное останется в галерее')) return;
    ser.jobs = ser.jobs.filter(y => y !== j); ser.save();
    vcUi.serNew = true; renderVoices(); return renderChars();
  }
  if (x.serAlt) { const r = j.rows[+x.serAlt]; if (r?.alt?.length) { r.alt.push(r.frame); r.frame = r.alt.shift(); ser.save(); } return renderVoices(); }
  if (x.serSkip) { const r = j.rows[+x.serSkip]; if (r) { r.skip = true; ser.save(); } renderVoices(); return serKick(); }
  if (b.hasAttribute('data-ser-zip')) return serZip(j, b);
  if (b.hasAttribute('data-ser-caps')) {
    const t = j.rows.filter(r => !r.skip).map((r, i) => `${i + 1}. ${r.title}\n${r.caption || ''}`).join('\n\n');
    return clCopyText(t).then(ok => toast(ok ? 'Подписи к постам скопированы' : 'Не удалось скопировать', {type: ok ? 'ok' : 'err'}));
  }
}

function charCardHTML(c) {
  const v = vc.voice(c.voice), n = c.locs?.length || 0;
  const tags = [c.info && '📊 инфографика', n && `📍 ${n} ${plur(n, 'кадр', 'кадра', 'кадров')}`, c.sample && `🎧 образец ${c.sampleSec || ''} с`, c.flow?.name && '🎙 Flow'].filter(Boolean);
  const mine = items.filter(it => it.char === c.id).length, scripts = scr.list.filter(x => x.char === c.id).length;
  return `<div class="ch-card ${wr.char === c.id ? 'on' : ''}">
    <button class="ch-main" data-ch-edit="${c.id}" title="Изменить персонажа">${vcThumb(c)}<span><b>${esc(c.name)}</b><small>🎙 ${esc(c.flow?.name ? (c.flow.kind === 'char' ? '@' : '@Voice: ') + c.flow.name : v?.name || 'голос не выбран')}${c.lang === 'en' ? ' · English' : ''}${wr.char === c.id ? ' · выбран в «Сценарии»' : ''}</small>
      ${c.about ? `<em>${esc(c.about)}</em>` : ''}${tags.length ? `<i class="ch-tags">${tags.map(t => `<u>${t}</u>`).join('')}</i>` : ''}</span></button>
    ${serCardHTML(c)}
    <div class="ch-acts"><button class="btn small free" data-ch-series="${c.id}">🚀 Серия роликов</button>${c.sample ? `<button class="btn small" data-ch-play="${c.id}" title="Послушать его голос">${chPlay.id === c.id ? '⏸ Голос' : '▶ Голос'}</button>` : ''}<button class="btn small" data-ch-write="${c.id}">✍ Сценарий</button><button class="btn small" data-ch-edit="${c.id}">✎ Изменить</button>
      ${mine ? `<button class="btn small" data-ch-gallery="${c.id}" title="Его фото и видео в галерее">🖼 ${mine}</button>` : ''}
      ${scripts ? `<button class="btn small" data-ch-scripts="${c.id}" title="Готовые сценарии с ним">📜 ${scripts}</button>` : ''}</div></div>`;
}
// строка серии в карточке персонажа: идёт — этап и ход, готова — кнопка к ней
function serCardHTML(c) {
  const j = serOf(c.id);
  if (!j || (j.stage === 'done' && Date.now() - (j.doneAt || 0) > 7 * 864e5)) return '';
  return `<button class="ser-line ${j.stage}" data-ch-series="${c.id}">🚀 ${SER_STAGE[j.stage]}${j.paused ? ' · ⏸' : ''}${j.note ? ` — ${esc(j.note)}` : ''}</button>`;
}
function renderChars() {
  const el = $('#charsCreate');
  if (!el) return;
  el.innerHTML = `${vc.chars.length ? '' : '<p class="ch-empty">Здесь живут герои ваших роликов. Персонаж из файла (.freefield.json) — кнопка «📥 Импорт персонажа» ниже. Один раз сохраните персонажа — внешность (развёртка), о чём он рассказывает (инфографика), кадры в локациях, характер и голос — и потом выбирайте его в «Сценариях» одним нажатием.</p>'}
    <div class="ch-list">${vc.chars.map(charCardHTML).join('')}<button class="ch-add" data-ch-new>＋ Новый персонаж</button></div>
    <div class="vc-foot"><button class="btn" data-ch-import>📥 Импорт персонажа</button><button class="btn" data-ch-scripts>📜 Готовые сценарии${scr.list.length ? ' · ' + scr.list.length : ''}</button></div>
    <p class="hint vc-note">Персонажи хранятся в этом браузере. У каждого свой голос — два персонажа одним голосом не заговорят.</p>`;
}
function bindChars() {
  $('#charsCreate').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const x = b.dataset;
    if (b.hasAttribute('data-ch-new')) return vcOpenChar(null, 'chars');
    if (x.chEdit) return vcOpenChar(vc.char(x.chEdit), 'chars');
    if (b.hasAttribute('data-ch-scripts')) return openScripts(x.chScripts || 'all');
    if (x.chPlay) return charPlay(vc.char(x.chPlay));
    if (b.hasAttribute('data-ch-import')) return pickFile('.json,application/json').then(f => f && charImport(f));
    if (x.chSeries) return openSeries(x.chSeries);
    if (x.chGallery) {   // его фото и видео: поиск галереи по имени персонажа
      $('#search').value = vc.char(x.chGallery)?.name || '';
      state.filter = 'all';
      setView('gallery'); render();
      return $('#feed')?.scrollTo({top: 0, behavior: 'smooth'});
    }
    if (x.chWrite) {   // в «Сценарии» с этим героем: развёртка, инфографика, кадры, голос — в ячейки
      const c = vc.char(x.chWrite);
      if (!c) return;
      wrUseChar(c); wr.save();
      setCreateMode('write');
      $('.panel-scroll')?.scrollTo({top: 0, behavior: 'smooth'});
      toast(`Герой — ${c.name}: ${wrCharTook(c) || 'голос не выбран'}. ${c.info ? 'Осталось написать сценарии' : 'Загрузите инфографику — о чём ролик'}`, {type: 'ok', ms: 7000});
    }
  });
}

/* ---- 🎤 Запись голоса с микрофона: образец персонажу («Точный голос») или для «Заменить голос» ---- */
// Пользователь 2026-09-28: записать свой голос прямо в приложении и взять его референсом. Запись идёт через voiceSample
// (срез тишины, до 15 с, WAV 24 кГц) — дальше как образец из файла: @Audio1 в карточках Dola, Seed-VC, 💾 на другие сайты.
const REC_MAX = 20;   // секунд — дальше стоп сам; в образец уйдут первые 15 с речи
const REC_TEXT = 'Привет! Сегодня я расскажу вам одну короткую историю. Знаете, что в ней самое удивительное? Всё оказалось намного проще, чем я думал. Сначала было непонятно, потом интересно, а в конце — просто смешно. Давайте разберёмся вместе!';
const rec = {id: 0, to: null, view: null, stream: null, mr: null, src: null, parts: [], t0: 0, timer: 0, peak: 0, busy: false};
const recSec = () => rec.t0 ? Math.floor((performance.now() - rec.t0) / 1000) : 0;
const recClock = t => `0:${String(t).padStart(2, '0')}`;
const recBtn = (to, label) => `<button class="btn small" data-rec="${to}" ${rec.to ? 'disabled' : ''}>🎤 ${label}</button>`;
function recPanel(to) {
  if (rec.to !== to) return '';
  if (!rec.mr) return '<div class="rec-box"><div class="rec-top">⏳ Разрешите доступ к микрофону…</div></div>';
  if (rec.busy) return '<div class="rec-box"><div class="rec-top">⏳ Готовлю образец…</div></div>';
  const t = recSec();
  return `<div class="rec-box"><div class="rec-top"><i class="rec-dot"></i><b id="recTime" class="${t >= 10 ? 'ok' : ''}">${recClock(t)}</b><span>нужно 10–15 с · стоп сам на ${recClock(REC_MAX)}</span></div>
    <div class="rec-lvl"><i id="recLvl"></i></div>
    <p class="rec-text"><small>Прочитайте вслух — своим обычным голосом, с интонацией:</small>${REC_TEXT}</p>
    <div class="vc-foot"><button class="btn free" data-rec-stop>⏹ Готово</button><button class="btn" data-rec-cancel>✕ Отмена</button></div></div>`;
}
async function recStart(to) {
  if (rec.to) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    return toast(window.isSecureContext ? 'Этот браузер не умеет записывать звук — запишите диктофоном и загрузите файлом (📁)'
      : 'Микрофон браузер даёт только сайтам на https — откройте Freefield с GitHub (zuevilia808-collab.github.io/freefield) или запишите диктофоном и загрузите файлом', {type: 'err', ms: 10000});
  const id = ++rec.id;
  Object.assign(rec, {to, view: vcUi.view, parts: [], peak: 0, busy: false});
  renderVoices();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}}); }
  catch (e) {
    if (rec.id !== id) return;
    recCancel();
    return toast(e.name === 'NotAllowedError' ? (native.on() ? 'У приложения нет доступа к микрофону — запишите в Chrome или диктофоном и загрузите файлом' : 'Нет доступа к микрофону — разрешите его сайту: значок слева от адреса → «Микрофон»')
      : e.name === 'NotFoundError' ? 'Микрофон не найден' : 'Микрофон недоступен: ' + e.message, {type: 'err', ms: 9000});
  }
  if (rec.id !== id) return stream.getTracks().forEach(t => t.stop());   // окно закрыли, пока спрашивали разрешение
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t));
  let mr;
  try { mr = new MediaRecorder(stream, type ? {mimeType: type} : {}); }
  catch (e) { stream.getTracks().forEach(t => t.stop()); recCancel(); return toast('Запись не запускается: ' + e.message, {type: 'err'}); }
  // уровень громкости — чтобы видно было, что микрофон слышит (в тишину через нулевую громкость: Safari иначе не считает)
  const ctx = actx(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(), mute = ctx.createGain();
  ctx.resume?.().catch(() => {});
  an.fftSize = 1024; mute.gain.value = 0;
  src.connect(an); an.connect(mute); mute.connect(ctx.destination);
  mr.ondataavailable = e => { if (e.data.size) rec.parts.push(e.data); };
  mr.onstop = () => recDone(id, new Blob(rec.parts, {type: mr.mimeType || type || 'audio/webm'}));
  Object.assign(rec, {stream, mr, src, t0: performance.now()});
  mr.start(250);
  renderVoices();
  const buf = new Float32Array(an.fftSize);
  rec.timer = setInterval(() => {
    if (rec.id !== id || rec.busy) return;
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const x of buf) sum += x * x;
    const rms = Math.sqrt(sum / buf.length), t = recSec(), lvl = $('#recLvl'), tm = $('#recTime');
    rec.peak = Math.max(rec.peak, rms);
    if (lvl) lvl.style.width = Math.min(100, rms * 600) + '%';
    if (tm) { tm.textContent = recClock(t); tm.classList.toggle('ok', t >= 10); }
    if (t >= REC_MAX) recStop();
  }, 80);
}
function recStop() {
  if (!rec.mr || rec.busy) return;
  rec.busy = true;
  clearInterval(rec.timer);
  if (rec.mr.state !== 'inactive') rec.mr.stop();
  renderVoices();
}
// сброс записи; запоздалые ответы (разрешение микрофона, остановка записи) по старому id игнорируются
function recCancel(rerender = true) {
  rec.id++;
  clearInterval(rec.timer);
  try { if (rec.mr && rec.mr.state !== 'inactive') rec.mr.stop(); } catch {}
  rec.stream?.getTracks().forEach(t => t.stop());
  try { rec.src?.disconnect(); } catch {}
  Object.assign(rec, {to: null, view: null, stream: null, mr: null, src: null, parts: [], t0: 0, busy: false});
  if (rerender) renderVoices();
}
async function recDone(id, blob) {
  if (rec.id !== id) return;
  const to = rec.to, quiet = rec.peak < 0.01;
  rec.stream?.getTracks().forEach(t => t.stop());   // микрофон отпускаем сразу — значок записи в браузере гаснет
  try {
    const r = await voiceSample(blob);
    if (rec.id !== id) return;
    if (to === 'rv') Object.assign(vcUi, {rvFile: r.data, rvRec: true});
    else if (vcUi.edit) vcOwnSample(vcUi.edit, r);
    toast(`Записано: образец голоса ${r.sec} с${to === 'rv' ? '' : ' — сохраните персонажа'}`, {type: 'ok'});
  } catch (e) {
    if (rec.id !== id) return;
    toast('Запись не подошла: ' + (quiet ? 'очень тихо — говорите громче или ближе к микрофону' : e.message), {type: 'err', ms: 8000});
  }
  recCancel();
}
