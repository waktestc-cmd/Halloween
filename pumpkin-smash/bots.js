#!/usr/bin/env node
'use strict';
// Bot simulator: `npm run bots -- 25 [--url http://localhost:3000] [--start] [--exit]`
//   --start  also connect as host (HOST_KEY env, default "spooky") and start the game
//   --exit   quit (exit code 0) once the RESULT screen is reached
const { io } = require('socket.io-client');
const S = require('./public/shared.js');

const args = process.argv.slice(2);
const N = Math.max(1, Math.min(200, parseInt(args.find((a) => /^\d+$/.test(a)) || '25', 10)));
const urlIdx = args.indexOf('--url');
const URL = urlIdx >= 0 ? args[urlIdx + 1] : process.env.BOT_URL || `http://localhost:${process.env.PORT || 3000}`;
const AUTOSTART = args.includes('--start');
const EXIT = args.includes('--exit');
const HOST_KEY = process.env.HOST_KEY || 'spooky';

const FIRST = ['Ghoul', 'Boo', 'Mortimer', 'Wanda', 'Vlad', 'Elvira', 'Igor', 'Morticia', 'Casper', 'Hex', 'Raven', 'Grim', 'Luna', 'Drac', 'Pumpkin', 'Salem', 'Bones', 'Mist', 'Shade', 'Crow'];
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const META = require('./public/rooms/rooms.json').rooms;
const ROOM_META = S.ROOMS.map((r) => META.find((m) => m.id === r.id));
const stats = { claims: 0, souls: 0, deaths: 0, doors: 0, votes: 0, rejected: 0 };

function makeBot(i) {
  const name = `${rand(FIRST)}${i + 1}`.slice(0, S.MAX_NAME);
  const costume = rand(S.COSTUMES).id;
  const sock = io(URL, { transports: ['websocket'], reconnection: true });
  const bot = { name, sock, items: new Map(), me: null, state: null, dead: false, busy: false, u: Math.random(), v: 0.5, tu: Math.random(), tv: 0.6 };

  sock.on('connect', () => {
    sock.emit('join', { name, costume, token: bot.token }, (res) => {
      if (!res.ok) return console.log(`[bot] ${name} join failed: ${res.error}`);
      bot.token = res.token;
      bot.me = res.me;
    });
  });
  sock.on('items', (list) => {
    bot.items = new Map(list.map((it) => [it.id, it]));
  });
  sock.on('item+', (it) => bot.items.set(it.id, it));
  sock.on('item~', (m) => {
    const it = bot.items.get(m.id);
    if (it) Object.assign(it, m);
  });
  sock.on('item-', (m) => bot.items.delete(m.id));
  sock.on('me', (me) => (bot.me = me));
  sock.on('state', (s) => {
    const prev = bot.state;
    bot.state = s;
    if (s.phase === 'VOTE' && (!prev || prev.phase !== 'VOTE')) scheduleVote(bot);
  });
  return bot;
}

function scheduleVote(bot) {
  const voteMs = (bot.state.remaining || 5000) * (0.1 + Math.random() * 0.5);
  setTimeout(() => {
    bot.sock.emit('vote', { n: 1 + Math.floor(Math.random() * 6) }, (r) => r && r.ok && stats.votes++);
    if (Math.random() < 0.25) {
      setTimeout(() => bot.sock.emit('vote', { n: 1 + Math.floor(Math.random() * 6) }), voteMs * 0.5);
    }
  }, voteMs);
}

