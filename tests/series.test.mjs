// «🚀 Серия роликов» у персонажа: одна кнопка → ИИ пишет 3 сценария → 3 кадра во Flow → 3 видео — всё само.
// Хаб — настоящий (pc/mcp/hub.js), компьютер (Flow) и Gemini — макеты; без компьютера — карточки в галерее.
import fs from 'node:fs';
import path from 'node:path';
import {suite, sleep, PC, ROOT, FIX, serveStatic} from './lib.mjs';

process.env.FREEFIELD_APP_LOCAL = '1';   // страница — из этой папки, не с GitHub Pages
const {startHub} = await import('../pc/mcp/hub.js');
const KEY = 'test-key-' + Date.now();
const PNG = path.join(FIX, 'ref.png'), MP4 = path.join(FIX, 'clip.mp4');
// компьютер: каждая пачка готова через секунду — кадр (png) или видео (mp4)
const batches = [], sent = [];
const api = {
  hello: async () => ({ok: true, name: 'Freefield', profiles: [{id: 1, name: 'Профиль 1'}], active: null, open: [], multi: false, unknown: 0, app: 1, mcp: false,
    lan: [], port: hub.address().port, features: ['update']}),
  list: async () => batches,
  submit: async list => {
    const b = {id: 'b' + batches.length, source: 'phone', created: Date.now(), done: false, items: list.map(s => ({...s, status: 'queued', files: []}))};
    batches.unshift(b); sent.push(list);
    setTimeout(() => {
      b.items.forEach((it, n) => Object.assign(it, {status: 'done', message: 'готово',
        files: [{url: `/api/file/${b.id}/${n}/0`, name: `freefield-${b.id}-${n}.${it.kind === 'image' ? 'png' : 'mp4'}`, mime: it.kind === 'image' ? 'image/png' : 'video/mp4'}]}));
      b.done = true;
    }, 1000);
    return {id: b.id};
  },
  filePath: async (id, n) => { const it = batches.find(b => b.id === id)?.items[n]; return it ? (it.kind === 'image' ? PNG : MP4) : null; },
};
const hub = await startHub({port: 0, host: '127.0.0.1', key: KEY, appDir: ROOT, api});
const base = `http://127.0.0.1:${hub.address().port}/`;

// Gemini: модель одна; сценариев — сколько просят в задании
const geminiCalls = [];
async function mockGemini(p) {
  await p.route(/generativelanguage\.googleapis\.com/, async r => {
    const u = new URL(r.request().url());
    if (r.request().method() === 'GET') return r.fulfill({json: {models: [{name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 65536}]}});
    const body = r.request().postDataJSON(), text = body.contents[0].parts.map(x => x.text || '').join('\n');
    geminiCalls.push(u.pathname);
    const n = +(text.match(/(\d+)\s+(?:different\s+)?(?:scenario|сценари)/i) || [0, 3])[1] || 3;
    const scenarios = Array.from({length: n}, (_, i) => ({title: `Ролик ${i + 1}`, angle: `угол ${i + 1}`, location: 'кухня', hook: 'привет', cta: 'подпишись',
      beats: [{time: '0-8s', action: 'машет', speech: 'привет'}], asset_prompt: `Hero in kitchen, take ${i + 1}, vertical 3:4`,
      caption: `подпись ${i + 1}`, video_prompt: `Scene ${i + 1}: the hero waves and says hello.`}));
    r.fulfill({json: {candidates: [{content: {parts: [{text: JSON.stringify({scenarios})}]}, finishReason: 'STOP'}]}});
  });
}
// персонаж с развёрткой и инфографикой, ключ Gemini
const setup = () => page => page.evaluate(async png => {
  wallet.gemini = 'AIza' + 'x'.repeat(35);
  vc.chars = [{id: 'ch-test', name: 'Тестовый', sheet: png, info: png, locs: [], voice: null}];
  await vc.saveChars();
  setCreateMode('chars'); renderChars();
}, 'data:image/png;base64,' + fs.readFileSync(PNG).toString('base64'));
async function startSeries(p, n) {
  await p.locator('[data-ch-series="ch-test"]').first().click();
  await p.locator(`#voiceSheet [data-ser-n="${n}"]`).click();
  const go = p.locator('#voiceSheet [data-ser-go]');
  const label = await go.innerText(), disabled = await go.isDisabled();
  await go.click();
  return {label, disabled};
}
const job = p => p.evaluate(() => { const j = serOf('ch-test'); return j && {stage: j.stage, note: j.note, hub: j.hub, rows: j.rows.length,
  frames: j.rows.filter(r => r.frame).length, videos: j.rows.filter(r => r.vstate === 'done').length}; });

