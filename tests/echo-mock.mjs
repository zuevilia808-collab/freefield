// Макет программы «Эхо» по её контракту (голос из видео, озвучка) — для проверки «Озвучки» без видеокарты.
// Запоминает, кто к нему ходил: браузер должен ходить только через хаб Freefield, не напрямую.
import http from 'node:http';
import {wav} from './lib.mjs';

export function startEchoMock() {
  const AUDIO = wav(2.6, 330), REF = wav(4, 200);
  const jobs = new Map(), uploads = new Map(), voices = [], history = [], seen = [];
  let seq = 0;
  const id = p => p + (++seq);
  const EMO = ['neutral', 'calm', 'happy', 'excited', 'sad', 'serious'];
  // задача «Эхо»: пара опросов «работаю», потом результат
  const job = final => { const j = {id: id('job'), status: 'queued', progress: 0, message: 'в очереди', left: 2, final}; jobs.set(j.id, j); return pub(j); };
  function pub(j) {
    if (j.left > 0) { j.left--; Object.assign(j, {status: 'running', progress: 50, message: 'клонирую голос…'}); }
    else if (j.status !== 'done') Object.assign(j, {status: 'done', progress: 100, result: j.final()});
    const {final, left, ...out} = j;
    return out;
  }
  const body = req => new Promise(r => { const b = []; req.on('data', c => b.push(c)); req.on('end', () => r(Buffer.concat(b))); });
  const send = (res, code, data) => { res.writeHead(code, {'content-type': 'application/json'}); res.end(JSON.stringify(data)); };
  const audio = (res, buf) => { res.writeHead(200, {'content-type': 'audio/wav', 'content-length': buf.length, 'accept-ranges': 'bytes'}); res.end(buf); };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname, raw = await body(req);
    seen.push({path: p, origin: req.headers.origin || null});
    const js = () => { try { return JSON.parse(raw.toString() || '{}'); } catch { return {}; } };
    let m;
    if (p === '/api/health') return send(res, 200, {ok: true, app: 'echo', model: 'ready'});
    if (p === '/api/status') return send(res, 200, {model: 'ready', gpu: 'тест', busy: false, languages: [{id: 'russian', name: 'Русский'}], emotions: EMO.map(e => ({id: e, name: e})), max_ref: 30});
    if (p === '/api/voices' && req.method === 'GET') return send(res, 200, voices.filter(v => v.saved));
    if (p === '/api/upload') {
      if (!/multipart\/form-data/.test(req.headers['content-type'] || '')) return send(res, 422, {detail: 'нужен multipart'});
      const up = {id: id('up'), name: (/filename="([^"]+)"/.exec(raw.toString('latin1')) || [])[1] || 'file', duration: 14.2, kind: 'audio'};
      uploads.set(up.id, up);
      return send(res, 200, {...up, url: `/files/uploads/${up.id}.wav`, preview: `/files/uploads/${up.id}.wav`, peaks: Array.from({length: 400}, (_, i) => +Math.abs(Math.sin(i / 9)).toFixed(3))});
    }
    if (p === '/api/voice') {
      const b = js();
      if (!uploads.has(b.upload_id)) return send(res, 404, {detail: 'нет загрузки'});
      if (b.end - b.start < 1.5 || b.end - b.start > 30) return send(res, 422, {detail: 'отрезок 1,5–30 с'});
      return send(res, 200, job(() => { const v = {id: id('v'), name: '', emotion: 'neutral', favorite: false, text: 'распознанный текст', duration: b.end - b.start, url: '/files/voices/x/ref.wav', saved: false}; voices.push(v); return v; }));
    }
    if ((m = p.match(/^\/api\/voices\/([\w-]+)\/save$/))) {
      const v = voices.find(x => x.id === m[1]);
      if (!v) return send(res, 404, {detail: 'нет голоса'});
      Object.assign(v, {name: js().name, emotion: js().emotion || 'neutral', text: js().text || v.text, saved: true});
      return send(res, 200, v);
    }
    if (p === '/api/speak') {
      const b = js(), vs = voices.filter(x => x.saved && (x.name.toLowerCase() === String(b.voice || '').toLowerCase() || x.id === b.voice_id));
      if (!vs.length) return send(res, 404, {detail: `голос «${b.voice}» не найден`});
      return send(res, 200, job(() => Array.from({length: b.takes || 1}, (_, k) => {
        const t = {id: id('t'), text: b.text, voice_id: vs[0].id, voice_name: vs[0].name, emotion: b.emotion, favorite: false, duration: 2.6, take: k + 1, takes: b.takes || 1};
        Object.assign(t, {mp3: `/files/outputs/${t.id}.wav`, wav: `/files/outputs/${t.id}.wav`});
        history.unshift(t);
        return t;
      })));
    }
    if ((m = p.match(/^\/api\/jobs\/([\w-]+)$/))) { const j = jobs.get(m[1]); return j ? send(res, 200, pub(j)) : send(res, 404, {detail: 'нет задачи'}); }
    if (p === '/api/history') return send(res, 200, history.slice(0, 60));
    if ((m = p.match(/^\/api\/history\/([\w-]+)\/favorite$/))) { const t = history.find(x => x.id === m[1]); if (t) t.favorite = !!js().favorite; return send(res, 200, t || {}); }
    if ((m = p.match(/^\/api\/history\/([\w-]+)$/)) && req.method === 'DELETE') { const i = history.findIndex(x => x.id === m[1]); if (i >= 0) history.splice(i, 1); return send(res, 200, {ok: true}); }
    if (/^\/files\/(voices\/[\w-]+\/ref\.wav|uploads\/[\w-]+\.wav)$/.test(p)) return audio(res, REF);
    if (/^\/files\/outputs\/[\w-]+\.(mp3|wav)$/.test(p)) return audio(res, AUDIO);
    send(res, 404, {detail: 'Not Found'});
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({port: server.address().port, seen, history, close: () => server.close()})));
}
