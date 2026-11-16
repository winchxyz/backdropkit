# BackdropKit

Animated pixel-art themes for the Claude Code desktop app. A theme plays behind your conversation, follows your clock from night to day, and tints the app's panels to match.

**Site:** https://winchxyz.github.io/backdropkit/ (pick a theme, download it, copy the install prompt)

Made by [winchxyz](https://github.com/winchxyz). Community project, not affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic.

## The themes

| Theme | What it is | Moments |
| --- | --- | --- |
| Sunfield | Sunflowers under a sky that follows the sun | Night, sunrise, day, sunset, and every time between |
| Harbor | A fishing harbour seen from the pier | Day, sunset, night |
| Snowfall Ridge | Mountains, spruce and a cabin under snow | Morning, day, night |
| Rainy Studio | A desk by a rainy window | Day, evening, night |
| Low Orbit | The edge of the Earth, seen from orbit | Before dawn, morning |
| Tide Line | A low view from the beach | Sunrise, sunset, night |
| Cloud Sea | A cliff top above a sea of clouds | Day, sunset, night |
| Mirror Lake | A still mountain lake that mirrors the sky | Day, sunset, night |
| Lavender Slope | Lavender rows rolling down to a valley | Day, sunset, night |
| Hill Village | A village on a forested hillside | Sunrise, day, night |
| Sunbeam Wood | Shafts of light in an old forest | Morning, day, night |
| Side Street | A steep lane in a quiet seaside town | Day, evening, night |
| Deep Reef | Under the water, light falling from above | The same at every hour |
| Moon Keep | A castle of spires under a full moon | The same at every hour |

## Install a theme

1. Download its archive from the site (`docs/themes/<theme>.zip` in this repository).
2. Paste the install prompt from the site into Claude Code in the desktop app. Claude Code lists what is in the archive, reads the hooks, unpacks the theme into `~/.claude/backdropkit/<theme>`, installs it and tells you when to reload.

By hand, after unpacking the archive into a folder you keep:

```
claude plugin marketplace add "<that folder>"
claude plugin install <theme>@backdropkit-<theme> --scope user
```

Then run `/reload-plugins` or start a new session. Each archive's README lists its files and commands.

## How a theme works

- Each moment of the day is one animated SVG, a 320 x 200 grid of pixel cells. The desktop app plays it itself as a picture, with CSS motion and no script.
- The app's limits shape every scene: at most 131,072 characters after its still-frame scrub, at most 64 runs per path, one shared 0.05 s clock for all motion, and a light frame cost.
- The theme is a Claude Code plugin. At the start of a session it picks the moment for your local time, sets the backdrop, tints the frosted glass from the scene and picks light or dark colours. It checks the clock again every few minutes.
- Every scene is checked for 1-px hairlines between cells at 11 window sizes, from 1x to 2x displays. See [engine/README.md](engine/README.md).

## Repository

- `prototypes/<theme>/`: each scene. `build.mjs` draws it into `out/<theme>-<moment>.svg`; `notes.md` explains the scene, and `seamfix-log.md` how its hairlines were removed.
- `engine/`: the shared encoder and the checks (`seamscan.mjs`, `seamwho.mjs`, `pixeldiff.mjs`, `purity.mjs`).
- `site/`: the landing page. `node site/build.mjs` builds it into `docs/`, which GitHub Pages serves; `node site/serve.mjs` previews it on localhost.
- `app/tools/`: the theme catalog (names and text) and the archive tools used by the site build.
- `docs/`: the built site, with the scenes, thumbnails and theme archives.

Sunfield is its own project; its built archive is in `docs/themes/sunfield.zip`, and the site build expects its source next to this folder.

`npm install` brings `playwright-core`, which the build and the checks use to render scenes.

## Make your own

**Editor:** https://winchxyz.github.io/backdropkit/editor/ (it also opens from the box at the bottom of the site)

Start from one of the 14 themes, your own art (a picture, sprites, animated GIFs) or a blank scene. Stack layers, paint cell by cell, give your art a look (dither, palettes, pixel shapes, glyphs, outline), add motion and live effects, and give every colour its time of day. The editor checks each scene against the app's limits as you work and exports the same archive and install prompt as the themes above. It runs in your browser; your work stays on your computer.

The app plays pixel scenes only (no embedded pictures), so uploaded art always becomes cells on the 320 x 200 grid; the look decides how.

- `editor/app/`: the editor page. `editor/lib/`: the exporter (project to scenes and archive). `editor/fx/`: the looks. `editor/PROJECT.md`: the project format they share.
- Checks: `node editor/test/run.mjs <outDir>` (the exporter against the player checks) and `node editor/app/test/e2e.mjs` (the editor end to end, after `EDITOR_ONLY=1 node site/build.mjs` and `node site/serve.mjs`).

## License

MIT, see [LICENSE](LICENSE).
