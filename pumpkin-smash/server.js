'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game, FAST } = require('./src/game');

const PORT = Number(process.env.PORT) || 3000;
const HOST_KEY = process.env.HOST_KEY || 'spooky';
if (!process.env.HOST_KEY) console.warn('[warn] HOST_KEY not set; using the default "spooky". Set HOST_KEY in production.');

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e5,
});
const game = new Game(io);

const { TITLE } = require('./public/shared');
// the pages carry the game's name from shared.js, so renaming it is one line
const views = {};
for (const f of ['index.html', 'host.html']) views[f] = fs.readFileSync(path.join(__dirname, 'views', f), 'utf8').replace(/\{\{TITLE\}\}/g, TITLE);
const sendView = (name) => (req, res) => res.type('html').send(views[name]);

app.get('/', sendView('index.html'));
app.get('/host', (req, res) => {
  if (req.query.key !== HOST_KEY) {
    return res
      .status(403)
      .type('html')
      .send('<body style="background:#05010a;color:#ff1744;font:24px sans-serif;padding:40px">🔒 The host screen needs <code>?key=HOST_KEY</code>.</body>');
  }
  sendView('host.html')(req, res);
});
app.get('/healthz', (req, res) => res.json({ ok: true, phase: game.phase }));

// QR code for the join URL, generated in code as SVG (no image files).
app.get('/qr.svg', async (req, res) => {
  const url = String(req.query.u || '').slice(0, 300);
  if (!/^https?:\/\//.test(url)) return res.status(400).end();
  try {
    const svg = await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#05010aff', light: '#ffffffff' },
    });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch (e) {
    res.status(500).end();
  }
});

// the paintings and sprites are big and rarely change: let browsers keep them for an hour
for (const dir of ['rooms', 'sprites', 'sounds']) {
  app.use('/' + dir, express.static(path.join(__dirname, 'public', dir), { index: false, maxAge: FAST ? 0 : '1h' }));
}
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: FAST ? 0 : '5m' }));

io.on('connection', (socket) => {
  const auth = socket.handshake.auth || {};
  if (auth.role === 'host') {
    if (auth.key !== HOST_KEY) {
      socket.emit('denied');
      return socket.disconnect(true);
    }
    game.attachHost(socket);
  } else {
    game.attachPlayer(socket);
  }
});

server.listen(PORT, () => {
  console.log(`🎃 ${TITLE} listening on http://localhost:${PORT}${FAST ? '  (DEV_FAST timers)' : ''}`);
  console.log(`   host screen: http://localhost:${PORT}/host?key=${process.env.HOST_KEY ? '<HOST_KEY>' : HOST_KEY}`);
});
