// Ярлык «Freefield» на рабочем столе: главная копия не запущена — запускает её (без окна), ждёт, пока поднимется
// приложение, и открывает галерею в браузере. Уже запущена — сразу открывает галерею.
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\freefield-main' : path.join(os.tmpdir(), 'freefield-main.sock');
const APP = 'http://127.0.0.1:5180/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mainUp = () => new Promise(res => { const s = net.connect(PIPE); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });
const appUp = async () => { try { return (await fetch(APP, {signal: AbortSignal.timeout(3000)})).ok; } catch { return false; } };

if (!await mainUp()) {
  const main = path.join(HERE, 'main.js'), logf = path.join(HERE, '.main.log');
  if (process.platform !== 'win32') {
    const fd = fs.openSync(logf, 'a');
    spawn(process.execPath, [main], {detached: true, stdio: ['ignore', fd, fd], cwd: HERE}).unref();
  } else {
    // как в server.js: через WScript — без окна консоли и без родителя
    const q = s => `""${s}""`;
    const vbs = path.join(os.tmpdir(), `freefield-main-open-${Date.now()}.vbs`);
    fs.writeFileSync(vbs, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`CreateObject("WScript.Shell").Run "cmd /d /c ""${q(process.execPath)} ${q(main)} >> ${q(logf)} 2>&1""", 0, False\r\n`, 'utf16le')]));
    spawn('wscript.exe', ['//B', '//Nologo', vbs], {stdio: 'ignore', windowsHide: true}).on('exit', () => fs.rm(vbs, {force: true}, () => {}));
  }
}
for (let i = 0; i < 40 && !await appUp(); i++) await sleep(1000);
if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/c', 'start', '', APP], {stdio: 'ignore', windowsHide: true, detached: true}).unref();
else spawn('xdg-open', [APP], {stdio: 'ignore', detached: true}).unref();
process.exit(0);
