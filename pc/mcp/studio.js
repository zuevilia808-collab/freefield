// «Студия» Freefield на компьютере: история генераций (.batches.json), пакеты сценариев, синхронизация с сайтами
// и связь с приложением (телефон / браузер) по Wi-Fi. Этим модулем пользуются и MCP-сервер для Claude (server.js),
// и отдельная программа связи (hub-main.mjs), которая может работать без перезапуска Claude.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {HERE, readState, writeState, withProfile, profileIds, profileName, activeProfileId} from './state.js';

export const OUT = process.env.FREEFIELD_OUTPUT_DIR || path.join(HERE, '..', 'outputs');
export const HUB_PORT = +process.env.FREEFIELD_PHONE_PORT || 5180;
let log = (...a) => console.error('[freefield]', ...a);
export const setLog = fn => { log = fn; };

let portalsMod = null, batchModP = null;
export const portals = async () => (portalsMod ??= await import('./portals.js'));
export const batchMod = async () => (batchModP ??= await import('./batch.js'));

const EXT = {'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm'};
const slug = s => (s || 'art').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'art';
export const randSeed = () => Math.floor(Math.random() * 2147483647);

export function saveOutput(buf, mime, prompt, seed = randSeed()) {
  const dir = path.join(OUT, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(dir, {recursive: true});
  let file = path.join(dir, `freefield-${slug(prompt)}-${seed}.${EXT[mime] || 'bin'}`);
  for (let i = 2; fs.existsSync(file); i++) file = file.replace(/(-\d+)?(\.\w+)$/, `-${i}$2`);
  fs.writeFileSync(file, buf);
  return file;
}

// ---- история: пакеты сценариев (от Claude, с телефона, синхронизация) ----
const BATCH_FILE = path.join(HERE, '.batches.json');
const batches = new Map();
const readBatches = () => { try { return JSON.parse(fs.readFileSync(BATCH_FILE, 'utf8')); } catch { return []; } };
const plainBatch = b => ({id: b.id, source: b.source, created: b.created, done: b.done, pid: b.pid, items: b.items});
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// пакет из файла, который не доделал уже закрытый Freefield (перезапуск, сбой), больше не «идёт» — помечаем прерванным
function orphan(b) {
  if (b.done || batches.has(b.id) || (b.pid ? alive(b.pid) : Date.now() - b.created < 3 * 3600e3)) return b;
  return {...b, done: true, items: b.items.map(it => ['queued', 'running'].includes(it.status)
    ? {...it, status: 'error', message: 'прервано: Freefield на компьютере перезапускался — запустите сценарий снова'} : it)};
}
export function allBatches() {
  const map = new Map(readBatches().map(b => [b.id, orphan(b)]));
  for (const b of batches.values()) map.set(b.id, plainBatch(b));
  return [...map.values()].sort((a, b) => b.created - a.created).slice(0, 200);
}
let persistTimer = null;
export function persistBatches() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { try { fs.writeFileSync(BATCH_FILE, JSON.stringify(allBatches(), null, 1)); } catch (e) { log('batches:', e.message); } }, 400);
}

// одиночная генерация — в историю как пакет из одного сценария (галерея приложения забирает оттуда)
export function recordGen({kind, site, model, appModel, prompt, aspect, files}) {
  const b = {id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, source: 'claude', created: Date.now(), done: true,
    items: [{n: 1, prompt, kind, site, model, appModel: appModel || null, aspect: aspect || null, status: 'done', message: '', note: '', files}]};
  batches.set(b.id, b);
  persistBatches();
}

// всё, что есть на сайтах и чего нет в Freefield, — в outputs и в историю; одна синхронизация за раз
let syncing = null;
export function runSync(onStatus) {
  return syncing ||= import('./sync.js').then(S => S.syncSites({onStatus})).finally(() => { syncing = null; });
}

export async function startBatch(scenarios, source) {
  const B = await batchMod();
  // профили, окна которых сейчас открыты, — задания в первую очередь им (без открытия новых окон)
  let open = [];
  try {
    const {chromeOpen, openProfilesNow} = await import('./bridge.js');
    if (await chromeOpen()) open = Object.keys((await openProfilesNow()).map).map(dir => dir === 'Default' ? 1 : +dir.split(' ')[1] + 1);
  } catch {}
  const batch = {id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, source, created: Date.now(), done: false, pid: process.pid, items: B.planBatch(scenarios, {open})};
  batches.set(batch.id, batch);
  persistBatches();
  batch.promise = B.runBatch(batch.items, {
    save: (o, it) => saveOutput(o.buf, o.mime || (it.kind === 'video' ? 'video/mp4' : 'image/jpeg'), it.prompt),
    onChange: persistBatches,
  }).catch(e => log('batch:', e.message)).finally(() => { batch.done = true; persistBatches(); runSync().catch(() => {}); });
  return batch;
}

