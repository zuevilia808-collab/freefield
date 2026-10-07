// Spaces на Hugging Face (Gradio) — под аккаунтом пользователя, чтобы считалась его квота ZeroGPU, а не анонимная.
// Два способа, один и тот же протокол Gradio:
//  • token — токен HF из config.json Freefield (пользователь вписывает его сам): запросы идут прямо из программы;
//  • frame — без токена: в окне Chrome Freefield открывается страница Space на huggingface.co (пользователь вошёл в HF сам),
//    и запросы выполняются внутри окна Space — заголовки ZeroGPU с его входом выдаёт сама страница huggingface.co.
// Ни токен, ни заголовки входа не попадают в ответы инструментов и в журнал.
// Space описывает себя в /config (компоненты и события) — Freefield находит нужные функции по api_name и заполняет
// входы по подписям полей («Seed», «Texture Size»…); остальные поля — со значениями по умолчанию из самого Space.
import crypto from 'node:crypto';
import {hfToken, scrub} from './config.js';
import {readAcct, writeAcct, currentProfile} from './state.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
export class HfError extends Error { constructor(msg, kind = 'other') { super(scrub(msg)); this.kind = kind; } }

export const spaceHost = id => 'https://' + id.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.hf.space';
const today = () => new Date().toLocaleDateString('sv');

// ---- квота ZeroGPU: что сказал сам Space («… 44s left», «Try again in 1:02:03») ----
export function noteQuota(text) {
  const s = String(text || '');
  const left = s.match(/(\d+(?:\.\d+)?)\s*s(?:econds?)? left/i);
  const again = s.match(/Try again in (\d+):(\d{2}):(\d{2})/i);
  if (!left && !again) return null;
  const q = {at: Date.now(), left: left ? Math.round(+left[1]) : null,
    resetAt: again ? Date.now() + ((+again[1]) * 3600 + (+again[2]) * 60 + (+again[3])) * 1000 : null};
  writeAcct({hfQuota: q});
  return q;
}
export const lastQuota = () => readAcct().hfQuota || null;
export function quotaError(raw, title) {
  const s = `${title || ''} ${raw || ''}`;
  if (/Unlogged user|unauthenticated|Create a free account/i.test(s))
    return new HfError('Hugging Face посчитал запрос анонимным — вход не применился. Войдите в huggingface.co в окне Chrome Freefield ' +
      '(или впишите свой токен в config.json Freefield) и повторите', 'login');
  if (/quota|exceeded your .*GPU/i.test(s)) {
    const q = noteQuota(s);
    const when = q?.resetAt ? ` — обновится в ${new Date(q.resetAt).toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'})}` : '';
    return new HfError(`закончилась дневная квота ZeroGPU этого аккаунта Hugging Face${q?.left != null ? ` (осталось ${q.left} с)` : ''}${when}`, 'quota');
  }
  return null;
}

// ---- транспорт «token»: запросы из программы ----
function nodeTransport(token) {
  const auth = {Authorization: `Bearer ${token}`};
  const streams = new Map();
  return {
    mode: 'token',
    async request(method, url, {json, form, headers = {}} = {}) {
      let body;
      const h = {...auth, ...headers};
      if (json !== undefined) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
      if (form) { body = new FormData(); body.append('files', new Blob([Buffer.from(form.b64, 'base64')], {type: form.mime}), form.name); }
      const r = await fetch(url, {method, headers: h, body, signal: AbortSignal.timeout(120000)}).catch(e => { throw new HfError('нет связи с Hugging Face: ' + e.message, 'down'); });
      return {status: r.status, text: await r.text()};
    },
    async open(url, headers = {}) {
      const r = await fetch(url, {headers: {...auth, ...headers, Accept: 'text/event-stream'}});
      if (!r.ok) throw new HfError(`Space не открыл поток событий (${r.status})`, 'down');
      const id = crypto.randomBytes(6).toString('hex');
      streams.set(id, {reader: r.body.getReader(), dec: new TextDecoder(), buf: '', pending: null, done: false});
      return id;
    },
    async pull(id, ms) {
      const s = streams.get(id);
      const out = [];
      const t0 = Date.now();
      while (!s.done && Date.now() - t0 < ms) {
        s.pending ||= s.reader.read().then(v => { s.pending = null; return v; });
        const r = await Promise.race([s.pending, sleep(Math.max(50, ms - (Date.now() - t0))).then(() => null)]);
        if (!r) break;
        if (r.done) { s.done = true; break; }
        s.buf += s.dec.decode(r.value, {stream: true});
        let i;
        while ((i = s.buf.indexOf('\n')) >= 0) { const line = s.buf.slice(0, i).trim(); s.buf = s.buf.slice(i + 1); if (line.startsWith('data:')) out.push(line.slice(5).trim()); }
      }
      return {lines: out, done: s.done};
    },
    close(id) { const s = streams.get(id); streams.delete(id); s?.reader.cancel().catch(() => {}); },
    headersForJoin: async () => ({}),
    fetchFile: async url => { const r = await fetch(url, {headers: auth}); if (!r.ok) throw new HfError(`Space не отдал файл (${r.status})`, 'down'); return Buffer.from(await r.arrayBuffer()); },
  };
}

