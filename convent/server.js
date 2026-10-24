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
// games of one person's own, kept by an id the browser makes up (so a refresh gets the same game back)
const solos = new Map();
const MAX_SOLOS = 40;

const page = (f) => fs.readFileSync(path.join(ROOT, 'views', f), 'utf8').replace(/\{\{TITLE\}\}/g, TITLE);
const views = { player: page('index.html'), host: page('host.html') };
app.get('/', (req, res) => res.type('html').send(DEV ? page('index.html') : views.player));
app.get('/host', (req, res) => {
  if (req.query.key !== HOST_KEY) return res.status(403).type('html').send('<body style="background:#050406;color:#d8c9a8;font:22px Georgia,serif;padding:40px">The host screen needs <code>?key=HOST_KEY</code>.</body>');
  res.type('html').send(DEV ? page('host.html') : views.host);
});
// what the join screen needs to know: is a big screen open (is there a group game to join)?
app.get('/status', (req, res) => res.set('Cache-Control', 'no-store').json({ hostOn: game.hosts.size > 0, inside: game.online(), phase: game.phase, solos: solos.size }));
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
  if (auth.mode === 'solo') {
    const gid = String(auth.gid || '');
    if (!/^[a-z0-9]{8,24}$/.test(gid)) return socket.disconnect(true);
    let g = solos.get(gid);
    if (!g) {
      if (solos.size >= MAX_SOLOS) {
        socket.emit('full');
        return socket.disconnect(true);
      }
      g = new Game(io, { room: 'solo-' + gid, solo: true });
      solos.set(gid, g);
    }
    g.idleSince = Infinity;
    g.attachPlayer(socket);
    // registered after the game's own handler, so the player already counts as gone
    socket.on('disconnect', () => g.online() || (g.idleSince = Date.now()));
    return;
  }
  if (auth.role === 'host') {
    if (auth.key !== HOST_KEY) {
      socket.emit('denied');
      return socket.disconnect(true);
    }
    return game.attachHost(socket);
  }
  game.attachPlayer(socket);
});

// a solo game goes away two minutes after its player has left (long enough for a refresh)
setInterval(() => {
  for (const [id, g] of solos) {
    if (!g.online() && Date.now() - g.idleSince > 120000) {
      g.destroy();
      solos.delete(id);
    }
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`${TITLE} on http://localhost:${PORT}${DEV ? '  (dev)' : ''}`);
  console.log(`  host screen: http://localhost:${PORT}/host?key=${process.env.HOST_KEY ? '<HOST_KEY>' : HOST_KEY}`);
});
