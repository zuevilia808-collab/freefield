// Мини-сервер без зависимостей: node serve.js  (или  node serve.js --lan  — чтобы открыть с телефона по Wi-Fi)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = +process.env.PORT || 5173;
const LAN = process.argv.includes('--lan');
const ROOT = path.join(__dirname, 'app');   // само приложение лежит в app/
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
    res.end(data);
  });
}).listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Freefield: http://localhost:${PORT}`);
  if (LAN) for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets) if (n.family === 'IPv4' && !n.internal) console.log(`С телефона (та же Wi-Fi сеть): http://${n.address}:${PORT}`);
});
