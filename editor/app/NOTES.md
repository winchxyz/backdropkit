# editor/app: notes

The BackdropKit editor: a static page where anyone makes an animated pixel-art backdrop theme for the Claude Code desktop app and exports it ready to install. Plain ES modules, no framework, no build step, no CDN scripts. The project format is `editor/PROJECT.md`; the exporter is `editor/lib/`, the looks are `editor/fx/`. This file is the log: how to run it, what is where, what was decided, what the tests found.

## Run it

```
EDITOR_ONLY=1 node site/build.mjs     # copies app, lib, fx and the mod hooks into docs/editor/
node site/serve.mjs                   # http://localhost:8765/editor/
node editor/app/test/e2e.mjs          # the end-to-end test (needs the server)
node editor/app/test/fit.mjs          # nothing cut, at six sizes with real scrollbars
```

Both tests launch Chromium with real scrollbars (`ignoreDefaultArgs: ['--hide-scrollbars']`): headless Chromium hides them by default, which hid the 15 to 17 pixels they take on Windows. `PLAYWRIGHT_CORE` may point at a playwright-core `index.mjs`; `OUT` sets where screenshots go.

The page also opens from `editor/app/` itself, without `lib/` and `fx/` next to it: then an estimate stands in for the checks, Play shows the editor's own preview, Export says the exporter is not there, and a small built-in look engine stands in for fx. Everything else works.

## The page

A Claude Code window with the scene behind it, filling the window the way the app fills it (bottom-centred, cropped):

- **Menu bar**: BackdropKit, File, Edit, View, Help (real menus with their keys), the moment and time on show, and a clock.
- **Title row**: `<name> ⌄` (rename, line, slug), the save state, Guide, Show chat, Play, and the two panel toggles. On a first visit Guide wears a quiet ring and a dot (no blinking, no pulse) until the guide has been opened once (`localStorage` key `backdropkit-editor-guide`; if storage fails, the ring simply shows).
- **Left** (like the sessions list): tools, the layers (top first; drag to reorder, double-click to rename, a menu per layer), and **Your art** (the assets strip: click to add as a layer, right-click for more, drop files anywhere). Each layer's line says when it shows first: "All day", "Night only", "Day, Sunset", or for a layer with pictures for different times "Day / Night · 2 pictures". A one-line hint under the list says how layers stack.
- **Right**: the inspector, one frosted panel with a rail of tabs (Layer, Look, Colour, Motion, Effects), cards of controls, and a help line at its foot that says what the control under the pointer does. The help line keeps room for four lines, so a longer help never moves the controls under the pointer. An image layer has a **Times of day** card: its pictures, when each shows, "Add a version for another time of day…", and "Split into layers".
- **Bottom**: the day bar, shaped like the composer: the time, the moment, Play the day, the checks status, Export, and the 24-hour line split into moments (drag the line, drag a start, + Moment).
- **Chat column**: the start ("What do you want to start from?" with four answers), a sample chat over the scene (Show chat), and Export as a short exchange with winch-ai.
- **Narrow screens**: the panels become sheets from the sides (toggles in the title row); the toast moves to the top while a sheet is up.
- **Guide** (`guide.html`): a page of its own in the editor's look, opened in a new tab from the title row, Help → Guide, and the start ("New here? Read the guide"). A contents list and fifteen scenarios in short numbered steps with the exact labels.

Colour is only for state: the status dot (ok, look at, too big), the cost bar when a layer takes more than 60% of a scene, errors. All colours, radii, blurs, spacing and shadows are tokens at the top of `editor.css`, with a dark and a light set. The panels keep one tone (`data-tone` on the root): dark by default; View → Panels: Dark, Light, Follow the scene (`localStorage` key `backdropkit-editor-panels`).

## Modules

