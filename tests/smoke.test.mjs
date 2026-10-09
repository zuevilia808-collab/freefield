// Все разделы, все окна и просмотр картинки — на ПК и телефоне, без ошибок
import {suite, serveStatic, sleep, PC, PHONE} from './lib.mjs';

const site = await serveStatic();
await suite('смоук: разделы, окна, просмотр', async t => {
  for (const [dev, vp] of [['ПК', PC], ['телефон', PHONE]]) {
    const p = await t.page(vp, dev);
    await p.goto(site.url); await sleep(1500);
    for (const cm of ['chars', 'one', 'write', 'scn', 'edit', 'voice', '3d']) {
      await p.evaluate(m => { closeSheets(); setView('create'); setCreateMode(m); }, cm); await sleep(250);
      t.ok(await p.evaluate(m => cl.mode === m && document.body.dataset.cm === m, cm), `${dev}: раздел ${cm} открывается`);
    }
    t.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${dev}: без прокрутки вбок`);
    await p.evaluate(() => setCreateMode('one'));
    for (const k of ['info', 'sheet', 'loc']) { await p.evaluate(k => { closeSheets(); setAssetKind(k); }, k); await sleep(150); }
    await p.evaluate(() => closeSheets());
    // все окна: открыть и закрыть
    for (const id of await p.evaluate(() => [...document.querySelectorAll('.sheet')].map(s => s.id))) {
      const opened = await p.evaluate(id => {
        const open = {settingsSheet: () => $('#settingsBtn').click(), accSheet: openAcc, mcpSheet: openMcp, installSheet: openInstall}[id];
        if (!open) return null;
        open(); return !$('#' + id).classList.contains('hidden');
      }, id);
      if (opened !== null) t.ok(opened, `${dev}: окно ${id} открывается`);
      await sleep(120); await p.evaluate(() => closeSheets());
    }
    // картинка в галерее → просмотр → действия
    await p.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').fillRect(0, 0, 30, 30);
      const blob = await new Promise(r => c.toBlob(r));
      const it = {id: 'smoke1', type: 'image', status: 'done', createdAt: Date.now(), prompt: 'тест', userPrompt: 'тест', finalPrompt: 'test', model: 'ext:flow-image',
        tier: 'free', modelTitle: 'Flow', seed: 0, cost: 0, source: 'text', aspect: '1:1', w: 64, h: 64, blob};
      items.unshift(it); await DB.put(it); render();
    });
    await p.evaluate(() => setView('gallery')); await sleep(300);
    for (const [act, mode] of [['to-asset', 'one'], ['reuse', 'one'], ['animate', 'scn']]) {
      await p.evaluate(() => { closeSheets(); openLB('smoke1'); }); await sleep(200);
      const has = await p.evaluate(a => { const b = document.querySelector(`[data-act="${a}"]`); b?.click(); return !!b; }, act);
      await sleep(300);
      t.ok(has && await p.evaluate(m => cl.mode === m, mode), `${dev}: «${act}» из просмотра ведёт в ${mode}`);
    }
    await p.context().close();
  }
});
site.close();
