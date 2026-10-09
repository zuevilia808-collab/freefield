// Инструмент разработчика: изучать страницы порталов в браузере Freefield.
//   node mcp/dev/portal-dev.mjs open <url>
//   node mcp/dev/portal-dev.mjs shot <файл.png> [часть-адреса]
//   node mcp/dev/portal-dev.mjs inspect [часть-адреса]      — поля ввода и кнопки на странице
//   node mcp/dev/portal-dev.mjs eval "<js>" [часть-адреса]
import {context, pageFor, screenshot} from '../bridge.js';

const [cmd, a, b] = process.argv.slice(2);
const pick = async match => {
  const ctx = await context();
  const pages = ctx.pages();
  return (match && pages.find(p => p.url().includes(match))) || pages[pages.length - 1];
};

if (cmd === 'open') { const p = await pageFor(a); console.log('открыто:', p.url()); }
else if (cmd === 'tabs') { for (const p of (await context()).pages()) console.log(p.url()); }
else if (cmd === 'shot') { const p = await pick(b); console.log(await screenshot(p, a), p.url()); }
else if (cmd === 'eval') { const p = await pick(b); console.log(JSON.stringify(await p.evaluate(a), null, 1)); }
else if (cmd === 'inspect') {
  const p = await pick(a);
  console.log('URL:', p.url(), '\nTITLE:', await p.title());
  const els = await p.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const txt = e => (e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 70);
    return [...document.querySelectorAll('textarea, input, [contenteditable="true"], button, [role="button"], [role="tab"], [role="option"], [role="menuitem"], a[href]')]
      .filter(vis).slice(0, 150).map(e => {
        const r = e.getBoundingClientRect();
        return `${e.tagName.toLowerCase()}${e.type ? '[' + e.type + ']' : ''}${e.isContentEditable ? '[editable]' : ''} "${txt(e)}" @${Math.round(r.x)},${Math.round(r.y)}` +
          (e.id ? ` #${e.id}` : '') + (e.getAttribute('data-testid') ? ` testid=${e.getAttribute('data-testid')}` : '');
      });
  });
  console.log(els.join('\n'));
}
process.exit(0);
