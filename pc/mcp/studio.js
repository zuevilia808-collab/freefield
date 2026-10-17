// «Студия» Freefield на компьютере: история генераций (.batches.json), пакеты сценариев, синхронизация с сайтами
// и связь с приложением (телефон / браузер) по Wi-Fi. Этим модулем пользуются и MCP-сервер для Claude (server.js),
// и отдельная программа связи (hub-main.mjs), которая может работать без перезапуска Claude.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {HERE, readState, writeState, withProfile, profileIds, profileName, profileNum, activeProfileId} from './state.js';
import {PROFILE as CHROME_PROFILE, profileDirOf} from './bridge.js';
// аватарка аккаунта Google, которую Chrome хранит в профиле; нет файла — null
const avatarFile = p => { const f = path.join(CHROME_PROFILE, profileDirOf(p), 'Google Profile Picture.png'); return fs.existsSync(f) ? f : null; };

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
const trendJobs = new Map();   // «🔥 Тренды»: поиск с идеями из приложения (id → ход)
const batches = new Map();
const readBatches = () => { try { return JSON.parse(fs.readFileSync(BATCH_FILE, 'utf8')); } catch { return []; } };
const plainBatch = b => ({id: b.id, source: b.source, created: b.created, done: b.done, pid: b.pid, items: b.items,
  ...(b.siteTask && {siteTask: b.siteTask, siteProject: b.siteProject})});
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

