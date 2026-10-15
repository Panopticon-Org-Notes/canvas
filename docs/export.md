# Export and «Разложить на холсте»

## Export

«Экспорт ▾» at the top right of a mindmap and of a canvas (and the palette's «Холст: экспорт в Excalidraw»,
«Холст: копировать для Excalidraw»):

| Item | What it makes |
| --- | --- |
| Excalidraw — файл .excalidraw… | a `.excalidraw` file (the system's save panel, named as the canvas or the file): open it on excalidraw.com |
| Копировать для Excalidraw | Excalidraw's clipboard (`type: "excalidraw/clipboard"`): paste into an open board with `⌘V` |
| PNG… | a picture at 2×, the theme's background |
| SVG… | the same as a vector picture |
| Показать файл .canvas в Finder | (a canvas) the file itself — it is JSON Canvas and opens in Obsidian |

When part of the scene is out of view, PNG and SVG ask: everything or the visible part.

What goes to Excalidraw:

| Canvas / mindmap | Excalidraw |
| --- | --- |
| a note, a card, a mindmap node | a `rectangle` (rounded) with its `text` bound in it (`containerId`, the rectangle's `boundElements`) |
| a live card | the same; the text is a snapshot (file and parents, status and title, 1–2 lines, checklist and date, tags); the heading's link (`id:…`) in the element's `link` |
| a link | a rectangle with the address; `link` — the address |
| a group | a `frame` named as the group; the nodes inside it have its `frameId` |
| an arrow | an `arrow` bound to the rectangles (`startBinding` / `endBinding`); its label a `text` bound in it |
| a mindmap's line | an `arrow` without a head, bound to the nodes |
| a colour | `strokeColor` and a light `backgroundColor` |

The font is the one Excalidraw calls «Normal»; sizes and coordinates are the canvas's. The export goes one way:
changes made in Excalidraw do not come back.

## «Разложить на холсте»

In the menu of a heading (the editor, the navigator, a mindmap's node) and in the palette («Холст: разложить ветку
на холсте…», on the heading under the caret):

- choose a new canvas (named as the heading, next to its file) or one of the canvases there are;
- the heading and its children — two levels by default, a setting (1 / 2 / 3) — become live cards laid out as a tree
  from left to right, with arrows from each parent to its children; on an existing canvas they go to the right of
  what it holds;
- each heading gets an `:ID:` if it has none (one step of `⌘Z`), so the cards keep finding it;
- a branch's `:COLOR:` becomes the card's `color`.

After that it is an ordinary canvas: move the cards by hand; it does not follow the mindmap.
