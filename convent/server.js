// Escape the Convent: web server. Serves the game pages, three.js and the assets, and runs the game.
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import express from 'express';
import compression from 'compression';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { Game } from './src/game.js';
import { TITLE } from './shared/config.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || 'spooky';
const DEV = process.env.DEV === '1';
if (!process.env.HOST_KEY) console.warn('[warn] HOST_KEY not set; using the default "spooky". Set HOST_KEY in production.');

const app = express();
app.disable('x-powered-by');
// squeeze pages, scripts and models on the way out (recorded sound is compressed already, except .wav)
app.use(compression({ filter: (req, res) => /\.(glb|gltf|wav)$/.test(req.path) || compression.filter(req, res) }));
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000, maxHttpBufferSize: 1e5 });
const game = new Game(io);

const page = (f) => fs.readFileSync(path.join(ROOT, 'views', f), 'utf8').replace(/\{\{TITLE\}\}/g, TITLE);
const views = { player: page('index.html'), host: page('host.html') };
app.get('/', (req, res) => res.type('html').send(DEV ? page('index.html') : views.player));
app.get('/host', (req, res) => {
  if (req.query.key !== HOST_KEY) return res.status(403).type('html').send('<body style="background:#050406;color:#d8c9a8;font:22px Georgia,serif;padding:40px">The host screen needs <code>?key=HOST_KEY</code>.</body>');
  res.type('html').send(DEV ? page('host.html') : views.host);
});
app.get('/healthz', (req, res) => res.json({ ok: true, phase: game.phase }));
app.get('/qr.svg', async (req, res) => {
  const url = String(req.query.u || '').slice(0, 300);
  if (!/^https?:\/\//.test(url)) return res.status(400).end();
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#050406ff', light: '#ffffffff' } });
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
});

// which recordings are present, so the browser only asks for those
app.get('/assets/sounds.json', (req, res) => {
  const files = fs.readdirSync(path.join(ROOT, 'public/assets/sounds')).filter((f) => /\.(mp3|ogg|wav)$/.test(f));
  res.json(files);
});
const cache = (age) => ({ index: false, maxAge: DEV ? 0 : age });
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), cache('1d')));
app.use('/shared', express.static(path.join(ROOT, 'shared'), cache('5m')));
app.use('/assets', express.static(path.join(ROOT, 'public/assets'), cache('1d')));
app.use(express.static(path.join(ROOT, 'public'), cache('5m')));

io.on('connection', (socket) => {
  const auth = socket.handshake.auth || {};
  if (auth.role === 'host') {
    if (auth.key !== HOST_KEY) {
      socket.emit('denied');
      return socket.disconnect(true);
    }
    return game.attachHost(socket);
  }
  game.attachPlayer(socket);
});

server.listen(PORT, () => {
  console.log(`${TITLE} on http://localhost:${PORT}${DEV ? '  (dev)' : ''}`);
  console.log(`  host screen: http://localhost:${PORT}/host?key=${process.env.HOST_KEY ? '<HOST_KEY>' : HOST_KEY}`);
});
