// Окна выбора файлов во всех разделах и ключи ИИ в «Настройках»
import {suite, serveStatic, sleep, PC, FIX, wav, tmpFile} from './lib.mjs';

const site = await serveStatic();
// образец голоса — латиницей: файл с кириллицей в имени Playwright в страницу не передаёт
const REF = FIX + 'ref.png', VOICE = tmpFile('voice.wav', wav(5));
await suite('выбор файлов и ключи', async t => {
  const p = await t.page(PC, 'ПК');
  await p.goto(site.url); await sleep(1200);
  // «Сценарии»: инфографика (один файл) и кадры (несколько)
  await p.evaluate(() => setCreateMode('write')); await sleep(300);
  t.ok(await t.choose(p, '#writeCreate [data-wslot="info"]', [REF]), 'сценарии: окно выбора инфографики');
  await t.choose(p, '#writeCreate [data-wslot="loc"]', [REF, REF]);
  t.ok(await p.evaluate(() => !!wr.info && wr.locs.length === 2), 'сценарии: инфографика и два кадра на месте');
  // «Видео»: фото сценария
  await p.evaluate(() => { wr.locs = []; setCreateMode('scn'); renderScn(); }); await sleep(300);
  await t.choose(p, '[data-ref-add]', [REF]);
  t.ok(await p.evaluate(() => !!cl.scn[0].ref), 'видео: фото у сценария');
  // персонаж: развёртка, кадры, образец голоса
  await p.evaluate(() => { setCreateMode('chars'); vcOpenChar(null, 'chars'); }); await sleep(400);
  await t.choose(p, '#vcBody [data-vc-sheet]', [REF]);
  await t.choose(p, '#vcBody [data-vc-img="locs"]', [REF, REF, REF]);
  t.ok(await p.evaluate(() => !!vcUi.edit?.sheet && vcUi.edit.locs.length === 3), 'персонаж: развёртка и три кадра');
  await t.choose(p, '#vcBody [data-vc-sample]', [VOICE]); await sleep(1500);
  t.ok(await p.evaluate(() => vcUi.edit?.sampleSec >= 4), 'персонаж: образец голоса из файла');
  await p.evaluate(() => closeSheets());
  t.ok(await t.choose(p, '#charsCreate [data-ch-import]', [REF]), 'персонаж из файла: окно выбора');
  // ключи в «Настройках»
  await p.evaluate(() => closeSheets());
  await p.locator('#settingsBtn').click(); await sleep(300);
  await p.locator('#setKeys [data-wkey-in="claude"]').fill('abc'); await p.locator('#setKeys [data-wkey-save="claude"]').click(); await sleep(300);
  t.ok(await p.$$eval('.toast', ts => ts.some(x => /sk-ant-/.test(x.textContent))), 'Claude: ключ не того вида не принимается');
  await p.locator('#setKeys [data-wkey-in="gemini"]').fill('AQ.' + 'x'.repeat(30)); await p.locator('#setKeys [data-wkey-in="gemini"]').press('Enter'); await sleep(1500);
  t.ok(await p.evaluate(() => !wallet.gemini), 'Gemini: без ответа Google ключ не сохраняется');
  await p.evaluate(() => { wallet.gemini = 'AQ.test'; ls.set('freefield.gemini', 'AQ.test'); renderWallet(); });
  await p.locator('#setKeys [data-wkey-del="gemini"]').click(); await sleep(300);
  t.ok(await p.evaluate(() => wallet.gemini === '' && localStorage.getItem('freefield.gemini') === null && !!$('#setKeys [data-wkey-in="gemini"]')), 'Gemini: «Удалить ключ»');
});
site.close();
