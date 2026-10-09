// Кто пишет сценарии: «Claude (подписка)» — через программу на компьютере (Claude Code), «Бесплатный ИИ» — без ключа
import {suite, serveStatic, sleep, PC} from './lib.mjs';

const site = await serveStatic();
await suite('сценаристы: подписка Claude через компьютер, бесплатный без ключа', async t => {
  const p = await t.page(PC, 'ПК');
  // компьютер с программой Freefield: задание → id → готовый текст
  let got = null;
  await p.route('**/api/write**', async r => {
    if (r.request().method() === 'POST') { got = JSON.parse(r.request().postData()); return r.fulfill({json: {id: '0123456789abcdef'}}); }
    return r.fulfill({json: {id: '0123456789abcdef', status: 'done', text: '{"scenarios":[{"title":"Тест"}]}', cut: false, model: 'opus'}});
  });
  await p.goto(site.url); await sleep(1500);
  t.ok(await p.evaluate(() => writerNow() === 'free'), 'без ключей и компьютера «Авто» — бесплатный ИИ');
  const sub = await p.evaluate(async () => {
    Object.assign(hubLink, {ok: true, key: 'k', base: '', info: {...(hubLink.info || {}), features: ['claude']}});
    const auto = writerNow();
    const png = (() => { const c = document.createElement('canvas'); c.width = c.height = 8; return c.toDataURL('image/png'); })();
    const r = await aiWrite('sub', 'SYS', 'USER', [['IMAGE 1:', png]]);
    return {auto, r};
  });
  t.ok(sub.auto === 'sub', 'компьютер с Claude Code есть — «Авто» берёт подписку', sub.auto);
  t.ok(sub.r.text.includes('Тест') && /подписка/.test(sub.r.by), 'ответ Claude Code вернулся в приложение', sub.r);
  t.ok(got?.system === 'SYS' && got.content.some(b => b.type === 'image' && /^data:image\/png/.test(b.data)) && got.content.at(-1).text === 'USER', 'на компьютер ушли промпт, картинка и задание', got && {system: got.system, n: got.content.length});
  // настоящий бесплатный ИИ (сеть)
  const free = await p.evaluate(async () => { try { return await aiWrite('free', 'Answer with JSON only.', 'Return {"ok":true}', []); } catch (e) { return {err: e.message}; } });
  t.ok(free.text && /ok/.test(free.text), 'бесплатный ИИ ответил без ключа', free);
});
