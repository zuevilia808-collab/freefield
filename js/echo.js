'use strict';
/* ---- «🎙 Озвучка» — «Эхо», часть Freefield (пользователь 2026-10-08: «Эхо должно стать частью Freefield, а не отдельным
   приложением»; «в Озвучке не меняй дизайн Эхо»; «у неё не должно быть своего адреса»). Во вкладке — интерфейс в виде «Эхо»
   (exRender), всё — через программу Freefield (/api/echo/…); она же запускает «Эхо» сама, без окна — и когда вкладку открыли
   с телефона. Слева — связка с персонажами: имя персонажа = имя голоса в «Эхо», клон голоса из его образца ---- */
const ECHO_EMO = [['neutral', 'Как в образце'], ['calm', 'Спокойно'], ['happy', 'Радостно'], ['excited', 'Восторженно'], ['sad', 'Грустно'], ['serious', 'Серьёзно']];
const echoEmoName = e => (ECHO_EMO.find(x => x[0] === e) || ECHO_EMO[0])[1];
const echoUrl = p => hubLink.url('/api/echo' + p);   // p: '/api/…' или '/files/outputs/<id>.mp3'
const echoKey = n => String(n || '').trim().toLowerCase();
const UPDATE_PS = 'irm https://raw.githubusercontent.com/zuevilia808-collab/freefield/main/pc/update.ps1 | iex';
const hubHas = f => (hubLink.info?.features || []).includes(f);
async function echoApi(p, body, method) {
  const noHub = () => Object.assign(new Error('нет связи с программой Freefield на компьютере'), {hub: true});
  if (!(await hubReady())) throw noHub();
  const opt = body instanceof FormData ? {method: 'POST', body}
    : {method: method || (body ? 'POST' : 'GET'), headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined};
  let r;
  try { r = await fetch(echoUrl('/api' + p), opt); } catch { throw noHub(); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 503 && d.echo_down) throw Object.assign(new Error('«Эхо» не запущено'), {down: true});
  if (r.status === 404 && d.error === 'нет такого запроса') throw Object.assign(new Error('программа Freefield на компьютере старая — обновите её'), {old: true});
  if (!r.ok) throw new Error((typeof d.detail === 'string' ? d.detail : '') || d.error || '«Эхо»: ошибка ' + r.status);
  return d;
}
// долгие операции «Эхо» — задача: опрашиваем, пока queued / running (видеокарта одна — задачи по очереди)
async function echoJob(job, onMsg) {
  while (job.status === 'queued' || job.status === 'running') {
    onMsg?.(job.message || '«Эхо» работает…', job.progress);
    await sleep(800);
    job = await echoApi('/jobs/' + encodeURIComponent(job.id));
  }
  if (job.status === 'error') throw new Error(job.error || '«Эхо»: ошибка');
  return job.result;
}
const eh = {
  state: null,   // null — не проверяли; ok; starting — Freefield запускает «Эхо»; down — не запустилось; old — программа на ПК старая; nohub — нет программы
  err: '', model: '', voices: [], at: 0, busy: '', cloneEmo: 'neutral', updating: false, qr: false,
};
const echoSamples = name => eh.voices.filter(v => echoKey(v.name) === echoKey(name));
// «Эхо» готово? Нет — запускаем (программа Freefield делает это сама, без окна) и ждём, пока ответит
let echoEnsuring = null;
function echoEnsure() {
  echoEnsuring ||= (async () => {
    if (!(await hubReady())) { eh.state = 'nohub'; return echoShow(); }
    if (!hubHas('echo-start')) { eh.state = 'old'; return echoShow(); }
    try {
      const h = await echoApi('/health');
      eh.model = h.model || ''; eh.state = 'ok';
    } catch (e) {
      if (!e.down) { eh.state = e.old ? 'old' : e.hub ? 'nohub' : 'down'; eh.err = e.message; return echoShow(); }
      eh.state = 'starting'; echoShow();
      const r = await fetch(hubLink.url('/api/echo-start'), {method: 'POST'}).then(x => x.json()).catch(() => ({ok: false, error: 'нет связи с программой Freefield'}));
      if (!r.ok) { eh.state = 'down'; eh.err = r.error; return echoShow(); }
      for (let i = 0; i < 75 && eh.state === 'starting'; i++) {
        await sleep(2000);
        try { const h = await echoApi('/health'); eh.model = h.model || ''; eh.state = 'ok'; } catch {}
      }
      if (eh.state !== 'ok') { eh.state = 'down'; eh.err = '«Эхо» не ответило за 2,5 минуты после запуска'; return echoShow(); }
    }
    eh.voices = await echoApi('/voices').catch(() => []);
    eh.at = Date.now();
    echoShow();
  })().finally(() => { echoEnsuring = null; });
  return echoEnsuring;
}
function echoStatusHTML() {
  if (eh.state === 'ok') return '';
  if (eh.state === 'old') return `<div class="eh-card col"><b>Программа Freefield на компьютере старая — в ней нет «Эхо»</b>
    ${hubHas('update') ? `<button class="btn small primary" data-eh-update ${eh.updating ? 'disabled' : ''}>${eh.updating ? '⏳ Обновляю…' : '⟳ Обновить программу'}</button>`
      : `<span>Один раз: на компьютере откройте PowerShell (Пуск → «PowerShell») и вставьте строку:</span><code class="eh-ps" data-noicon>${esc(UPDATE_PS)}</code><button class="btn small" data-eh-copy-ps>📋 Копировать строку</button>`}
    <span>Потом закройте Claude Desktop полностью (значок у часов → «Выход») и откройте снова.</span><button class="btn small" data-eh-recheck>↻ Проверить снова</button></div>`;
  if (eh.state === 'nohub') return echoNoHubHTML();
  if (eh.state === 'starting' || eh.state === null) return '<div class="eh-card">⏳ Запускаю «Эхо» на компьютере — первая загрузка модели до минуты</div>';
  return `<div class="eh-card">⚠ ${esc(eh.err || '«Эхо» не запустилось')} <button class="btn small" data-eh-recheck>↻ Ещё раз</button></div>`;
}
// нет связи с программой на компьютере: ключ сменился / компьютер не отвечает / сайт на ПК без программы / телефон с GitHub
function echoNoHubHTML() {
  const again = '<button class="btn small" data-eh-recheck>↻ Проверить снова</button>';
  const st = pcStatus();
  if (st.k !== 'ok' && st.k !== 'none') return `<div class="eh-card">${st.icon} ${st.text} ${again}</div>`;
  // Freefield с GitHub на телефоне: «Эхо» — на видеокарте компьютера, телефон открывает его с компьютера по Wi-Fi
  const p = ls.get('freefield.pcLan', null);
  if (p) return `<div class="eh-card col"><b>🎙 «Эхо» — на компьютере, телефон подключается к нему по Wi-Fi</b>
    <button class="btn primary" data-eh-lan>🎙 Открыть «Озвучку» с компьютера</button>
    <span class="hint">Компьютер ${esc(p.addr.replace(/:\d+$/, ''))} · телефон — в той же сети Wi-Fi, на компьютере открыт Claude Desktop; «Эхо» запустится само.
      Chrome спросит доступ к устройствам в локальной сети — разрешите, и «Озвучка» заработает прямо здесь.
      <button class="link-btn" data-eh-recheck>Проверить снова</button> · <button class="link-btn" data-eh-unpair>Забыть компьютер</button></span></div>`;
  return `<div class="eh-card col"><b>🎙 «Озвучка» идёт на компьютере — телефон подключается к нему по Wi-Fi</b>
    <span>Один раз: на компьютере откройте Freefield → «Озвучка» → <b>«📱 На телефон»</b> и наведите камеру этого телефона на QR-код.</span>
    <span class="hint">После этого «Озвучка» заработает здесь. Телефон и компьютер — в одной сети Wi-Fi.</span></div>`;
}
// на компьютере: QR-код для телефона — Freefield на телефоне запомнит компьютер и откроет «Озвучку» с него
const echoPairUrl = () => `${SITE_URL}#pc=${hubLink.info.lan[0]}:${hubLink.info.port || 5180}&k=${encodeURIComponent(hubLink.key)}&to=voice`;
function echoPhoneHTML() {
  if (hubLink.viaLan) return `<div class="eh-card">📱 Телефон подключён к компьютеру ${esc(hubLink.base.replace(/^http:\/\/|:\d+$/g, ''))} по Wi-Fi
    <button class="link-btn" data-eh-unpair>Забыть компьютер</button></div>`;
  if (!hubLink.ok || !hubLink.onPc() || !hubLink.key || !hubLink.info?.lan?.length) return '';
  return `<div class="block-head"><span class="lbl">Озвучка на телефоне</span></div>
    <div class="eh-card col">${eh.qr ? `<div class="eh-qr" id="ehQr"></div>
      <span>Наведите камеру телефона на код — Freefield на телефоне подключится к этому компьютеру, и «Озвучка» заработает там. Телефон — в той же сети Wi-Fi.</span>
      <span class="hint">🔒 В коде — ключ связи с этим компьютером: не показывайте его посторонним.</span>
      <button class="btn small" data-eh-qr>Скрыть код</button>`
    : `<span>Чтобы «Озвучка» работала на телефоне, один раз отсканируйте QR-код телефоном (он — в той же сети Wi-Fi).</span><button class="btn small" data-eh-qr>📱 На телефон</button>`}</div>`;
}
function echoCharsHTML() {
  if (eh.state !== 'ok' || !vc.chars.length) return '';
  return `<div class="block-head"><span class="lbl">Голоса персонажей</span></div>
    <div class="eh-chars">${vc.chars.map(c => { const s = echoSamples(c.name);
      return `<div class="eh-chr">${vcThumb(c)}<span><b>${esc(c.name)}</b><small>${s.length ? [...new Set(s.map(v => echoEmoName(v.emotion || 'neutral').toLowerCase()))].join(', ') : 'нет голоса'}</small></span>
        ${c.sample ? `<button class="btn small" data-eh-clone="${esc(c.id)}" ${eh.busy ? 'disabled' : ''} title="Клон голоса из образца персонажа">${s.length ? '＋ Образец' : 'Сделать голос'}</button>` : ''}</div>`; }).join('')}</div>
    ${eh.busy ? `<div class="eh-busy">⏳ ${esc(eh.busy)}</div>` : ''}`;
}
// вкладка: «Эхо» — справа (на телефоне — в самой вкладке), слева — голоса персонажей и QR-код для телефона
function renderEcho() {
  const root = $('#echoCreate');
  if (!root) return;
  // каркас — один раз: «Эхо» на телефоне живёт в #ehSlot (перерисовка панели его не трогает)
  if (!$('#ehSlot')) root.innerHTML = '<div id="ehSlot"></div><div id="ehChars"></div><div id="ehPhone"></div>';
  if (eh.state === null || eh.state === 'nohub' && hubLink.ok || eh.state === 'ok' && Date.now() - eh.at > 60000) echoEnsure();
  workMount();
  echoShow();
}
function echoShow() {
  if (cl.mode === 'voice') {
    const ch = $('#ehChars'), ph = $('#ehPhone');
    if (ch) ch.innerHTML = echoCharsHTML();
    if (ph) { ph.innerHTML = echoPhoneHTML(); if ($('#ehQr')) drawQR($('#ehQr'), echoPairUrl()); }
    exRender();
    if (eh.state === 'ok' && Date.now() - ex.at > 60000) exLoad();
  }
  if (!$('#voiceSheet').classList.contains('hidden') && vcUi.view === 'char') echoCharFill();
}
/* ---- «Эхо» внутри «Озвучки» (пользователь 2026-10-08, со снимками «Эхо»: «у неё не должно быть своего адреса типа 127.0.0… —
   всё встроено в раздел „Озвучка“ и открывается на телефоне»). Вид — как у самого «Эхо»: 1 видео с голосом → 2 голос →
   3 текст озвучки, справа — готовые озвучки. Ходит всё через программу Freefield (/api/echo/…) — тем же адресом, что и
   приложение: на компьютере, с телефона по Wi-Fi. Код «Эхо» не меняем — только его API ---- */
