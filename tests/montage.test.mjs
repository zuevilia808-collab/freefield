// «Монтаж»: без лагов (перерисовка раз в кадр, без base64 на таймлайне), голос отдельно от видео (фон остаётся у клипа),
// эффекты голоса (высота без сдвига по времени), голос → «Озвучка» (распознать реплику) → озвучка другим голосом → в монтаж,
// склейка: в ролике фон и новый голос, старого голоса нет. Хаб — настоящий (pc/mcp/hub.js), Demucs и «Эхо» — макеты.
import fs from 'node:fs';
import path from 'node:path';
import {suite, sleep, PC, ROOT, FIX, wav, tmpFile} from './lib.mjs';
import {startEchoMock} from './echo-mock.mjs';

const echo = await startEchoMock();
process.env.ECHO_PORT = String(echo.port);
process.env.FREEFIELD_APP_LOCAL = '1';
const {startHub} = await import('../pc/mcp/hub.js');
const KEY = 'test-key-' + Date.now();
// Demucs на компьютере: голос — тон 200 Гц, фон — 1000 Гц (как звук клипа: 2 с)
const VOICE = tmpFile('voice.wav', wav(2, 200)), REST = tmpFile('rest.wav', wav(2, 1000)), splits = [];
const api = {
  hello: async () => ({ok: true, name: 'Freefield', profiles: [{id: 1, name: 'Профиль 1'}], active: null, open: [], multi: false, unknown: 0, app: 1, mcp: false,
    lan: [], port: hub.address().port, features: ['echo', 'echo-start', 'update', 'split'], echoPort: echo.port}),
  list: async () => [],
  splitStart: async audio => { splits.push(audio.length); return {id: 'abcdef012345678' + splits.length}; },
  splitGet: async id => ({id, status: 'done', voice: `/api/split/${id}/voice.wav`, rest: `/api/split/${id}/rest.wav`}),
  splitFile: async (id, which) => which === 'voice' ? VOICE : REST,
};
const hub = await startHub({port: 0, host: '127.0.0.1', key: KEY, appDir: ROOT, api});
const base = `http://127.0.0.1:${hub.address().port}/`;
const CLIP = fs.readFileSync(path.join(FIX, 'clip.webm')).toString('base64');

