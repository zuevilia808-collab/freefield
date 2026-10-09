// «Озвучка» — «Эхо» внутри Freefield через хаб программы на ПК: голос из записи → сохранить → озвучить; ПК и телефон.
// Хаб — настоящий (pc/mcp/hub.js), «Эхо» — макет; браузер к «Эхо» напрямую не ходит.
import fs from 'node:fs';
import path from 'node:path';
import {suite, sleep, PC, PHONE, ROOT, wav, tmpFile} from './lib.mjs';
import {startEchoMock} from './echo-mock.mjs';

const echo = await startEchoMock();
process.env.ECHO_PORT = String(echo.port);
process.env.FREEFIELD_APP_LOCAL = '1';   // страница — из этой папки, не с GitHub Pages
const {startHub} = await import('../pc/mcp/hub.js');
const KEY = 'test-key-' + Date.now();
const api = {
  hello: async () => ({ok: true, name: 'Freefield', profiles: [{id: 1, name: 'Профиль 1'}], active: null, open: [], multi: false, unknown: 0, app: 1, mcp: false,
    lan: ['192.168.50.5'], port: hub.address().port, features: ['echo', 'echo-start', 'update'], echoPort: echo.port}),
  list: async () => [],
};
const hub = await startHub({port: 0, host: '127.0.0.1', key: KEY, appDir: ROOT, api});
const base = `http://127.0.0.1:${hub.address().port}/`;
const REC = tmpFile('record.wav', wav(6));

