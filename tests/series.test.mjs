// «🚀 Серия роликов» у персонажа: одна кнопка → ИИ пишет 3 сценария → 3 кадра во Flow → 3 видео — всё само.
// Только фото героя → серия сама делает развёртку и инфографику; «🎧 Голос персонажа» → голос меняется, звуки места остаются.
// Хаб — настоящий (pc/mcp/hub.js), компьютер (Flow, Demucs), Gemini и Seed-VC — макеты; без компьютера — карточки в галерее.
import fs from 'node:fs';
import path from 'node:path';
import {suite, sleep, PC, ROOT, FIX, serveStatic, wav, tmpFile} from './lib.mjs';

process.env.FREEFIELD_APP_LOCAL = '1';   // страница — из этой папки, не с GitHub Pages
const {startHub} = await import('../pc/mcp/hub.js');
const KEY = 'test-key-' + Date.now();
const PNG = path.join(FIX, 'ref.png'), CLIP = path.join(FIX, 'clip.webm');
// компьютер: каждая пачка готова через секунду — кадр (png) или видео (mp4)
const batches = [], sent = [];
// разделение звука (Demucs на компьютере): голос — тон 200 Гц, фон — тон 1000 Гц
const VOICE = tmpFile('voice.wav', wav(2, 200)), REST = tmpFile('rest.wav', wav(2, 1000)), splits = [];
const api = {
  hello: async () => ({ok: true, name: 'Freefield', profiles: [{id: 1, name: 'Профиль 1'}], active: null, open: [], multi: false, unknown: 0, app: 1, mcp: false,
    lan: [], port: hub.address().port, features: ['update', 'split']}),
  list: async () => batches,
  submit: async list => {
    const b = {id: 'b' + batches.length, source: 'phone', created: Date.now(), done: false, items: list.map(s => ({...s, status: 'queued', files: []}))};
    batches.unshift(b); sent.push(list);
    setTimeout(() => {
      b.items.forEach((it, n) => Object.assign(it, {status: 'done', message: 'готово',
        files: [{url: `/api/file/${b.id}/${n}/0`, name: `freefield-${b.id}-${n}.${it.kind === 'image' ? 'png' : 'webm'}`, mime: it.kind === 'image' ? 'image/png' : 'video/webm'}]}));
      b.done = true;
    }, 1000);
    return {id: b.id};
  },
  splitStart: async audio => { if (!/^data:audio\/wav;base64,/.test(audio)) throw new Error('нужен WAV'); splits.push(audio.length); return {id: 'abcdef012345678' + splits.length}; },
  splitGet: async id => ({id, status: 'done', voice: `/api/split/${id}/voice.wav`, rest: `/api/split/${id}/rest.wav`}),
  splitFile: async (id, which) => which === 'voice' ? VOICE : REST,
  filePath: async (id, n) => { const it = batches.find(b => b.id === id)?.items[n]; return it ? (it.kind === 'image' ? PNG : CLIP) : null; },
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
// Seed-VC на Hugging Face: новый голос — тон 300 Гц
const vcCalls = [];
async function mockSeedVc(p) {
  await p.route(/plachta-seed-vc\.hf\.space/, async r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/config') return r.fulfill({json: {components: [{id: 1, type: 'audio'}, {id: 2, type: 'audio'}, {id: 3, type: 'slider', props: {label: 'Diffusion Steps', maximum: 50, value: 10}}],
      dependencies: [{id: 0, api_name: 'convert', inputs: [1, 2, 3]}]}});
    if (u.pathname === '/gradio_api/upload') return r.fulfill({json: ['/tmp/in.wav']});
    if (u.pathname === '/gradio_api/queue/join') { vcCalls.push(r.request().postDataJSON().data); return r.fulfill({json: {event_id: 'e1'}}); }
    if (u.pathname === '/gradio_api/queue/data') return r.fulfill({contentType: 'text/event-stream', body:
      'data: {"msg":"process_starts"}\n\ndata: {"msg":"process_completed","success":true,"output":{"data":[{"url":"https://plachta-seed-vc.hf.space/file=out.wav"}]}}\n\n'});
    if (u.pathname === '/file=out.wav') return r.fulfill({body: wav(2, 300), contentType: 'audio/wav'});
    r.fulfill({status: 404, body: ''});
  });
}
// персонаж с развёрткой и инфографикой, ключ Gemini
const setup = () => page => page.evaluate(async png => {
  wallet.gemini = 'AIza' + 'x'.repeat(35);
  vc.chars = [{id: 'ch-test', name: 'Тестовый', sheet: png, info: png, locs: [], voice: null}];
  await vc.saveChars();
  setCreateMode('chars'); renderChars();
}, 'data:image/png;base64,' + fs.readFileSync(PNG).toString('base64'));
async function startSeries(p, n, open = true) {
  if (open) await p.locator('[data-ch-series="ch-test"]').first().click();
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

  // 3. только фото героя и образец голоса: серия сама — развёртка и инфографика → сценарии → кадры → видео → голос персонажа
  sent.length = 0; geminiCalls.length = 0;
  const v = await t.page(PC, 'фото и голос');
  await mockGemini(v); await mockSeedVc(v);
  await v.goto(`${base}?k=${KEY}`);
  await v.waitForFunction(() => hubLink.ok, null, {timeout: 15000}).catch(() => {});
  await v.evaluate(async ([png, smp]) => {
    wallet.gemini = 'AIza' + 'x'.repeat(35);
    vc.chars = [{id: 'ch-test', name: 'Фотограф', photo: png, locs: [], voice: null, sample: smp, sampleSec: 2}];
    await vc.saveChars();
    setCreateMode('chars'); renderChars();
  }, ['data:image/png;base64,' + fs.readFileSync(PNG).toString('base64'), 'data:audio/wav;base64,' + wav(2, 150).toString('base64')]);
  await v.locator('[data-ch-series="ch-test"]').first().click();
  const setupUi = await v.locator('#voiceSheet').innerText();
  t.ok(/Сначала Flow сделает развёртку и инфографику по фото/.test(setupUi), 'только фото: серия сама сделает развёртку и инфографику', setupUi.slice(0, 300));
  t.ok(await v.locator('#voiceSheet [data-ser-voice="char"].on').count() === 1, 'голос персонажа выбран сам, раз есть образец');
  const go2 = await startSeries(v, 2, false);
  t.ok(!go2.disabled, 'с одним фото кнопка доступна', go2);
  await v.waitForFunction(() => ['done', 'error'].includes(serOf('ch-test')?.stage), null, {timeout: 90000}).catch(() => {});
  const j3 = await v.evaluate(() => { const j = serOf('ch-test'), c = vc.char('ch-test'); return {stage: j.stage, note: j.note, split: j.split, vv: j.rows.filter(r => r.vv).length,
    sheet: !!c.sheet, info: !!c.info, voiced: items.filter(i => i.voiceOf === 'Фотограф').length}; });
  t.ok(j3.stage === 'done' && j3.vv === 2 && j3.split === true, 'серия дошла до конца, голос заменён в 2 роликах, фон отделён', j3);
  t.ok(j3.sheet && j3.info, 'развёртка и инфографика остались у персонажа', j3);
  const [prep] = sent;
  t.ok(prep?.length === 2 && prep[0].aspect_ratio === '16:9' && prep[1].aspect_ratio === '9:16' && prep.every(x => x.images?.length === 1) && /turnaround/i.test(prep[0].prompt) && /infographic/i.test(prep[1].prompt),
    'сначала на компьютер: развёртка 16:9 и инфографика 9:16 по фото', prep?.map(x => x.aspect_ratio));
  t.ok(sent.length === 3, 'пачки: подготовка, кадры, видео', sent.length);
  t.ok(splits.length === 2 && vcCalls.length === 2, 'на каждый ролик: разделение на компьютере и замена голоса', {splits: splits.length, vc: vcCalls.length});
  t.ok(j3.voiced === 2, 'в галерее 2 ролика с голосом персонажа (исходные остались)', j3);
  // в новом звуке — и новый голос (300 Гц), и фон (1000 Гц)
  const band = await v.evaluate(async () => {
    const it = items.find(i => i.voiceOf === 'Фотограф'), ab = await decodeAudio(it.blob);
    const at = async hz => { const off = new OfflineAudioContext(1, ab.length, ab.sampleRate), s = off.createBufferSource(), f = off.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = hz; f.Q.value = 30; s.buffer = ab; s.connect(f).connect(off.destination); s.start(); return rms(await off.startRendering()); };
    return {voice: await at(300), rest: await at(1000), old: await at(200), total: rms(ab)};
  });
  t.ok(band.voice > 0.02 && band.rest > 0.02, 'в ролике новый голос и звуки места', band);
  const ui3 = await v.locator('#voiceSheet').innerText();
  t.ok(/Голос/.test(ui3) && /голос персонажа — в 2 из 2/.test(ui3), 'окно серии: шаг «Голос» и итог', ui3.slice(0, 400));
  await v.context().close();
});
hub.close();
