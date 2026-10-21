// Tuning shared by the server and the browser. Speeds in metres per second, times in seconds.
export const TITLE = 'Escape the Convent';

export const LIVES = 3; // the first two catches send you back to the dormitory, the third one ends your night
export const RESPAWN_SAFE = 5; // seconds nothing can touch you after waking up again

export const WALK = 3.0;
export const RUN = 5.0;
export const STAMINA = 6; // seconds of running before you are out of breath
export const STAMINA_BACK = 0.6; // regained per second while not running
export const REACH = 2.2; // how far you can reach to open, search or hide

export const NUN = {
  patrol: 1.5,
  investigate: 2.4,
  chase: 3.5, // faster than walking, slower than running
  finale: 4.1,
  sight: 9, // how far she sees you in the dark
  sightLit: 17, // ...and with your flashlight on
  fov: 1.15, // half-angle in radians she can see either side of where she faces
  near: 2.2, // she notices you this close whichever way she faces
  catchAt: 1.05,
  loseAfter: 3.5, // seconds without seeing you before she gives up the chase
  search: 7,
  gloat: 3,
  max: 3, // the most nuns in the house; how many players share one depends on the difficulty
};

// the host picks how hard the night is
export const DIFFICULTY = {
  easy: { label: 'Easy', speed: 0.86, sight: 0.8, perPlayers: 12, ghosts: 0.6 },
  normal: { label: 'Normal', speed: 1, sight: 1, perPlayers: 8, ghosts: 1 },
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

// noise: how far away a nun hears it (metres)
export const NOISE = { walk: 2.5, run: 10, door: 11, search: 6, padlock: 30, drop: 9 };

export const DURATION = {
  night: 20 * 60, // until dawn
  grace: 40, // the nuns and ghosts stay still at first while everyone gets their bearings
  finale: 120, // once the front door is open
};

// the house acting up on its own (doors, knocking, lamps, a wail): seconds between events
export const HAUNT = { first: 25, every: [28, 55] };

export const BATTERY = { drainPerSec: 1 / 200, refill: 0.5, spares: 8 };

export const ITEMS = {
  fuse: { name: 'Fuse', hint: 'Bring it to the fuse box in the cloister' },
  brass: { name: 'Brass key', hint: "Unlock the desk in Mother Superior's office" },
  key1: { name: 'Iron key', hint: 'Take it to the front door' },
  key2: { name: 'Iron key', hint: 'Take it to the front door' },
  key3: { name: 'Iron key', hint: 'Take it to the front door' },
};

export const STAGES = {
  power: 'Find the fuse and bring it to the fuse box in the cloister',
  desk: "Find the brass key and open Mother Superior's desk",
  keys: 'Find the three iron keys and bring them to the front door',
  escape: 'The front door is open. Get out!',
};

export const LOOKS = ['#6b4a3a', '#2f4a6b', '#4a6b3a', '#6b3a5a', '#7a6a3a', '#3a6b6b', '#5a3a6b', '#6b5a4a'];