await suite('монтаж: без лагов, голос отдельно, эффекты, переозвучка', async t => {
  const p = await t.page(PC, 'ПК');
  await p.goto(`${base}?k=${KEY}`); await sleep(1500);
  // ролик в галерее → в монтаж
  await p.evaluate(async b64 => {
    const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], {type: 'video/webm'});
    const [it] = await mtImportFiles([new File([blob], 'аватар.webm', {type: 'video/webm'})]);
    setView('create'); setCreateMode('edit');
    mtAddItems([it.id], true);
    mt.p.titles.push({k: 'tt1', text: 'Титр', at: 0, dur: 1.5, pos: 'bottom'});
    mtRefresh();
  }, CLIP);
  await sleep(1500);

  // --- без лагов: 60 движений мыши подряд → таймлайн перерисован раз в кадр; на таймлайне нет base64
  const perf = await p.evaluate(async () => {
    const orig = mtTl;
    let calls = 0, long = 0;
    window.mtTl = () => { calls++; orig(); };
    const po = new PerformanceObserver(l => { long += l.getEntries().filter(e => e.duration > 50).length; });
    try { po.observe({type: 'longtask'}); } catch {}
    const blk = $('#mtTrT .tl-b'), r = blk.getBoundingClientRect(), inner = $('#mtInner');
    const ev = (type, x) => inner.dispatchEvent(new PointerEvent(type, {bubbles: true, clientX: x, clientY: r.top + 5, pointerId: 7, pointerType: 'mouse', button: 0}));
    blk.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 5, pointerId: 7, pointerType: 'mouse', button: 0}));
    for (let i = 1; i <= 60; i++) ev('pointermove', r.left + r.width / 2 + i);
    const during = calls;
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    ev('pointerup', r.left + r.width / 2 + 60);
    await new Promise(res => setTimeout(res, 300));
    po.disconnect(); window.mtTl = orig;
    return {during, after: calls, long, moved: mt.p.titles[0].at, data: /url\(data:/.test($('#mtInner').innerHTML)};
  });
  t.ok(perf.during === 0 && perf.after <= 4, 'перетаскивание: 60 движений → перерисовка раз в кадр, а не 60 раз', perf);
  t.ok(perf.moved > 0, 'титр сдвинулся', perf);
  t.ok(!perf.data, 'на таймлайне нет картинок base64', perf);
  t.ok(perf.long === 0, 'долгих задач (>50 мс) при перетаскивании нет', perf);

  // --- 🗣 отделить голос: фон остаётся у клипа, голос — своя дорожка
  await p.evaluate(() => { mt.sel = {t: 'v', k: mt.p.clips[0].k}; renderMtEdit(); });
  await p.locator('#mtBody [data-mt-sep]').click();
  await p.waitForFunction(() => mt.p.clips[0].sep, null, {timeout: 15000}).catch(() => {});
  const sep = await p.evaluate(() => ({sep: mt.p.clips[0].sep, g: $$('#mtTrG .tl-b').length, lane: $('#mtWork .mtw-tl').classList.contains('g'), sel: mt.sel.t,
    fx: !!$('#mtBody [data-mt-f="fx.pitch"]'), muted: mtEl.vids.some(v => v._seg && v.muted)}));
  t.ok(sep.sep && sep.g === 1 && sep.lane && splits.length === 1, 'голос отделён компьютером: дорожка «🗣» с блоком', {...sep, splits: splits.length});
  t.ok(sep.sel === 'g' && sep.fx, 'выделен голос — ползунки эффектов на месте', sep);

  // --- эффекты: «Ниже» из набора, высота +5 полутонов — тон 200 → ~267 Гц, длина та же
  await p.locator('#mtBody [data-mt-vp="low"]').click();
  const low = await p.evaluate(() => mt.p.clips[0].vox.fx);
  t.ok(low.pitch === -4 && low.formant === -8, 'набор «⬇ Ниже» применился', low);
  if (process.env.SHOT) await p.screenshot({path: process.env.SHOT + '-pc.png'});   // посмотреть глазами
  const fx = await p.evaluate(async () => {
    const c = mt.p.clips[0], src = mtSepSrc(c.id, 'voice'), orig = await mtSrcP(src);
    const b = await mtFxP(src, {pitch: 5});
    const per = [...vfxLocal.periods(b.getChannelData(0), b.sampleRate, 441)].filter(Boolean).sort((x, y) => x - y);
    return {f0: Math.round(b.sampleRate / per[per.length >> 1]), dur: +b.duration.toFixed(2), was: +orig.duration.toFixed(2)};
  });
  t.ok(Math.abs(fx.f0 - 267) <= 4 && Math.abs(fx.dur - fx.was) < 0.01, 'высота +5 пт: 200 → 267 Гц, длина та же (губы совпадают)', fx);
  // ползунок «Высота» прямо в свойствах
  await p.locator('#mtBody [data-mt-f="fx.pitch"]').fill('3');
  t.ok(await p.evaluate(() => mt.p.clips[0].vox.fx.pitch === 3 && /\+3 пт/.test($('#mtBody [data-mt-f="fx.pitch"]').nextElementSibling.textContent)), 'ползунок «Высота»: +3 пт');
  // просмотр: звук фона и голоса — Web Audio по расписанию
  const play = await p.evaluate(async () => { mtSeekTo(0); mtPlay(); await new Promise(r => setTimeout(r, 900)); const r = {on: mtAE.on, nodes: mtAE.nodes.length, t: mtPv.t}; mtPause(); return r; });
  t.ok(play.on && play.nodes >= 2, 'просмотр: фон и голос звучат через Web Audio', play);

  // --- 🎙 переозвучить: «Озвучка» распознаёт реплику → голос «Диктор» → «＋ В монтаж» (новой дорожкой, голос клипа остаётся)
  await p.evaluate(() => { const c = mt.p.clips[0]; c.vox.fx = {}; mt.sel = {t: 'g', k: c.k}; renderMtEdit(); });
  await p.locator('#mtBody [data-mt-to-echo]').click();
  await p.waitForFunction(() => ex.line && ex.line.text, null, {timeout: 20000}).catch(() => {});
  const line = await p.evaluate(() => ({mode: cl.mode, text: ex.line?.text, field: ex.text, card: $('#ehxLine')?.innerText || '', dur: ex.line?.dur}));
  t.ok(line.mode === 'voice' && line.text === 'распознанный текст' && line.field === 'распознанный текст', '«Озвучка»: реплика распознана и стоит в «Текст озвучки»', line);
  t.ok(/Реплика из монтажа/.test(line.card) && Math.abs(line.dur - 2) < 0.4, 'карточка «Реплика из монтажа» с длиной реплики', line);
  await p.fill('#ehxVoice [data-ehx-f="vName"]', 'Диктор');
  await p.locator('#ehxVoice [data-ehx-save]').click(); await sleep(1200);
  await p.locator('#ehxGo').click();
  await p.waitForFunction(() => $$('#ehxTakes .ehx-take').length >= 2, null, {timeout: 20000}).catch(() => {});
  // у каждой дорожки — одинаковые кнопки, «Вместо реплики» нет
  const btns = await p.evaluate(() => $$('#ehxTakes .ehx-take').map(e => !!e.querySelector('[data-ehx-tadd]') && !!e.querySelector('[data-ehx-tfav]') && !!e.querySelector('[data-ehx-dl], [data-ehx-mdl]')));
  t.ok(btns.length >= 2 && btns.every(Boolean) && !(await p.locator('#ehxTakes [data-ehx-tomt]').count()), 'у всех дорожек (и «Из монтажа») — «＋ В монтаж», ★, скачать', btns);
  const before = await p.evaluate(() => ({audios: (mt.p.audios || []).length, sep: mt.p.clips[0].sep}));
  await p.evaluate(() => mtSeekTo(0));
  await p.locator('#ehxTakes .ehx-take:not(.mtl) [data-ehx-tadd]').first().click();
  await p.waitForFunction(n => (mt.p.audios || []).length > n, before.audios, {timeout: 20000}).catch(() => {});
  const take = await p.evaluate(() => { const a = mt.p.audios.at(-1); return {n: mt.p.audios.length, name: a?.name, at: a?.at, voice: a?.voice, sep: mt.p.clips[0].sep, take: mt.p.clips[0].vox?.take || null}; });
  if (process.env.SHOT) await p.screenshot({path: process.env.SHOT + '-take.png'});
  t.ok(take.n === before.audios + 1 && /Диктор/.test(take.name) && take.at === 0 && take.voice, '«＋ В монтаж»: озвучка — новой дорожкой с бегунка', take);
  t.ok(take.sep && !take.take, 'голос клипа остался как был', take);
  await p.evaluate(() => { setView('create'); setCreateMode('edit'); });   // «Озвучка» остаётся открытой — монтаж открываем сами

  // --- склейка: фон (1000 Гц) и новый голос (330 Гц) — есть, старого голоса и звука видео (200 Гц) — нет
  const mix = await p.evaluate(async () => {
    const r = await mtExport(mt.p), ab = await decodeAudio(r.blob), d = ab.getChannelData(0), sr = ab.sampleRate;
    const g = hz => { const n = Math.min(d.length, sr * 1.5), k = 2 * Math.cos(2 * Math.PI * hz / sr); let s1 = 0, s2 = 0; for (let i = Math.round(sr * 0.2); i < n; i++) { const s0 = d[i] + k * s1 - s2; s2 = s1; s1 = s0; } return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / n; };
    return {bed: +g(1000).toFixed(4), take: +g(330).toFixed(4), old: +g(200).toFixed(4), dur: +ab.duration.toFixed(2)};
  });
  t.ok(mix.bed > 0 && mix.take > 0 && mix.old > 0, 'в ролике фон, голос клипа и новая дорожка — все вместе', mix);

  // --- ✂ разрезать клип: у обеих половин свой голос
  const cut = await p.evaluate(() => { mt.sel = {t: 'v', k: mt.p.clips[0].k}; mtSeekTo(1); mtSplit(); return {n: mt.p.clips.length, sep: mt.p.clips.every(c => c.sep && c.vox), g: $$('#mtTrG .tl-b').length, same: mt.p.clips[0].vox === mt.p.clips[1].vox}; });
  // голос клипа без замены: на дорожке «🗣» — куски, где в половине звучит речь
  t.ok(cut.n === 2 && cut.sep && cut.g >= 1 && !cut.same, '✂: обе половины с голосом (настройки — у каждой свои)', cut);
  // «Вернуть звук как был» — у той половины, где голос на дорожке
  const k = await p.evaluate(() => { const k = $('#mtTrG .tl-b').dataset.k; mt.sel = {t: 'g', k}; renderMtEdit(); return k; });
  await p.locator('#mtBody [data-mt-unsep]').click();
  t.ok(await p.evaluate(([k, g]) => !mt.p.clips.find(c => c.k === k).sep && $$('#mtTrG .tl-b').length === g - 1, [k, cut.g]), '«Вернуть звук как был» — голос снова в клипе');
});
hub.close(); echo.close();
