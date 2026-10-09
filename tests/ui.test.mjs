// Навигация и верхняя полоса: колонка разделов, «● Компьютер», «Аккаунты», «Настройки», ⟨/⟩, три шага первого запуска
import {suite, serveStatic, sleep, PC, PHONE} from './lib.mjs';

const ORDER = 'Персонажи → Фото → Сценарии → Видео → Монтаж → Озвучка → 3D';
const site = await serveStatic();
await suite('интерфейс: разделы, верхняя полоса, первый запуск', async t => {
  for (const [dev, vp] of [['ПК', PC], ['телефон', PHONE]]) {
    const pc = dev === 'ПК', p = await t.page(vp, dev);
    await p.goto(site.url); await sleep(1500);
    const cm = await p.evaluate(() => ({parent: $('#createMode').parentElement.className, rail: $('#createMode').classList.contains('rail'),
      order: [...$$('#createMode [data-cm]')].map(b => b.textContent.trim()).join(' → '), mode: cl.mode}));
    t.ok(cm.order === ORDER, `${dev}: порядок разделов`, cm.order);
    t.ok(cm.mode === 'chars', `${dev}: новый пользователь начинает с «Персонажей»`, cm.mode);
    t.ok(pc ? cm.parent === 'layout' && cm.rail : cm.parent === 'panel-scroll' && !cm.rail, `${dev}: разделы ${pc ? 'колонкой слева' : 'сеткой в панели'}`, cm);
    await p.locator('#createMode [data-cm="edit"]').click(); await sleep(300);
    t.ok(await p.evaluate(() => cl.mode === 'edit'), `${dev}: переключение разделов нажатием`);
    await p.evaluate(() => setCreateMode('chars'));
    // верхняя полоса
    const top = await p.$$eval('.top-right > button', bs => bs.filter(b => b.offsetParent).map(b => b.id));
    t.ok(['pcBtn', 'accBtn', 'settingsBtn'].every(id => top.includes(id)), `${dev}: сверху «● Компьютер», «Аккаунты», ⚙`, top);
    await p.locator('#pcBtn').click(); await sleep(1500);
    t.ok(await p.evaluate(() => $('#pcBtn').dataset.pc === 'none'), `${dev}: без программы — точка серая`);
    t.ok(await p.$$eval('.toast', ts => ts.some(x => /не найдена|не подключён/.test(x.textContent))), `${dev}: «● Компьютер» говорит, что делать`);
    await p.locator('#accBtn').click(); await sleep(400);
    const acc = await p.evaluate(() => ({title: $('#accSheet h2').textContent, sites: $$('#hubBody .hub-row').length}));
    t.ok(acc.title === 'Аккаунты' && acc.sites > 10, `${dev}: «Аккаунты» — профили и сайты с кредитами вместе`, acc);
    await p.evaluate(() => closeSheets());
    await p.locator('#settingsBtn').click(); await sleep(300);
    t.ok(await p.evaluate(() => $$('#setKeys .set-card').length === 2 && !!$('#mcpOpen').offsetParent), `${dev}: в «Настройках» ключи Gemini и Claude и MCP`);
    // ⟨/⟩ — только в режиме разработчика (и после перезагрузки)
    const peek = () => p.evaluate(() => !!$('#peekBtn').offsetParent || $$('.peek-mini').some(x => x.offsetParent));
    await p.evaluate(() => { closeSheets(); setCreateMode('one'); }); await sleep(200);
    t.ok(!await peek(), `${dev}: ⟨/⟩ скрыт по умолчанию`);
    await p.locator('#settingsBtn').click(); await p.locator('label:has(#devMode)').click(); await p.evaluate(() => closeSheets()); await sleep(200);
    t.ok(await peek(), `${dev}: ⟨/⟩ виден в режиме разработчика`);
    await p.reload(); await sleep(1500); await p.evaluate(() => setCreateMode('one'));
    t.ok(await peek(), `${dev}: режим разработчика запоминается`);
    // ключи — только в «Настройках»: кнопка в «Сценариях» ведёт туда
    await p.evaluate(() => setCreateMode('write')); await sleep(300);
    t.ok(!await p.locator('#writeCreate [data-wkey-in]').count(), `${dev}: в «Сценариях» нет поля ключа`);
    await p.locator('#writeCreate [data-keys-open]').first().click(); await sleep(300);
    t.ok(await p.evaluate(() => !$('#settingsSheet').classList.contains('hidden')), `${dev}: «Подключить Gemini» открывает «Настройки»`);
    await p.evaluate(() => closeSheets());
    // пустая галерея: три шага
    await p.evaluate(() => { if (isMobile()) setView('gallery'); }); await sleep(300);
    const steps = await p.$$eval('#firstSteps .feat', fs => fs.map(f => f.dataset.step));
    t.ok(steps.join() === 'pc,acc,char', `${dev}: три шага первого запуска`, steps);
    await p.locator('#firstSteps [data-step="char"]').click(); await sleep(400);
    t.ok(await p.evaluate(() => cl.mode === 'chars' && !$('#voiceSheet').classList.contains('hidden')), `${dev}: «3. Персонаж» открывает нового персонажа`);
    await p.context().close();
  }
});
site.close();
