# Gas Station: notes

A lonely roadside filling station on a flat desert highway, seen from the far shoulder across
the two-lane road, in one-point perspective. Big sky, low mesas on the horizon, a canopy over two
pump islands, a small shop behind it, and a tall price pylon at the lot's corner by the road.
The pylon's three windows show live Claude figures instead of fuel prices: tokens, context,
weekly.

The plan below was written before painting; the numbers in it are the ones the scene was built
with. Results follow.

## Composition (cells of the 320 x 200 grid)

- Camera: eye 1.8 m over the ground, horizon on row 126, focal length 230 cells, centre column
  160 (the same small renderer as Side Street, `core.mjs`).
- Foreground: the near gravel shoulder (rows 184-199), the highway along X (rows 155-183), the
  station's lot beyond it (rows 126-155).
- Left: the canopy (fascia rows 72-85, soffit to row 100, x 0-152) over two islands of two
  pumps, the shop behind it (rows 105-139, x 0-123). It shows beside the chat on the left.
- Middle (behind the chat): the open lot, the far plain, a flat horizon with a saddle in the far
  range where the sun sets, sky, and the street lamp's pole (x 220-224). Calm.
- Right: the pylon (cabinet x 250-291, rows 36-122, cap from row 32, two legs down to a planter
  on the lot at row ~153), low mesas behind it.
