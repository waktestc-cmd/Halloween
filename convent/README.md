# Escape the Convent

A Halloween game for 20–25 people on their laptops, all in the same house at once. You walk a dark
convent in first person with a flashlight. Nuns patrol the halls and ghosts drift through the rooms.
Everyone works together to get out before dawn.

## Playing

| Key | Does |
| --- | --- |
| **W A S D** or **arrow keys** | Walk (left and right arrows turn you, unless you switch that off in Settings) |
| **Mouse** | Look around (click the screen once to start) |
| **Shift** | Run. It's faster, but the nuns hear it, and you run out of breath after a few seconds |
| **E**, **Space** or **click** | Open a door, search a drawer, hide, use the fuse box, the desk or the front door |
| **F** | Flashlight on or off. It lights your way but lets the nuns see you from further off, and the battery runs down |
| **M** | Map: every room by name, you as an arrow, the others as dots |
| **Esc** | Settings: volume, music, brightness, mouse speed, arrow-key turning, gentle mode, bigger text, full screen |

**The goal, as a team:**
1. Find the **fuse** (hidden in a drawer, cupboard or crate somewhere) and put it in the **fuse box** in the cloister. The cloister lights come on.
2. Find the **brass key** and open **Mother Superior's desk**. The note inside says which three rooms hold the iron keys.
3. Bring the **three iron keys** to the **front door**, one padlock each.
4. The door opens and every nun comes for you. You have two minutes to get out.

**Lives:** you have three, shown as candles. A nun or a ghost catching you the first or second time sends
you back to the dormitory. The third time, you're out and can only watch the others. Whatever you were
carrying drops where you were caught, and someone else can pick it up.

**The nuns** hum and carry a small bell, so you hear them coming. Your heartbeat gets louder as one gets
close. If one sees you, you hear a shriek and chase music: run, or hide in a wardrobe, under a bed or
behind a curtain. If she saw you climb in, she'll pull you out.

**The ghosts** drift toward you slower than you walk. Walk away, or hold your flashlight on one until
it shrieks and vanishes.

## Running it

```bash
npm install
npm start             # http://localhost:3000, big screen at /host?key=spooky
HOST_KEY=secret npm start
npm test              # plays the rules through against a real server
node tools/bots.js 20 --url http://localhost:3000   # fake players for trying it out
```

- Open `/host?key=<HOST_KEY>` on the big screen. It shows a QR code and the join address.
- The host picks Easy, Normal or Scary and starts the night.
- During the game the big screen shows the whole map, including where the nuns and ghosts are (the players can't see that), progress, and news as it happens.

## Putting it online (Google Cloud Run)

The game lives in one server's memory, so it must run as **one instance**, with websockets kept open.
`deploy.sh` does it all. In [Google Cloud Shell](https://shell.cloud.google.com), with this repository
cloned:

```bash
cd convent
HOST_KEY=choose-a-secret ./deploy.sh                    # your current gcloud project, europe-west1
HOST_KEY=choose-a-secret ./deploy.sh my-project us-central1
```

It prints the address for players and the big-screen address. What it sets, and why:

| Setting | Why |
| --- | --- |
| `--min-instances 1 --max-instances 1` | exactly one copy of the game, already warm when people arrive |
| `--session-affinity` | each laptop keeps talking to that one copy |
| `--timeout 3600` | a websocket can stay open for an hour (Cloud Run's maximum); the game reconnects by itself after that |
| `--no-cpu-throttling` | the nuns keep moving between messages |
| `--concurrency 100` | room for 25 players, the big screen and reconnections |
| `HOST_KEY` | the password in the big-screen address |

Don't redeploy during the party: a new version starts an empty game. Afterwards, set
`--min-instances 0` (the script prints the command) or delete the service so it costs nothing.

## How it's built

- `shared/level.js`: the house, a grid of 2 m tiles, with rooms, doors and every piece of furniture. The server and the browser both use it.
- `shared/config.js`: speeds, sight ranges, lives, timings and difficulty.
- `src/game.js`: the server.
  - It owns doors, hidden items, the puzzle stages and who gets caught.
  - It runs the nuns: patrol, hear, investigate, see, chase, search, and pull you from a hiding place.
  - It runs the ghosts.
  - Players report their own position; the server checks it's plausible.
- `public/js/`: the browser, using three.js.
  - `world.js` builds the house.
  - `actors.js` has the other players (an animated figure), the nun and the ghost.
  - `audio.js` handles sound, placed in 3D.
  - `ui.js` handles the map, settings and on-screen display.
  - `main.js` holds it all together.
  - `atmosphere.js` has the dust, the danger edge and each player's small events.
  - `models.js` loads the models listed in `models.json`.
- Furniture is merged into a few meshes per room and only the nearest four lamps or candles really shine,
  so ordinary laptops cope. If one still struggles, the game lowers its own resolution, then its shadow
  quality, then turns shadows off.

## Swapping in better art and sound

- **Sound:** drop recordings into `public/assets/sounds/` with these names and they replace the made-up sounds, with no code change:
  - `ambience`, `chase`, `nun-hum`, `bell`
  - `ghost-whisper`, `ghost-boo`, `heartbeat`, `thunder`
  - `jump-scare`, `door-slam`

  Each can be `.mp3`, `.ogg` or `.wav`.
- **Models:** the furniture and courtyard use Kenney's Furniture and Graveyard kits, the players wear one of ten
  Quaternius costumes (picked per player), and the nun stays the tall built figure. `public/assets/models/models.json` says which `.glb` file to use for each kind of furniture
  (the names in `PROP_TYPES` in `shared/level.js`), for the players and for the nun. A model is turned and
  sized to the same footprint as the shape it replaces, so hiding places and walls stay the same. Anything
  not listed keeps the built shape; with no `player` entry the players use `Soldier.glb`. See the top of
  `public/js/models.js` for the options, and `ASSETS.md` for where each file came from.

## What makes it scary (and what gentle mode turns down)

- Dust drifts in your flashlight beam. The flashlight stutters and the screen edge darkens red when a nun or ghost is close.
- The house acts up on its own, the same for everyone nearby: a door slams or creaks open, knocking behind a closed door, the cloister lamps stutter, a far-off wail.
- Each player also gets small moments of their own: a creak behind you, footsteps that stop when you turn, a book falling, a music box in the next room, a pale figure at the end of a corridor that is gone when you get close.
- Portraits change while the lightning flashes. The hall clock ticks, taps drip, the boiler rumbles.
- None of it can catch you. Gentle mode leaves out the footsteps, the figure and the wail, and makes the rest less frequent.
