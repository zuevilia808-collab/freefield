#!/usr/bin/env node
// Связь Freefield с приложением (телефон или браузер на компьютере) отдельной программой — работает и без Claude:
// node mcp/hub-main.mjs. Если порт уже держит Freefield внутри Claude, эта программа просто ждёт и подхватывает связь,
// когда порт освободится. Автозапуск при входе в Windows — mcp/autostart (включить.cmd / выключить.cmd).
import net from 'node:net';
import {ensureHub, hubRunning, setLog} from './studio.js';

const say = (...a) => console.log(new Date().toLocaleString('ru'), '[связь]', ...a);

// одна копия на компьютер: вторая (двойной запуск, автозапуск + ручной) сразу выходит с кодом 3.
// Замок — именованный канал Windows: его держит живой процесс, после закрытия или сбоя Windows освобождает его сама
if (process.platform === 'win32') {
  const lock = net.createServer();
  const busy = await new Promise(res => { lock.once('error', () => res(true)); lock.listen('\\\\.\\pipe\\freefield-hub-main', () => res(false)); });
  if (busy) { say('уже запущена — вторая копия не нужна'); process.exit(3); }
  lock.unref();
}

setLog(say);
const tryHub = async () => {
  if (hubRunning()) return;
  try {
    await ensureHub();
    if (hubRunning()) say('работает — приложение: http://127.0.0.1:5180 (ссылка для телефона — в приложении: 📱 На телефон)');
  } catch (e) { say(e.message); }
};
await tryHub();
setInterval(tryHub, 15e3);
