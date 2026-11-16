# Share your theme

Made a theme in the [editor](https://winchxyz.github.io/backdropkit/editor/) that you like? Send it in a pull request. If it looks good and passes the checks, it joins the collection.

## What to send

One folder per theme, `community/<folder>/`, where `<folder>` is the folder name you gave the theme when you exported it (small letters, numbers and dashes). It holds two files, both from the archive the editor exported:

- `project.json`: the whole theme (your art, layers, colours, moments and motion)
- `preview.png`: its preview picture

Nothing else: no zip, no `mod/` folder, no code. The mod that installs the theme is built here from this repository's own template, so a theme here is only data.

## Steps

1. In the editor, check that the line at the bottom says **ok** (not "too big" or "may stutter"), then click **Export**.
2. Open the archive it downloads (`<folder>.zip`) and take out `project.json` and `preview.png`.
3. Fork this repository and add the two files as `community/<folder>/project.json` and `community/<folder>/preview.png`.
   - On github.com: in your fork, open the `community` folder, choose **Add file → Upload files** and drag in a folder named `<folder>` with the two files inside.
4. Open a pull request. Say the theme's name, one line about it, and where the art comes from.

## What gets checked

Every theme goes through the same checks as the 14 here:

- each moment fits the app's limit (131,072 characters after the app cleans the scene up);
- no 1 px lines between cells at 11 window sizes, from 1x to 2x displays;
- it plays in the app's player, motion included, within the frame time;
- the archive built from it passes `claude plugin validate`, the type check and the mod's tests.

Then I look at it at every moment of the day. For the record, the command is

```
PROJECTS=community/<folder>/project.json node editor/test/run.mjs
```

## What can go in

- Your own art, or art you are free to share. Sending it means it is published here under the MIT License, like the rest of the repository.
- No logos or brands, no real people, no characters from games, films or shows.
- Nothing NSFW.
- A folder name that isn't taken: not one of the 14 themes and not another theme in `community/`.
- One theme per pull request.

## Anything else

Found a bug or have an idea? Open an issue. For a code change, open a pull request that says what it fixes and how you checked it (the checks are in the README under "Make your own").