// ---- связь с приложением по Wi-Fi ----
const hubKey = () => readState().hubKey;
const SVC3D = {auto: 'авто', hunyuan: 'Hunyuan 3D', hf: 'Hugging Face', tripo: 'Tripo', meshy: 'Meshy'};
export const hubApi = {
  // вход, кредиты и расход — по каждому профилю Chrome (профиль 1 — ещё и в корне ответа, как раньше)
  hello: async () => {
    const P = await portals();
    const one = p => withProfile(p, () => {
      const {raw, ...usage} = P.usageReport(), a = p === 1 ? readState() : (readState().profiles?.[p] || {});
      return {id: p, name: profileName(p), flowLeft: P.flowLeft(), flowDaily: P.FLOW_DAILY, flowChecked: a.flowCredits?.at || null,
        dolaPoints: P.dolaPoints(), siteOut: {flow: P.flowPaused(), dola: P.siteOut('dola'), arena: P.siteOut('arena'), vids: P.siteOut('vids')},
        // Google Vids ждёт разового шага пользователя: «умные функции» (smart) или правила фото-ингредиентов (terms)
        vidsWait: P.vidsBlocked() ? 'smart' : P.vidsBlocked(true) ? 'terms' : null,
        flowPause: P.flowPaused() ? a.flowPause : null, usage, login: a.login || {}};
    });
    const profiles = profileIds().map(one);
    // какой профиль Chrome сейчас открыт в окне Freefield (null — Chrome Freefield закрыт)
    const {chromeOpen} = await import('./bridge.js');
    // open — профили, окна которых сейчас открыты (их может быть несколько: «Открыть этот профиль», «Открыть все профили»)
    let active = null, open = [], multi = false, unknown = 0;
    if (await chromeOpen()) {
      const {openProfileIds} = await import('./multilogin.js');
      const o = await openProfileIds().catch(() => ({ids: [], count: 1, unknown: 0}));
      multi = o.count > 1;
      unknown = multi ? o.unknown : 0;
      open = multi ? o.ids : [o.ids[0] || activeProfileId()];
      active = multi ? null : open[0];
    }
    // версия приложения (время правки app/index.html): открытая страница видит, что вышло обновление
    const app = Math.round(fs.statSync(path.join(HERE, '..', 'app', 'index.html'), {throwIfNoEntry: false})?.mtimeMs || 0);
    const {lanAddresses} = await import('./hub.js');
    return {ok: true, name: 'Freefield', ...profiles[0], profiles, active, open, multi, unknown, app, mcp: !!hubApi.mcp, lan: lanAddresses(), port: HUB_PORT};
  },
  // выход и вход — в своём профиле Chrome (если открыт другой, Chrome Freefield переключится, когда там не идут генерации)
  switchAccount: async (site, p = 1) => {
    try { return {ok: true, message: await inProfile(p, async P => P.switchAccount(site))}; }
    catch (e) { return {ok: false, message: e.message}; }
  },
  // Dola и Arena: вход через Google сам ({loggedIn} — вошли; {choose: [почты]} — какой аккаунт взять, решает пользователь)
  openLogin: async (site, p = 1, email = null) => {
    try { return await inProfile(p, async P => P.openLogin(site, {email})); }   // в окне этого профиля (откроется, если закрыто)
    catch (e) { return {ok: false, message: e.message}; }
  },
  // проверить вход и баланс на сайтах (Flow — кредиты с сайта); без номера — в профиле Chrome, открытом сейчас
  status: async p => {
    const hello = await hubApi.hello();
    if (!p && hello.multi) {   // «Проверить баланс» при нескольких окнах — быстро: вход во всех открытых профилях
      const {checkProfiles} = await import('./multilogin.js');
      const message = await checkProfiles(hello.open);
      return {ok: true, message, ...(await hubApi.hello())};
    }
    const P = await portals();
    const st = {};
    const id = p || hello.active;
    st[id] = await withProfile(id, () => P.status(true));
    return {ok: true, status: st, ...(await hubApi.hello())};
  },
  // «💳 Проверить баланс» в «Видео сервисах»: выбранные сервисы во всех открытых профилях Chrome.
  // Flow — остаток кредитов с сайта (панель аккаунта) по очереди в каждом открытом окне; вход в остальные сервисы —
  // быстрая проверка вкладок без переходов. Баллы Dola, лимиты Vids и Arena сайты заранее не показывают — отдаём то, что известно
  balance: async sites => {
    const hello = await hubApi.hello();
    const open = hello.open?.length ? hello.open : [hello.active || activeProfileId()];
    const errors = {};
    if (sites.includes('flow')) {
      const P = await portals();
      for (const p of open) {
        if (runningIn(p)) { errors[p] = 'идут генерации — остаток прочитаю после них'; continue; }
        try { if (await withProfile(p, () => P.flowCheck()) == null) errors[p] = 'Flow не показал остаток'; }
        catch (e) { errors[p] = e.message; }
      }
    }
    if (sites.some(s => s !== 'flow') && hello.multi) {
      const {checkProfiles} = await import('./multilogin.js');
      await checkProfiles(open).catch(e => { errors.login = e.message; });
    }
    return {ok: true, checked: open, errors, ...(await hubApi.hello())};
  },
  // «Открыть этот профиль»: окно Chrome этого профиля — рядом с уже открытыми (Flow, Dola, Arena и окна входа)
  openProfile: async p => {
    // окна других профилей генерациям не мешают; в этом профиле идут генерации — окно не перестраиваем
    if (runningIn(p)) return {ok: false, message: `В профиле «${profileName(p)}» сейчас идут генерации — его окно уже открыто`};
    try {
      const r = await (await import('./multilogin.js')).openProfileWindow(p);
      return {...r, ...(await hubApi.hello()), ok: r.ok, message: r.message};
    } catch (e) { return {ok: false, message: e.message}; }
  },
  // «✕ Закрыть все профили»: все окна Chrome Freefield
  closeAll: async () => {
    if (allBatches().some(b => !b.done)) return {ok: false, message: 'Сейчас идут генерации — профили можно будет закрыть, когда они закончатся'};
    const {closeAllProfiles} = await import('./bridge.js');
    try { return {ok: true, message: await closeAllProfiles(), ...(await hubApi.hello())}; }
    catch (e) { return {ok: false, message: e.message}; }
  },
  // «🪟 Открыть все профили»: окна всех профилей Chrome сразу
  openAll: async () => {
    if (allBatches().some(b => !b.done)) return {ok: false, message: 'Сейчас идут генерации — окна всех профилей откроются, когда они закончатся'};
    try {
      const r = await (await import('./multilogin.js')).openAllProfiles();
      return {...r, ...(await hubApi.hello()), ok: r.ok, message: r.message};
    } catch (e) { return {ok: false, message: e.message}; }
  },
  // «Закрыть этот профиль»: окно Chrome Freefield закрывается целиком (если открыт этот профиль и не идут генерации)
  closeProfile: async p => {
    const {closeProfile, profileDirOf} = await import('./bridge.js');
    if (runningIn(p)) return {ok: false, message: `В профиле «${profileName(p)}» сейчас идут генерации — закройте его, когда они закончатся`};
    try { return {ok: true, message: await closeProfile(profileDirOf(p)), ...(await hubApi.hello())}; }
    catch (e) { return {ok: false, message: e.message}; }
  },
  // «＋ Добавить профиль для входа»: новый профиль Chrome в новом окне рядом с открытыми — Flow, Dola, Arena и окна входа
  newProfile: async () => {
    try {
      const r = await (await import('./multilogin.js')).newProfileWindow();
      return {...r, ...(await hubApi.hello()), ok: r.ok,
        message: `Открыл новый профиль Chrome (${profileName(r.id)}) в отдельном окне. Войдите в нём во Flow, Dola и Arena другим аккаунтом Google — окна входа уже открыты. Переименовать профиль можно в самом Chrome.`};
    } catch (e) { return {ok: false, message: e.message}; }
  },
  submit: async list => {
    const {saveDataUrl} = await import('./refs.js');
    // первое фото — главный референс (Dola, Arena), все — «ингредиенты» Flow; развёртка героя — только «ингредиент» Flow и Vids
    const scenarios = list.map(({images = [], sheet, ...s}) => {
      const paths = images.map(x => saveDataUrl(OUT, x));
      if (sheet) s.sheet_path = saveDataUrl(OUT, sheet);
      return paths.length ? {...s, image_path: paths[0], image_paths: paths} : s;
    });
    const b = await startBatch(scenarios, 'phone');
    // profile — какой профиль Chrome (аккаунт) взял задание: приложение пишет, как пакет разошёлся по аккаунтам
    return {id: b.id, items: b.items.map(i => ({n: i.n, kind: i.kind, site: i.site, profile: i.profile || 1, profileName: profileName(i.profile || 1)}))};
  },
  list: async () => {
    const {SITE_LABEL} = await batchMod();
    return allBatches().map(b => ({...b, items: b.items.map(it => ({n: it.n, prompt: it.prompt, kind: it.kind, site: it.site,
      model: it.model, appModel: it.appModel || null, status: it.status, message: it.message, note: it.note, aspect: it.aspect,
      siteLabel: SITE_LABEL[it.site] || it.siteLabel || null, meta3d: it.meta3d || null,
      files: (it.files || []).map((f, j) => ({url: `/api/file/${b.id}/${it.n}/${j}`, name: f.name || path.basename(f.path), mime: f.mime, label: f.label}))}))}));
  },
  filePath: async (id, n, j) => {
    const p = allBatches().find(b => b.id === id)?.items.find(i => i.n === n)?.files?.[j]?.path;
    const root = path.resolve(OUT) + path.sep;
    return p && path.resolve(p).startsWith(root) ? path.resolve(p) : null;
  },
  // файлы из outputs за последние 2 дня, сделанные через Freefield (пакеты от Claude и из приложения, свои недозабранные
  // с сайтов); то, что раньше синхронизация тащила с сайтов подряд, в галерею больше не отдаём
  outputs: async () => {
    const meta = new Map();
    for (const b of allBatches()) if (b.source !== 'sync' || b.ours) for (const it of b.items) for (const f of it.files || [])
      meta.set(path.basename(f.path), {prompt: it.prompt, kind: it.kind, site: it.site, model: it.model, appModel: it.appModel || null, aspect: it.aspect, label: f.label});
    const days = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-2) : [];
    return days.flatMap(d => fs.readdirSync(path.join(OUT, d)).filter(n => meta.has(n)).map(n => ({
      name: n, url: `/api/out/${d}/${encodeURIComponent(n)}`, mtime: fs.statSync(path.join(OUT, d, n)).mtimeMs, meta: meta.get(n),
    }))).sort((a, b) => b.mtime - a.mtime);
  },
  sync: async () => {
    const r = await runSync();
    return {ok: true, added: r.added.length, errors: r.errors,
      message: r.added.length ? `Забрано с сайтов: ${r.added.length} — появится в галерее` : 'Новых файлов на сайтах нет — в Freefield уже всё'};
  },
  // «🧊 3D-модель» из приложения: картинка (и виды сзади/слева/справа) → модель; идёт как пакет — приложение показывает
  // живую карточку с этапами, а готовую модель забирает в галерею (GLB одним файлом, иначе zip с текстурами)
  make3d: async o => {
    const {saveDataUrl} = await import('./refs.js');
    const image = o.pcPath || saveDataUrl(OUT, o.image);
    const extra = Object.fromEntries(Object.entries(o.views || {}).map(([k, v]) => [k, saveDataUrl(OUT, v)]));
    const views = Object.keys(extra).length ? {front: image, ...extra} : null;
    const it = {n: 1, prompt: o.title || '3D-модель', kind: '3d', site: o.service, siteLabel: SVC3D[o.service] || 'авто', status: 'running', message: 'в очереди',
      note: '', aspect: '1:1', files: []};
    const b = {id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, source: 'phone', created: Date.now(), done: false, pid: process.pid, items: [it]};
    batches.set(b.id, b);
    persistBatches();
    (async () => {
      try {
        const M = await import('./mesh3d.js');
        const {zipFiles} = await import('./media.js');
        const r = await M.imageTo3d({image: views ? undefined : image, views, service: o.service, quality: o.quality, texture: o.texture, pbr: o.pbr,
          format: o.format, allowPaid: false, outDir: path.join(OUT, '3d', b.id), onStatus: m => { it.message = m; persistBatches(); }});
        const others = r.files.filter(f => f.path !== r.model_path && f.role !== 'model_alt');
        const file = others.length ? await zipFiles(r.files.map(f => ({path: f.path, name: path.relative(path.join(OUT, '3d', b.id), f.path)})), path.join(OUT, '3d', b.id, `freefield-3d-${b.id}.zip`)) : r.model_path;
        const ext = path.extname(file).slice(1);
        it.files = [{path: file, name: `freefield-3d-${b.id}.${ext}`, mime: {zip: 'application/zip', glb: 'model/gltf-binary', obj: 'model/obj'}[ext] || 'application/octet-stream', label: `3D · ${r.format.toUpperCase()}`}];
        const fl = r.free_left;
        Object.assign(it, {status: 'done', message: '', site: r.service, siteLabel: r.service_label, model: r.engine,
          note: [r.polygons && `${r.polygons.triangles.toLocaleString('ru')} треугольников`, r.error, fl && (r.service === 'hf' ? `квота ZeroGPU: ≈ ${fl.generations_left_estimate} моделей` : `осталось ≈ ${fl.left} ${fl.unit}`)].filter(Boolean).join(' · '),
          meta3d: {format: r.format, pack: ext, triangles: r.polygons?.triangles ?? null, vertices: r.polygons?.vertices ?? null, textures: r.textures, pbr: r.pbr,
            service: r.service_label, engine: r.engine, folder: path.join(OUT, '3d', b.id), model_path: r.model_path, error: r.error || null, warnings: r.warnings, skipped: r.skipped}});
      } catch (e) { Object.assign(it, {status: 'error', message: e.message}); }
      b.done = true;
      persistBatches();
    })();
    return {id: b.id};
  },
  // «🔍 Увеличить» из приложения: результат — обычная картинка, приложение заберёт её в галерею
  upscale: async o => {
    const {saveDataUrl} = await import('./refs.js');
    const src = o.pcPath || saveDataUrl(OUT, o.image);
    const it = {n: 1, prompt: o.title || `Увеличение ×${o.factor}`, kind: 'image', site: 'upscale', siteLabel: 'увеличение', status: 'running', message: 'в очереди', note: '', aspect: o.aspect, files: []};
    const b = {id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, source: 'phone', created: Date.now(), done: false, pid: process.pid, items: [it]};
    batches.set(b.id, b);
    persistBatches();
    (async () => {
      try {
        const U = await import('./upscale.js');
        const r = await U.upscaleImage({file: src, factor: o.factor, outDir: path.join(OUT, new Date().toISOString().slice(0, 10)), onStatus: m => { it.message = m; persistBatches(); }});
        Object.assign(it, {status: 'done', message: '', model: `×${r.factor_actual ?? o.factor} · ${r.engine}`, siteLabel: r.service === 'flow' ? 'Google Flow' : 'Hugging Face',
          note: [`${r.width}×${r.height}`, ...r.warnings].join(' · '), files: [{path: r.path, mime: r.mime}]});
      } catch (e) { Object.assign(it, {status: 'error', message: e.message}); }
      b.done = true;
      persistBatches();
    })();
    return {id: b.id};
  },
  // файл галереи, который сделал этот компьютер (по имени) — чтобы не пересылать его обратно и чтобы Flow мог его увеличить
  findOutput: name => {
    if (!/^[\w.\-]+$/.test(name || '')) return null;
    const days = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() : [];
    for (const d of days) { const p = path.join(OUT, d, name); if (fs.existsSync(p)) return p; }
    return null;
  },
  outPath: async (day, name) => {
    const p = path.resolve(OUT, day, name);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && p.startsWith(path.resolve(OUT) + path.sep) && fs.existsSync(p) ? p : null;
  },
};