- The price windows: three painted panels, x 255-286, rows 66-76, 86-96 and 106-116, each with a
  cream label strip (TOKENS, CONTEXT, WEEKLY, in the scene's own 3 x 5 letters) above it and a
  GAS panel (7 x 9 letters) on top. Inside each frame the panel is 30 x 9 cells; the digits'
  window is 28 x 7 (x 257-284), with one clear cell all round. All of it lies inside x 228-292,
  rows 35-150: beside the chat at 16:9 (chat right edge x 240) and at 4:3 (x 226; columns
  27-293 visible), and below row 20 (cut at 16:9).
- The marker `<g id='bk-board'></g>` sits once, at the top level of the nested 320 x 200 Svg,
  right after the still scene (which holds the panels) and before every sprite. Nothing moves
  over the windows: the pickup's roof is on row 129 or lower (the lowest window ends on row 116),
  the moths circle the canopy, the neon is the GAS sign above the windows.

## Key light per moment (lighting.md, rule 1)

| Moment | Key light | Colour / shadow colour | Local lights |
| --- | --- | --- | --- |
| day | Sun 55 degrees up, behind the viewer on the right (azimuth 150 degrees from straight ahead). Fronts facing us and right-hand faces lit; left-hand faces (the pylon's side) in shadow. Shadows fall back and to the left: the canopy's on the lot over the pumps, the lamp pole's and the pylon's back-left on the lot. | Warm white sun / cobalt sky shadow. | None. Pump screens faintly on. |
| sunset | Sun in the frame at cell (196, 117), about 2 degrees over the horizon, in a saddle of the far range between the canopy and the pylon. Backlit: fronts dark, edges toward the sun rimmed orange, shadows very long, fanning out toward the viewer from under the sun (the lamp pole's across the road, the pylon's to the right, the passing pickup's across both lanes). | Orange-gold sun / violet shadow. | Canopy lights just on, shop window warm, pylon panels lit, neon on, the street lamp starting. |
| night | Moon high at upper left, cell (58, 34). Faint cool light, short faint shadows toward the viewer and right. | Cool blue moon / deep blue shadow. | Canopy downlights (warm white pools on the lot and the pump fronts), the shop window (warm pool on the lot), the pylon's glow at its foot, one sodium street lamp over the road (orange pool on both lanes). |

## Motion (calm only)

- Clouds drifting a few cells there and back over 70-90 s, by whole cells: cumulus by day, long
  thin streaks lit from below at sunset, two thin dark clouds at night.
- Stars dimming softly (to 55% and back over 12% of their own cycle) at night.
- Moths circling the canopy's two front rows of lights at night (12-frame loops, 3-4.5 s).
- A red pickup passing right to left in the far lane once a 50 s cycle (sets off at 16 s,
  crosses in about 8 s): headlamp and tail lamp lit at sunset and night, a beam on the road at
  night, and at sunset a long shadow running toward us across both lanes.
- The GAS neon breathes between 45% and 100% over 8 s in 16 steps (sunset, night); never a
  blink.

No flashes, strobing, shaking, wipes or zooms.

## Files

`build.mjs` (lighting, quantizing, layers, encoding), `core.mjs` (renderer), `scene.mjs` (what
stands where), `moments.mjs` (light and palette), `motion.mjs` (sprites), `pylon.mjs` (the
pylon's face, its lettering and the board's windows), `encode-local.mjs` (Side Street's copy of
harbor's encoder), `png.mjs`, and the tools:

- `node build.mjs [moment]` writes `out/gas-station-<moment>.svg`, `out/board.json` (after
  `checkBoard`) and `out/debug/keys.json`; `PREVIEW=1` also writes a cell preview,
  `PROBE='x,y;...'` prints what a cell is and its colour.
- `node render.mjs [moment ...]` draws the scenes as the app does, with the board filled with
  SAMPLE, into `out/preview/gas-station-<moment>.png` (1536 x 864). `T=`, `CROP=`/`ZOOM=`,
  `VW=`/`VH=`, `VALUES=`, `EMPTY=1` write into `out/frames/`.
- `node check.mjs` checks the rules and the marker, then fills the board with SAMPLE, `{ tokens:
  888, context: 5 }` and `{ tokens: 99.9e3, context: 100, weekly: 100 }`, checks those too and
  writes them to `out/filled/` for seamscan, purity and the player.
- `node debug.mjs` writes the value map and the light check (`out/debug/<moment>-value.png`,
  `<moment>-light.png`).

Only the three scenes and `board.json` sit at the top of `out/`.

## Results (2026-11-19)

**Sizes** (empty marker; limit 126,000): day 48,751, sunset 60,792, night 57,301 characters.
Filled with SAMPLE: 50,270 / 62,311 / 58,820.

**board.json**

```
{ "yo": 0,
  "rows": [ { "id": "tokens",  "x": 257, "y": 68,  "w": 28, "align": "right" },
            { "id": "context", "x": 257, "y": 88,  "w": 28, "align": "right" },
            { "id": "weekly",  "x": 257, "y": 108, "w": 28, "align": "right" } ],
  "ink":  { "day": "#ffb52e", "sunset": "#ffc23e", "night": "#ffc44a" },
  "halo": { "day": "#3a1c10", "sunset": "#6a2a0e", "night": "#7a2e0a" } }
```

The panels are #141012 / #120d0e / #0e0a0c, so the amber digits stand on near-black at every
moment; the halo is a dim ember round them.

**Checks**
- `check.mjs`: board.json ok (`checkBoard` has no problems); every scene and all nine filled
  copies ok: single quotes, no banned property, viewport unit, media query or outside url,
  at most 64 runs a path, every time on the 0.05 s clock, the reduced-motion stop; the marker
  once, a child of the nested 320 x 200 Svg with no transform above it.
- `engine/seamscan.mjs`, 11 sizes, on the SAMPLE copies: no holes anywhere; most line pixels
  day 11, sunset 14, night 13 (all at 1440x900@1) at T=0; the same at T=37; 10 / 14 / 13 at
  T=20 (pickup on screen). The two edge-case copies of each moment: all ok.
- `engine/purity.mjs` (6, 8 and 9 px a cell), with and without HIDEGRAD: 0 impure pixels in
  every moment.
- `editor/test/player.mjs` (the app's list, parser and 5.56 ms limit, 1536x864 at 1.25x):

| Moment | Window 1 average / worst | Window 2 average / worst | Result |
| --- | --- | --- | --- |
| day | 0.44 ms / 3.8 ms | 0.40 ms / 0.8 ms | PLAYS |
| sunset | 0.48 ms / 8.7 ms | 0.43 ms / 0.7 ms | PLAYS |
| night | 0.55 ms / 9.4 ms | 0.49 ms / 1.1 ms | PLAYS |

The app's new flash detector and frame reader are not in the port; the motion is kept calm.

**Light check** (`debug.mjs`): by day the pole's and the pylon's shadows fall back-left along the
arrows; at sunset the shadows of the pumps, the pole and the pylon fan out from the sun's foot
toward us along the arrows; at night the lamps give the pools and the moon only faint shadows.

## What changed while iterating

- Lamp cones lit nothing at first: the cone test had Y the wrong way up (Y is down).
- The shop's right window and door were all frame: one mullion test ran over every pane. Each
  pane now has its own.
- Day exposure: sun 1.22 to 1.04, sky light 0.95 to 0.68, the lot's concrete darker, the
  canopy's soffit lit by a lighter, neutral bounce. The lot was nearly white before.
- The near shoulder's dry grass was large yellow blotches; it is now small olive tufts in gravel
  with stones.
- The lamp pole's shadow broke into dashes on the far lot, where one row is 0.6-0.7 m of ground:
  the sun's four rays now start spread over a cell's depth on the ground, a cell there is in
  shadow or not, and the pole throws a 0.6 m shadow (it is drawn 0.26 m wide).
- Sunset: the setting sun was hidden by the far range, which now has a saddle there; the rays
  were dropped (they read as a cartoon sunburst and a slab over the sky); the clouds became
  long thin streaks; the pickup's shadow was missing (a sun this low passes under the body), so
  its shadow casters now reach the road.
- Night: canopy lights 2.0 to 1.45 (the lot was blown out), the street lamp 1.8 to 2.8 so its
  pool shows on the road.

## Second pass (2026-11-19, after the owner looked at it in the app)

The owner's notes: the passing car looked awful, the lights were black, the canopy was crooked,
and there was a light gap under the wheels.

- The canopy now runs from X -26 to X 0. Its right end is straight over the eye, so it shows as
  a clean square end with no slanted side face, and its left end is off the picture (no notch in
  the soffit). Six fixtures a row, evenly spaced.
- After dark the soffit glows (`soffitGlow`): light thrown back up off the lot, strongest round
  each fixture. Before, the lamps sat on a black ceiling.
- A soft three-ring glow round the street lamp's head in the sky (`lampHalo`), sunset and night.
- The pickup is drawn again from its side profile (`sideAt` in motion.mjs): a rounded nose, the
  hood rising to the cowl, a raked A-pillar, a side window with a vent pane, a seat back, a cream
  roof with rounded corners, doors, a handle, a fuel door, a cream stripe, fender lips round the
  arches, wheel wells, cream steel wheels with chrome caps, chrome bumpers, side markers. The
  tops seen from above (hood, roof, the open bed) are their own faces. Under it the road is in
  its own shade (`underShadow`), so there is no light gap between the body and the road. At
  sunset its top edges catch the sun (`truckSheen`); at night a soft warm fill (`truckFill`) and
  a cool sheen let its side read, and the sodium light reaches in under it (`underLift`).

Then the owner saw the night pass in the app: the headlights threw a dark patch ahead of the
pickup, and the shade under it looked wrong. Both were painted once at the render position, lit
by the headlamp or the sky alone, without the sodium lamp that lights the road around them, and
then slid along the road. They are now see-through layers that move with the pickup
(`roadOverlay` in motion.mjs): the beam a pale warm layer in two strengths (`beam`), so it only
ever adds light, and the shade a dark layer in two strengths (`underShade`), strongest under the
middle, so it darkens whatever road it is over.

Then the owner said the shade's front, under the hood, looked square, and that the wheels did
not turn.

- The square block was not the shade: it was the wheel well's flat bottom and the frame's front
  end, both dark and cut straight under the front overhang. The well now shows only above the
  body's bottom line, and the frame runs from wheel to wheel, its ends behind the tyres.
- The shade's footprint is a superellipse (power 3), as long as the body and reaching 2.2 m past
  its far side, set in the pickup's own columns (X taken back along the line of sight to its near
  side). The road seen under the overhangs, as far as the curb, is in shade, and its ends come to
  a round tip under the bumpers.
- The steel wheels have five round holes. Their faces are drawn again in four frames (`SPIN`),
  each turned a quarter of a hole's step further, over the pickup in its own moving group, one
  shown at a time (`wf0`-`wf3`, 0.2 s a cycle, 0.05 s a frame). At 46 cells a second a wheel
  rolls a hole's step (a fifth of a turn, 9.3 cells) in 0.2 s, so they turn at the speed it
  drives, anticlockwise as it goes left. The light on them stays where it is.

Sizes after this pass (empty marker): day 56,419, sunset 68,230, night 64,009 characters. Every
check above passes again: check.mjs, seamscan at T=0 and with the pickup on screen (no holes, at
most 13 line pixels), purity 0, player PLAYS at 0.4-0.5 ms.

## Open points

- The sunset streak nearest the sun is thin, with dark tops; it reads a little busy at 1x.
- The pylon's body is near black at night; only the strips, digits and neon glow. That is the
  intent, but a faint lit edge could help it read as a cabinet.
