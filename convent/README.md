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

On GCP, the `Dockerfile` runs as is on Cloud Run. Set `HOST_KEY`, and keep it to one instance, since
the game lives in that server's memory. Use session affinity and a request timeout of at least an hour
so the websockets stay up.

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
- If a laptop struggles, the game lowers its own resolution and shadow quality.

## Swapping in better art and sound

- **Sound:** drop recordings into `public/assets/sounds/` with these names and they replace the made-up sounds, with no code change:
  - `ambience`, `chase`, `nun-hum`, `bell`
  - `ghost-whisper`, `ghost-boo`, `heartbeat`, `thunder`
  - `jump-scare`, `door-slam`

  Each can be `.mp3`, `.ogg` or `.wav`.
- **Models:** the other players use `public/assets/models/Soldier.glb`, which has idle, walk and run animations. A character pack with the same animations can replace it. See `ASSETS.md`.
