# The mindmap

## What is drawn

| Node | Look |
| --- | --- |
| Root | The file's `#+TITLE` (else the file name) or, for a branch's map, that heading. Accent fill, 16 pt bold. |
| Branches (top-level headings) | Split between the right and the left side by how many headings each holds: the first ones in the file go right until they hold half, the rest go left. 1.5 pt border in the branch colour (the accent by default), bold. |
| Deeper headings | 1 pt border, wrapped text up to 200 pt wide. |

A node shows the status as a capsule, the title with its inline markup (`*bold*`, `/italic/`, `=code=`, links by
their description) and the tags set on the heading itself. The text under a heading is not shown.

Curves go from the parent's side to the child's: 2 pt in the branch colour from the root, 1.4 pt deeper.

Three levels are open by default (a setting: 2, 3, 4 or all); deeper branches show a «+N» capsule — how many
headings are hidden. Folding by hand (`Space`, a click on «+N») is remembered on this Mac per map; nothing is
written to the file. Nothing about the layout is stored either: it is computed from the tree each time.

## Keys

| Key | Action | In the file |
| --- | --- | --- |
| click, arrows | choose a node; `←` `→` follow the tree by the node's side, `↑` `↓` go to siblings | — |
| `⇥` | new child (typed in place, `↩` makes it, `⎋` cancels) | a subheading, last child |
| `↩` | new sibling | a heading of the same level right after the subtree |
| typing, `F2` | rename | the title; on the root of a file — `#+TITLE` |
| `⌫` | delete with its subtree; «Удалено: … · Отменить» | the subtree is removed |
| `Space`, «+N» | fold / unfold | — |
| `⌘↑` `⌘↓` | move among siblings | the subtree moves |
| drag onto a node / its top or bottom edge | make it a child / put it before or after | the subtree moves, levels follow |
| double click, `⌘↩` | the heading's text at the side, edited in place; «В файле ›» opens the text view | — |
| right click | the app's task menu: status, priority, dates, tags, refile, link; plus «Цвет ветки…», «Показать ветку как mindmap», «Удалить» | as usual |
| `⌘+` `⌘−`, pinch | zoom | — |
| two-finger scroll, drag the background | pan | — |
| `⇧1`, «Вписать» | fit the whole map | — |

Every change is one transaction of the app: `⌘Z` takes it back. Changes made in the text, in another tab or on disk
show on the map at once.

## Branch colours

«Цвет ветки…» in a node's menu opens a bar over it: no colour, six colours, «Свой…». The value goes into the
heading's `:COLOR:` property:

```org
* Платформа
:PROPERTIES:
:COLOR: green
:END:
```

Values: `red`, `orange`, `yellow`, `green`, `cyan`, `purple` (Obsidian's canvas colours `1`–`6`: #e5484d, #f76b15,
#e2a336, #30a46c, #12a594, #8e4ec6) or `#rrggbb`. Headings below take the nearest parent's colour until they set
their own. A colour paints the node's border, a light fill (14%) on the heading that sets it, and the curves to its
children.

## Settings

«Настройки → Настройки плагинов → Холст»:

- «Раскрыто уровней» — 2 / **3** / 4 / все.

## API used

`ui.fileView` (with `file.heading` and `view.setHeading`), `ui.openFileView`, `ui.headingAction`,
`ui.currentHeading`, `ui.taskList`, `ui.editor`, `ui.menu`, `index.outline`, `index.statusTone`, `index.workflow`,
`files.read`, `edit.transaction` (`insertHeading`, `setTitle`, `move`, `remove`, `setProperty`, `update`),
`storage.local`.