const EHX_BARS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg>';
const EHX_ADJ = {neutral: 'обычная', calm: 'спокойная', happy: 'радостная', excited: 'восторженная', sad: 'грустная', serious: 'серьёзная'};
const EHX_LANGS = [['russian', 'Русский'], ['english', 'English'], ['german', 'Deutsch'], ['french', 'Français'], ['spanish', 'Español'],
  ['italian', 'Italiano'], ['portuguese', 'Português'], ['japanese', '日本語'], ['korean', '한국어'], ['chinese', '中文'], ['auto', 'Определить сам']];
const ex = {
  status: null, hist: [], fav: false, at: 0, fresh: new Set(),
  up: null, upPct: -1, upName: '', a: 0, b: 0, clean: true, cut: '',   // 1: загруженный ролик и отрезок
  voice: null, vName: '', vText: '', vEmo: 'neutral', saving: false,   // 2: голос в карточке
  text: '', emo: 'neutral', intensity: 0.7, lang: 'russian', speed: 1, takes: 1, sel: '', speak: '',   // 3: озвучка
  ...ls.get('freefield.echo.ui', {}),
};
const exSave = () => ls.set('freefield.echo.ui', {text: ex.text, emo: ex.emo, intensity: ex.intensity, lang: ex.lang, speed: ex.speed, takes: ex.takes, sel: ex.sel});
const exT = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
const exT1 = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const exNum = (x, d = 1) => x.toFixed(d).replace('.', ',');
const exDate = c => { const d = new Date(typeof c === 'number' && c < 1e12 ? c * 1000 : c); return isNaN(d) ? '' : d.toLocaleString('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).replace(', ', ' '); };
const exProg = (m, p) => (p != null && p !== '' ? Math.round(p <= 1 ? p * 100 : p) + '% · ' : '') + (m || '«Эхо» работает…');
// голоса «Эхо» по именам: один голос — несколько образцов (эмоции); избранные первыми
function exGroups() {
  const g = new Map();
  for (const v of eh.voices) {
    if (v.saved === false || !v.name) continue;
    const k = echoKey(v.name), x = g.get(k) || {name: v.name, id: v.id, fav: false, list: []};
    x.fav ||= !!v.favorite; x.list.push(v);
    if ((v.emotion || 'neutral') === 'neutral' && (x.list[0].emotion || 'neutral') !== 'neutral') x.id = v.id;
    g.set(k, x);
  }
  return [...g.values()];
}
const exStep = () => ex.voice && !exVoiceSaved() ? 2 : ex.up && !ex.voice ? 1 : exGroups().length ? 3 : 1;
const exVoiceSaved = () => { const v = ex.voice; return !!v && v.saved !== false && !!v.name && ex.vName.trim() === v.name && ex.vText === (v.text || '') && ex.vEmo === (v.emotion || 'neutral'); };

// звук «Эхо» (озвучка, образец голоса, ролик) — через программу Freefield; сайт с GitHub на телефоне, связанный по Wi-Fi,
// берёт его файлом (звук с адреса http страница https сама не играет)
const exBlobs = new Map();
async function exMedia(p) {
  const u = echoUrl('/' + String(p || '').replace(/^\//, ''));
  if (!hubLink.viaLan) return u;
  if (!exBlobs.has(u)) exBlobs.set(u, fetch(u).then(r => { if (!r.ok) throw new Error('файл не скачался: ' + r.status); return r.blob(); }).then(b => URL.createObjectURL(b)));
  return exBlobs.get(u).catch(e => { exBlobs.delete(u); throw e; });
}
// волна звука: пики из файла (озвучки и образцы короткие), по одному разу на файл
const exPeakCache = new Map(), exPeakDone = new Map();
function exPeaks(p, n) {
  if (!exPeakCache.has(p)) exPeakCache.set(p, (async () => {
    const r = await fetch(echoUrl('/' + p.replace(/^\//, '')));
    if (!r.ok) return null;
    const ab = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await r.arrayBuffer());
    const d = ab.getChannelData(0), step = Math.max(1, Math.floor(d.length / n)), out = [];
    for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step, e = Math.min(d.length, j + step); j < e; j += 8) m = Math.max(m, Math.abs(d[j])); out.push(m); }
    const top = Math.max(...out, 0.01), pk = out.map(x => x / top);
    exPeakDone.set(p, pk);
    return pk;
  })().catch(() => null));
  return exPeakCache.get(p);
}
const exResample = (pk, n) => { if (!pk?.length) return null; const top = Math.max(...pk.map(Math.abs), 0.0001);
  return Array.from({length: n}, (_, i) => Math.abs(pk[Math.floor(i * pk.length / n)]) / top); };
const exBars = (pk, n) => (pk || Array(n).fill(0.14)).map(v => `<i style="height:${Math.max(8, Math.round(v * 100))}%"></i>`).join('');
const exWave = (key, src, n = 90, pk = exPeakDone.get(src)) => `<div class="ehx-wave" data-wave="${esc(key)}" ${src && !pk ? `data-wave-src="${esc(src)}" data-n="${n}"` : ''}><div class="w1">${exBars(pk, n)}</div><div class="w2">${exBars(pk, n)}</div></div>`;
// волны рисуем, когда их видно (озвучек до 60 — не качаем все сразу)
const exWaveObs = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  exWaveObs.unobserve(e.target);
  const el = e.target, n = +el.dataset.n || 90;
  exPeaks(el.dataset.waveSrc, n).then(pk => { if (pk) el.querySelectorAll('div').forEach(d => { d.innerHTML = exBars(pk, n); }); });
}), {rootMargin: '200px'}) : null;

// один проигрыватель на всю вкладку: ▶ у озвучки, у образца голоса и у отрезка ролика
const exAud = new Audio();
let exNow = '', exTo = 0;
async function exPlay(key, src, from = 0, to = 0) {
  if (exNow === key && !exAud.paused) return exAud.pause();
  if (exNow === key && exAud.src && (!to || exAud.currentTime < to - 0.05)) return exAud.play().catch(() => {});
  if (exNow === key && to) exAud.currentTime = from;
  exAud.pause();
  try { exAud.src = await exMedia(src); } catch (e) { return toast(e.message, {type: 'err'}); }
  exNow = key; exTo = to;
  exAud.currentTime = from;
  exAud.play().catch(e => e.name !== 'AbortError' && toast('Не играет: ' + e.message, {type: 'err'}));
}
function exPlayMarks() {
  $$('#echoWork [data-ehx-play]').forEach(b => { const on = b.dataset.ehxPlay === exNow && !exAud.paused; b.classList.toggle('on', on); b.innerHTML = ic(on ? 'pause' : 'play'); });
}
['play', 'pause', 'ended'].forEach(ev => exAud.addEventListener(ev, exPlayMarks));
exAud.addEventListener('timeupdate', () => {
  if (exTo && exAud.currentTime >= exTo) { exAud.pause(); exAud.currentTime = exTo; }
  const w = $(`#echoWork [data-wave="${CSS.escape(exNow)}"]`);
  if (w && exAud.duration) w.style.setProperty('--p', (exAud.currentTime / exAud.duration * 100) + '%');
  if (exNow === 'seg') { const s = $('#ehxSel'); if (s && ex.up?.duration) s.style.setProperty('--t', (exAud.currentTime / ex.up.duration * 100) + '%'); }
});

function exHead(n, t, sub) {
  return `<div class="ehx-h"><b class="ehx-n ${exStep() === n ? 'on' : ''}">${n}</b><div><h3>${t}</h3><small>${sub}</small></div></div>`;
}
// 1. Видео с голосом: загрузить ролик (или звук) и выделить кусок, где человек говорит
function exSrcHTML() {
  const head = exHead(1, 'Видео с голосом', 'Загрузи ролик и выдели кусок, где человек говорит');
  const busy = ex.upPct >= 0;
  if (!ex.up) return head + `<label class="ehx-drop" id="ehxDrop"><input type="file" id="ehxFile" accept="video/*,audio/*,.mkv,.mov,.mp3,.wav,.m4a" hidden ${busy ? 'disabled' : ''}>
      <span class="ehx-up">${busy ? ic('hourglass') : ic('upload')}</span><b>${busy ? `Загружаю… ${ex.upPct}%` : pwa.mobile() ? 'Выбери видео' : 'Перетащи видео сюда'}</b>
      <small>${busy ? esc(ex.upName) : `${pwa.mobile() ? 'из галереи телефона' : 'или нажми, чтобы выбрать файл'} · MP4, MOV, MKV, WEBM, а также MP3/WAV`}</small></label>`;
  const u = ex.up, D = u.duration || 0, pk = exResample(u.peaks, 140);
  return head + `<div class="ehx-file"><span>${ic(u.kind === 'audio' ? 'volume' : 'video')}<b>${esc(u.name || 'файл')}</b>· ${exT(D)}</span><button class="ehx-btn ghost sm" data-ehx-new>Другой файл</button></div>
    <div class="ehx-sel" id="ehxSel"><div class="in"><div class="bars">${exBars(pk, 140)}</div><div class="bars on">${exBars(pk, 140)}</div>
      <div class="rng"><i class="hl"></i><i class="hr"></i></div><b class="tm"></b></div></div>
    <div class="ehx-selinfo" id="ehxSelInfo"></div>
    <div class="ehx-row"><button class="ehx-play" data-ehx-play="seg" title="Прослушать отрезок">${ic('play')}</button>
      <button class="ehx-tog ${ex.clean ? 'on' : ''}" data-ehx-clean>${ic(ex.clean ? 'check' : 'x')}Убрать музыку и шум</button>
      <button class="ehx-btn" id="ehxCut" data-ehx-cut></button></div>`;
}
// отрезок без перерисовки: рамка, подписи, кнопка
function exSelShow() {
  const s = $('#ehxSel'), u = ex.up;
  if (!s || !u) return;
  const D = u.duration || 1, L = ex.b - ex.a, bad = L < 1.5 || L > 30;
  s.style.setProperty('--a', ex.a / D * 100 + '%'); s.style.setProperty('--b', ex.b / D * 100 + '%');
  $('#ehxSelInfo').innerHTML = `<span>${exT1(ex.a)} — ${exT1(ex.b)} · <b class="${bad ? 'bad' : ''}">${exNum(L)} с</b></span><small>кусок 1,5–30 с, лучше 6–15 с чистой речи одного человека</small>`;
  const c = $('#ehxCut');
  c.disabled = bad || !!ex.cut;
  c.innerHTML = ex.cut ? '⏳ ' + esc(ex.cut) : ic('scissors') + 'Вырезать голос';
}
// 2. Голос: образец, что звучит, имя, эмоция, сохранить; «Мои голоса»
function exVoiceHTML() {
  const head = exHead(2, 'Голос', 'Проверь, что получилось, и сохрани голос, чтобы не вырезать его снова');
  const v = ex.voice, groups = exGroups();
  const body = v ? `<div class="ehx-player"><button class="ehx-play" data-ehx-play="v:${esc(v.id)}" data-src="${esc(v.url || '')}">${ic('play')}</button>
      ${exWave('v:' + v.id, v.url, 120)}<small>${esc(ex.vName.trim() || v.name || 'новый голос')} · ${exT(v.duration)}</small></div>
    <div class="ehx-lbl"><b>Что звучит в отрезке</b> — исправь ошибки, от этого зависит похожесть</div>
    <textarea class="ehx-in" rows="2" data-ehx-f="vText" placeholder="Текст, который звучит в образце">${esc(ex.vText)}</textarea>
    <div class="ehx-row3"><input class="ehx-in" data-ehx-f="vName" value="${esc(ex.vName)}" placeholder="Имя голоса" title="Имя голоса — например, имя персонажа" maxlength="60" autocomplete="off">
      <select class="ehx-in" data-ehx-f="vEmo" aria-label="Как человек говорит в этом отрезке">${ECHO_EMO.map(([k]) => `<option value="${k}" ${ex.vEmo === k ? 'selected' : ''}>Эмоция: ${EHX_ADJ[k]}</option>`).join('')}</select>
      <span id="ehxSaveBox">${exSaveBtn()}</span></div>
    <p class="ehx-note">Чтобы эмоция звучала живо, сохрани ещё отрезки <b>с тем же именем</b>, где человек говорит радостно, грустно и т.д., и укажи их эмоцию.</p>`
    : `<p class="ehx-empty">Вырежи голос из видео выше — или выбери сохранённый ниже.</p>`;
  return head + body + (groups.length ? `${v ? '<div class="ehx-sep"></div>' : ''}<div class="ehx-lbl">Мои голоса</div>
    <div class="ehx-chips">${groups.map(g => `<span class="ehx-chip ${echoKey(g.name) === echoKey(ex.sel) ? 'on' : ''}">
      <button class="${g.fav ? 'fav' : ''}" data-ehx-vfav="${esc(g.id)}" title="${g.fav ? 'Убрать из избранных' : 'В избранные'}">${ic('star')}</button>
      <button data-ehx-vsel="${esc(g.name)}" title="Озвучивать этим голосом">${esc(g.name)}</button>
      <button data-ehx-vdel="${esc(g.name)}" title="Удалить голос со всеми образцами">${ic('x')}</button></span>`).join('')}</div>` : '');
}
const exSaveBtn = () => exVoiceSaved() ? `<button class="ehx-btn ghost" disabled>${ic('check')}Сохранено</button>`
  : `<button class="ehx-btn" data-ehx-save ${ex.saving ? 'disabled' : ''}>${ex.saving ? '⏳ Сохраняю…' : 'Сохранить'}</button>`;
// 3. Текст озвучки: текст, эмоция (живой образец или обработка интонации), язык, темп, варианты
const exCount = () => { const n = [...ex.text].length; return `${n} ${plur(n, 'символ', 'символа', 'символов')} · ≈ ${Math.max(n ? 1 : 0, Math.round(n / 13 / ex.speed))} сек`; };
function exSpeakHTML() {
  const head = exHead(3, 'Текст озвучки', 'Что должен сказать этот голос');
  const live = new Set(echoSamples(ex.sel).map(v => v.emotion || 'neutral'));
  const own = ex.emo === 'neutral' || live.has(ex.emo);
  const langs = ex.status?.languages?.length ? ex.status.languages.map(l => [l.id, l.name]) : EHX_LANGS;
  return head + `<div class="ehx-lbl spread"><b>Текст</b><span id="ehxCount">${exCount()}</span></div>
    <textarea class="ehx-in big" rows="5" maxlength="5000" data-ehx-f="text" placeholder="Что скажет голос">${esc(ex.text)}</textarea>
    <div class="ehx-lbl"><b>Эмоция</b></div>
    <div class="ehx-emos">${ECHO_EMO.map(([k, t]) => `<button class="${ex.emo === k ? 'on' : ''}" data-ehx-emo="${k}">${t}${k !== 'neutral' && live.has(k) ? '<i title="есть живой образец"></i>' : ''}</button>`).join('')}</div>
    <p class="ehx-hint"><i></i>${ex.emo === 'neutral' ? 'Голос повторит манеру речи из образца.' : live.has(ex.emo) ? 'Есть живой образец этой эмоции — прозвучит естественно.' : 'Живого образца этой эмоции нет — она добавится обработкой интонации.'}</p>
    ${own ? '' : `<div class="ehx-lbl spread"><b>Сила эмоции</b><span id="ehxInt">${Math.round(ex.intensity * 100)}%</span></div>
      <input type="range" class="ehx-range" min="0.2" max="1" step="0.05" value="${ex.intensity}" data-ehx-f="intensity" aria-label="Сила эмоции">`}
    <div class="ehx-opts"><label><span>Язык</span><select class="ehx-in" data-ehx-f="lang">${langs.map(([id, name]) => `<option value="${esc(id)}" ${ex.lang === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
      <label><span>Темп</span><span class="ehx-tempo"><input type="range" min="0.8" max="1.3" step="0.05" value="${ex.speed}" data-ehx-f="speed" aria-label="Темп"><b id="ehxSpeed">${exNum(ex.speed)}×</b></span></label>
      <label><span>Вариантов</span><span class="ehx-seg">${[1, 2, 3].map(k => `<button class="${ex.takes === k ? 'on' : ''}" data-ehx-takes="${k}">${k}</button>`).join('')}</span></label></div>
    <button class="ehx-btn go" id="ehxGo" data-ehx-speak></button>`;
}
const exGoShow = () => { const b = $('#ehxGo'); if (b) { b.disabled = !!ex.speak; b.innerHTML = ex.speak ? '⏳ ' + esc(ex.speak) : ic('sparkles') + 'Озвучить'; } };
// справа: готовые озвучки — слушать, ★, скачать MP3 / WAV, удалить
function exTakesHTML() {
  const list = ex.hist.filter(t => !ex.fav || t.favorite);
  return `<div class="ehx-h"><span class="ehx-logo sm">${EHX_BARS}</span><div><h3>Готовые озвучки</h3><small>Слушай и скачивай</small></div></div>
    <div class="ehx-seg tabs"><button class="${ex.fav ? '' : 'on'}" data-ehx-fav="">Все</button><button class="${ex.fav ? 'on' : ''}" data-ehx-fav="1">${ic('star')}Избранные</button></div>
    <div class="ehx-takes">${list.length ? list.map(t => `<div class="ehx-take ${ex.fresh.has(t.id) ? 'new' : ''}">
      <div class="ehx-tk"><button class="ehx-play" data-ehx-play="t:${esc(t.id)}" data-src="${esc(t.mp3 || '')}">${ic('play')}</button>
        <div><p>${esc(t.text || '')}</p>${exWave('t:' + t.id, t.mp3, 64)}</div></div>
      <small>${esc(t.voice_name || '')} · ${exT(t.duration)} · вариант ${t.take || 1}/${t.takes || 1}${t.created ? ' · ' + exDate(t.created) : ''}</small>
      <div class="ehx-acts"><button class="${t.favorite ? 'on' : ''}" data-ehx-tfav="${esc(t.id)}" title="${t.favorite ? 'Убрать из избранных' : 'В избранные'}">${ic('star')}</button>
        <button class="ehx-btn ghost sm" data-ehx-dl="mp3" data-id="${esc(t.id)}">${ic('download')}MP3</button>${t.wav ? `<button class="ehx-btn ghost sm" data-ehx-dl="wav" data-id="${esc(t.id)}">WAV</button>` : ''}
        <button data-ehx-tdel="${esc(t.id)}" title="Удалить озвучку">${ic('trash')}</button></div></div>`).join('')
      : `<p class="ehx-empty">${ex.fav ? 'Избранных пока нет — отметь ☆ у озвучки' : 'Здесь появятся озвучки'}</p>`}</div>`;
}
function exPill() {
  const m = ex.status?.model || eh.model, gpu = typeof ex.status?.gpu === 'string' ? ex.status.gpu : '';
  const [c, t] = eh.state === 'ok' ? (m === 'loading' ? ['warn', 'Загружаю модель…'] : m === 'error' ? ['bad', 'Модель не загрузилась'] : ['', ex.status?.busy ? 'Озвучивает…' : 'Готово' + (gpu ? ' · ' + gpu : '')])
    : eh.state === 'starting' || eh.state === null ? ['warn', 'Запускаю…'] : ['bad', 'Программа не отвечает'];
  return `<i class="${c}"></i>${esc(t)}`;
}
// перерисовать «Эхо» (part — одну карточку); поле, где пишут, остаётся в фокусе
function exRender(part) {
  const box = $('#echoWork');
  if (!box) return;
  if (!box.querySelector('.ehx')) box.innerHTML = `<div class="ehx">
    <header class="ehx-top"><span class="ehx-logo">${EHX_BARS}</span><div><h2>Эх<span>о</span></h2><small>озвучка голосом из видео</small></div><span class="ehx-pill" id="ehxPill"></span></header>
    <div id="ehxState"></div>
    <div class="ehx-grid"><div class="ehx-col"><section class="ehx-card" id="ehxSrc"></section><section class="ehx-card" id="ehxVoice"></section><section class="ehx-card" id="ehxSpeak"></section></div>
      <aside class="ehx-card ehx-side" id="ehxTakes"></aside></div>
    <p class="ehx-foot">Всё работает на вашем компьютере и бесплатно — файлы никуда не отправляются. Клонируй только свой голос или голос человека, который на это согласился.</p></div>`;
  const fo = document.activeElement?.closest?.('#echoWork [data-ehx-f]'), key = fo?.dataset.ehxF, sel = fo && 'selectionStart' in fo ? [fo.selectionStart, fo.selectionEnd] : null;
  const parts = {src: ['#ehxSrc', exSrcHTML], voice: ['#ehxVoice', exVoiceHTML], speak: ['#ehxSpeak', exSpeakHTML], takes: ['#ehxTakes', exTakesHTML]};
  for (const [k, [id, fn]] of Object.entries(parts)) if (!part || part === k) box.querySelector(id).innerHTML = fn();
  $('#ehxPill').innerHTML = exPill();
  $('#ehxState').innerHTML = eh.state === 'ok' ? '' : echoStatusHTML();
  box.querySelector('.ehx-grid').classList.toggle('off', eh.state !== 'ok');
  if (!part || part === 'src') exSelShow();
  if (!part || part === 'speak') exGoShow();
  if (!part || part === 'voice' || part === 'speak') $$('#echoWork .ehx-n').forEach((n, i) => n.classList.toggle('on', exStep() === i + 1));
  box.querySelectorAll('[data-wave-src]').forEach(el => exWaveObs ? exWaveObs.observe(el) : exPeaks(el.dataset.waveSrc, +el.dataset.n).then(pk => { if (pk) el.querySelectorAll('div').forEach(d => { d.innerHTML = exBars(pk, +el.dataset.n); }); }));
  exPlayMarks();
  if (key) { const el = box.querySelector(`[data-ehx-f="${key}"]`); if (el && el !== document.activeElement) { el.focus({preventScroll: true}); if (sel && 'setSelectionRange' in el) try { el.setSelectionRange(...sel); } catch {} } }
}
// состояние «Эхо» (модель, языки) и готовые озвучки; модель ещё грузится — спрашиваем снова
let exTimer = null;
async function exLoad() {
  if (eh.state !== 'ok') return;
  ex.at = Date.now();
  const [st, h] = await Promise.all([echoApi('/status').catch(() => null), echoApi('/history').catch(() => null)]);
  if (st) ex.status = st;
  if (Array.isArray(h)) ex.hist = h;
  if (cl.mode === 'voice') exRender();
  clearTimeout(exTimer);
  if (ex.status?.model === 'loading') exTimer = setTimeout(() => cl.mode === 'voice' && exLoad(), 4000);
}

// загрузить ролик в «Эхо» (с ходом загрузки — видео с телефона бывают большими)
async function exUpload(file) {
  if (!file || ex.upPct >= 0) return;
  if (!(await hubReady())) return toast('Нет связи с программой Freefield на компьютере', {type: 'err'});
  ex.upPct = 0; ex.upName = file.name || ''; exRender('src');
  try {
    const d = await new Promise((res, rej) => {
      const x = new XMLHttpRequest(), fd = new FormData();
      fd.append('file', file, file.name || 'video.mp4');
      x.open('POST', echoUrl('/api/upload'));
      x.upload.onprogress = e => { if (!e.lengthComputable) return; ex.upPct = Math.round(e.loaded / e.total * 100); const b = $('#ehxDrop b'); if (b) b.textContent = `Загружаю… ${ex.upPct}%`; };
      x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {}
        x.status < 300 ? res(j) : rej(new Error(x.status === 503 ? '«Эхо» не запущено' : (typeof j.detail === 'string' && j.detail) || j.error || '«Эхо»: ошибка ' + x.status)); };
      x.onerror = () => rej(new Error('файл не дошёл до компьютера'));
      x.send(fd);
    });
    if (!d.id) throw new Error('«Эхо» не приняло файл');
    ex.up = d; ex.a = 0; ex.b = Math.min(d.duration || 12, 12);
    if ((d.duration || 0) < 1.5) toast('В файле меньше 1,5 с звука — голос из него не вырезать', {type: 'err', ms: 8000});
  } catch (e) { toast('Не загрузилось: ' + e.message, {type: 'err', ms: 9000}); }
  ex.upPct = -1;
  exRender('src');
}
// вырезать голос из отрезка → карточка «Голос» (текст «Эхо» распознаёт само)
async function exCut() {
  const u = ex.up;
  if (!u || ex.cut) return;
  ex.cut = 'Ставлю в очередь…'; exSelShow();
  try {
    const v = await echoJob(await echoApi('/voice', {upload_id: u.id, start: +ex.a.toFixed(2), end: +ex.b.toFixed(2), clean: ex.clean}), (m, p) => { ex.cut = exProg(m, p); exSelShow(); });
    Object.assign(ex, {voice: v, vText: v.text || '', vName: v.saved ? v.name || '' : '', vEmo: v.emotion || 'neutral'});
    ex.cut = '';
    exRender();
    $('#ehxVoice')?.scrollIntoView({block: 'start', behavior: 'smooth'});
    toast('Голос вырезан — проверь текст, впиши имя и сохрани', {type: 'ok', ms: 7000});
  } catch (e) { ex.cut = ''; exSelShow(); toast('Голос не вырезан: ' + e.message, {type: 'err', ms: 9000}); }
}
async function exVoices() { eh.voices = await echoApi('/voices').catch(() => eh.voices); eh.at = Date.now(); }
async function exSaveVoice() {
  const v = ex.voice, name = ex.vName.trim();
  if (!v || ex.saving) return;
  if (!name) { toast('Впиши имя голоса — например, имя персонажа', {type: 'err'}); return $('#echoWork [data-ehx-f="vName"]')?.focus(); }
  ex.saving = true; $('#ehxSaveBox').innerHTML = exSaveBtn();
  try {
    const s = await echoApi(`/voices/${encodeURIComponent(v.id)}/save`, {name, text: ex.vText, emotion: ex.vEmo});
    ex.voice = {...v, ...(s && typeof s === 'object' && !Array.isArray(s) ? s : {}), saved: true, name, text: ex.vText, emotion: ex.vEmo};
    ex.sel = name; exSave();
    await exVoices();
    toast(`🎙 Голос «${name}» сохранён`, {type: 'ok'});
  } catch (e) { toast('Не сохранилось: ' + e.message, {type: 'err'}); }
  ex.saving = false;
  echoShow();
}
function exPick(name) {
  const g = exGroups().find(x => echoKey(x.name) === echoKey(name));
  if (!g) return;
  const v = g.list.find(x => x.id === g.id) || g.list[0];
  Object.assign(ex, {sel: g.name, voice: v, vName: v.name, vText: v.text || '', vEmo: v.emotion || 'neutral'});
  exSave(); exRender('voice'); exRender('speak');
}
async function exSpeak() {
  if (ex.speak) return;
  if (!ex.text.trim()) { toast('Впиши текст, который скажет голос', {type: 'err'}); return $('#echoWork [data-ehx-f="text"]')?.focus(); }
  if (!exGroups().some(g => echoKey(g.name) === echoKey(ex.sel))) return toast('Выбери голос в «Мои голоса» — или вырежи и сохрани новый', {type: 'err', ms: 7000});
  ex.speak = 'Ставлю в очередь…'; exGoShow();
  try {
    const own = ex.emo === 'neutral' || echoSamples(ex.sel).some(v => (v.emotion || 'neutral') === ex.emo);
    const takes = await echoJob(await echoApi('/speak', {voice: ex.sel, text: ex.text.trim(), emotion: ex.emo, intensity: own ? 0.7 : ex.intensity, takes: ex.takes, speed: ex.speed, language: ex.lang}),
      (m, p) => { ex.speak = exProg(m, p); exGoShow(); });
    ex.fresh = new Set((Array.isArray(takes) ? takes : []).map(t => t.id));
    ex.fav = false;
    ex.speak = '';
    await exLoad();
    const first = (Array.isArray(takes) ? takes : [])[0];
    if (first?.mp3) exPlay('t:' + first.id, first.mp3);
  } catch (e) { ex.speak = ''; exGoShow(); toast('Не озвучилось: ' + e.message, {type: 'err', ms: 9000}); }
}
// отрезок ролика мышью или пальцем: края — за ручки, весь — за середину, по пустому месту — новый там же той же длины
function exSelDown(e) {
  const s = e.target.closest('#ehxSel');
  if (!s || !ex.up?.duration || ex.cut) return;
  e.preventDefault();
  const r = s.querySelector('.in').getBoundingClientRect(), D = ex.up.duration;
  const at = x => Math.max(0, Math.min(D, (x - r.left) / r.width * D));
  const t0 = at(e.clientX), a0 = ex.a, b0 = ex.b, L = b0 - a0;
  const mode = e.target.closest('.hl') ? 'a' : e.target.closest('.hr') ? 'b' : t0 >= a0 && t0 <= b0 ? 'move' : 'new';
  if (mode === 'new') { ex.a = Math.max(0, Math.min(t0, D - L)); ex.b = Math.min(D, ex.a + L); exSelShow(); }
  const move = ev => {
    const t = at(ev.clientX);
    if (mode === 'a') ex.a = Math.max(0, Math.min(t, ex.b - 1.5));
    else if (mode === 'b') ex.b = Math.min(D, Math.max(t, ex.a + 1.5));
    else if (mode === 'move') { const d = Math.max(-a0, Math.min(D - b0, t - t0)); ex.a = a0 + d; ex.b = b0 + d; }
    else { ex.a = Math.max(0, Math.min(t, D - L)); ex.b = Math.min(D, ex.a + L); }
    exSelShow();
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); if (exNow === 'seg') exAud.pause(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
(() => {
  const W = $('#echoWork');
  W.addEventListener('pointerdown', exSelDown);
  W.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || !W.contains(b)) return;
    const d = b.dataset, take = id => ex.hist.find(t => t.id === id);
    if (d.ehxPlay) {
      if (d.ehxPlay === 'seg') return exPlay('seg', ex.up.preview || ex.up.url, ex.a, ex.b);
      return d.src && exPlay(d.ehxPlay, d.src);
    }
    if ('ehxNew' in d) { if (exNow === 'seg') exAud.pause(); ex.up = null; return exRender('src'); }
    if ('ehxClean' in d) { ex.clean = !ex.clean; return exRender('src'); }
    if ('ehxCut' in d) return exCut();
    if ('ehxSave' in d) return exSaveVoice();
    if (d.ehxVsel) return exPick(d.ehxVsel);
    if (d.ehxVfav) {
      const g = exGroups().find(x => x.id === d.ehxVfav);
      try { await echoApi(`/voices/${encodeURIComponent(d.ehxVfav)}/favorite`, {favorite: !g?.fav}); await exVoices(); } catch (er) { toast(er.message, {type: 'err'}); }
      return exRender('voice');
    }
    if (d.ehxVdel) {
      const g = exGroups().find(x => echoKey(x.name) === echoKey(d.ehxVdel));
      if (!g || !confirm(`Удалить голос «${g.name}» со всеми образцами?`)) return;
      try { await echoApi(`/voices/${encodeURIComponent(g.id)}?group=true`, null, 'DELETE'); } catch (er) { return toast('Не удалилось: ' + er.message, {type: 'err'}); }
      if (ex.voice && echoKey(ex.voice.name) === echoKey(g.name)) ex.voice = null;
      if (echoKey(ex.sel) === echoKey(g.name)) { ex.sel = ''; exSave(); }
      await exVoices();
      return echoShow();
    }
    if (d.ehxEmo) { ex.emo = d.ehxEmo; exSave(); return exRender('speak'); }
    if (d.ehxTakes) { ex.takes = +d.ehxTakes; exSave(); return $$('#echoWork [data-ehx-takes]').forEach(x => x.classList.toggle('on', x === b)); }
    if ('ehxSpeak' in d) return exSpeak();
    if ('ehxFav' in d) { ex.fav = !!d.ehxFav; return exRender('takes'); }
    if (d.ehxTfav) {
      const t = take(d.ehxTfav);
      try { const r = await echoApi(`/history/${encodeURIComponent(d.ehxTfav)}/favorite`, {favorite: !t?.favorite}); if (t) t.favorite = r?.favorite ?? !t.favorite; } catch (er) { toast(er.message, {type: 'err'}); }
      return exRender('takes');
    }
    if (d.ehxTdel) {
      if (!confirm('Удалить эту озвучку?')) return;
      try { await echoApi(`/history/${encodeURIComponent(d.ehxTdel)}`, null, 'DELETE'); ex.hist = ex.hist.filter(t => t.id !== d.ehxTdel); } catch (er) { toast('Не удалилось: ' + er.message, {type: 'err'}); }
      return exRender('takes');
    }
    if (d.ehxDl) {
      const t = take(d.id), p = t?.[d.ehxDl];
      if (!p) return;
      try {
        const r = await fetch(echoUrl('/' + p.replace(/^\//, '')));
        if (!r.ok) throw new Error('ошибка ' + r.status);
        saveFile(await r.blob(), `озвучка-${(t.voice_name || 'эхо').replace(/[\\/:*?"<>|]+/g, '')}-${t.take || 1}.${d.ehxDl}`);
      } catch (er) { toast('Не скачалось: ' + er.message, {type: 'err'}); }
    }
  });
  W.addEventListener('input', e => {
    const f = e.target.closest('[data-ehx-f]');
    if (!f) return;
    const k = f.dataset.ehxF;
    ex[k] = ['intensity', 'speed'].includes(k) ? +f.value : f.value;
    if (['text', 'intensity', 'lang', 'speed'].includes(k)) exSave();
    if (k === 'text' || k === 'speed') $('#ehxCount').textContent = exCount();
    if (k === 'speed') $('#ehxSpeed').textContent = exNum(ex.speed) + '×';
    if (k === 'intensity') $('#ehxInt').textContent = Math.round(ex.intensity * 100) + '%';
    if (['vName', 'vText', 'vEmo'].includes(k)) { $('#ehxSaveBox').innerHTML = exSaveBtn(); const s = $('#ehxVoice .ehx-player small'); if (s && ex.voice) s.textContent = `${ex.vName.trim() || ex.voice.name || 'новый голос'} · ${exT(ex.voice.duration)}`; }
  });
  W.addEventListener('change', e => { if (e.target.id === 'ehxFile') exUpload(e.target.files?.[0]); });
  W.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('[data-ehx-f="text"]')) { e.preventDefault(); exSpeak(); } });
  const drop = e => e.target.closest?.('#ehxDrop');
  W.addEventListener('dragover', e => { const z = drop(e); if (z) { e.preventDefault(); z.classList.add('drag'); } });
  W.addEventListener('dragleave', e => drop(e)?.classList.remove('drag'));
  W.addEventListener('drop', e => { const z = drop(e); if (!z) return; e.preventDefault(); z.classList.remove('drag'); exUpload(e.dataTransfer.files?.[0]); });
})();
// голос персонажа в «Эхо» из его образца: загрузка → отрезок (до 20 с) → голос под его именем; другая эмоция — живой образец
async function echoCloneChar(c, emotion = eh.cloneEmo) {
  if (eh.busy || !c?.sample) return;
  eh.busy = `Делаю голос «${c.name}»…`; echoShow();
  try {
    const fd = new FormData();
    fd.append('file', dataBlob(c.sample), 'voice.' + ((/^data:audio\/(\w+)/.exec(c.sample) || [])[1] || 'wav').replace('mpeg', 'mp3'));
    const up = await echoApi('/upload', fd);
    const end = Math.min(up.duration || 20, 20);
    if (end < 1.5) throw new Error('образец короче 1,5 с');
    const v = await echoJob(await echoApi('/voice', {upload_id: up.id, start: 0, end, clean: true}), m => { eh.busy = m; echoShow(); });
    await echoApi(`/voices/${encodeURIComponent(v.id)}/save`, {name: c.name, emotion});
    toast(`🎙 Голос «${c.name}» (${echoEmoName(emotion).toLowerCase()}) — в «Эхо»`, {type: 'ok', ms: 6000});
  } catch (e) { toast('Голос не сделан: ' + e.message, {type: 'err', ms: 9000}); }
  eh.busy = '';
  eh.voices = await echoApi('/voices').catch(() => eh.voices);
  eh.at = Date.now();
  echoShow();
}
// обновить программу на компьютере из репозитория (если она уже умеет)
async function hubUpdate() {
  eh.updating = true; echoShow();
  try {
    const r = await fetch(hubLink.url('/api/update'), {method: 'POST'});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'ошибка ' + r.status);
    toast(j.changed?.length ? `Обновлено файлов: ${j.changed.length}. Закройте Claude Desktop полностью (значок у часов → «Выход») и откройте снова` : 'Программа уже новейшая', {type: 'ok', ms: 12000});
  } catch (e) { toast('Не обновилось: ' + e.message, {type: 'err', ms: 9000}); }
  eh.updating = false; echoShow();
}
async function echoClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (e.currentTarget.id === 'echoCreate' && b.closest('#echoWork')) return;   // на телефоне «Эхо» внутри панели — своим обработчиком
  const d = b.dataset;
  if ('ehRecheck' in d) { eh.state = null; if (!hubLink.viaLan) hubLink.lanTry = null; await hubLink.refresh?.(); return renderEcho(); }
  if ('ehUpdate' in d) return hubUpdate();
  if ('ehCopyPs' in d) return toast(await clCopyText(UPDATE_PS) ? 'Строка скопирована — вставьте её в PowerShell на компьютере' : 'Не удалось скопировать', {type: 'ok', ms: 7000});
  if ('ehLan' in d) return pcLanOpen('voice');
  if ('ehUnpair' in d) {
    ls.set('freefield.pcLan', null);
    if (hubLink.viaLan) { clearTimeout(hubLink.timer); Object.assign(hubLink, {viaLan: false, lanTry: null, base: '', ok: false, info: null, key: ls.get('freefield.hubKey', null)}); eh.state = null; }
    return renderEcho();
  }
  if ('ehQr' in d) { eh.qr = !eh.qr; return echoShow(); }
  if (d.ehClone) return echoCloneChar(vc.char(d.ehClone));
}
$('#echoCreate').addEventListener('click', echoClick);
$('#echoWork').addEventListener('click', echoClick);

