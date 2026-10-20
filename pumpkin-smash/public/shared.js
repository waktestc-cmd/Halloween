// Constants shared by the server, the browser clients and the bot simulator.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SHARED = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // The house, in the order its rooms open (more players, more rooms; more each act).
  // Rooms are painted art in public/rooms/<id>/ (see tools/build_rooms.py). drone: ambient pitch (Hz).
  const ROOMS = [
    { id: 'hall', name: 'Hall', at: 'in the hall', drone: 55.0 },
    { id: 'drawing', name: 'Drawing room', at: 'in the drawing room', drone: 58.27 },
    { id: 'parlour', name: 'Parlour', at: 'in the parlour', drone: 51.91 },
    { id: 'kitchen', name: 'Kitchen', at: 'in the kitchen', drone: 61.74 },
    { id: 'chapel', name: 'Chapel', at: 'in the chapel', drone: 73.42 },
    { id: 'nursery', name: 'Nursery', at: 'in the nursery', drone: 69.3 },
    { id: 'bedroom', name: 'Bedroom', at: 'in the bedroom', drone: 46.25 },
    { id: 'cellar', name: 'Cellar', at: 'in the cellar', drone: 43.65 },
    { id: 'attic', name: 'Attic', at: 'in the attic', drone: 65.41 },
    { id: 'boiler', name: 'Boiler room', at: 'in the boiler room', drone: 38.89 },
    { id: 'crypt', name: 'Crypt', at: 'in the crypt', drone: 41.2 },
    { id: 'lake', name: 'Lake', at: 'by the lake', drone: 48.99 },
  ];
  // Where each room sits on the host's floor plan.
  const FLOORS = [
    { name: 'Upstairs', rooms: [5, 6, 8] },
    { name: 'Ground floor', rooms: [0, 1, 2, 3] },
    { name: 'Below', rooms: [7, 9, 10] },
    { name: 'Grounds', rooms: [4, 11] },
  ];

  // One original ghost per room (same index as ROOMS). id picks its shape and how it moves.
  const GHOSTS = [
    { id: 'butler', name: 'Hollow Butler' },
    { id: 'bride', name: 'Lady in Grey' },
    { id: 'ragdoll', name: 'Static Child' },
    { id: 'butler', name: 'Scullery Maid' },
    { id: 'choir', name: 'Choir Shade' },
    { id: 'ragdoll', name: 'Rag Doll Wraith' },
    { id: 'bride', name: 'Sleepwalker' },
    { id: 'warden', name: 'Thing in the Cellar' },
    { id: 'choir', name: 'Weeping Governess' },
    { id: 'warden', name: 'Stoker' },
    { id: 'warden', name: 'Bone Warden' },
    { id: 'bride', name: 'Drowned Bride' },
  ];

  // One zombie per room (same index as ROOMS): slow, floor-bound, drawn to light.
  const ZOMBIES = ['Groundskeeper', 'Lodger', 'Coachman', 'Cook', 'Deacon', 'Nanny', 'Valet', 'Sexton', 'Footman', 'Chimney Sweep', 'Gravedigger', 'Ferryman'].map(
    (name) => ({ name })
  );

  // The house's residents: one per room, each with one easy rule. Sprites in public/sprites/.
  // Light on them and they stop. If one reaches you, you get a fright and drop a soul.
  const RESIDENTS = {
    hall: { id: 'ghostface', name: 'Ghostface', rule: 'The telephone rings. Brave people answer it.' },
    parlour: { id: 'samara', name: 'Samara', rule: 'The television turns itself on. Keep your light on whatever comes out.' },
    kitchen: { id: 'michael', name: 'Michael Myers', rule: 'He walks. Your light stops him.' },
    chapel: { id: 'valak', name: 'Valak', rule: 'Keep an eye on the painting.' },
    nursery: { id: 'annabelle', name: 'Annabelle', rule: 'She only moves in the dark.' },
    cellar: { id: 'pennywise', name: 'Pennywise', rule: 'Do not take the balloon.' },
    boiler: { id: 'freddy', name: 'Freddy', rule: 'Do not stand still.' },
    lake: { id: 'jason', name: 'Jason', rule: 'Something is in the water. Your light stops him.' },
  };

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
    ghostFlood: { name: 'Ghost flood', line: (at) => `The dead are gathering ${at}.` },
    soulShower: { name: 'Soul shower', line: (at) => `It is raining souls ${at}.` },
  };

  const ACTS = [
    null,
    { name: 'Pumpkin rush', ordinal: 'one', sub: 'Pumpkins are hidden in the furniture. Open things. Take one.' },
    { name: 'The hammer', ordinal: 'two', sub: 'One hammer. It will not sit still.' },
    { name: 'Soul harvest', ordinal: 'three', sub: 'Souls everywhere. Ghosts in a hurry.' },
  ];

  // Recorded sounds need their authors in the end credits (CC BY). See ASSETS.md.
  const SOUND_CREDITS = ['qubodup'];

  // The game's name, in one place.
  const TITLE = 'Pumpkin Smash';

  const NUM_PUMPKINS = 6;
  const MAX_NAME = 16;

  return { TITLE, SOUND_CREDITS, ROOMS, FLOORS, RESIDENTS, GHOSTS, ZOMBIES, COSTUMES, EVENTS, ACTS, NUM_PUMPKINS, MAX_NAME };
});