await suite('озвучка: «Эхо» через хаб', async t => {
  const p = await t.page(PC, 'ПК');
  await p.goto(base); await sleep(1500);
  await p.locator('#createMode [data-cm="voice"]').click();
  await p.waitForFunction(() => eh.state === 'ok', null, {timeout: 20000}).catch(() => {});
  t.ok(await p.evaluate(() => eh.state === 'ok'), 'ПК: «Эхо» на связи');
  t.ok(await p.evaluate(() => $('#echoWork').parentElement.id === 'work'), 'ПК: «Эхо» справа, вместо галереи');
  t.ok(await p.evaluate(() => $('#pcBtn').dataset.pc === 'ok'), 'ПК: точка «● Компьютер» зелёная');
  // 1. запись с голосом → отрезок → голос
  await t.choose(p, '#ehxDrop', [REC]);
  await p.waitForFunction(() => !!ex.up, null, {timeout: 15000}).catch(() => {});
  t.ok(await p.evaluate(() => !!ex.up), 'ПК: запись загружена');
  await p.locator('#ehxCut').click();
  await p.waitForFunction(() => !!ex.voice, null, {timeout: 20000}).catch(() => {});
  t.ok(await p.evaluate(() => !!ex.voice), 'ПК: голос вырезан');
  // 2. сохранить под именем
  await p.fill('#ehxVoice [data-ehx-f="vName"]', 'Паша');
  await p.locator('#ehxVoice [data-ehx-save]').click(); await sleep(1500);
  t.ok(/Паша/.test(await p.locator('#ehxVoice .ehx-chips').innerText()), 'ПК: голос «Паша» в «Моих голосах»');
  // 3. озвучка, два варианта
  await p.fill('#ehxSpeak [data-ehx-f="text"]', 'я лечу!');
  await p.locator('#ehxSpeak [data-ehx-takes="2"]').click();
  await p.locator('#ehxGo').click();
  await p.waitForFunction(() => !ex.speak && ex.hist.length >= 2, null, {timeout: 20000}).catch(() => {});
  t.ok(await p.evaluate(() => ex.hist.length >= 2) && echo.history.length === 2, 'ПК: два варианта озвучки');
  await p.locator('#ehxTakes .ehx-play').first().click(); await sleep(800);
  t.ok(await p.evaluate(() => !exAud.paused), 'ПК: озвучка играет');
  await p.context().close();

  // телефон по ссылке из QR: сразу «Озвучка», всё в панели, без прокрутки вбок
  const ph = await t.page(PHONE, 'телефон');
  await ph.goto(`${base}?k=${KEY}#voice`);
  await ph.waitForFunction(() => typeof eh !== 'undefined' && eh.state === 'ok' && ex.hist.length, null, {timeout: 20000}).catch(() => {});
  const st = await ph.evaluate(() => ({mode: cl.mode, slot: $('#echoWork').parentElement.id, w: document.documentElement.scrollWidth, takes: $$('#ehxTakes .ehx-take').length}));
  t.ok(st.mode === 'voice' && st.slot === 'ehSlot' && st.w <= 390 && st.takes >= 2, 'телефон: «Озвучка» в панели, озвучки видны', st);
  await ph.context().close();

  // связка по QR: Freefield с GitHub на телефоне запоминает компьютер и ходит к нему по Wi-Fi (192.168.50.5 → этот хаб)
  const pc = await t.page(PC, 'ПК-QR');
  await pc.goto(base); await sleep(1500);
  const pair = await pc.evaluate(() => echoPairUrl());
  await pc.context().close();
  t.ok(/^https:\/\/zuevilia808-collab\.github\.io\/freefield\/#pc=192\.168\.50\.5:\d+&k=[^&]+&to=voice$/.test(pair), 'QR: ссылка на сайт с адресом компьютера', pair.replace(/k=[^&]+/, 'k=***'));
  const gh = await t.page({...PHONE, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36'}, 'телефон-GitHub');
  await gh.context().route(/^https:\/\/zuevilia808-collab\.github\.io\/freefield\//, r => {
    const rel = new URL(r.request().url()).pathname.replace(/^\/freefield\//, '') || 'index.html', f = path.join(ROOT, rel);
    if (!/^[\w./-]+$/.test(rel) || rel.includes('..') || !fs.existsSync(f)) return r.fulfill({status: 404, body: ''});
    r.fulfill({body: fs.readFileSync(f), contentType: {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json'}[path.extname(f)] || 'image/png'});
  });
  await gh.context().route(/^http:\/\/192\.168\.50\.5:\d+\//, async r => r.fulfill({response: await r.fetch({url: r.request().url().replace('192.168.50.5', '127.0.0.1')})}));
  await gh.goto('about:blank'); await gh.goto(pair);
  await gh.waitForFunction(() => typeof eh !== 'undefined' && eh.state === 'ok' && ex.hist.length, null, {timeout: 20000}).catch(() => {});
  const lan = await gh.evaluate(() => ({viaLan: hubLink.viaLan, mode: cl.mode, takes: $$('#ehxTakes .ehx-take').length, saved: !!ls.get('freefield.pcLan', null), host: location.host}));
  t.ok(lan.host === 'zuevilia808-collab.github.io' && lan.viaLan && lan.mode === 'voice' && lan.takes >= 2 && lan.saved, 'QR: сайт с GitHub работает с компьютером напрямую', lan);
  await gh.locator('#ehPhone [data-eh-unpair]').tap(); await sleep(800);
  t.ok(await gh.evaluate(() => !ls.get('freefield.pcLan', null)), '«Забыть компьютер»');
  await gh.goto('https://zuevilia808-collab.github.io/freefield/#pc=evil.com:80&k=x&to=voice'); await sleep(1500);
  t.ok(await gh.evaluate(() => !ls.get('freefield.pcLan', null)), 'чужой адрес в ссылке не запоминается');
  await gh.context().close();

  // браузер к «Эхо» напрямую не ходил; всё — через хаб и без Origin
  t.ok(echo.seen.length > 5 && echo.seen.every(x => !x.origin), 'к «Эхо» ходил только хаб', echo.seen.filter(x => x.origin));
  // чтение файлов по пути через хаб закрыто
  const r = await fetch(`${base}api/echo/api/upload-path?k=${KEY}`, {method: 'POST', body: '{}'});
  t.ok(r.status === 403, 'upload-path через хаб закрыт', r.status);
});
hub.close(); echo.close();
