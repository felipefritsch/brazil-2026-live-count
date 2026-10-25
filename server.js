// Optional Node server: polls TSE every 5 minutes for all visitors and keeps count history on disk.
// The static site in docs/ runs the same core in the browser and needs no server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createCore, POLL_MS } = require('./lib/core');

const PORT = process.env.PORT || 4826;
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const SNAPSHOTS = path.join(DATA, 'snapshots.jsonl');
fs.mkdirSync(DATA, { recursive: true });

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const core = createCore({
  base: readJson(path.join(DATA, 'base2022.json'), null),
  baseR1: readJson(path.join(DATA, 'base2026r1.json'), null),
  snapshots: fs.existsSync(SNAPSHOTS)
    ? fs.readFileSync(SNAPSHOTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [],
  saveSnapshot: (snap) => fs.appendFileSync(SNAPSHOTS, JSON.stringify(snap) + '\n'),
  forceRound: process.env.ROUND,
  log: console.log,
});
setInterval(() => core.poll(), POLL_MS);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function sendJson(res, obj) {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/state') return sendJson(res, core.payload());
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      const throttled = await core.refresh();
      return sendJson(res, { ...core.payload(), throttled });
    }
    if (url.pathname === '/data/pres2022_curve.json') return sendJson(res, readJson(path.join(DATA, 'pres2022_curve.json'), {}));
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e.message));
  }
});

// Listen first so a hosting platform's health check passes while the first poll runs.
server.listen(PORT, () => console.log(`Dashboard on http://localhost:${PORT}`));
core.poll();
