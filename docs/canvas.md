# The free canvas

A `.canvas` file is a board of notes, live cards of Org headings, files, links and groups, joined by arrows. The
format is [JSON Canvas 1.0](https://jsoncanvas.org), the one Obsidian uses: a canvas made here opens in Obsidian, and
one made in Obsidian opens here.

## Making one

- «Новый холст» in a folder's menu in the navigator (or in the menu of the empty place under the files);
- «Холст: новый» in the palette — the canvas goes next to the file shown now.

The file is JSON with two spaces of indent, so a diff in git reads well. It is saved as any note: at once, watched
on disk, taken back with `⌘Z`. Fields this plugin does not know (from Obsidian or other programs) are kept as they
were. A file that is not valid JSON is shown with a note and never written over.

## Nodes

| Node | JSON Canvas | Look |
| --- | --- | --- |
| Note | `type: "text"`, `text` | a sheet with plain text (line breaks kept); yellow by default (`color: "3"`, a setting); double click or `↩` edits it in place, `⎋` or `⌘↩` finishes |
| Heading (a live card) | `type: "file"`, `file: "platform.org"`, `subpath: "#Переезд в новый ДЦ"`, `orgId` | the file and the parents in grey, the status, the title, 1–2 lines of text, the checklist «☑ 2/5» and the date, the tags. Found by `orgId` (the heading's `:ID:`, written when the card is made), else by the title in `subpath`. Changes in the file show at once |
| File | `type: "file"` without `subpath` | the file's `#+TITLE` (or `# ` of a markdown file) and its first lines |
| Link | `type: "link"`, `url` | the host and the path (the page itself is not fetched) |
| Group | `type: "group"`, `label` | a frame with a bold label, a light fill of its colour |

A card whose heading cannot be found turns grey with «Заголовок не найден», «Найти…» (pick the heading again) and
«Убрать». Obsidian shows a live card as a link to the `.org` file: it does not know `subpath` of Org files.

## Putting things on it

- The bar at the bottom: «Заметка», «Заголовок…» (the app's choice of a heading), «Файл…», «Ссылка», «Группа» — the
  node appears in the middle of the visible part.
- Drag a file or a heading from the navigator, a heading from «Структура», a row of the agenda, a search hit or a
  row of the tag tab onto the canvas: it becomes a card where it is dropped.
- `⌘V`: an address makes a link, `[[id:…]]` or a copied heading link (`⌃C L`) makes a live card, any other text a
  note.
- Double click on the empty place: a new note there.

## Working with nodes

| Key / gesture | Action |
| --- | --- |
| click, `⇧`-click, a frame drawn on the empty place, `⌘A` | choose |
| drag, arrows (`⇧` — by 10) | move; snapped to the 22 pt grid (a setting), `⌘` while dragging — no snap. Nodes inside a group's box move with it, as in Obsidian |
| the corner handle | resize |
| `⌘D` | duplicate (with the arrows between the copies) |
| `⌫` | delete (a live card goes; its heading stays) |
| `⌘G` | group the chosen: a group around them, 24 pt around, its label typed at once |
| drag from a side's dot to another node | an arrow (`fromSide`, `toSide`, `toEnd: "arrow"`) |
| double click on an arrow | its label, shown as a capsule in the middle |
| double click / `↩` on a card | the heading's text at the side (430 pt), edited right in the file; «В файле ›» opens the file beside |
| right click | the node's menu: colour, duplicate, group, delete; on the empty place — new note, heading, fit |
| `⌘+` `⌘−`, pinch, two-finger scroll, `Space` + drag | zoom and pan |
| `⇧1`, «Вписать» | fit everything |

Every change is one step of the app's `⌘Z` / `⇧⌘Z`.

## Colours

«Цвет…» in the menu opens a bar over the chosen nodes, groups or arrows: no colour, six colours, «Свой…». The value
goes into `color`: `"1"`–`"6"` (red, orange, yellow, green, cyan, purple — as in Obsidian) or `#rrggbb`. A node gets a
coloured border and a 16% fill, an arrow its line and head, a group its frame and a 6% fill. A yellow note is drawn
as a note's paper.

## Settings

«Настройки → Настройки плагинов → Холст»:

- «Новая заметка — цвет» — без цвета / красный / … / **жёлтый** / …;
- «Привязка к сетке» — on.

## API used

`fileTypes` and `fileViews` of the manifest, `files.read`, `edit.transaction` (`update`, `ensureId`),
`edit.ensureFile`, `index.byId`, `index.outline`, `index.heading`, `index.body`, `ui.pickPlace`, `ui.form`,
`ui.editor`, `ui.menu`, `droppedOf` / `draggingOurs`.