// extra — {siteTask, siteProject}: картинки для «🌐 Ассетов для сайта» — в галерее с меткой проекта
export async function startBatch(scenarios, source, extra = {}) {
  const B = await batchMod();
  // профили, окна которых сейчас открыты, — задания в первую очередь им (без открытия новых окон)
  let open = [];
  try {
    const {chromeOpen, openProfilesNow} = await import('./bridge.js');
    if (await chromeOpen()) open = Object.keys((await openProfilesNow()).map).map(dir => dir === 'Default' ? 1 : +dir.split(' ')[1] + 1);
  } catch {}
  const batch = {id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, source, created: Date.now(), done: false, pid: process.pid, items: B.planBatch(scenarios, {open}),
    ...(extra.siteTask && {siteTask: extra.siteTask, siteProject: extra.siteProject || null})};
  batches.set(batch.id, batch);
  persistBatches();
  batch.promise = B.runBatch(batch.items, {
    // имя файла — номер сценария и его название (title), иначе начало промпта: у похожих промптов имена были одинаковые (2026-10-17)
    save: (o, it) => saveOutput(o.buf, o.mime || (it.kind === 'video' ? 'video/mp4' : 'image/jpeg'), `s${it.n}-${it.title || it.prompt.replace(/^(On-screen text|Subject|Spoken line):[^\n]*\n?/gim, '')}`),
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
      return {id: p, name: profileName(p), num: profileNum(p), avatar: avatarFile(p) ? `/api/avatar/${p}` : null, flowLeft: P.flowLeft(), flowDaily: P.FLOW_DAILY, flowChecked: a.flowCredits?.at || null,
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
    // версия приложения (последняя правка index.html, css/, js/ в папке app): открытая страница видит, что вышло обновление
    const appDir = path.join(HERE, '..', 'app'), mtime = f => fs.statSync(path.join(appDir, f), {throwIfNoEntry: false})?.mtimeMs || 0;
    const sub = d => { try { return fs.readdirSync(path.join(appDir, d)).map(f => d + '/' + f); } catch { return []; } };
    const app = Math.round(Math.max(0, ...['index.html', ...sub('css'), ...sub('js')].map(mtime)));
    const {lanAddresses} = await import('./hub.js');
    // что умеет эта версия программы: приложение видит, что программу на компьютере пора обновить
    return {ok: true, name: 'Freefield', ...profiles[0], profiles, active, open, multi, unknown, app, mcp: !!hubApi.mcp, lan: lanAddresses(), port: HUB_PORT,
      features: ['echo', 'echo-start', 'update', 'split', 'site', 'trends', 'heroes', ...((await import('./write.js')).claudeExe() ? ['claude'] : [])], echoPort: (await import('./echo.js')).ECHO.port};
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
    return allBatches().map(b => ({...b, siteProject: b.siteProject || null, items: b.items.map(it => ({n: it.n, prompt: it.prompt, kind: it.kind, site: it.site,
      model: it.model, appModel: it.appModel || null, status: it.status, message: it.message, note: it.note, aspect: it.aspect,
      siteLabel: SITE_LABEL[it.site] || it.siteLabel || null, meta3d: it.meta3d || null,
      files: (it.files || []).map((f, j) => ({url: `/api/file/${b.id}/${it.n}/${j}`, name: f.name || path.basename(f.path), mime: f.mime, label: f.label}))}))}));
  },
  splitStart: async audio => (await import('./split.js')).splitStart(audio),
  splitGet: async id => (await import('./split.js')).splitGet(id),
  splitFile: async (id, which) => (await import('./split.js')).splitFile(id, which),
  writeStart: async job => (await import('./write.js')).writeStart(job),
  writeGet: async id => (await import('./write.js')).writeGet(id),
  avatarFile: p => avatarFile(p),
  etalonGet: async () => (await import('./etalon.js')).etalon(),
  etalonSet: async (text, mode) => (await import('./etalon.js')).setEtalon(text, mode),
  siteCreate: async body => (await import('./site.js')).siteCreate(body),
  siteList: async () => (await import('./site.js')).siteList(),
  siteSrcFile: async (id, n) => (await import('./site.js')).siteSrcFile(id, n),
  siteDelete: async id => (await import('./site.js')).siteDelete(id),
  // «🔥 Тренды»: лента (outputs/trends/trends.json), поиск с идеями (Claude Code по подписке), «Сделать с моим героем» — в галерее с ходом работы
  heroesGet: async () => (await import('./heroes.js')).heroesList().map(h => ({id: h.id, name: h.name, about: h.about || '', updated: h.updated, url: `/api/heroes/${h.id}`})),
  heroFile: async id => (await import('./heroes.js')).heroFile(id),
  trendsGet: async () => (await import('./trends.js')).trendsList(),
  trendDelete: async id => (await import('./trends.js')).trendDelete(id),
  trendsFind: async o => {
    const id = crypto.randomBytes(8).toString('hex');
    const job = {id, status: 'running', message: 'начинаю', at: Date.now()};
    trendJobs.set(id, job);
    (async () => {
      try {
        const T = await import('./trends.js');
        const st = m => { job.message = m; };
        const r = await T.findTrends({query: o.query, limit: 12, onStatus: st});
        let items = r.items, ideas, note = '';
        const w = await T.writeIdeas(items, o.heroes || [], st);
        if (w.error) note = w.error;
        else { const by = new Map(w.items.map(x => [x.url, x])); items = items.map(x => ({...x, ...(by.get(x.url) || {})})); ideas = w.ideas; }
        T.saveTrends({items, ideas});
        Object.assign(job, {status: 'done', message: '', found: items.length, note});
      } catch (e) { Object.assign(job, {status: 'error', message: e.message}); }
    })();
    return {id};
  },
  trendsJob: async id => trendJobs.get(id) || null,
  trendsMake: async o => {
    const {saveDataUrl} = await import('./refs.js');
    const hero = o.heroPc || saveDataUrl(OUT, o.hero);
    const loc = o.locationImage ? saveDataUrl(OUT, o.locationImage) : null;
    const it = {n: 1, prompt: `🔥 Тренд → ${o.heroName || 'мой герой'}${o.locationText ? ' · ' + o.locationText : ''}`, kind: 'video', site: 'motion', siteLabel: 'перенос движения',
      status: 'running', message: 'в очереди', note: '', aspect: '9:16', files: []};
    const b = {id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, source: 'phone', created: Date.now(), done: false, pid: process.pid, items: [it]};
    batches.set(b.id, b);
    persistBatches();
    (async () => {
      try {
        const T = await import('./trends.js');
        const r = await T.motionTransfer({source: o.url, hero, location: o.location || '', locationImage: loc, mode: o.mode, start: o.start, seconds: o.seconds,
          quality: o.quality, name: o.heroName || '', onStatus: m => { it.message = m; persistBatches(); }});
        Object.assign(it, {status: 'done', message: '', model: r.engine, aspect: r.height >= r.width ? '9:16' : '16:9',
          note: `${r.seconds} с · ${r.mode === 'move' ? 'новая локация' : 'та же локация'} · ${r.audio} · ≈ ${r.gpu_seconds} с GPU`,
          files: [{path: r.path, mime: 'video/mp4'}]});
      } catch (e) { Object.assign(it, {status: 'error', message: e.message}); }
      b.done = true;
      persistBatches();
    })();
    return {id: b.id};
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
      meta.set(path.basename(f.path), {prompt: it.prompt, kind: it.kind, site: it.site, model: it.model, appModel: it.appModel || null, aspect: it.aspect, label: f.label, siteProject: b.siteProject || null});
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
  // «Отрендерить на компьютере» (монтаж из приложения): файл из браузера → outputs/montage-src/mf-<sha1>.<ext> (одинаковые не дублируются)
  montageFile: async (stream, ext) => {
    const dir = path.join(OUT, 'montage-src');
    fs.mkdirSync(dir, {recursive: true});
    const tmp = path.join(dir, `up-${crypto.randomBytes(6).toString('hex')}.part`);
    const h = crypto.createHash('sha1'), out = fs.createWriteStream(tmp);
    let size = 0;
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > 600e6) throw Object.assign(new Error('файл больше 600 МБ'), {code: 413});
        h.update(chunk);
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      }
      await new Promise((r, j) => out.end(e => e ? j(e) : r()));
      if (size < 100) throw new Error('пустой файл');
      const ref = `mf-${h.digest('hex')}.${ext === 'jpeg' ? 'jpg' : ext}`, dst = path.join(dir, ref);
      if (fs.existsSync(dst)) fs.rmSync(tmp, {force: true}); else fs.renameSync(tmp, dst);
      return {ref};
    } catch (e) {
      // файл удаляем, когда поток его закрыл (на Windows открытый файл не удалить), и не теряем исходную ошибку
      await new Promise(r => { out.once('close', r); out.destroy(); });
      try { fs.rmSync(tmp, {force: true}); } catch { /* уберёт следующая загрузка */ }
      throw e;
    }
  },
  // проект montage.json → рендер на этом компьютере; как пакет: приложение показывает живую карточку, готовый ролик забирает в галерею
  montageStart: async ({project, quality}) => {
    const M = await import('./montage.js');
    const P = M.normalize(project);
    if (!P.tracks.video.length) throw new Error('в проекте нет видео');
    const q = quality === 'draft' ? 'draft' : 'final';
    const it = {n: 1, prompt: `монтаж: ${P.name}`, kind: 'video', site: 'montage', siteLabel: q === 'draft' ? 'монтаж · черновик 540p' : 'монтаж на компьютере',
      status: 'running', message: 'в очереди', note: '', aspect: P.aspect, files: []};
    const b = {id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, source: 'phone', created: Date.now(), done: false, pid: process.pid, items: [it]};
    batches.set(b.id, b);
    persistBatches();
    (async () => {
      try {
        const r = await M.renderProject(P, {outDir: path.join(OUT, new Date().toISOString().slice(0, 10)), uploadDir: path.join(OUT, 'montage-src'), quality: q, restrict: true,
          onStatus: m => { it.message = m; persistBatches(); }});
        Object.assign(it, {status: 'done', message: '', model: `${r.width}×${r.height} · ${r.encoder === 'h264_nvenc' ? 'видеокарта' : 'процессор'}`,
          note: [`${r.duration} с`, r.lufs != null && `${r.lufs} LUFS`, `${r.seconds} с рендера`].filter(Boolean).join(' · '), files: [{path: r.path, mime: r.mime}]});
      } catch (e) { Object.assign(it, {status: 'error', message: e.message}); }
      b.done = true;
      persistBatches();
    })();
    return {id: b.id};
  },
  // редактор монтажа (этап 7): шаблоны (встроенные и свои) с превью, стили субтитров, цвета
  montageTemplates: async () => {
    const M = await import('./montage.js');
    const dir = path.join(OUT, 'montage-templates');
    return {templates: M.recipeList(OUT).map(t => ({...t, preview: fs.existsSync(path.join(dir, t.id + '.mp4')) ? `/api/montage/preview/${t.id}.mp4` : null})),
      caption_styles: M.CAPTION_STYLES, looks: Object.entries(M.LOOKS).map(([id, l]) => ({id, label: l.label}))};
  },
  montagePreview: async id => { const p = path.join(OUT, 'montage-templates', id + '.mp4'); return fs.existsSync(p) ? p : null; },
  // автомонтаж выбранных в приложении клипов (источники — файлы компьютера или загруженные): как пакет — карточка в галерее, ролик туда же
  montageAuto: async o => {
    const M = await import('./montage.js'), {sourcePath} = await import('./montage/project.js');
    const ctx = {outDir: OUT, uploadDir: path.join(OUT, 'montage-src'), restrict: true};
    const clips = (o.clips || []).slice(0, 8).map(s => sourcePath(s, ctx));
    if (!clips.length) throw new Error('нет клипов');
    const music = o.music ? sourcePath(o.music, ctx) : undefined;
    const q = o.quality === 'draft' ? 'draft' : 'final', n = Math.max(1, Math.min(4, +o.variants || 1));
    const pick = (v, list) => list.includes(v) ? v : undefined;
    const opts = {clips, music, duration: Math.min(60, Math.max(6, +o.duration || 20)), template: typeof o.template === 'string' ? o.template.slice(0, 40) : undefined,
      title: String(o.title || '').slice(0, 80) || undefined, hook: String(o.hook || '').slice(0, 90) || undefined, cta: String(o.cta || '').slice(0, 40) || undefined,
      items: Array.isArray(o.items) ? o.items.map(s => String(s).slice(0, 60)).filter(Boolean).slice(0, 5) : undefined,
      caption_style: pick(o.caption_style, M.CAPTION_STYLES), captions: o.captions !== false,
      look: o.look && M.LOOKS[o.look] ? {preset: o.look, vignette: true} : o.look === 'none' ? {preset: 'none'} : undefined,
      brand: o.brand ? {accent: o.brand.accent, font: o.brand.font} : undefined, aspect: pick(o.aspect, ['9:16', '1:1', '4:5', '16:9']),
      style: o.template ? undefined : 'titles', outDir: path.join(OUT, new Date().toISOString().slice(0, 10)), quality: q};
    const items = Array.from({length: n}, (_, i) => ({n: i + 1, prompt: `автомонтаж${o.template ? ' · ' + o.template : ''}${n > 1 ? ` · вариант ${i + 1}` : ''}`, kind: 'video', site: 'montage',
      siteLabel: q === 'draft' ? 'монтаж · черновик 540p' : 'монтаж на компьютере', status: 'running', message: 'в очереди', note: '', aspect: opts.aspect || '9:16', files: []}));
    const b = {id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, source: 'phone', created: Date.now(), done: false, pid: process.pid, items};
    batches.set(b.id, b);
    persistBatches();
    (async () => {
      for (const [i, it] of items.entries()) {
        try {
          const r = await M.montage({...opts, variant: i, ...(i === 2 && !opts.look ? {look: {preset: 'teal_orange', vignette: true}} : {}), onStatus: m => { it.message = m; persistBatches(); }});
          Object.assign(it, {status: 'done', message: '', model: `${r.width}×${r.height} · ${r.cuts} кусков · ${r.bpm} BPM`,
            note: [`${r.duration} с`, r.lufs != null && `${r.lufs} LUFS`, `${r.seconds} с рендера`, ...r.warnings].filter(Boolean).join(' · '), files: [{path: r.path, mime: r.mime}]});
        } catch (e) { Object.assign(it, {status: 'error', message: e.message}); }
        persistBatches();
      }
      b.done = true;
      persistBatches();
    })();
    return {id: b.id};
  },
  // биты трека (метки на таймлайне редактора и прилипание к ним)
  montageBeats: async o => {
    const {sourcePath} = await import('./montage/project.js'), A = await import('./montage/analyze.js');
    const file = sourcePath(o.src, {outDir: OUT, uploadDir: path.join(OUT, 'montage-src'), restrict: true});
    const b = await A.trackBeats(file, OUT);
    return {bpm: b.bpm, beats: b.beats, downbeats: b.downbeats, drop: A.findDrop(b), duration: b.duration};
  },
  // проект → FCPXML / OTIO / SRT (текстом — приложение сохранит файлы; клипы ссылаются на файлы этого компьютера)
  montageExport: async ({project, formats}) => {
    const E = await import('./montage/export.js'), {normalize} = await import('./montage/project.js');
    const ctx = {outDir: OUT, uploadDir: path.join(OUT, 'montage-src'), restrict: true}, P = await E.withAutoCaptions(normalize(project), ctx);
    const want = Array.isArray(formats) ? formats : ['fcpxml', 'otio', 'srt'];
    return {...(want.includes('fcpxml') ? {fcpxml: await E.fcpxml(P, ctx)} : {}), ...(want.includes('otio') ? {otio: await E.otio(P, ctx)} : {}),
      ...(want.includes('srt') && P.tracks.captions.words.length ? {srt: E.srt(P)} : {})};
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
