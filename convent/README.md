# Monster Manor

A Halloween game for 20–25 people on their laptops, all in the same house at once. You walk dark
Blackwood Manor in first person with a flashlight. A vampire, a stitched-together giant and a few
zombies hunt the halls, and ghosts drift through the rooms. Everyone works together to get out
before dawn. (It began as *Escape the Convent*; the folder keeps that name.)

## Playing

| Key | Does |
| --- | --- |
| **W A S D** or **arrow keys** | Walk (left and right arrows turn you, unless you switch that off in Settings) |
| **Mouse** | Look around (click the screen once to start) |
| **Shift** | Run. It's faster, but the monsters hear it, and you run out of breath after about ten seconds. Running is how you get away from a monster |
| **E**, **Space** or **click** | Open a door, search a drawer, hide, use the fuse box, the desk or the front door |
| **F** | Flashlight on or off. It lights your way but lets the monsters see you from further off, and the battery runs down. Switch it off for a while and it slowly charges up again |
| **Q** | Flash. Every monster in a wide cone in front of you is dazzled for 3 seconds and loses you, and ghosts vanish. No aiming needed. It uses a quarter of your battery (you need at least that much) and takes 10 seconds to charge again |
| **G** | Drop what you carry, just in front of you. Anyone can pick it up with **E** |
| **M** | Map: every room by name, you as an arrow, the others as dots, and a card with your goal, what you carry, who is in the house and the latest news |
| **Esc** | Settings: volume, music, brightness, mouse speed, arrow-key turning, gentle mode, bigger text, full screen |

**Joining:** type your name, pick a costume (wizard, witch, pirates, ninja, viking, knight, cowgirl, chef or
doctor; it turns slowly in the lantern light so you see it) and a colour for its clothes, and press
**Enter the manor**. That is how the others see you in the house.

**The goal, as a team:**
1. Find the **fuse** (hidden in a drawer, cupboard or box somewhere) and put it in the **fuse box** in the gallery. The gallery lights come on, and something wakes up in the laboratory.
2. Find the **brass key** and open **the Count's desk** in his study. The note inside says which three rooms hold the iron keys.
3. Bring the **three iron keys** to the **front door**, one padlock each.
4. The door opens and every monster comes for you. You have two minutes to get out.

**How to win** (the lobby and the map card say the same): when chased, run with Shift, then hide in a
wardrobe, under a bed or behind a curtain; when cornered, flash with Q; follow the clue messages and the
map's "left to search"; work as a team; and press G to drop what you carry for someone else.

**Lives:** you have three, shown as candles. A monster or a ghost catching you the first or second time
sends you back to the guest bedrooms. The third time, you're out and can only watch the others. Whatever
you were carrying drops where you were caught, and someone else can pick it up.

**The monsters**, each with its own sound so you hear it coming. Your heartbeat gets louder as one gets
close. If one sees you, it cries out and chase music starts: run, or hide in a wardrobe, under a bed or
behind a curtain. If it saw you climb in, it pulls you out.

| Monster | Lives in | Sounds like | Good to know |
| --- | --- | --- | --- |
| **The Count**, a vampire in the style of the 1922 *Nosferatu* | the Crypt | slow breathing | The fastest. Shine your flashlight in his face and he hisses and hides his eyes for a moment |
| **The Doctor's Monster**, a stitched giant | the Laboratory, asleep on the slab | heavy footsteps, a growl | Wakes when the power comes back. Slow, but he sees far |
| **Zombies** (more with more players) | the Graveyard | groaning | Slow; they wander the graveyard, the gallery and nearby rooms |

**The ghosts** hum as they drift toward you, slower than you walk. Walk away, or hold your flashlight on
one until it shrieks and vanishes.

**Trick or treat:** wrapped sweets lie on the floors all over the house (about forty, and a new one turns up
every 15 seconds). Just walk over one to pick it up, no key needed. Your count shows on the card at the bottom
of the screen and on the map; each sweet is worth 2 points at dawn, and whoever collects the most gets the
*Sweet tooth* award. The big screen shows them as small pink dots.

**Help finding things:** when you walk into a room, a short line says how many hiding places are left to search there ("2 places left to search in the Kitchen.", or "Everything in the Kitchen has been searched."); it only speaks up when that has changed since you were last there. The map shows the same under each room's name. Every emptied hiding place gets a tick on everyone's map, and if nobody has found
the fuse (or the brass key) for 3 minutes, a clue says which room it is in.