// ---- транспорт «frame»: запросы внутри окна Space в Chrome Freefield ----
function frameTransport(frame) {
  // окно, в котором открыт Space (на деле — https://huggingface.co): только ему отправляем просьбу о заголовках
  const parent = (() => { try { return new URL(frame.parentFrame()?.url() || '').origin; } catch { return 'https://huggingface.co'; } })();
  return {
    mode: 'frame',
    request: (method, url, {json, form, headers = {}} = {}) => frame.evaluate(async ({method, url, json, form, headers}) => {
      let body;
      const h = {...headers};
      if (json !== undefined) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
      if (form) {
        const bin = Uint8Array.from(atob(form.b64), c => c.charCodeAt(0));
        body = new FormData();
        body.append('files', new Blob([bin], {type: form.mime}), form.name);
      }
      const r = await fetch(url, {method, headers: h, body, credentials: 'include'});
      return {status: r.status, text: await r.text()};
    }, {method, url, json, form, headers}),
    open: (url, headers = {}) => frame.evaluate(async ({url, headers}) => {
      const r = await fetch(url, {headers: {...headers, Accept: 'text/event-stream'}, credentials: 'include'});
      if (!r.ok) throw new Error('Space не открыл поток событий (' + r.status + ')');
      const id = Math.random().toString(36).slice(2);
      (window.__ffStreams ||= {})[id] = {reader: r.body.getReader(), dec: new TextDecoder(), buf: '', pending: null, done: false};
      return id;
    }, {url, headers}),
    pull: (id, ms) => frame.evaluate(async ({id, ms}) => {
      const s = window.__ffStreams?.[id];
      if (!s) return {lines: [], done: true};
      const out = [], t0 = Date.now();
      while (!s.done && Date.now() - t0 < ms) {
        s.pending ||= s.reader.read().then(v => { s.pending = null; return v; });
        const r = await Promise.race([s.pending, new Promise(res => setTimeout(() => res(null), Math.max(50, ms - (Date.now() - t0))))]);
        if (!r) break;
        if (r.done) { s.done = true; break; }
        s.buf += s.dec.decode(r.value, {stream: true});
        let i;
        while ((i = s.buf.indexOf('\n')) >= 0) { const line = s.buf.slice(0, i).trim(); s.buf = s.buf.slice(i + 1); if (line.startsWith('data:')) out.push(line.slice(5).trim()); }
      }
      return {lines: out, done: s.done};
    }, {id, ms}),
    close: id => frame.evaluate(id => { const s = window.__ffStreams?.[id]; if (s) { s.reader.cancel().catch(() => {}); delete window.__ffStreams[id]; } }, id).catch(() => {}),
    // заголовки ZeroGPU с входом пользователя — их выдаёт окно huggingface.co, как самому интерфейсу Space
    headersForJoin: () => frame.evaluate(parent => new Promise(res => {
      if (window.parent === window) return res(null);
      const ch = new MessageChannel();
      const t = setTimeout(() => res(null), 8000);
      ch.port1.onmessage = ({data}) => {
        clearTimeout(t);
        const h = data instanceof Map ? Object.fromEntries(data) : data && typeof data === 'object' ? data : null;
        res(h ? Object.fromEntries(Object.entries(h).filter(([, v]) => typeof v === 'string')) : null);
      };
      window.parent.postMessage('zerogpu-headers', parent, [ch.port2]);
    }), parent),
    fetchFile: async url => {
      // публичный Space отдаёт файлы и без входа; если нет — читаем внутри окна Space
      const r = await fetch(url).catch(() => null);
      if (r?.ok) return Buffer.from(await r.arrayBuffer());
      const b64 = await frame.evaluate(async url => {
        const r = await fetch(url, {credentials: 'include'});
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const b = await r.blob();
        return await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = () => no(fr.error); fr.readAsDataURL(b); });
      }, url);
      return Buffer.from(b64, 'base64');
    },
  };
}

