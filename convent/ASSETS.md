# Assets and where they come from

| What | File | Source | Licence |
| --- | --- | --- | --- |
| Players' figures: 10 costumes (wizard, pirates, ninja, viking, knight, cowgirl, zombie, chef, doctor), with idle/walk/run | `public/assets/models/characters/*.glb` | Quaternius *Ultimate Animated Character Pack* (Nov 2019), converted to .glb keeping only Idle, Walk and Run | CC0 |
| Fallback player figure | `public/assets/models/Soldier.glb` | three.js examples, originally from Mixamo | Shipped with three.js (MIT repository); internal event use |
| Beds, wardrobes, cabinets, tables, desks, stove, sink, boxes, bathtub, rugs, coat rack | `public/assets/models/furniture/*.glb` | Kenney *Furniture Kit* 2.0, recoloured in `models.json` | CC0 |
| Gravestones (no crosses), benches and pews, altar, coffin, crypt, urn, shovel, iron fence, carved pumpkins | `public/assets/models/graveyard/*.glb` and `Textures/colormap.png` | Kenney *Graveyard Kit* 5.0 | CC0 |
| Wooden floor, brick | `public/assets/textures/*.jpg` | three.js examples | Shipped with three.js (MIT repository) |
| Footsteps, doors, searching, found, hit, win | `public/assets/sounds/sfx-*.mp3` | Kenney sound packs, from the Pumpkin Smash game in this repository | CC0 |
| `ambience.mp3` | | Pikmin 2 soundtrack, "Submerged Castle" (supplied by the organiser) | Nintendo's music; organiser handles rights for this internal event |
| `nun-hum.mp3` | | "Creepy Humming Sound Effect" (supplied by the organiser) | Organiser handles rights |
| `bell.mp3`, `jump-scare-2.mp3` | | Pixabay: freesound_community "handbell" (81953), "jump scare scream" (82738) | Pixabay Content License |
| `ghost-boo.mp3`, `ghost-whisper.mp3` | | Pixabay: Dragon Studio "creepy ghosts moan" (482866), "creepy whisper" (472369) | Pixabay Content License |
| `door-slam.mp3` | | Pixabay: flutie8211 "door slamming 2" (551015) | Pixabay Content License |
| `heartbeat.mp3` | | Pixabay: lenspulse "intense cinematic heartbeat" (584627) | Pixabay Content License |
| `thunder.mp3`, `thunder-2.mp3` (first 10 s) | | Pixabay: u_q2hb2391vb "thunder clap" (521194), soundreality "thunder sound" (375727) | Pixabay Content License |
| `jump-scare.wav` | | Made by the organiser with Adobe Firefly | Organiser's |
| Plaster walls, stone, tiles, wood, cloth, portraits, the nun's face | drawn in code (`public/js/textures.js`, `actors.js`) | Made for this game | Ours |
| Rain, wind, drone, chase music, clock, drips, music box, wail, creaks | made in code (`public/js/audio.js`) | Made for this game | Ours |
| The nun, the ghosts, shelves, dressers, the boiler, the well, candles, the clock | built from simple shapes in code (`world.js`, `actors.js`) | Made for this game | Ours |

The organiser's original downloads were added in `convent/assets/` (commit b515f7d on main) and taken out
again once the files above were copied from them; they are still in the git history.

## How the models are used

`public/assets/models/models.json` lists a model for each kind of furniture, the player figures, and a
`recolor` table that repaints the Kenney furniture colours in older, darker ones. The Quaternius pack has no
nun, and a cartoon figure made into one looked cute rather than frightening, so the nun stays the tall built
one; a `"nun"` entry (see `public/js/models.js`) would replace her with an animated model.

## Still wanted

- A chase track (`chase.mp3`) to replace the made-up chase music