async function act(bot) {
  const s = bot.state;
  if (!s || s.phase !== 'HUNT' || s.paused || bot.dead || bot.busy || !bot.me) return;
  bot.busy = true;
  try {
    const me = bot.me;
    const here = [...bot.items.values()].filter((it) => it.r === me.room);
    const roll = Math.random();
    const doorsLocked = s.events.some((e) => e.type === 'lockedDoors');
    if (roll < 0.012) {
      // taken by a ghost
      bot.dead = true;
      stats.deaths++;
      bot.sock.emit('died', { ghost: me.room, x: Math.random(), y: Math.random() });
      await sleep(5000);
      bot.sock.emit('respawn', {}, () => {});
      bot.dead = false;
    } else if (roll < 0.1 && !doorsLocked) {
      bot.sock.emit('door', {}, (r) => r && r.ok && stats.doors++);
    } else {
      const want = here.filter(
        (it) => it.t === 's' || (it.t === 'p' && !me.pumpkin && !me.hammer) || (it.t === 'h' && !me.pumpkin && !me.hammer)
      );
      // pumpkins and the hammer hide in the furniture: bots open things, sometimes the right one
      const special = want.find((it) => it.t !== 's');
      const nc = (ROOM_META[me.room] && ROOM_META[me.room].containers.length) || 0;
      if (nc && Math.random() < 0.5) {
        await sleep(150 + Math.random() * 600);
        const c = special && special.c != null && Math.random() < 0.35 ? special.c : Math.floor(Math.random() * nc);
        bot.sock.emit('open', { c }, (r) => {
          if (r && r.ok && (r.found === 'p' || r.found === 'h') && r.kept !== false) stats.claims++;
          else if (r && r.ok && r.found === 's') stats.souls++;
        });
        return;
      }
      const loose = want.filter((it) => it.c == null);
      const target = loose.length && Math.random() < 0.55 ? rand(loose) : null;
      if (target) {
        await sleep(150 + Math.random() * 600); // "searching"
        bot.sock.emit('claim', { id: target.id }, (r) => {
          if (r && r.ok) {
            if (r.t === 's') stats.souls += r.v || 1;
            else stats.claims++;
          } else stats.rejected++;
        });
      }
    }
  } finally {
    bot.busy = false;
  }
}

async function main() {
  console.log(`[bots] connecting ${N} bots to ${URL}`);
  const bots = [];
  for (let i = 0; i < N; i++) {
    bots.push(makeBot(i));
    await sleep(40);
  }
  setInterval(() => bots.forEach((b) => Math.random() < 0.6 && act(b)), 450);
  // bots sweep their lanterns around the room so real players can see them
  setInterval(() => {
    for (const b of bots) {
      if (!b.state || b.state.phase !== 'HUNT' || b.dead) continue;
      if (Math.hypot(b.tu - b.u, b.tv - b.v) < 0.02) {
        b.tu = 0.1 + Math.random() * 0.8;
        b.tv = 0.35 + Math.random() * 0.55;
      }
      const du = b.tu - b.u;
      const dv = b.tv - b.v;
      const d = Math.hypot(du, dv) || 1;
      b.u += (du / d) * 0.02;
      b.v += (dv / d) * 0.02;
      b.sock.volatile.emit('pos', { u: b.u, v: b.v });
    }
  }, 150);

  let lastPhase = '';
  const watcher = bots[0];
  setInterval(() => {
    const s = watcher.state;
    if (!s) return;
    const label = `${s.phase}${s.act ? ' act ' + s.act : ''}${s.overtime ? ' OVERTIME' : ''}`;
    if (label !== lastPhase) {
      lastPhase = label;
      const held = s.pumpkins.filter((p) => p.holder).length;
      console.log(`[bots] ${label.padEnd(20)} players=${s.playerCount} pumpkins=${held}/6 hammer=${s.hammer.holder ? s.hammer.holder.name : '-'} ` + JSON.stringify(stats));
      if (s.phase === 'SMASH' && s.smash) {
        console.log(`[bots] 🔨 ${s.smash.hammer ? s.smash.hammer.name : 'The House'} swings at Pumpkin ${s.smash.target} (${s.smash.holder ? s.smash.holder.name : 'the House'})`);
      }
      if (s.phase === 'RESULT' && s.result) {
        const r = s.result;
        console.log(`[bots] RESULT: smashed ${r.smashed}, real winner ${r.winning} -> ${r.win ? 'FRIDAY AFTERNOON OFF!' : 'ZOMBIE PUMPKIN'}`);
        if (r.awards.souls) console.log(`[bots]   Most Souls: ${r.awards.souls.who.map((w) => w.name).join(', ')} (${r.awards.souls.value})`);
        if (r.awards.haunted) console.log(`[bots]   Most Haunted: ${r.awards.haunted.who.map((w) => w.name).join(', ')} (${r.awards.haunted.value})`);
        if (r.awards.hammer) console.log(`[bots]   Hammer Hero: ${r.awards.hammer.who[0].name}`);
        if (EXIT) setTimeout(() => process.exit(0), 500);
      }
    }
  }, 100);

  if (AUTOSTART) {
    await sleep(1500);
    const host = io(URL, { transports: ['websocket'], auth: { role: 'host', key: HOST_KEY } });
    host.on('denied', () => {
      console.log('[bots] host key rejected (set HOST_KEY)');
      process.exit(1);
    });
    host.on('connect', () => {
      console.log('[bots] host connected, starting game');
      host.emit('host:start');
    });
  }
}

main();
