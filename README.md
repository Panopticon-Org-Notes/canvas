# Canvas («Холст») — a Panopticon plugin

Mindmaps of Org files and a free canvas for [Panopticon](https://github.com/YuryBogdanov/OrgNotes). The tree of
headings *is* the mindmap: every edit on the map is an ordinary edit of the headings, and the file stays plain Org.
The canvas is a `.canvas` file in [JSON Canvas](https://jsoncanvas.org), so it opens in Obsidian too.

- **The map of a file** — «Показать как › Mindmap» in a file tab's menu, or the palette command «Холст: mindmap
  файла». The root is the file's `#+TITLE` (else its name); top-level headings are the branches, split between the
  right and the left side.
- **The map of one branch** — «Показать ветку как mindmap» in the menu of a heading (editor and navigator), or
  «Холст: mindmap ветки» on the heading under the caret. It opens in a tab of its own, «file › heading».
- **Editing in place** — `⇥` child, `↩` sibling, start typing or `F2` to rename, `⌫` delete (with «Отменить»),
  `Space` fold, `⌘↑` / `⌘↓` and drag-and-drop to move, double click or `⌘↩` for the heading's text at the side.
  Each change is one step of `⌘Z`. Status, priority, dates and tags — the app's own task menu (right click) and keys.
- **Branch colours** — six colours (as in Obsidian's canvas) or your own, stored in the heading's `:COLOR:`
  property; headings below take it until they set their own.

- **The free canvas** — «Новый холст» in a folder's menu or «Холст: новый». Notes, live cards of headings (changes
  in the file show at once; the text opens at the side), files, links, groups and arrows with labels; drag headings
  and files from the app's lists, paste links; colours as in Obsidian.

Export to Excalidraw, PNG and SVG is coming next.

Requires Panopticon with plugin API 1.10 or later. Permissions: `index.read`, `files.edit`.

## Install

From the catalog: «Настройки → Плагины → Каталог плагинов…» → «Холст» → «Установить». Or by link:
`https://github.com/Panopticon-Org-Notes/canvas`.

## Documentation

- [The mindmap](docs/mindmap.md): what is drawn, keys, colours, settings, what is stored where.
- [The free canvas](docs/canvas.md): the file, nodes, keys, colours, compatibility with Obsidian.

## Development

```bash
npm install
npm test             # unit tests (vitest)
npm run build        # dist/main.js and dist/manifest.json
```

To try a build, put `dist` into the app's plugins folder as `canvas` («Настройки → Плагины → Открыть папку
плагинов»), then «Перезагрузить плагины». The app's end-to-end tests (`e2e/canvasPlugin.spec.ts` in OrgNotes) load
the build from `../panopticon-canvas/dist`.

`panopticon-api.ts` is a copy of the app's `src/api/index.ts`: the API's types and `definePlugin`. Update it with
the app.

## Release

Bump `version` in `manifest.json` and `package.json`, merge, then push a tag equal to the version (`0.2.0`). The
release workflow builds the plugin and attaches `manifest.json` and `main.js` to a GitHub release — that is what the
app's catalog downloads.
