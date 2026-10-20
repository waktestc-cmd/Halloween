// Constants shared by the server, the browser clients and the bot simulator.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHARED = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // drone: ambient pitch per room (Hz). Rooms are painted art in public/rooms/<id>/.
  const ROOMS = [
    { id: 'hall', name: 'Hall', drone: 55.0 },
    { id: 'attic', name: 'Attic', drone: 65.41 },
    { id: 'crypt', name: 'Crypt', drone: 41.2 },
    { id: 'swamp', name: 'Swamp', drone: 48.99 },
    { id: 'chapel', name: 'Chapel', drone: 73.42 },
  ];

  // One original ghost per room (same index as ROOMS).
  const GHOSTS = [
    { id: 'butler', name: 'Hollow Butler' },
    { id: 'ragdoll', name: 'Rag Doll Wraith' },
    { id: 'warden', name: 'Bone Warden' },
    { id: 'bride', name: 'Drowned Bride' },
    { id: 'choir', name: 'Choir Shade' },
  ];

  // One zombie per room (same index as ROOMS): slow, floor-bound, drawn to light.
  const ZOMBIES = [{ name: 'Groundskeeper' }, { name: 'Lodger' }, { name: 'Sexton' }, { name: 'Ferryman' }, { name: 'Deacon' }];

  // Costumes are code-drawn cut-paper silhouettes (see SIL in common.js).
  const COSTUMES = [
    { id: 'witch', name: 'Witch' },
    { id: 'vampire', name: 'Vampire' },
    { id: 'mummy', name: 'Mummy' },
    { id: 'skeleton', name: 'Skeleton' },
    { id: 'werewolf', name: 'Werewolf' },
    { id: 'zombie', name: 'Zombie' },
    { id: 'ghost', name: 'Ghost' },
    { id: 'pumpkin', name: 'Pumpkin-head' },
    { id: 'bat', name: 'Bat' },
    { id: 'cat', name: 'Black cat' },
    { id: 'spider', name: 'Spider' },
    { id: 'devil', name: 'Devil' },
  ];

  // Voice: dry, deadpan, short.
  const EVENTS = {
    bloodMoon: { name: 'Blood moon', line: () => 'Blood moon. Torches burn at half.' },
    lockedDoors: { name: 'Locked doors', line: () => 'The doors are locked.' },
    ghostFlood: { name: 'Ghost flood', line: (room) => `The ${room} is crowded with the dead.` },
    soulShower: { name: 'Soul shower', line: (room) => `It is raining souls in the ${room}.` },
  };

  const ACTS = [
    null,
    { name: 'Pumpkin rush', ordinal: 'one', sub: 'A pumpkin turns up every thirty seconds. Take one.' },
    { name: 'The hammer', ordinal: 'two', sub: 'One hammer. It will not sit still.' },
    { name: 'Soul harvest', ordinal: 'three', sub: 'Souls everywhere. Ghosts in a hurry.' },
  ];

  // The game's name, in one place.
  const TITLE = 'Pumpkin Smash';

  const NUM_PUMPKINS = 6;
  const MAX_NAME = 16;

  return { TITLE, ROOMS, GHOSTS, ZOMBIES, COSTUMES, EVENTS, ACTS, NUM_PUMPKINS, MAX_NAME };
});