| File | What |
| --- | --- |
| `editor.js` | Wiring: menus, keys, search ("/"), drop, paste and open anywhere, hints. |
| `state.js` | The project with its undo history (`change(label, fn, key)`, drafts, merge keys for sliders), and the view's state. |
| `project.js` | The project in memory and as `project.json` (cells as base64 Uint16 LE), new layers, slots, limits. |
| `actions.js` | Every change, each one undoable: layers, palette, Relight, Merge similar, moments, motion, live effects. |
| `canvas.js` | The scene: crisp at any zoom, fill or fit, pan, grid, the paint tools, placing art (drag, corner handles, Alt+wheel, flip). |
| `render.js` | Draws the layers that show at a moment, bottom first; motion sampled at a time for the preview. |
| `layers.js` | The left sidebar. |
| `inspector.js` | The right panel: Layer, Look (presets with live thumbnails, the stack, cost, Make it fit), Colour, Motion, Effects. |
| `controls.js` | The inspector's controls: slider (value shown, double-click resets), seg, select, toggle, colour, text. |
| `day.js` | The day bar, the checks after edits, the checks popover. |
| `play.js` | Play: the real exported SVG of the moment, full window (or the editor's preview without the exporter). |
| `chat.js` | The start, Show chat, Export (form, steps, zip, install prompt with Copy), Save and Open project. |
| `assets.js` | Your art: files in (decoded once, kept as PNG frames), placed on the grid, baked by a look, colours given slots. |
| `fxa.js` | The one door to `editor/fx/` (and `fx/browser.js` for decoding), with a built-in stand-in. Holds the look schema (field words, ranges, help). |
| `adapter.js` | The one door to `editor/lib/`: checks, scenes and export in workers (three lanes), pictures of the site's themes, the archive. |
| `checks-worker.js` | Runs the exporter off the page's thread. |
| `gen.js`, `starter.js` | Generators (sky, sun and moon, stars, clouds, ridges, trees, water): seeded, deterministic, every moment. The blank scene. |
| `color.js` | sRGB and OKLab, the light of each time of day, relighting. |
| `themes.js` | The 14 site themes as the start offers them. |
| `store.js` | The last project in IndexedDB (autosave, restore on load). |
| `ui.js`, `util.js` | Popovers, menus, hints, toast; DOM and number helpers, icons. |
| `zipread.js` | Reading an exported zip back (to open its `project.json`). |
| `guide.js` | The Guide button's first-visit ring and opening the guide. |
| `guide.html` | The guide: self-contained (its own tokens, no scripts but the tone). |
| `test/e2e.mjs`, `test/art.mjs` | The end-to-end test and its test art (PNG photo, day and night photos, sprite, GIF encoders). |
| `test/fit.mjs`, `test/overflow.mjs` | Nothing cut: every screen at six sizes; the check that no text ends past its nearest clipping ancestor's inner box. |

## Keyboard

| Keys | Does |
| --- | --- |
| V, B, E, G, L, R, I | Move, Pencil, Eraser, Fill, Line, Rectangle, Pick colour (or hold Alt) |
| 1 2 3 | Brush size |
| Ctrl/⌘ Z, Ctrl+Y / ⇧⌘Z | Undo, redo |
| Ctrl/⌘ D, Del | Duplicate layer, delete layer |
| Shift+H | Flip your art |
| \ (hold) | Compare with the original art |
| / | Search every setting, layer and command |
| F, 0, + − | Fit, fill as the app, zoom |
| Space (hold), Alt + scroll | Pan; size your art |
| Tab, C | Panels; show chat |
| [ ], , . | Previous or next moment; previous or next frame |
| M, P, Shift+P | Preview motion, play the scene, play the day |
| Ctrl/⌘ S, O, E | Save project, open project, export theme |
| ? | This map |
| Esc | Close search, popover, Play, sheets |

Help > Keyboard shortcuts shows the same map.

## Decisions

- **Art keeps its own colours at every moment** by default. Relighting a photo from day to night by default made it pale by day and muddy at night; the owner's art should look as drawn. "Light by the time of day" (Layer tab, with more than one moment) takes the art as drawn by day and relights it for each moment's light; Relight in the Colour tab turns it on for the art whose slots it touched. Stored as `lit: true` on the image layer (editor-only).
- **Art colours get slots of their own** (`own` on the layer). A slot with the very colours wanted at every moment is shared; otherwise the layer's own slots are reused or added. Merge similar never recolours another layer's own slots.
- **Placing runs on a canvas** (`assets.js placed()`), not `fx.placeAsset`: it is instant during a drag and matches fx's rule (smooth when scaled down, blocks when scaled up).
- **One palette for every frame** of animated art (`applyLookFrames`), so a GIF does not flicker.
- **The look schema lives in `fxa.js`**: field words, ranges, units and help for every fx field, sections in fx's order with `when` rules (a colour field only when the cut is by colour, and so on). fx gives the lists (palettes, dither patterns with cost and hint, glyph sets, presets).
- **Make it fit** (Look tab, shown when a layer takes more than 60% of a scene): fx's `fitLook` simplifies the look a step at a time until the art takes at most 60% of a scene or what the other layers leave (minus 4,000 for the scene's wrapper), and the toast names what changed. One undo step.
- **Checks run in workers, in three lanes** (checks, Play, export). A newer job replaces one still running in its lane, so a very heavy edit (a 390k-character look, say) never holds up the next check, Play, or an export. While a check runs, the last result stays on show with dots.
- **The estimate only stands in** when the exporter is missing; with it, every number in the status, the popover and the cost per layer is the exporter's own.
- **The missing line about the theme** (an exporter warning) stays out of the status: the export form asks for it. The popover says so in a note.
- **The install prompt is shown reflowed** (the exporter's hard-wrapped lines joined, steps with a hanging indent); Copy gives the exporter's text unchanged.
- **The keyboard map** is a three-column card, centred, that fits a 900-pixel-high window.
- **Messages come from winch-ai.** The footer line is "Community project, not affiliated with Anthropic."
- **Pictures for different times of day are one layer** with `versions: { momentId: assetId }` (editor-only, `editor/PROJECT.md` under Image layers). `asset` is the base picture; a moment without a version shows it. Every picture is placed the same (same width as the base, same foot) and takes the one look; each is baked on its own and the layer's `byMoment` holds each moment's cells, which is all the exporter reads. Slot k at a moment takes the k-th colour (darkest first) of the picture shown then. Versions are stills; "Light by the time of day" does not apply to them (each picture is already that moment's light).
- **"My own art" with two to six stills asks** whether they are one scene at different times of day. Each picture gets a thumbnail and a moment chip, guessed by brightness (brightest is Day, darkest is Night; three adds Sunset, four Sunrise and Sunset); picking a moment another picture holds swaps the two. Two pictures make Day 06:00–18:00 and Night 18:00–06:00. "Yes, one scene" makes one layer with versions; "No, separate pieces" places them as before. Splitting later is an explicit choice ("Split into layers").
- **Panels keep one tone** while the day moves. Following the scene flipped every panel from dark to light at sunrise, which read as a glitch while working. Dark is the default; the frost is thick enough (`--panel` 0.92, title and menu bar 0.86) that every panel text reads at 4.4:1 or better over a pure white picture filling the window; light panels read at 4.4:1 or better over pure black.
- **The canvas redraws on doc, time, moment and load events**, not only on pointer moves.

## Test log

`node editor/app/test/e2e.mjs`, Chromium (playwright-core 1.62) with real scrollbars, 1440 x 900, then 1920 x 1080 and 390 x 844 as a phone. 2026-11-16, last run: 40 of 40 steps, no console errors.

| Step | Result |
| --- | --- |
| Start shows four answers | One of the 14 themes, My own art, A blank scene, Open a project |
| Guide button: a quiet ring on a first visit | The ring and dot show, no animation; the start has "New here? Read the guide" |
| Guide opens in a new tab | guide.html, 15 sections, dark |
| Guide ring gone once opened, after a reload too | Help → Guide is there too |
| Theme start | Snowfall Ridge remix: 1 layer, 3 moments, 838 slots, 109,901 of 131,072, ok |
| Panels keep their tone from Night to Day | dark at Night, Day, Night, Day |
| View → Panels: Light, kept after a reload | light, light after reload; Follow the scene at night: dark; Dark |
| New brings the start back | "Back to Snowfall Ridge remix" |
| Own art start (PNG photo) | One image layer, Look tab open, 14,627 of 131,072 |
| Look preset Night grain | 12 presets with thumbnails; the picked one pressed |
| Undo and redo the preset | art, nightgrain |
| Look sliders and selects | Pattern Bayer 16; about 39,110 |
| Make it fit | A heavy look at about 390,315; Make it fit: about 71,629, "lighter dither, dither only in smooth areas, smoother picture, fewer stray cells, fewer colours"; undo brings it back |
| Hold to compare | \ held shows the original |
| Drop a sprite | Move tool, placed at 0.703, 2,582 cells, Look tab |
| Place: drag, Alt+wheel, flip | (126, 94) 0.703 → (88, 63) 1.008, flipped |
| GIF as frames | 4 frames |
| Light the art by the time of day | On: day, sunset and night colours differ; off: one colour again |
| Effects: pulse on | `{ type: 'pulse', period: 5, low: 0.7 }` |
| Search every setting | "dither" finds the Dither section, Soft dither, Pattern, Amount, Pattern size |
| Paint: pencil, undo, redo | 101 cells |
| Generators: all seven | sky, sun, stars, clouds, ridge, trees, water |
| Colour: merge similar, relight | 71 → 64 slots; the photo keeps its colours |
| Moments: add, rename, drag, remove | Starts 6, 13.25, 17, 21; then Blue hour, Sunset, Night |
| Motion: drift on clouds, preview | `{ type: 'drift', period: 180, dir: 1 }` |
| Play the exported scene | "Night · 47,622 characters" |
| Checks popover | Blue hour 45,053, Sunset 45,292, Night 47,622; top layers by the exporter's costs |
| Export: zip and install prompt | lantern-dusk.zip with `.claude-plugin/marketplace.json`, `mod/.claude-plugin/plugin.json`, `mod/hooks/*`; the prompt with Copy |
| Save project | lantern-dusk.project.json, 12 layers, 3 assets |
| Reload restores the project | 12 layers, Lantern Dusk |
| Open a project file | 12 layers |
| Open an exported zip | 12 layers, 3 assets |
| Day and night: two pictures, one scene | Two pictures given night first; the chips guess Day and Night by brightness; hours "Day 06:00–18:00 · Night 18:00–06:00"; Day picked on the night picture swaps the two, then back; one layer, moments day@6 and night@18, base harbour-day.png, version night harbour-night.png; "Day / Night · 2 pictures"; the scene's mean brightness 0.58 by day, 0.12 at night |
| Day and night: export holds a scene for each | harbour.zip: theme.js has day@6 (light, 14,009 characters) and night@18 (dark, 13,580), the two SVGs differ; project.json keeps `versions` |
| Day and night by hand: Add a version | Layer tab → "Add a version for another time of day…" → For Night; the night picture shows at Night only; "Day, Sunset / Night · 2 pictures"; undo and redo |
| Blank start, night | Day, Sunset and Night cards |
| Keyboard map | Fits at 1440 x 900 |
| Wide 1920 x 1080 | Layout holds |
| Phone: start and blank | No sideways scroll |
| Phone: sheets | Layers and inspector as sheets |

`node editor/app/test/fit.mjs`, real scrollbars, at 1536 x 864 @1.25, 1366 x 768, 1280 x 720, 1440 x 900, 1920 x 1080 and the 390 x 844 phone: 220 screens (every inspector tab scrolled to the end, menus, popovers, search, the keyboard map, the export form, the day-and-night start, the phone sheets, the guide), nothing cut. 2026-11-16.

Also: `node --check` on every module after each edit; the exporter timed in Node on the test project (exportAll 1.2-1.5 s for 3 moments of 12 layers).

## Bugs found and fixed

- **Merge similar turned every scene black.** The slider value (4) went to `similarGroups` as an OKLab distance, where the scale runs 0 to about 1: every colour merged into slot 1 (`#05060d`), so the editor and the exported scenes were black. The slider is in hundredths now, and other layers' own slots are left alone.
- **Art relit from night looked pale by day.** Art now keeps its own colours; lighting is a choice (see Decisions).
- **Play waited behind a heavy check.** One worker served everything, so a check of a 390k-character scene held up Play for over 20 s. Three lanes, newer replaces older.
- **The status pill sat over the dock line** while checking: the state class `busy` was also a global class. Renamed `checking`.
- **The hint read "null"** for controls without a key (`replaceChildren(null)`).
- **`note()` threw** for two classes ("dim mono").
- **`requestIdleCallback(step, 0)` threw** (the second argument must be an options object).
- **Three 404s on load**: the favicon. Inline SVG favicon now.
- **The previous-moment chevron did not turn**: `icon()` put its class on a wrapper, not the svg.
- **The menu bar kept a moment's old name** after a rename.
- **The keyboard map ran off a 900-pixel window**; it is three columns now.
- **The art toast said its line on every upload**; once per visit now.
- **Panels were cut by real scrollbars on Windows.** Headless runs hide scrollbars, so the 15 to 17 pixels a Windows scrollbar takes never showed in tests. Both tests now launch with real scrollbars, and `fit.mjs` checks every screen at six sizes.
- **The scene kept the old picture after a moment change** until the pointer moved: the canvas only redrew on pointer events. It redraws on doc, time, moment and load events now.
- **"Add a version for another time of day…" ran off its card** and made the inspector scroll sideways; buttons in a button row wrap now.
- **A click near the inspector's foot could miss**: the help line grew with a longer help as the pointer arrived, the scroll area shrank, and the button moved out from under the pointer. The help line keeps room for four lines, and the three longest helps are shorter.
- **The panels washed out over a bright scene** (1.5:1 to 2.3:1 for the dimmer text over a white picture filling the window). The frost is thicker; see Decisions.

## Not done, and limits

- Animated WebP and APNG come in as frames only where the browser has `ImageDecoder` (Chromium, Edge, Firefox 133+); elsewhere only the first frame. GIF works everywhere.
- Make it fit counts the other layers with fx's estimate, not the exporter; the status after it is the exporter's.
- Checks re-encode every moment after each pause in editing (about 1.5 s on the test project); a scene near the limit takes longer.
- Art and generator layers are not painted directly: To paint (Layer tab) turns one into a paint layer, and its look or generator stops there.
- Not tested on Safari or Firefox; the e2e runs Chromium only.
- The phone layout works but is a small window onto a desktop tool.
- Pictures for different times of day are stills. A GIF with a night version would need frames per moment in the exporter (`readLayers` takes `frames` before `byMoment`); see NEEDS.md item 10. Animated art in a set comes in as its own layer on top.
- On the start screen the chat's frost is kept thinner than the panels so the theme behind still shows; the footer line reads at about 3.3:1 over a pure white picture there (more over a real theme).
