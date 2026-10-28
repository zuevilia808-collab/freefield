#!/usr/bin/env node
// Freefield в чате Claude — посредник. Вся работа (Chrome, аккаунты, общая очередь, задачи) идёт в ОДНОЙ главной копии
// (main.js) на компьютер; этот процесс только передаёт сообщения MCP между Claude и ней по именованному каналу.
// Главной копии нет — запускает её сам (без окна, отдельно от Claude: перезапуск Claude её не закрывает).
// Главная копия перезапустилась (новый код) — подключается заново и повторяет приветствие MCP, чат этого не замечает;
// вызовы, которые шли в момент перезапуска, получают понятную ошибку (пакеты продолжатся сами, check_job работает).
// FREEFIELD_STDIO=1 — старый режим: этот чат работает своей копией (main.js целиком в этом процессе).
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (process.env.FREEFIELD_STDIO) await import('./main.js');
else {
  const PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\freefield-main' : path.join(os.tmpdir(), 'freefield-main.sock');
  const REINIT = '__freefield_reinit__';
  const say = (...a) => console.error('[freefield]', ...a);
  let sock = null, initLine = null, initedLine = null, inBuf = '', outBuf = '', connecting = null, everConnected = false;
  const queue = [], pending = new Set();
  const answerError = (id, message) => process.stdout.write(JSON.stringify({jsonrpc: '2.0', id, error: {code: -32000, message}}) + '\n');

  // главная копия — отдельным процессом без окна и без родителя (через WScript): Claude, закрывая чат, закрывает дерево
  // своих процессов — главная копия в него не входит. Лог — mcp/.main.log
  let lastSpawn = 0;
  function startMain() {
    if (Date.now() - lastSpawn < 20e3) return;
    lastSpawn = Date.now();
    const main = path.join(HERE, 'main.js'), logf = path.join(HERE, '.main.log');
    try { if (fs.statSync(logf).size > 5e6) fs.renameSync(logf, logf + '.old'); } catch {}
    if (process.platform !== 'win32') {
      const fd = fs.openSync(logf, 'a');
      spawn(process.execPath, [main], {detached: true, stdio: ['ignore', fd, fd], cwd: HERE}).unref();
      return;
    }
    const q = s => `""${s}""`;
    const vbs = path.join(os.tmpdir(), `freefield-main-${process.pid}-${Date.now()}.vbs`);
    const text = `CreateObject("WScript.Shell").Run "cmd /d /c ""${q(process.execPath)} ${q(main)} >> ${q(logf)} 2>&1""", 0, False\r\n`;
    fs.writeFileSync(vbs, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
    const done = () => setTimeout(() => fs.rm(vbs, {force: true}, () => {}), 5000);
    spawn('wscript.exe', ['//B', '//Nologo', vbs], {stdio: 'ignore', windowsHide: true, cwd: HERE}).on('exit', done).on('error', done);
  }

  const lines = (buf, chunk, each) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) each(l); }
    return buf;
  };
  const send = l => { if (sock) sock.write(l + '\n'); else queue.push(l); };

  function connect() {
    if (connecting) return connecting;
    connecting = new Promise(resolve => {
      const t0 = Date.now();
      const attempt = () => {
        const s = net.connect(PIPE);
        s.once('connect', () => {
          s.setEncoding('utf8');
          s.on('data', d => { outBuf = lines(outBuf, d, l => {
            let m = null;
            try { m = JSON.parse(l); } catch {}
            if (m?.id === REINIT) return;   // ответ на повторное приветствие — чату он не нужен
            if (m && 'id' in m && ('result' in m || 'error' in m)) pending.delete(m.id);
            process.stdout.write(l + '\n');
          }); });
          s.on('close', () => {
            if (sock !== s) return;
            sock = null; outBuf = '';
            for (const id of pending) answerError(id, 'Freefield перезапускается (обновился код) — повторите этот вызов через несколько секунд. Пакеты продолжатся сами, check_job по старому номеру работает.');
            pending.clear();
            setTimeout(connect, 500);
          });
          s.on('error', () => {});
          // переподключение: главная копия новая — повторяем ей приветствие MCP (чат его уже прошёл)
          if (everConnected && initLine) {
            const init = JSON.parse(initLine);
            s.write(JSON.stringify({...init, id: REINIT}) + '\n');
            if (initedLine) s.write(initedLine + '\n');
          }
          everConnected = true;
          sock = s;
          connecting = null;
          for (const l of queue.splice(0)) s.write(l + '\n');
          resolve();
        });
        s.once('error', () => {
          s.destroy();
          startMain();
          // минута без главной копии — вызовы, что ждут, получают ошибку (Claude не висит); пробовать продолжаем
          if (Date.now() - t0 > 60e3) {
            for (const l of queue.splice(0)) { try { const m = JSON.parse(l); if ('id' in m && m.method) { pending.delete(m.id); answerError(m.id, 'Главная копия Freefield не запускается — смотрите Freefield\\mcp\\.main.log'); } } catch {} }
          }
          setTimeout(attempt, Date.now() - t0 < 5000 ? 300 : 1000);
        });
      };
      attempt();
    });
    return connecting;
  }

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { inBuf = lines(inBuf, d, l => {
    try {
      const m = JSON.parse(l);
      if (m.method === 'initialize') initLine = l;
      else if (m.method === 'notifications/initialized') initedLine = l;
      if ('id' in m && m.method) pending.add(m.id);
    } catch {}
    send(l);
  }); });
  process.stdin.on('end', () => process.exit(0));
  connect().catch(e => say(e.message));
}
