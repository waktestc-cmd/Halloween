// Tuning shared by the server and the browser. Speeds in metres per second, times in seconds.
export const TITLE = 'Monster Manor';

export const LIVES = 3; // the first two catches send you back to the guest bedrooms, the third one ends your night
export const RESPAWN_SAFE = 5; // seconds nothing can touch you after waking up again

export const WALK = 3.0;
export const RUN = 5.0;
// Running saves you: ten seconds of it outruns the Count (3.85 m/s on Normal, 4.2 on Scary, against
// your 5) by about 8 to 11 m, enough to get round a corner and out of his sight.
export const STAMINA = 10; // seconds of running before you are out of breath
export const STAMINA_BACK = 1.2; // seconds of running regained per second while walking (more standing still)
export const REACH = 2.2; // how far you can reach to open, search or hide

// what every monster does; each kind below scales the speeds and how far it sees
export const MONSTER = {
  patrol: 1.5,
  investigate: 2.4,
  chase: 3.5, // faster than walking, slower than running
  finale: 4.1,
  sight: 9, // how far it sees you in the dark
  sightLit: 17, // ...and with your flashlight on
  fov: 1.15, // half-angle in radians it can see either side of where it faces
  near: 2.2, // it notices you this close whichever way it faces
  catchAt: 1.05,
  loseAfter: 3.5, // seconds without seeing you before it gives up the chase
  search: 7,
  gloat: 3,
  max: 6, // the most monsters in the house
};

// The monsters of the manor, in the order they join as more people play. home: the room it starts
// in; roams: the rooms it prefers to wander. The Doctor's Monster sleeps until the power comes back.
export const KINDS = {
  vampire: { name: 'the Count', speed: 1.1, sight: 1, home: 'p', roams: null, flinch: true },
  creature: { name: "the Doctor's Monster", speed: 0.9, sight: 1.15, home: 'x', roams: null, sleeps: true },
  zombie: { name: 'a zombie', speed: 0.8, sight: 0.75, home: 'g', roams: ['g', 'c', 'g', 'n', 't'] },
};
export const LINEUP = ['vampire', 'creature', 'zombie', 'zombie', 'zombie', 'zombie'];
// shine your flashlight at the Count and he shrinks back for a moment
export const FLINCH = { range: 7, cone: 0.35, stun: 1.4, again: 7 };
// Q: a bright flash from your flashlight. Everything in a wide cone in front of you (cone: half-angle
// in radians, about 50 degrees) is hit: ghosts vanish, monsters are dazzled for a few seconds and lose
// track of you. It costs a quarter of the battery and needs that much charge; then it recharges.
export const FLASH = { range: 8, cone: 0.87, stun: 3, cost: 0.25, cooldown: 10 };

// the host picks how hard the night is
export const DIFFICULTY = {
  easy: { label: 'Easy', speed: 0.86, sight: 0.8, perPlayers: 12, ghosts: 0.6 },
  normal: { label: 'Normal', speed: 1, sight: 1, perPlayers: 8, ghosts: 1 }, // perPlayers: players per monster, plus two
  scary: { label: 'Scary', speed: 1.1, sight: 1.15, perPlayers: 6, ghosts: 1.4 },
};

export const GHOST = {
  drift: 1.0,
  approach: 2.1, // slower than walking: you can always walk away from a ghost
  notice: 7,
  touch: 0.9,
  burn: 1.6, // seconds of flashlight on it before it shrieks and vanishes
  back: 18, // seconds before a vanished ghost returns somewhere else
  base: 2,
  perPlayers: 5,
  max: 6,
};

// noise: how far away a monster hears it (metres)
export const NOISE = { walk: 2.5, run: 10, door: 11, search: 6, padlock: 30, drop: 9 };

export const DURATION = {
  night: 12 * 60, // until dawn
  grace: 40, // the monsters and ghosts stay still at first while everyone gets their bearings
  finale: 120, // once the front door is open
};

// the house acting up on its own (doors, knocking, lamps, a wail): seconds between events
export const HAUNT = { first: 25, every: [28, 55] };

// when nobody has found the fuse (or the brass key) for this long, the house gives a clue to its room
export const HINT = { after: 120 };

// the flashlight: it runs down while on, and slowly charges up again while switched off
// (from empty to full in a minute, starting a moment after you switch it off)
export const BATTERY = { drainPerSec: 1 / 200, refill: 0.5, spares: 16, rechargeAfter: 2, rechargePerSec: 1 / 60 };

// trick or treat: wrapped sweets lie on the floors all over the house (never in the guest bedrooms).
// Walk over one to pick it up, no key needed. A new one turns up every so often, up to the most there
// can be. points: what each adds to your score at dawn.
export const CANDY = { start: 40, max: 40, every: 15, reach: 0.9, points: 2 };

export const ITEMS = {
  fuse: { name: 'Fuse', hint: 'Bring it to the fuse box in the gallery' },
  brass: { name: 'Brass key', hint: "Unlock the desk in the Count's study" },
  key1: { name: 'Iron key', hint: 'Take it to the front door' },
  key2: { name: 'Iron key', hint: 'Take it to the front door' },
  key3: { name: 'Iron key', hint: 'Take it to the front door' },
};

export const STAGES = {
  power: 'Find the fuse and bring it to the fuse box in the gallery',
  desk: "Find the brass key and open the desk in the Count's study",
  keys: 'Find the three iron keys and bring them to the front door',
  escape: 'The front door is open. Get out!',
};

// the costumes you can pick when you join, in the order of the "player" models in models.json
export const COSTUMES = [
  { id: 'wizard', name: 'Wizard' },
  { id: 'pirate-queen', name: 'Pirate queen' },
  { id: 'pirate', name: 'Pirate' },
  { id: 'ninja', name: 'Ninja' },
  { id: 'viking', name: 'Viking' },
  { id: 'knight', name: 'Knight' },
  { id: 'cowgirl', name: 'Cowgirl' },
  { id: 'witch', name: 'Witch' },
  { id: 'chef', name: 'Chef' },
  { id: 'doctor', name: 'Doctor' },
];

export const LOOKS = ['#6b4a3a', '#2f4a6b', '#4a6b3a', '#6b3a5a', '#7a6a3a', '#3a6b6b', '#5a3a6b', '#6b5a4a'];