**Trying it out:** join with the name **tester** and you never run out of lives, and your map shows where
the fuse and keys are hidden (the big screen still shows your catches). This only works on a test server: on Cloud Run (`NODE_ENV=production`) it is off
unless you set `TESTERS=1`.

## Running it

```bash
npm install
npm start             # http://localhost:3000, big screen at /host?key=spooky
HOST_KEY=secret npm start
npm test              # plays the rules through against a real server
node tools/bots.js 20 --url http://localhost:3000   # fake players for trying it out
```

- Open `/host?key=<HOST_KEY>` on the big screen. It shows a QR code and the join address.
- The big screen's lobby is a dark house: a window lights up, with their costume and name, for each guest who comes in.
- The host picks Easy, Normal or Scary and presses **Open the house**. The house laughs, on the big screen and every laptop.
- During the game the big screen shows the whole map, including where the monsters and ghosts are (the players can't see that), progress, and news as it happens.

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
| `--no-cpu-throttling` | the monsters keep moving between messages |
| `--concurrency 100` | room for 25 players, the big screen and reconnections |
| `HOST_KEY` | the password in the big-screen address |

Don't redeploy during the party: a new version starts an empty game. Afterwards, set
`--min-instances 0` (the script prints the command) or delete the service so it costs nothing.

## How it's built

- `shared/level.js`: the house, a grid of 2 m tiles, with rooms, doors and every piece of furniture. The server and the browser both use it.
- `shared/config.js`: speeds, sight ranges, lives, timings and difficulty.
- `src/game.js`: the server.
  - It owns doors, hidden items, the puzzle stages and who gets caught.
  - It runs the monsters: patrol, hear, investigate, see, chase, search, pull you from a hiding place; the Count flinches from light, the Doctor's Monster sleeps until the power is back.
  - It runs the ghosts.
  - Players report their own position; the server checks it's plausible.
- `public/js/`: the browser, using three.js.
  - `world.js` builds the house.
  - `actors.js` has the other players (in costume), the three kinds of monster and the ghost.
  - `audio.js` handles sound, placed in 3D.
  - `ui.js` handles the map, settings and on-screen display.
  - `main.js` holds it all together.
  - `join.js` is the join screen (with the turning costume), `costumes.js` the costume silhouettes.
  - `atmosphere.js` has the dust, the danger edge and each player's small events.
  - `candy.js` draws the sweets (all of them in one instanced mesh).
  - `models.js` loads the models listed in `models.json`.
- Furniture is merged into a few meshes per room and only the nearest four lamps or candles really shine,
  so ordinary laptops cope. If one still struggles, the game lowers its own resolution, then its shadow
  quality, then turns shadows off.

## Swapping in better art and sound

- **Sound:** drop recordings into `public/assets/sounds/` with these names and they replace the made-up sounds, with no code change:
  - `ambience`, `chase`, `nun-hum` (the ghosts' hum), `bell`
  - `ghost-whisper`, `ghost-boo`, `heartbeat`, `thunder`
  - `jump-scare`, `door-slam`, `zombie-groan`, `zombie-snarl` (the zombies, and pitched down for the Doctor's Monster)

  Each can be `.mp3`, `.ogg` or `.wav`.
- **Models:** the furniture and graveyard use Kenney's Furniture and Graveyard kits, the players wear one of ten
  Quaternius costumes (picked per player), the zombies are Quaternius zombies, and the Count and the Doctor's
  Monster are built in code (`actors.js`). `public/assets/models/models.json` says which `.glb` file to use for each kind of furniture
  (the names in `PROP_TYPES` in `shared/level.js`), for the players and for the zombies. A model is turned and
  sized to the same footprint as the shape it replaces, so hiding places and walls stay the same. Anything
  not listed keeps the built shape; with no `player` entry the players use `Soldier.glb`. See the top of
  `public/js/models.js` for the options, and `ASSETS.md` for where each file came from.

## What makes it scary (and what gentle mode turns down)

- Dust drifts in your flashlight beam. The flashlight stutters and the screen edge darkens red when a monster or ghost is close.
- The house acts up on its own, the same for everyone nearby: a door slams or creaks open, knocking behind a closed door, the cloister lamps stutter, a far-off wail.
- A handbell rings in an empty room now and then.
- Each player also gets small moments of their own: a creak behind you, footsteps that stop when you turn, a book falling, a music box in the next room, a pale figure at the end of a corridor that is gone when you get close.
- Portraits change while the lightning flashes. The hall clock ticks, taps drip, the boiler rumbles.
- None of it can catch you. Gentle mode leaves out the footsteps, the figure and the wail, and makes the rest less frequent.
