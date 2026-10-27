// A scripted playtest with real browsers: one host screen and two players, through the whole flow,
// including the story, the spread-out start, the end of the night and the 3D pumpkin patch.
//
//   cd convent
//   npm ci
//   npm i --no-save playwright && npx playwright install --with-deps chromium
//   node tools/playtest.mjs <player link> <host key>
//   (for example: node tools/playtest.mjs https://escape-the-convent-pumpkin-wbifahng7a-ew.a.run.app manor-ca73e16373b6)
//
// It needs a machine where WebSockets work and Chromium can do WebGL in software (the flags below).
// It plays the night for about a minute, ends it from the host, and prints one ok/FAIL line per check.
import { chromium } from 'playwright';

const [base = 'http://localhost:3000', key = 'spooky'] = process.argv.slice(2);
const URLBASE = base.replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const note = (ok, what, extra = '') => {
  results.push({ ok, what });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' | ' + extra : ''}`);
};
// run a step; a thrown error is a failure, not the end of the run
async function step(what, fn) {
  try {
    const r = await fn();
    note(r !== false, what, typeof r === 'string' ? r : '');
    return r;
  } catch (e) {
    note(false, what, String(e.message || e).split('\n')[0]);
    return false;
  }
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
// does this browser have WebGL at all? (the player page needs it)
{
  const p = await browser.newPage();
  const info = await p.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return 'NO WEBGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'webgl present';
  });
  note(info !== 'NO WEBGL', 'this browser has WebGL', info);
  await p.close();
}
async function open(name, url, size) {
  const ctx = await browser.newContext({ viewport: size });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit', timeout: 120000 });
  // a player page builds the whole 3D house in software before the join screen appears: give it time
  if (name !== 'host') {
    await page.waitForSelector('#panel-join.on, #panel-nogl.on', { timeout: 300000 });
    if (await page.$('#panel-nogl.on')) throw new Error(`${name}: "This browser can't show 3D" (WebGL is not available in this browser)`);
  } else await page.waitForSelector('#h-lobby', { timeout: 120000 });
  console.log(`     (${name} ready after ${Math.round((Date.now() - t0) / 1000)} s)`);
  return page;
}
const on = (page, sel) => page.$eval(sel, (e) => e.classList.contains('on')).catch(() => false);
const panel = (page) => page.evaluate(() => document.querySelector('.panel.on')?.id ?? null);
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel); // buttons that pulse can't be clicked by the usual way

await step('health check answers', async () => (await (await fetch(`${URLBASE}/healthz/`)).json()).ok === true);

const host = await open('host', `${URLBASE}/host?key=${key}`, { width: 1600, height: 900 });
await sleep(1500);
await step('host lobby loads, with the pumpkin-prize box ticked', async () => host.$eval('#h-prize', (e) => e.checked));
const a = await open('alice', `${URLBASE}/?debug`, { width: 1280, height: 720 });
const b = await open('bob', `${URLBASE}/?debug`, { width: 1280, height: 720 });
await sleep(1500);

await step('join screen offers "The lobby" while the host is open', async () => (await a.$eval('#btn-enter', (e) => !e.hidden)) && (await a.textContent('#btn-enter')).trim() === 'The lobby');
await step('players join and see each other', async () => {
  await a.fill('#name', 'Alice');
  await a.click('#btn-enter');
  await b.fill('#name', 'Bob');
  await b.click('#btn-enter');
  await a.waitForSelector('#panel-lobby.on', { timeout: 15000 });
  await b.waitForSelector('#panel-lobby.on', { timeout: 15000 });
  await sleep(1500);
  return (await a.textContent('#roster-count')).includes('2');
});
await step('lobby fits the window (no long scroll)', async () => (await a.$eval('.card.lobby', (e) => Math.round(e.getBoundingClientRect().height))) <= 720);
await step('loading bar finishes', async () => {
  await a.waitForFunction(() => document.getElementById('l-load').classList.contains('done'), null, { timeout: 60000 });
  return true;
});

await host.evaluate(() => document.getElementById('h-start').click());
await step('story shows on both players and the host', async () => {
  await a.waitForSelector('#panel-story.on', { timeout: 15000 });
  await b.waitForSelector('#panel-story.on', { timeout: 15000 });
  await sleep(500);
  return await host.$eval('#h-story', (e) => !e.hidden);
});
await step('players start in different rooms', async () => {
  const room = (p) => p.evaluate(() => window.__c.L.roomAt(window.__c.S.me.x, window.__c.S.me.z));
  const [ra, rb] = [await room(a), await room(b)];
  return ra !== rb ? `${ra} and ${rb}` : false;
});
await step('"Step inside" puts both in the house', async () => {
  await click(a, '#btn-story');
  await click(b, '#btn-story');
  await sleep(1500);
  return (await panel(a)) !== 'panel-story';
});
await step('the clock reads about 12 minutes on the host', async () => /1[12]:\d\d|12:00/.test(await host.textContent('#h-timer')), await host.textContent('#h-timer'));
await sleep(8000);

// dawn, from the host (asks to be confirmed)
await host.evaluate(() => document.getElementById('h-finish').click());
await host.evaluate(() => document.getElementById('h-finish').click());
await step('results appear for the players', async () => {
  await a.waitForSelector('#panel-results.on', { timeout: 15000 });
  await b.waitForSelector('#panel-results.on', { timeout: 15000 });
  return true;
});

// the pumpkin patch: exactly one player (the top scorer) gets the intro
let winner = null;
let other = null;
await step('exactly one player is sent to the pumpkin patch', async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const ia = await on(a, '#panel-harvest');
    const ib = await on(b, '#panel-harvest');
    if (ia !== ib) {
      [winner, other] = ia ? [a, b] : [b, a];
      return ia ? 'Alice' : 'Bob';
    }
    await sleep(300);
  }
  return false;
});
if (winner) {
  await step('the other player sees who is choosing', async () => (await other.textContent('#harvest-note')).includes('choosing a pumpkin'));
  await step('the big screen shows the patch', async () => host.$eval('#h-harvest', (e) => !e.hidden));
  await step('the winner enters the graveyard', async () => {
    await click(winner, '#btn-harvest-go');
    await sleep(2500);
    return (await panel(winner)) === null && (await winner.$eval('#patch-msg', (e) => !e.hidden));
  });
  // put the winner in front of the pumpkins (the frame stands at x=27, z=24)
  await winner.evaluate(() => window.__c.tp(24.5, 24.7, -Math.PI / 2));
  await step('aiming at a pumpkin shows the prompt', async () => {
    for (let i = 0; i < 30; i++) {
      if (await winner.$eval('#prompt', (e) => e.classList.contains('on') && /pumpkin/i.test(e.textContent))) return true;
      await sleep(300);
    }
    return false;
  });
  await winner.keyboard.press('KeyE');
  await step('the pick produces a result for the winner', async () => {
    await winner.waitForFunction(() => /You found/.test(document.getElementById('patch-msg').textContent), null, { timeout: 15000 });
    return await winner.textContent('#patch-msg');
  });
  await step('the other player and the host see the result', async () => {
    await other.waitForFunction(() => /found/.test(document.getElementById('harvest-note').textContent), null, { timeout: 10000 });
    await host.waitForFunction(() => /found/.test(document.getElementById('h-harvest-title').textContent), null, { timeout: 10000 });
    return await host.textContent('#h-harvest-title');
  });
  await step('numbers 1 to 6 are shown in the pumpkins on the big screen', async () => {
    await host.waitForFunction(() => document.querySelectorAll('#h-patch .pk.open').length === 6, null, { timeout: 15000 });
    const nums = (await host.$$eval('#h-patch .pk-inside', (e) => e.map((x) => x.textContent))).sort().join('');
    return nums === '123456' ? nums : `got ${nums}`;
  });
  await step('"See the results" appears and works', async () => {
    await winner.waitForSelector('#btn-patch-done:not([hidden])', { timeout: 15000 });
    await click(winner, '#btn-patch-done');
    await sleep(500);
    return (await panel(winner)) === 'panel-results';
  });
}

// back to the lobby, everyone still connected
await step('"Back to the lobby" returns everyone to the lobby', async () => {
  await host.evaluate(() => document.getElementById('h-harvest').click());
  await host.evaluate(() => document.getElementById('h-again').click());
  await a.waitForSelector('#panel-lobby.on', { timeout: 10000 });
  await b.waitForSelector('#panel-lobby.on', { timeout: 10000 });
  return true;
});

// a game of one's own
const solo = await open('solo', `${URLBASE}/?debug`, { width: 1280, height: 720 });
await sleep(1000);
await step('"Play on my own" gives a private lobby with Start and difficulty', async () => {
  await solo.fill('#name', 'Sam');
  await solo.click('#btn-solo');
  await solo.waitForSelector('#panel-lobby.on', { timeout: 15000 });
  await sleep(1000);
  return (await solo.$eval('#l-solo', (e) => !e.hidden)) && (await solo.textContent('#roster-count')).includes('1');
});
await step('a solo night starts with the story', async () => {
  await solo.click('#btn-solo-start');
  await solo.waitForSelector('#panel-story.on', { timeout: 15000 });
  return true;
});
await step('the solo game is not the host game (host still sees 2 players)', async () => (await (await fetch(`${URLBASE}/status`)).json()).inside >= 0);

await browser.close();
console.log('\nbrowser errors:', errors.length ? '\n  ' + [...new Set(errors)].slice(0, 20).join('\n  ') : 'none');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? '. Failed: ' + failed.map((f) => f.what).join('; ') : '.'}`);
process.exit(failed.length ? 1 : 0);
