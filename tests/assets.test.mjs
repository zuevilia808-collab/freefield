// «Фото»: «Развёртка героя» и «Создать инфографику» — готовый промпт сразу в поле, без [ПОЛЕЙ]; развёртка без фото героя не уходит
import {suite, serveStatic, sleep, PHONE, FIX} from './lib.mjs';

const site = await serveStatic();
const REF = FIX + 'ref.png';
await suite('фото: развёртка и инфографика', async t => {
  const p = await t.page(PHONE, 'телефон');
  await p.goto(site.url); await sleep(1200);
  await p.locator('#createMode [data-cm="one"]').tap(); await sleep(300);

  // инфографика: тема и заголовок — по желанию у каждой картинки
  await p.locator('#assetCreate [data-akind="info"]').tap(); await sleep(400);
  const info = await p.inputValue('#prompt');
  t.ok(/infographic/i.test(info) && !/\[[A-Z]/.test(info), 'инфографика: готовый промпт в поле', info.slice(0, 80));
  const [fc] = await Promise.all([p.waitForEvent('filechooser', {timeout: 3000}).catch(() => null), p.locator('#akindNums [data-an="2"]').tap()]);
  if (fc) await fc.setFiles([]);
  await sleep(500);
  await p.locator('#assetItems input[data-ai-i="0"][data-ai-f="TOPIC"]').fill('how to save money on groceries');
  await p.locator('#assetItems input[data-ai-i="0"][data-ai-f="HEADLINE"]').fill('5 простых способов');
  await p.locator('#genBtn').tap(); await sleep(1500);
  const cards = await p.evaluate(() => items.filter(i => i.status === 'external').sort((a, b) => a.phone.n - b.phone.n).map(i => i.finalPrompt));
  t.ok(cards.length === 2, 'инфографика: две карточки для сайтов', cards.length);
  t.ok(/Topic: how to save money on groceries/.test(cards[0]) && /"5 простых способов"/.test(cards[0]), 'инфографика: тема и заголовок попали в промпт');
  t.ok(/Choose yourself/.test(cards[1] || ''), 'инфографика: без темы — модель выбирает сама');

  // развёртка: промпт сразу; без фото героя — не уходит, место фото подсвечено
  await p.evaluate(() => { items.length = 0; render(); closeSheets(); setView('create'); }); await sleep(300);
  await p.locator('#assetCreate [data-akind="sheet"]').tap(); await sleep(400);
  const sheet = await p.inputValue('#prompt');
  t.ok(/turnaround sheet/i.test(sheet) && !/\[[A-Z]/.test(sheet), 'развёртка: готовый промпт в поле', sheet.slice(0, 80));
  const [fc2] = await Promise.all([p.waitForEvent('filechooser', {timeout: 3000}).catch(() => null), p.locator('#akindNums [data-an="1"]').tap()]);
  if (fc2) await fc2.setFiles([]);
  await sleep(400);
  await p.locator('#genBtn').tap(); await sleep(800);
  t.ok(await p.evaluate(() => !items.some(i => i.status === 'external') && !!$('#assetCreate .asset-item-ph.miss')), 'развёртка без фото героя: не уходит, фото подсвечено');
  await p.evaluate(() => setView('create')); await sleep(300);
  await t.choose(p, '#assetCreate [data-ai-ph="0"]', [REF]);
  await p.locator('#genBtn').tap(); await sleep(1200);
  t.ok(await p.evaluate(() => items.filter(i => i.status === 'external').length === 1), 'развёртка с фото героя: карточка для сайта');
});
site.close();