/* ---- у персонажа: «🎙 Голос в «Эхо»» — есть ли голос, сделать из его образца, открыть «Озвучку» ---- */
function echoCharFill() {
  const box = $('#vcBody #ehChar'), d = vcUi.edit;
  if (!box || !d) return;
  if (eh.state === null || eh.state === 'ok' && Date.now() - eh.at > 30000) { box.innerHTML = '⏳ проверяю «Эхо»…'; echoEnsure(); return; }
  if (eh.state !== 'ok') {
    box.innerHTML = `<span>${eh.state === 'starting' ? '⏳ запускаю «Эхо»…' : eh.state === 'old' ? 'Программа Freefield на компьютере старая — обновите её (вкладка «Озвучка»)' : esc(eh.err || '«Эхо» недоступно')}</span>${eh.state === 'starting' ? '' : '<button class="btn small" data-eh-recheck>↻</button>'}`;
    return;
  }
  const name = (d.name || '').trim(), s = name ? echoSamples(name) : [];
  box.innerHTML = `<span>${!name ? 'Сначала имя персонажа' : s.length ? 'Есть: ' + [...new Set(s.map(v => echoEmoName(v.emotion || 'neutral').toLowerCase()))].join(', ') : 'Нет'}</span>
    ${name && d.sample ? `<select data-eh-ch-emo aria-label="Как говорит в образце">${ECHO_EMO.map(([v, t]) => `<option value="${v}" ${eh.cloneEmo === v ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn small" data-eh-ch-clone ${eh.busy ? 'disabled' : ''}>${s.length ? '＋ Образец эмоции' : 'Сделать голос'}</button>` : ''}
    ${name ? '<button class="btn small" data-eh-ch-open>🎙 Озвучка</button>' : ''}<i>${esc(eh.busy)}</i>`;
}
$('#voiceSheet').addEventListener('click', async e => {
  const b = e.target.closest('#vcBody #ehChar button');
  if (!b || b.disabled) return;
  const d = vcUi.edit;
  if ('ehRecheck' in b.dataset) { eh.state = null; return echoCharFill(); }
  if ('ehChClone' in b.dataset) return echoCloneChar({...d, name: (d.name || '').trim()});
  if ('ehChOpen' in b.dataset) { closeSheets(); setView('create'); return setCreateMode('voice'); }
});
$('#voiceSheet').addEventListener('change', e => { if ('ehChEmo' in e.target.dataset) eh.cloneEmo = e.target.value; });
// MP3 озвучки «Эхо» — для звуковой дорожки «Монтажа»
async function echoBlob(t) {
  if (!/^\/?files\/[\w./-]+$/.test(t.mp3 || '')) throw new Error('у озвучки нет файла');
  const r = await fetch(echoUrl('/' + t.mp3.replace(/^\//, '')));
  if (!r.ok) throw new Error(r.status === 503 ? '«Эхо» не запущено' : 'файл не скачался: ' + r.status);
  return r.blob();
}

/* ---- правая часть экрана во вкладках «Монтаж» и «Озвучка»: на ПК — вместо галереи, на телефоне — в самой вкладке ---- */
function workMount() {
  const mob = isMobile(), work = $('#work');
  const place = (el, panelSlot) => { const to = mob ? panelSlot : work; if (el && to && el.parentElement !== to) to.append(el); };
  place($('#echoWork'), $('#ehSlot'));
  place($('#mtWork'), $('#mtSlot'));
}
matchMedia('(max-width: 900px)').addEventListener?.('change', () => { if (cl.mode === 'voice' || cl.mode === 'edit') workMount(); });

// ⟨/⟩ для разработчика: большая кнопка вкладки проходит свой обычный путь, но перед отправкой показывает промпт и запрос
const peek = {on: false};
async function peekRun() {
  if (peek.on) return;
  peek.on = true;
  try { await createGo(); } finally { peek.on = false; }
}
// данные картинок в запросе — коротко: тип и размер
function peekRedact(v) {
  if (typeof v === 'string' && v.startsWith('data:')) return `[картинка ${v.slice(5, v.indexOf(';'))}, ${Math.round(v.length * 0.75 / 1024)} КБ]`;
  if (Array.isArray(v)) return v.map(peekRedact);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, peekRedact(x)]));
  return v;
}
let peekTexts = [];
function peekShow(title, {prompts = [], request}) {
  peekTexts = [...prompts.map(p => p[1]), ...(request ? [JSON.stringify(peekRedact(request), null, 2)] : [])];
  $('#peekTitle').textContent = '⟨/⟩ ' + title;
  $('#peekBody').innerHTML = prompts.map(([h], i) => `<div class="peek-sec"><div class="peek-h">${esc(h)}<button class="btn small" data-peek-copy="${i}">Копировать</button></div><pre>${esc(peekTexts[i])}</pre></div>`).join('') +
    (request ? `<div class="peek-sec"><div class="peek-h">Запрос<button class="btn small" data-peek-copy="${prompts.length}">Копировать</button></div><pre>${esc(peekTexts[prompts.length])}</pre></div>` : '');
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#peekSheet').classList.remove('hidden');
}
$('#peekBtn').addEventListener('click', peekRun);
$('#peekBody').addEventListener('click', async e => {
  const b = e.target.closest('[data-peek-copy]');
  if (b) toast(await clCopyText(peekTexts[+b.dataset.peekCopy]) ? 'Скопировано' : 'Не удалось скопировать', {type: 'ok'});
});




function openSheet(which) {
  if (which === 'settings') renderWallet();
  $$('.sheet').forEach(s => s.classList.add('hidden'));
  $(`#${which}Sheet`).classList.remove('hidden');
}
function openHub() {
  renderHub();
  if (hubLink.key && hubLink.local()) hubLink.refresh();
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#hubSheet').classList.remove('hidden');
}

// окно «Профили» (кнопка в верхней строке): профили Chrome, баланс и вход во Flow / Dola / Arena
function openAcc() {
  renderScnAcc();
  if (hubLink.key && hubLink.local()) hubLink.refresh();
  else if (!hubLink.ok && hubLink.pcSite() && hubLink.pcUp === null) hubLink.tryDirect().then(() => renderScnAcc());   // сайт с GitHub — ищем программу
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#accSheet').classList.remove('hidden');
}

// окно «MCP» (кнопка 🔌 в верхней строке): ссылка на MCP-сервер Freefield и готовые команды подключения
function openMcp() {
  renderMcp();
  if (hubLink.key && hubLink.local()) hubLink.refresh();
  $$('.sheet').forEach(x => x.classList.add('hidden'));
  $('#mcpSheet').classList.remove('hidden');
}
let mcpVals = [];
// https-туннель к Freefield на компьютере — для Claude Code в облаке и приложения Claude на телефоне (пользователь 2026-09-28:
// «должна быть возможность подключить по MCP к Claude Code»): их коннекторы принимают только https-ссылку из интернета
const MCP_TUNNEL = port => `npx cloudflared tunnel --url http://localhost:${port} --http-host-header localhost:${port}`;
const MCP_CONNECTORS = 'https://claude.ai/customize/connectors';
// готовый текст для Claude Code / Cowork на компьютере (пользователь 2026-09-28: «добавь, что написать в Claude Code или Cowork
// с телефона, чтобы MCP-сервер подключился»): Claude сам берёт ключ, подключает Freefield к Claude Code и поднимает https-туннель
function mcpPrompt(key, port = 5180) {
  const k = key ? encodeURIComponent(key) : '<ключ>';
  return `Подключи MCP-сервер Freefield — это моё приложение для генерации видео и фото (${SITE_URL}). Его сервер работает на этом компьютере вместе с Claude Desktop: http://127.0.0.1:${port}.
1. ${key ? `Ключ Freefield: ${key}` : `Возьми ключ: GET http://127.0.0.1:${port}/api/local-key — поле key.`} Если сервер не отвечает — открой Claude Desktop (Freefield запускается вместе с ним) и проверь ещё раз.
2. Подключи Freefield к Claude Code на этом компьютере: claude mcp add --scope user --transport http freefield "http://localhost:${port}/mcp?k=${k}" — и проверь: claude mcp list.
3. Сделай доступ из интернета — для Claude Code в облаке и приложения Claude на телефоне: запусти в фоне туннель npx cloudflared tunnel --url http://localhost:${port} --http-host-header localhost:${port}, дождись адреса https://….trycloudflare.com и проверь, что отвечает https://….trycloudflare.com/api/hub?k=${k}.
4. Пришли мне готовую ссылку коннектора https://….trycloudflare.com/mcp?k=${k} — я добавлю её в claude.ai → Настройки → Коннекторы. Ключ никуда больше не отправляй и не публикуй.`;
}
// блок «попросите Claude» — сверху окна MCP
const mcpAskHTML = (row, key, port) => `<div class="cl-sec" style="margin-top:4px">🤖 Проще всего — попросите Claude</div>
  <p class="set-p">Скопируйте текст и отправьте в Claude Code или Cowork, которые работают на вашем компьютере (с телефона — через приложение Claude). Claude сам ${key ? '' : 'возьмёт ключ, '}подключит Freefield к Claude Code и сделает https-ссылку для облака и телефона — останется добавить её в <a href="${MCP_CONNECTORS}" target="_blank" rel="noopener">Коннекторы</a>.</p>
  ${row('Текст для Claude', key ? 'в нём ваш ключ — отправляйте только своему Claude' : 'ключ Claude возьмёт сам на компьютере', mcpPrompt(key, port))}
  <div class="cl-sec">Или вручную</div>`;
function renderMcp() {
  const box = $('#mcpBody');
  if (!box) return;
  mcpVals = [];
  const row = (label, hint, val) => { mcpVals.push(val);
    return `<div class="mcp-row"><div class="mcp-l"><b>${label}</b><span class="hint">${hint}</span></div>
      <div class="mcp-v"><code>${esc(val)}</code><button class="btn" data-mcp-copy="${mcpVals.length - 1}">📋 Копировать</button></div></div>`; };
  if (!hubLink.local() || !hubLink.key) {
    box.innerHTML = `
      <div class="mcp-status">🔴 MCP-сервер — часть Freefield на компьютере, ${pwa.hosted() ? 'а эта страница открыта с сайта' : 'а связи с ним сейчас нет'}</div>
      <p class="set-p">Через MCP Claude Code запускает генерации в Google Flow, Vids, Dola и Arena на ваших аккаунтах, собирает пакеты сценариев и забирает готовое в галерею. Сервер работает на компьютере вместе с Claude Desktop — ссылку с ключом показывает Freefield, открытый на том компьютере.</p>
      ${mcpAskHTML(row, '', 5180)}
      <div class="cl-sec">💻 Claude Code на компьютере</div>
      <ol class="steps"><li>Откройте Claude Desktop — Freefield запустится вместе с ним.</li>
        <li>В браузере компьютера откройте <b>http://127.0.0.1:5180</b> → «MCP»: там готовая команда с вашим ключом.</li>
        <li>Вставьте её в терминал: <code>claude mcp add --transport http freefield "http://localhost:5180/mcp?k=…"</code></li></ol>
      <div class="cl-sec">☁️ Claude Code в облаке и приложение Claude на телефоне</div>
      <ol class="steps"><li>Им нужна https-ссылка из интернета. На компьютере с Freefield запустите туннель (нужен Node.js):</li></ol>
      ${row('Туннель', 'в терминале компьютера', MCP_TUNNEL(5180))}
      <ol class="steps" start="2"><li>Туннель покажет адрес <b>https://….trycloudflare.com</b>. На компьютере в Freefield → «MCP» вставьте его — получится ссылка коннектора.</li>
        <li>Добавьте её: <a href="${MCP_CONNECTORS}" target="_blank" rel="noopener">claude.ai → Настройки → Коннекторы</a> → «Добавить свой коннектор», — и начните новую сессию Claude Code: коннекторы подключаются при старте.</li></ol>
      <div class="mcp-note">⚠️ Пока туннель запущен, по ссылке с ключом можно запускать генерации на ваших аккаунтах — никому её не отправляйте. Адрес туннеля меняется при каждом запуске.</div>`;
    return;
  }
  const info = hubLink.info || {}, port = info.port || location.port || 5180, k = encodeURIComponent(hubLink.key);
  const local = `http://localhost:${port}/mcp?k=${k}`;
  const lan = (info.lan || []).map(a => `http://${a}:${port}/mcp?k=${k}`);
  const tunnel = ls.get('freefield.mcpTunnel', '');
  const status = !hubLink.ok ? '🔴 Компьютер не отвечает — Freefield на компьютере сейчас не запущен'
    : info.mcp ? '🟢 MCP-сервер работает — ссылкой можно пользоваться'
    : '🟡 Ссылка заработает после перезапуска Claude Desktop (сейчас связь держит упрощённый Freefield без MCP)';
  box.innerHTML = `
    <div class="mcp-status">${status}</div>
    <div class="mcp-note">💡 <b>В Claude Desktop ничего добавлять не нужно</b> — Freefield уже подключён к нему сам. Окно «Добавить свой коннектор» (просит ссылку на https) — не для этой ссылки: см. ниже.</div>
    ${mcpAskHTML(row, hubLink.key, port)}
    <p class="set-p">По этой ссылке к Freefield подключаются Claude Code, Cursor и другие программы с MCP: им доступны те же инструменты, что и Claude, — генерация в Google Flow, Vids, Dola и Arena, пакеты сценариев, галерея.</p>
    ${row('Ссылка на MCP', 'для программ на этом компьютере', local)}
    ${lan.map(u => row('В домашней сети', 'для другого компьютера в том же Wi-Fi', u)).join('')}
    <div class="cl-sec">Готовые команды</div>
    ${row('Claude Code', 'вставьте в терминал', `claude mcp add --transport http freefield "${local}"`)}
    ${row('Cursor и другие', 'в настройки MCP (mcp.json)', JSON.stringify({mcpServers: {freefield: {url: local}}}, null, 2))}
    <div class="cl-sec">☁️ Claude Code в облаке и приложение Claude на телефоне — через https</div>
    <p class="set-p">Их коннекторы принимают только https-ссылку из интернета. Туннель даёт её вашему Freefield на время, пока он запущен.</p>
    ${row('1. Туннель', 'в терминале этого компьютера (нужен Node.js)', MCP_TUNNEL(port))}
    <div class="mcp-row"><div class="mcp-l"><b>2. Адрес туннеля</b><span class="hint">вставьте https://….trycloudflare.com из терминала</span></div>
      <div class="key-row"><input class="show" data-mcp-tunnel value="${esc(tunnel)}" placeholder="https://….trycloudflare.com" autocomplete="off" spellcheck="false"></div></div>
    ${tunnel ? row('3. Ссылка коннектора', `<a href="${MCP_CONNECTORS}" target="_blank" rel="noopener">claude.ai → Настройки → Коннекторы</a> → «Добавить свой коннектор»; потом — новая сессия Claude Code`, `${tunnel}/mcp?k=${k}`) : ''}
    <div class="mcp-note">⚠️ Ссылка секретная: с ней можно запускать генерации на ваших аккаунтах — никому не отправляйте и не публикуйте.<br>
      Claude Desktop на этом компьютере подключён к Freefield сам — ему ссылка не нужна.<br>
      Ссылка работает на этом компьютере и в вашей домашней сети, пока открыт Claude Desktop.<br>
      Для «Добавить свой коннектор» (claude.ai, приложение Claude на телефоне, Claude Code в облаке) нужна https-ссылка — через туннель выше: серверы Anthropic подключаются из интернета, а до вашего компьютера напрямую не достают. Адрес туннеля меняется при каждом запуске.</div>`;
}

function closeSheets() {
  if (rec.to) recCancel(false);
  $$('#vcBody audio').forEach(a => a.pause());   // «🎧 Библиотека голосов» и образцы не играют в закрытом окне
  $$('.sheet').forEach(s => s.classList.add('hidden'));
}
