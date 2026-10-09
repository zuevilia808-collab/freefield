// «🌐 Ассеты для сайта»: проект, исходники, задание на компьютер, список заданий, метка и фильтр в галерее
import {suite, serveStatic, sleep, PC, PHONE} from './lib.mjs';

const site = await serveStatic();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNgGAWjYBSMAggAAAQQAAGFP6pyAAAAAElFTkSuQmCC';
await suite('ассеты для сайта: задание для Claude', async t => {
  for (const [dev, vp] of [['ПК', PC], ['телефон', PHONE]]) {
    const p = await t.page(vp, dev);
    let posted = null, tasks = [];
    await p.route('**/api/site**', async r => {
      const m = r.request().method();
      if (m === 'POST') {
        posted = JSON.parse(r.request().postData());
        tasks = [{id: 'sabc123def', created: Date.now(), status: 'waiting', statusText: 'ждёт Claude', message: '', project: posted.project,
          sources: posted.sources.map((s, i) => ({n: i + 1, role: s.role, roleText: 'главный баннер', keep: s.keep, count: s.count, composition: s.composition, url: `/api/site/sabc123def/${i + 1}`, analysis: '', prompts: []}))}];
        return r.fulfill({json: {id: 'sabc123def'}});
      }
      if (/\/api\/site\/sabc123def\/\d/.test(r.request().url())) return r.fulfill({body: Buffer.from(PNG, 'base64'), contentType: 'image/png'});
      return r.fulfill({json: tasks});
    });
    await p.goto(site.url); await sleep(1500);
    await p.evaluate(() => { Object.assign(hubLink, {ok: true, key: 'k', base: '', info: {...(hubLink.info || {}), features: ['site']}}); hubLink.refresh = async () => {}; closeSheets(); setView('create'); setCreateMode('site'); });
    await sleep(300);
    t.ok(await p.evaluate(() => document.body.dataset.cm === 'site' && $('#siteCreate').offsetParent && !$('#assetCreate').offsetParent), `${dev}: вкладка «Для сайта» открывается, чужие разделы скрыты`);
    t.ok(await p.evaluate(() => $('#genLabel').textContent.includes('Добавьте исходники')), `${dev}: без исходников кнопка просит их добавить`);
    // поля проекта и два исходника
    await p.fill('#siteCreate [data-site-p="name"]', 'Кафе Прибой');
    await p.fill('#siteCreate [data-site-p="about"]', 'кофейня у моря');
    await p.locator('#siteCreate [data-site-color-add]').click();
    await p.evaluate(async png => { const b = await (await fetch('data:image/png;base64,' + png)).blob(); await siteAddFiles([new File([b], 'a.png', {type: 'image/png'}), new File([b], 'b.png', {type: 'image/png'})]); }, PNG);
    await sleep(200);
    t.ok(await p.locator('#siteCreate .site-src').count() === 2, `${dev}: два исходника — две карточки`);
    const c2 = p.locator('#siteCreate .site-src').nth(1);
    await c2.locator('select').selectOption('icon');
    await c2.locator('[data-site-f="keep"]').fill('мягкий свет');
    await c2.locator('[data-site-n="4"]').click();
    await c2.locator('[data-site-f="composition"]').check();
    t.ok(await p.evaluate(() => $('#genLabel').textContent.includes('Отправить Claude') && $('#genSub').textContent.startsWith('2 ')), `${dev}: кнопка «Отправить Claude» · 2 исходника`);
    await p.locator('#genBtn').click(); await sleep(800);
    t.ok(posted?.project.name === 'Кафе Прибой' && posted.project.about === 'кофейня у моря' && posted.project.colors.length === 1 && posted.sources.length === 2,
      `${dev}: на компьютер ушёл проект и 2 исходника`, posted && {...posted.project});
    const s2 = posted?.sources[1];
    t.ok(s2?.role === 'icon' && s2.keep === 'мягкий свет' && s2.count === 4 && s2.composition === true && /^data:image\/png;base64,/.test(s2.image), `${dev}: поля исходника — как выбрали`, s2 && {...s2, image: s2.image.slice(0, 30)});
    t.ok(await p.evaluate(() => site.srcs.length === 0 && $('#siteTasks .site-task') && $('#siteTasks .site-st').textContent === 'ждёт Claude'), `${dev}: исходники очищены, задание в списке «ждёт Claude»`);
    // Claude закончил
    tasks[0] = {...tasks[0], status: 'done', statusText: 'готово', message: 'Сделал 2 баннера', sources: tasks[0].sources.map(s => ({...s, analysis: 'разбор', prompts: ['A calm seaside cafe…']}))};
    await p.evaluate(() => siteRefresh()); await sleep(400);
    t.ok(await p.evaluate(() => $('#siteTasks .site-st.ok')?.textContent === 'готово' && $('#siteTasks .site-t-msg').textContent === 'Сделал 2 баннера' && $$('#siteTasks details').length === 4), `${dev}: готово — итог, разбор и промпты в карточке`);
    // проект запомнился
    t.ok(await p.evaluate(() => JSON.parse(localStorage.getItem('freefield.site.project')).about === 'кофейня у моря'), `${dev}: поля проекта сохраняются`);
  }
  // галерея: метка и фильтр по проекту
  const p = await t.page(PC, 'галерея');
  await p.goto(site.url); await sleep(1200);
  const g = await p.evaluate(async png => {
    const blob = await (await fetch('data:image/png;base64,' + png)).blob(), base = {type: 'image', status: 'done', w: 8, h: 8, aspect: '1:1', tier: 'free', blob, createdAt: Date.now()};
    items.push({...base, id: 'x1', prompt: 'site one', siteProject: 'Кафе'}, {...base, id: 'x2', prompt: 'other'});
    render(); await new Promise(r => setTimeout(r, 200));
    const shown = () => $$('#grid .card').map(c => c.dataset.id).filter(id => id.startsWith('x')).sort().join(',');
    const before = shown(), tag = $('#grid .card[data-id="x1"] .card-site')?.textContent, icon = !!$('#grid .card[data-id="x1"] .card-site svg, #grid .card[data-id="x1"] .card-site .ic'), vis = !$('#siteFilter').hidden;
    $('#siteFilter').value = 'Кафе'; $('#siteFilter').dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 200));
    return {before, tag, icon, vis, after: shown()};
  }, PNG);
  t.ok(g.tag?.trim() === 'Сайт: Кафе' && g.icon && g.vis, 'в галерее — метка «🌐 Сайт: Кафе» и фильтр по проекту', g);
  t.ok(g.before === 'x1,x2' && g.after === 'x1', 'фильтр показывает только картинки проекта', g);
});
