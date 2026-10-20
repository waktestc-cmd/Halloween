# Pumpkin Smash — Art Direction

Replaces all visual guidance in SPEC.md.

## The one idea: "Light is the only colour."

The house is pitch dark. Colour exists ONLY where there is a light source: the torch, pumpkins, candles, the hammer's spark. Everything else is monochrome ink and bone. This is both the gameplay (you hunt with a torch) and the design system. Every screen should look like it is lit by candlelight in a dark room. If an element doesn't emit light, it gets no colour and no glow.

## Delete these (they read as generic AI output)

* Purple radial-gradient backgrounds and drifting confetti/dust particles at rest
* Gradient buttons (orange→magenta), gradient text, neon glow on text and borders
* Rounded cards with thin borders ("card soup"); identical radius and padding everywhere
* Small UPPERCASE letter-spaced section labels ("LIVE FROM THE HOUSE", "WHO IS WHERE")
* Emoji as the visual language (costumes, feed icons, pumpkins, hammer)
* Fonts: Creepster, Inter, Space Grotesk, Poppins
* Dashboard layouts that show everything at once

## Tokens

```
--ink:    #0A0908   /* warm black background (not purple, not navy) */
--soot:   #15120E   /* the rare raised surface */
--bone:   #EDE3CF   /* primary text, silhouettes, line art */
--ash:    #7E7567   /* secondary text, unlit things */
--flame:  #FF7A1A   /* THE accent: light sources, CTA, claimed pumpkins, timer */
--ember:  #FFC46B   /* the hot core of the flame only (centre of glows) */
--blood:  #C3122B   /* death and the zombie result ONLY */
--wraith: #A9E8DA   /* ghosts ONLY, low opacity */
```

* Glow is allowed only on flame/ember light sources: radial falloff, no outlines.
* Radius: 0 or 2px. No shadows except light falloff. Separate things with space and tone, not borders.

## Type

* Display: Fraunces (variable; opsz 144, weight 800–900, SOFT 100, WONK 1). Storybook-gothic, characterful, not cliché.
* UI/body: Atkinson Hyperlegible (400/700). Readable on a shared screen.
* Numerals (timer, counts): Fraunces with tabular figures.
* Scale with real contrast: the hero line is huge (8–12vw on the host); everything else is small and quiet. One hero per screen.
* Sentence case everywhere. No letter-spaced caps.

## Characters (costumes) and objects

* Replace emoji with 12 code-drawn SVG silhouettes in one consistent cut-paper style: solid bone fill, no outline, a simple shape plus 1–2 negative-space details (eyes in a mask, a witch's hat brim). Witch, Vampire, Mummy, Skeleton, Werewolf, Zombie, Ghost, Pumpkin-head, Bat, Black Cat, Spider, Devil.
* Pumpkins: a carved shape. Unlit = ash outline. Lit = flame fill with an ember core and a flickering glow.
* Hammer: a bone silhouette with a flame spark at the impact moment only.
* Ghosts: soft wraith-coloured smoke shapes with two dark eye holes. They're the only cold colour in the game.

## Screens

* **Join (player):** A dark page. The title is set in Fraunces. The name field is a single bone underline (no box). The costume picker is a row of silhouettes in the dark; hovering passes a small torch light over them, and the selected one stays lit. The CTA is a solid flame rectangle with ink text and no gradient. Spooky/Mild is a small text toggle.
* **Lobby (host):** The silhouette of a house facade. Each player who joins lights up a window, with their silhouette and name beneath it. The QR code sits as a small "invitation" in the corner.
* **Hunt (player):** a real horror environment (Amnesia-style), not a black canvas. See "Environment" below.
* **Hunt (host) = a broadcast, not a dashboard:**
  * Hero: six pumpkins on a mantel across the top. Unclaimed ones are unlit; claimed ones ignite with the holder's silhouette and name beneath.
  * The timer is a candle that burns down, with large Fraunces numerals beside it.
  * The feed is a single-column séance log in Fraunces italic. The newest line is large and lit; older lines shrink and fade into darkness after about 5 items. No icons, no boxes.
  * The map is a floor plan in bone hairlines. Players are small silhouette dots, and each room glows faintly in proportion to how many people are in it.
  * Soul leaders are a quiet 3-line list at the bottom edge.
* **Vote:** The six pumpkins are large. The vote weight is shown as the brightness and glow size of each pumpkin, not bars. The most-voted pumpkin burns brightest.
* **Smash:** A full-screen moment. The hammer winds up (anticipation), slams down, then a 1-frame bone flash with a 120ms hit-stop. The pumpkin shatters into flame shards with a screen shake, followed by silence and one line of type.
* **Result:** One hero line ("Friday afternoon off." in flame, or "Zombie pumpkin." in blood). Awards are typeset like end credits, a centred list in Fraunces with no cards.

## Environment (the hunt rooms)

Target feel: Amnesia-style dread. A real room you can't see, revealed only by your light. For adults.

Approach: 2.5D fixed-camera rooms with dynamic torch lighting (not free-roam 3D, so it stays point-and-click for non-gamers and avoids motion sickness).

* Each of the 5 rooms is a single high-resolution painted background (1920×1080+): Hall, Attic, Crypt, Swamp, Chapel. One consistent style across all five: desaturated, painterly, Victorian gothic, rendered as if lit only by a lantern.
* Each background has a normal map and a depth map. The torch is a real 2D light (WebGL shader): surfaces catch light by their normals, so walls, beams and furniture look 3D as the torch moves. The base ambient is ~2%, so the room is almost invisible.
* Parallax: 2–3 layers (far wall, mid furniture, foreground silhouettes such as chair backs and cobwebs) shift slightly with the mouse.
* Atmosphere: film grain, a heavy vignette, slow dust motes visible only inside the torch beam, an occasional distant sound with a matching visual (a door at the edge of the room swings, a candle somewhere flares and dies).
* Items (pumpkins, souls, hammer) are placed on believable surfaces in each room (shelf, pew, coffin lid, rafters), not floating.
* Ghosts are partially visible outside the beam (a faint silhouette at the edge) and fully visible when lit. Light makes them real.
* Sound: positional (stereo pan by x position). Footsteps, creaks, breathing when a ghost is near.
* Tech: PixiJS (WebGL) with a custom lighting filter, or a small three.js orthographic scene using a normal-mapped plane plus a PointLight that follows the cursor. Fall back to a Canvas 2D radial mask if WebGL is unavailable.

Asset sourcing rules (the game may be public):

* Do NOT use assets ripped from commercial games (Amnesia, Look Outside, etc.). Their art is not open-licensed, even where the engine code is.
* Allowed: CC0 / public-domain sources (Poly Haven textures and HDRIs, Kenney, Freesound filtered to CC0), assets the team generates itself (e.g. room paintings made with Gemini image generation), and code-drawn art.
* Generate normal and depth maps from the paintings (e.g. with the free tool Laigter, or a depth-estimation model).
* Keep an `ASSETS.md` listing every asset, its source and its licence.

## Motion

* Easing with anticipation and overshoot. Nothing linear, nothing floats aimlessly.
* Flicker only on light sources (2–4% amplitude). Particles only at events (a claim, a death, the smash), never ambient.
* Respect prefers-reduced-motion and Mild mode.

## Voice

Dry, deadpan, short. "Rob was taken by the Drowned Bride." "Pumpkin 3 has a keeper." "Nobody trusts Priya."

## Check before shipping

Screenshot each screen and ask: is there exactly one hero? Is colour only on light sources? Could this belong to any other product? If yes, it isn't finished.