// ---- сессия Space ----
// open({space, frame?}) — frame передаёт mesh3d.js (окно Space в Chrome), иначе нужен токен.
export async function openSpace({space, frame = null, profile = currentProfile(), onStatus = () => {}}) {
  const token = frame ? '' : hfToken(profile);
  if (!frame && !token) throw new HfError('нет токена Hugging Face для этого профиля', 'auth');
  // FREEFIELD_SPACE_HOSTS — адреса Spaces вручную (зеркало или проверка на своём компьютере): {"owner/name": "http://…"}
  const host = frame ? new URL(frame.url()).origin : (JSON.parse(process.env.FREEFIELD_SPACE_HOSTS || '{}')[space] || spaceHost(space));
  const T = frame ? frameTransport(frame) : nodeTransport(token);
  // Space может спать или собираться — ждём до 4 минут
  let cfg = null;
  for (let t0 = Date.now(); !cfg;) {
    const r = await T.request('GET', host + '/config').catch(e => ({status: 0, text: e.message}));
    if (r.status === 200) { try { cfg = JSON.parse(r.text); break; } catch {} }
    if (r.status === 401 || r.status === 403) throw new HfError(`Space ${space} не пускает (${r.status}) — проверьте вход в Hugging Face`, 'login');
    if (r.status === 404) throw new HfError(`Space ${space} не найден — возможно, его удалили или переименовали`, 'down');
    if (Date.now() - t0 > 240000) throw new HfError(`Space ${space} не проснулся за 4 минуты (ответ ${r.status || 'нет связи'})`, 'down');
    onStatus(`Space ${space} просыпается…`);
    await sleep(8000);
  }
  const prefix = cfg.api_prefix ?? (cfg.version && +cfg.version.split('.')[0] >= 5 ? '/gradio_api' : '');
  const root = (cfg.root && /^https?:/.test(cfg.root) ? cfg.root : host).replace(/\/$/, '');
  const comps = new Map((cfg.components || []).map(c => [c.id, c]));
  const values = new Map((cfg.components || []).map(c => [c.id, c.props?.value ?? null]));
  const session = crypto.randomBytes(6).toString('hex');
  const deps = (cfg.dependencies || []).map((d, i) => ({...d, fn: d.id ?? i})).filter(d => d.backend_fn !== false);
  const label = id => String(comps.get(id)?.props?.label ?? '').trim().toLowerCase();

  const find = (want) => {
    const names = [].concat(want);
    for (const n of names) {
      const d = deps.find(d => d.api_name === n) || deps.find(d => String(d.api_name || '').replace(/_\d+$/, '') === n);
      if (d) return d;
    }
    return null;
  };
  // зависимость, которую запускает кнопка с подписью re
  const byButton = re => deps.find(d => (d.targets || []).some(([id, ev]) => ev === 'click' && re.test(String(comps.get(id)?.props?.value ?? comps.get(id)?.props?.label ?? ''))));
  const compsOf = d => ({inputs: (d.inputs || []).map(id => ({id, type: comps.get(id)?.type, label: label(id)})), outputs: (d.outputs || []).map(id => ({id, type: comps.get(id)?.type, label: label(id)}))});

  async function upload(buf, name, mime) {
    const r = await T.request('POST', `${root}${prefix}/upload?upload_id=${crypto.randomBytes(5).toString('hex')}`, {form: {b64: buf.toString('base64'), name, mime}});
    if (r.status !== 200) throw new HfError(`Space не принял файл (${r.status}): ${r.text.slice(0, 150)}`, 'down');
    const [p] = JSON.parse(r.text);
    return {path: p, orig_name: name, mime_type: mime, size: buf.length, meta: {_type: 'gradio.FileData'}};
  }

  // Вызов функции Space. set — значения входов по подписи поля (без учёта регистра) или по id компонента.
  async function call(dep, set = {}, {status = 'Space работает', timeoutMs = 15 * 60e3} = {}) {
    if (!dep) throw new HfError('в Space нет нужной функции — возможно, его интерфейс изменился', 'ui');
    const lower = Object.fromEntries(Object.entries(set).map(([k, v]) => [String(k).toLowerCase(), v]));
    const data = (dep.inputs || []).map(id => {
      const c = comps.get(id);
      if (c?.type === 'state') return null;   // состояние Space хранит у себя (по session_hash)
      const l = label(id);
      if (id in set) return set[id];
      if (l && l in lower) return lower[l];
      return values.get(id) ?? null;
    });
    // ZeroGPU: в окне Space заголовки входа выдаёт huggingface.co; без них квота была бы анонимной — тогда не запускаем
    // (метку zerogpu у функций ставит сам Hugging Face; её может не быть — тогда заголовки берём для всех функций Space)
    let headers = T.mode === 'frame' ? await T.headersForJoin() : {};
    if (!headers && dep.zerogpu) throw new HfError('страница Hugging Face не выдала данные входа для ZeroGPU — обновите окно Space в Chrome Freefield и повторите', 'login');
    headers ||= {};
    const j = await T.request('POST', `${root}${prefix}/queue/join?`, {json: {data, event_data: null, fn_index: dep.fn, trigger_id: null, session_hash: session}, headers});
    if (j.status === 401 || j.status === 403) throw new HfError(`Space не пустил (${j.status}) — проверьте вход в Hugging Face`, 'login');
    if (j.status === 503) throw new HfError('очередь Space переполнена — попробуйте позже', 'busy');
    if (j.status !== 200) throw quotaError(j.text) || new HfError(`Space ответил ${j.status}: ${j.text.slice(0, 200)}`, 'down');
    const eventId = JSON.parse(j.text).event_id;
    // поток событий — после постановки в очередь (раньше Gradio отвечает «Session not found»)
    const sid = await T.open(`${root}${prefix}/queue/data?session_hash=${session}`);
    try {
      const t0 = Date.now();
      for (;;) {
        if (Date.now() - t0 > timeoutMs) throw new HfError(`Space не закончил за ${Math.round(timeoutMs / 60000)} мин`, 'busy');
        const {lines, done} = await T.pull(sid, 5000);
        for (const line of lines) {
          let m;
          try { m = JSON.parse(line); } catch { continue; }
          if (m.event_id && eventId && m.event_id !== eventId) continue;
          if (m.msg === 'estimation') onStatus(m.rank > 0 ? `очередь Space: ${m.rank + 1}-й${m.rank_eta ? `, ≈ ${Math.round(m.rank_eta)} с` : ''}` : 'сейчас начнём');
          else if (m.msg === 'process_starts') onStatus(status);
          else if (m.msg === 'progress') { const p = m.progress_data?.[0]; if (p?.length) onStatus(`${status} ${Math.round(100 * p.index / p.length)}%`); else if (p?.desc) onStatus(`${status}: ${p.desc}`); }
          else if (m.msg === 'log') { noteQuota(m.log); if (m.level === 'warning' || m.level === 'error') { const qe = quotaError(m.log, m.title); if (qe) throw qe; } }
          else if (m.msg === 'unexpected_error') throw quotaError(m.message) || new HfError('Space: ' + (m.message || 'сбой'), 'busy');
          else if (m.msg === 'process_completed') {
            if (!m.success) {
              const err = m.output?.error ?? m.output?.title ?? '';
              throw quotaError(err, m.output?.title || m.title) || new HfError(err && err !== 'null' ? 'Space: ' + String(err).slice(0, 300) : 'бесплатный GPU не справился — попробуйте ещё раз', 'busy');
            }
            const out = (m.output?.data || []).map(v => v && typeof v === 'object' && v.__type__ === 'update' ? v.value : v);
            (dep.outputs || []).forEach((id, i) => { if (out[i] !== undefined) values.set(id, out[i]); });
            return out;
          }
        }
        if (done) throw new HfError('Space оборвал соединение', 'busy');
      }
    } finally { T.close(sid); }
  }

  const fileUrl = f => !f ? null : typeof f === 'string' ? (/^https?:/.test(f) ? f : `${root}${prefix}/file=${f}`) : f.url || (f.path ? `${root}${prefix}/file=${f.path}` : null);
  return {space, host, mode: T.mode, cfg, find, byButton, compsOf, upload, call, values, label, fileUrl,
    fetchFile: url => T.fetchFile(url)};
}

// Кто вошёл (по токену) — имя и тариф; сам токен не возвращаем
export async function whoamiToken(token) {
  const r = await fetch('https://huggingface.co/api/whoami-v2', {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(15000)}).catch(() => null);
  if (!r) return {ok: null, error: 'нет связи с huggingface.co'};
  if (r.status === 401) return {ok: false, error: 'токен не подошёл'};
  if (!r.ok) return {ok: null, error: `huggingface.co ответил ${r.status}`};   // проверить не вышло — токен не браковать
  const j = await r.json().catch(() => ({}));
  return {ok: true, name: j.name || null, pro: !!(j.isPro || j.plan?.type === 'pro')};
}
// Дневная квота ZeroGPU (по документации HF на 2026 год): бесплатный аккаунт — 3,5 мин, PRO — 25 мин
export const zeroGpuDaily = pro => pro ? 25 * 60 : 210;