// в профиле p сейчас идут генерации (задания в очереди или в работе)
const runningIn = p => allBatches().some(b => !b.done && b.items.some(it => (it.profile || 1) === p && ['queued', 'running'].includes(it.status)));

// профиль p: работа в его окне Chrome (окно откроется рядом с остальными, если закрыто)
async function inProfile(p, fn) {
  const P = await portals();
  const {leaseProfile} = await import('./bridge.js');
  return withProfile(p, async () => {
    const release = await leaseProfile();
    try { return await fn(P); } finally { release(); }
  });
}
let hubServer = null;
export const hubRunning = () => !!hubServer;
// Включает связь (ключ создаётся один раз). Если порт уже держит другой Freefield — связь остаётся за ним.
export async function ensureHub() {
  if (!hubKey()) writeState({hubKey: crypto.randomBytes(18).toString('base64url')});
  // пишем, только если флага ещё нет: ensureHub зовут раз в 15–60 с, а файл общий с другими копиями Freefield
  if (!readState().hubEnabled) writeState({hubEnabled: true});
  const H = await import('./hub.js');
  if (!hubServer) {
    try {
      hubServer = await H.startHub({port: HUB_PORT, host: process.env.FREEFIELD_PHONE_HOST || '0.0.0.0', key: hubKey, appDir: path.join(HERE, '..', 'app'), api: hubApi, log});
      log(`связь с телефоном: порт ${HUB_PORT}`);
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
      const ours = await fetch(`http://127.0.0.1:${HUB_PORT}/api/hub?k=${hubKey()}`).then(r => r.ok).catch(() => false);
      if (!ours) throw new Error(`порт ${HUB_PORT} занят другой программой — укажите другой в FREEFIELD_PHONE_PORT`);
    }
  }
  return H.lanAddresses().map(a => `http://${a}:${HUB_PORT}/?k=${hubKey()}#claude`);
}
