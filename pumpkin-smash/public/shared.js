// Constants shared by the server, the browser clients and the bot simulator.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHARED = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COLORS = {
    bg: '#05010a',
    violet: '#8b2bff',
    green: '#39ff14',
    orange: '#ff5a00',
    magenta: '#ff2bd6',
    cyan: '#00f0ff',
    red: '#ff1744',
  };

  // Each room has an accent colour, a ghost and a drone pitch (Hz).
  const ROOMS = [
    { id: 'hall', name: 'Hall', accent: COLORS.orange, drone: 55.0 },
    { id: 'attic', name: 'Attic', accent: COLORS.violet, drone: 65.41 },
    { id: 'crypt', name: 'Crypt', accent: COLORS.cyan, drone: 41.2 },
    { id: 'swamp', name: 'Swamp', accent: COLORS.green, drone: 48.99 },
    { id: 'chapel', name: 'Chapel', accent: COLORS.magenta, drone: 73.42 },
  ];

  // One original ghost per room (same index as ROOMS).
  const GHOSTS = [
    { id: 'butler', name: 'Hollow Butler', color: '#00f0ff' },
    { id: 'ragdoll', name: 'Rag Doll Wraith', color: '#ff2bd6' },
    { id: 'warden', name: 'Bone Warden', color: '#d8f3ff' },
    { id: 'bride', name: 'Drowned Bride', color: '#7dffcf' },
    { id: 'choir', name: 'Choir Shade', color: '#b26bff' },
  ];

  // emoji: null means the glyph is drawn in code (there is no mummy emoji).
  const COSTUMES = [
    { id: 'witch', name: 'Witch', emoji: '🧙', glow: '#39ff14' },
    { id: 'vampire', name: 'Vampire', emoji: '🧛', glow: '#ff1744' },
    { id: 'mummy', name: 'Mummy', emoji: null, glow: '#f5e6c8' },
    { id: 'skeleton', name: 'Skeleton', emoji: '💀', glow: '#d8f3ff' },
    { id: 'werewolf', name: 'Werewolf', emoji: '🐺', glow: '#ff5a00' },
    { id: 'zombie', name: 'Zombie', emoji: '🧟', glow: '#39ff14' },
    { id: 'ghost', name: 'Ghost', emoji: '👻', glow: '#00f0ff' },
    { id: 'pumpkin', name: 'Pumpkin-head', emoji: '🎃', glow: '#ff5a00' },
    { id: 'bat', name: 'Bat', emoji: '🦇', glow: '#8b2bff' },
    { id: 'cat', name: 'Black Cat', emoji: '🐈‍⬛', glow: '#ff2bd6' },
    { id: 'spider', name: 'Spider', emoji: '🕷️', glow: '#8b2bff' },
    { id: 'devil', name: 'Devil', emoji: '😈', glow: '#ff2bd6' },
  ];

  const EVENTS = {
    bloodMoon: { name: 'Blood Moon', sub: 'Torches burn at half strength', color: COLORS.red },
    lockedDoors: { name: 'Locked Doors', sub: 'No doors will open', color: COLORS.violet },
    ghostFlood: { name: 'Ghost Flood', sub: 'Three more ghosts haunt the', color: COLORS.cyan },
    soulShower: { name: 'Soul Shower', sub: 'Souls rain down in the', color: COLORS.green },
  };

  const ACTS = [
    null,
    { name: 'Pumpkin Rush', sub: 'A pumpkin appears every 30 seconds. First click claims it.' },
    { name: 'The Hammer', sub: 'One hammer, hidden from pumpkin holders. It will not sit still.' },
    { name: 'Soul Harvest', sub: 'A soul storm. Faster ghosts. Every soul is a vote.' },
  ];

  const NUM_PUMPKINS = 6;
  const MAX_NAME = 16;

  return { COLORS, ROOMS, GHOSTS, COSTUMES, EVENTS, ACTS, NUM_PUMPKINS, MAX_NAME };
});
