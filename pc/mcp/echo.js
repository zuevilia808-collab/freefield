// «Эхо» — озвучка голосом персонажа (Python, своя модель на видеокарте, http://127.0.0.1:7865). Её код не меняем.
// Это часть Freefield, а не отдельное приложение (пользователь 2026-10-08): программа Freefield сама запускает «Эхо»
// без своего окна — когда открыли «Озвучку» (и с телефона) или Claude озвучивает; ярлык на рабочем столе запускать не нужно.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn, execFile} from 'node:child_process';
import {readConfig} from './config.js';

export const ECHO = {host: '127.0.0.1', port: +(process.env.ECHO_PORT || 7865)};
export const ECHO_URL = process.env.ECHO_URL || `http://${ECHO.host}:${ECHO.port}`;

export async function echoUp(ms = 2500) {
  try { const r = await fetch(ECHO_URL + '/api/health', {signal: AbortSignal.timeout(ms)}); return r.ok ? await r.json().catch(() => ({ok: true})) : null; }
  catch { return null; }
}
// чем запускать: путь из config.json ("echo_launch") или ярлык «Эхо…» / «Echo…» на рабочем столе
export function echoLauncher() {
  const cfg = readConfig().echo_launch;
  if (typeof cfg === 'string' && cfg && fs.existsSync(cfg)) return cfg;
  const home = os.homedir();
  const desks = [path.join(home, 'Desktop'), path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'OneDrive', 'Рабочий стол'),
    path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')];
  for (const d of desks) {
    let names;
    try { names = fs.readdirSync(d); } catch { continue; }
    const hit = names.find(n => /^(эхо|echo)(?!\p{L}).*\.(lnk|cmd|bat|vbs|url|exe)$/iu.test(n));
    if (hit) return path.join(d, hit);
  }
  // ярлыка нет — файл запуска в папке «Эхо» (Desktop\voice)
  for (const d of desks.map(x => path.join(x, 'voice'))) {
    let names;
    try { names = fs.readdirSync(d); } catch { continue; }
    const hit = names.find(n => /^(start|run|launch|запуск|эхо|echo)[\p{L}\w -]*\.(bat|cmd|vbs)$/iu.test(n));
    if (hit) return path.join(d, hit);
  }
  return null;
}
// запустить «Эхо» (как двойной щелчок по ярлыку) и дождаться, пока ответит; одновременно — один запуск
let starting = null;
export function startEcho() {
  starting ||= (async () => {
    const up = await echoUp();
    if (up) return {ok: true, already: true, model: up.model};
    const file = echoLauncher();
    if (!file) return {ok: false, error: ECHO_NOT_FOUND};
    await launchHidden(file);
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const h = await echoUp(1500);
      if (h) return {ok: true, started: path.basename(file), model: h.model};
    }
    return {ok: false, error: '«Эхо» не ответило за 2 минуты после запуска'};
  })().finally(() => setTimeout(() => { starting = null; }, 0));
  return starting;
}
export const echoStarting = () => !!starting;
export const ECHO_NOT_FOUND = 'не нашёл «Эхо» на этом компьютере (ярлык «Эхо — озвучка» или папку voice на рабочем столе) — впишите путь к ярлыку или файлу запуска в config.json Freefield: "echo_launch"';

// ярлык Windows → что он запускает (программа, аргументы, папка) — чтобы запустить то же самое без окна
function lnkTarget(file) {
  const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $s=(New-Object -ComObject WScript.Shell).CreateShortcut('${file.replace(/'/g, "''")}'); ` +
    `Write-Output $s.TargetPath; Write-Output $s.Arguments; Write-Output $s.WorkingDirectory`;
  return new Promise(res => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {windowsHide: true, timeout: 15000, encoding: 'utf8'},
    (err, out) => { if (err) return res(null); const [target, args = '', cwd = ''] = String(out).split(/\r?\n/); res(target ? {target, args, cwd} : null); }));
}
// запустить «Эхо» без окна консоли (пользователь 2026-10-08: «когда нажимаю „Озвучка“, вылазит терминал — так быть не должно»).
// У Node на Windows detached + windowsHide окно консоли всё равно показывает, поэтому запускаем через WScript.Shell.Run(…, 0):
// скрыто, и всё, что «Эхо» запускает в своей консоли (Python, ffmpeg), тоже без окна. Ярлык → его цель (программа, аргументы, папка)
async function launchHidden(file) {
  if (process.platform !== 'win32') return spawn(file, [], {detached: true, stdio: 'ignore'}).unref();
  let t = /\.lnk$/i.test(file) ? await lnkTarget(file) : {target: file, args: '', cwd: path.dirname(file)};
  if (!t || !fs.existsSync(t.target) || /\.url$/i.test(t.target)) t = {target: file, args: '', cwd: path.dirname(file)};   // как двойной щелчок, но тоже скрыто
  const cwd = t.cwd && fs.existsSync(t.cwd) ? t.cwd : path.dirname(t.target);
  const cmd = /\.vbs$/i.test(t.target) ? `wscript.exe //B "${t.target}" ${t.args}` : `"${t.target}" ${t.args}`;
  runHidden(cmd.trim(), cwd);
}
// WScript.Shell.Run с окном 0 (скрыто), не дожидаясь конца; файл сценария — UTF-16 с BOM (пути с кириллицей)
function runHidden(cmd, cwd) {
  const q = s => s.replace(/"/g, '""');
  const vbs = path.join(os.tmpdir(), `freefield-echo-${process.pid}-${Date.now()}.vbs`);
  const text = `Set s = CreateObject("WScript.Shell")\r\ns.CurrentDirectory = "${q(cwd)}"\r\ns.Run "${q(cmd)}", 0, False\r\n`;
  fs.writeFileSync(vbs, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
  const done = () => fs.rm(vbs, {force: true}, () => {});
  spawn('wscript.exe', ['//B', '//Nologo', vbs], {stdio: 'ignore', windowsHide: true}).on('exit', done).on('error', done);
}