await suite('серия роликов: 3 видео одной кнопкой', async t => {
  // 1. с компьютером — всё само
  const p = await t.page(PC, 'ПК');
  await mockGemini(p);
  await p.goto(`${base}?k=${KEY}`);
  await p.waitForFunction(() => hubLink.ok, null, {timeout: 15000}).catch(() => {});
  t.ok(await p.evaluate(() => hubLink.ok), 'компьютер на связи');
  await setup()(p); await sleep(500);
  t.ok(await p.locator('[data-ch-series="ch-test"]').count() > 0, 'у персонажа есть «🚀 Серия роликов»');
  const go = await startSeries(p, 3);
  t.ok(!go.disabled && /3 видео/.test(go.label), 'кнопка «▶ Запустить: 3 видео» доступна', go);
  await p.waitForFunction(() => serOf('ch-test')?.stage === 'done' || serOf('ch-test')?.stage === 'error', null, {timeout: 60000}).catch(() => {});
  const j = await job(p);
  t.ok(j?.stage === 'done', 'серия дошла до конца', j);
  t.ok(j?.rows === 3 && j.frames === 3 && j.videos === 3, '3 сценария, 3 кадра, 3 видео', j);
  t.ok(geminiCalls.length === 1, 'ИИ написал сценарии за один запрос', geminiCalls.length);
  const [frames, videos] = sent;
  t.ok(sent.length === 2, 'на компьютер ушли две пачки: кадры и видео', sent.length);
  t.ok(frames?.length === 3 && frames.every(s => s.kind === 'image' && s.service === 'flow' && s.aspect_ratio === '9:16' && s.images?.length === 1), 'кадры: 3 фото во Flow, 9:16, с развёрткой', frames);
  t.ok(videos?.length === 3 && videos.every(s => s.kind === 'video' && s.images?.length >= 1) && new Set(videos.map(s => s.prompt)).size === 3, 'видео: 3 разных сценария с первым кадром',
    videos?.map(s => ({kind: s.kind, service: s.service, imgs: s.images?.length, sheet: !!s.sheet})));
  await sleep(2000);
  const gal = await p.evaluate(() => ({video: items.filter(i => i.type === 'video').length, frames: (vc.char('ch-test').locs || []).length}));
  t.ok(gal.video === 3, '3 видео в галерее', gal);
  t.ok(gal.frames === 3, 'кадры остались у персонажа', gal);
  const ui = await p.locator('#voiceSheet').innerText();
  t.ok(/Серия готова/.test(ui) && /Скачать всё/.test(ui), 'окно серии: «✅ Серия готова» и «📦 Скачать всё»');
  await p.context().close();

  // 2. без компьютера — карточки кадров в галерее; загрузили кадры → карточки видео сами
  const q = await t.page(PC, 'без ПК');
  await mockGemini(q);
  const site = await serveStatic();   // как сайт на GitHub — программы на компьютере нет
  await q.goto(site.url); await sleep(1500);
  await setup()(q); await sleep(300);
  await startSeries(q, 3);
  await q.waitForFunction(() => serOf('ch-test')?.sentFrames, null, {timeout: 20000}).catch(() => {});
  const cards = await q.evaluate(() => { const j = serOf('ch-test'); return {hub: j?.hub, cards: j?.rows.filter(r => items.some(i => i.id === r.card)).length}; });
  t.ok(cards.hub === false && cards.cards === 3, 'без компьютера: 3 карточки кадров в галерее', cards);
  // «загрузили» кадры в карточки
  await q.evaluate(async () => {
    const blob = await (await fetch(vc.char('ch-test').sheet)).blob();
    for (const r of serOf('ch-test').rows) Object.assign(items.find(i => i.id === r.card), {status: 'done', blob});
  });
  await q.waitForFunction(() => serOf('ch-test')?.sentVideos, null, {timeout: 20000}).catch(() => {});
  const vc2 = await q.evaluate(() => { const j = serOf('ch-test'); return {stage: j.stage, cards: j.rows.filter(r => items.some(i => i.id === r.vcard && i.type === 'video')).length}; });
  t.ok(vc2.stage === 'video' && vc2.cards === 3, 'дальше само: 3 карточки видео', vc2);
  await q.context().close();
  site.close();
});
hub.close();
