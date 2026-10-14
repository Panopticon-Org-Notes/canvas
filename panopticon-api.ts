// @panopticon/api (ТЗ 26, roadmap 1.1): the only module a plugin sees. Types and `definePlugin`; the plugin gets its
// `ctx` from the core when it is activated. Every call is asynchronous or gives back a Dispose, and only data goes
// in and out (JSON, HeadingRef, Date): no object of the core leaves it, so the plugins can later run isolated.

export const API_VERSION = '1.9.0';

export type Dispose = () => void;
export type Values = Record<string, unknown>;

export interface Plugin {
  activate(ctx: Ctx): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
/** The plugin's module exports it as default: `export default definePlugin({ activate(ctx) { … } })`. */
export const definePlugin = (p: Plugin): Plugin => p;

// ---- data ---------------------------------------------------------------------------------------------------------

/** A heading: its file (relative to the notes folder), line and title. The core finds it by the title if it moved. */
export interface HeadingRef {
  path: string;
  line: number;
  title: string;
}
export interface OrgDate {
  y: number;
  m: number;
  d: number;
  time?: string;
}
export interface HeadingInfo {
  ref: HeadingRef;
  level: number;
  keyword: string | null;
  done: boolean;
  priority: string | null;
  title: string;
  /** Own, inherited and the file's. */
  tags: string[];
  scheduled?: OrgDate;
  deadline?: OrgDate;
  closed?: OrgDate;
  /** An event (a meeting): a bare active timestamp right under the heading, else one in its title; its time if it has one. Since 1.7. */
  event?: OrgDate;
  /** Its own :PROPERTIES: (keys in upper case: `ID`, `RESULT`…), not the inherited ones. Since 1.7. */
  properties: Record<string, string>;
  /** The moves of its SCHEDULED its :LOGBOOK: notes (`- Rescheduled from "<…>" on […]`): from which day, when (its
   *  time too). The app writes them while the file's workflow keeps a journal (`workflow().logbook`). Since 1.8. */
  reschedules?: { from: OrgDate; at: OrgDate }[];
}
export interface FileInfo {
  path: string;
  title: string;
}
/** A date of a condition, counted from today. */
export type DateVal =
  | { kind: 'before' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'next'; n: number }
  | { kind: 'range'; from: string; to: string };
/**
 * A condition of the agenda builder (ТЗ 05), the same engine as the agenda's. `op` by field: status — in / notin
 * (values: keywords «TODO», or «Набор␟TODO»); done — yes / no; tag, title — has / hasnot (values / text); priority —
 * eq / higher / lower / none (prio); scheduled, deadline — eq / before / after / none (date); path — in / notin.
 */
export interface Cond {
  field: 'status' | 'scheduled' | 'deadline' | 'tag' | 'priority' | 'path' | 'title' | 'done';
  op: string;
  values?: string[];
  date?: DateVal;
  prio?: string;
  text?: string;
}
export interface Query {
  /** Files or folders (relative); none: every file of the notes folder. */
  sources?: string[];
  conds: Cond[];
  sort?: 'prio' | 'scheduled' | 'deadline' | 'age' | 'alpha';
}

// ---- ctx ----------------------------------------------------------------------------------------------------------

/** A view's or a section's drawing: the core gives an empty element, the plugin draws in it and cleans up. */
export type Render<S = void> = (el: HTMLElement, state: S, tab: TabHandle<S>) => Dispose | void;
export interface TabHandle<S> {
  id: string;
  /** Change the tab's state: kept with the layout after a restart. */
  setState(state: S): void;
}
export interface ViewSpec<S> {
  /** The tab's name. */
  title(state: S): string;
  /** The toolbar's path while the tab is active. */
  crumbs?(state: S): string[];
  render: Render<S>;
  /** The state read back after a restart (checked; a default when wrong). A new tab of the toolbar's button gets
   *  `restore(null)`. */
  restore?(raw: unknown): S;
  /** The inspector on the right while the tab is active (none: the file's). Drawn again when another tab of the
   *  kind becomes active; the plugin follows its state itself. */
  inspector?: Render<S>;
}
/** A transaction: the operations change the files in memory, in order — each sees what the ones before it did; the
 *  core writes them at once, one step of ⌘Z. A heading not found makes it a conflict (nothing is written). */
export interface Tx {
  setStatus(h: HeadingRef, keyword: string | null): void;
  setPlanning(h: HeadingRef, kind: 'SCHEDULED' | 'DEADLINE', date: Date | null): void;
  setTags(h: HeadingRef, tags: string[]): void;
  /** Rename the heading (its stars, status, priority and tags stay). Since 1.7. */
  setTitle(h: HeadingRef, title: string): void;
  setProperty(h: HeadingRef, key: string, value: string | null): void;
  /** Org text of one heading with its subtree, its stars relevelled to the place: under a heading (its first or last
   *  child — the last before the blank lines ending the parent — or right before one of its children), at the top or
   *  the end of a file, or right after another heading's subtree at its level (`after`, 1.5). Its reference (1.3), for
   *  the next operations; null — not made. */
  insertHeading(
    at: { under: HeadingRef; position: 'first' | 'last' } | { under: HeadingRef; before: HeadingRef } | { file: string; position: 'top' | 'end' } | { after: HeadingRef },
    org: string,
  ): HeadingRef | null;
  /** The direct subheading of that title (case and spaces around aside), made when there is none: last, or before a
   *  subheading (1.3). */
  ensureChild(under: HeadingRef, title: string, at?: { before?: HeadingRef }): HeadingRef | null;
  /** The heading as the transaction has it now (1.3). */
  heading(h: HeadingRef): HeadingInfo | null;
  /** Its direct subheadings now (1.3). */
  children(h: HeadingRef): HeadingInfo[];
  /** The text under it now, as `replaceBody` changes it (1.3); null — not found. */
  body(h: HeadingRef): string | null;
  /** The text under the heading (after its planning and drawers), up to its first subheading. */
  replaceBody(h: HeadingRef, org: string): void;
  /** Under a heading, to a file's top level, or right before / after another heading of its file at that one's level
   *  (`before` / `after`, 1.5). */
  move(h: HeadingRef, to: { under: HeadingRef } | { file: string } | { before: HeadingRef } | { after: HeadingRef }): void;
  remove(h: HeadingRef): void;
  /** The file changed by the plugin's own function: null leaves it. A fallback for a structure of the plugin's own in
   *  the file — the operations above are the core's to check and to merge (ТЗ 30). */
  update(path: string, fn: (text: string) => string | null): void;
}
export interface Store {
  get<T>(): T | undefined;
  set<T>(value: T): Promise<void>;
  onChange(fn: () => void): Dispose;
}
export type EventName = 'file.changed' | 'heading.changed' | 'tab.active' | 'day.changed' | 'theme.changed' | 'folder.changed' | 'inbox.changed';
export interface Opt {
  value: string | number | boolean | null;
  label: string;
  disabled?: boolean;
}

// ---- the core's sheets and the review (§5.2) -----------------------------------------------------------------

/** A field of a form (the same kinds as in the settings by schema). */
export type FormField =
  | { type: 'choice'; key: string; label: string; hint?: string; look: 'segments' | 'menu'; options: Opt[] }
  | { type: 'switch'; key: string; label: string; hint?: string }
  | { type: 'text'; key: string; label: string; hint?: string; placeholder?: string }
  | { type: 'file'; key: string; label: string; hint?: string }
  | { type: 'pair'; key: string; key2: string; label: string; hint?: string; labels: [string, string]; options: [Opt[], Opt[]] }
  // ТЗ 27 §2.4: under their label, across the sheet
  /** Lines; ↩ goes on a «- » list, ⇥ moves its item. */
  | { type: 'textarea'; key: string; label: string; hint?: string; placeholder?: string }
  /** A day as «yyyy-mm-dd» (null: none): the calendar of three months in the form, or a chip that opens it. */
  | { type: 'date'; key: string; label: string; hint?: string; look: 'inline' | 'chip'; clear?: string; stamp?: { kind: 'SCHEDULED' | 'DEADLINE'; names: string[] } }
  /** A file and its heading, in two columns: { path, heading } (heading null: only the file chosen; `create: true`:
   *  the heading `create` offered). */
  | {
      type: 'place'; key: string; label: string; hint?: string; levels?: number[]; fileCap?: string; headCap?: string;
      note?(path: string): { text: string; dim?: boolean };
      headNote?(path: string, title: string): string;
      create?(path: string): string | null;
    }
  /** A widget only (`ui.widget`): a month of the calendar's entries, the task marked — value
   *  { path, line, date: 'yyyy-mm-dd' | null, open }; a click on «Показать календарь» gives { …, open } back. */
  | { type: 'month'; key: string; label: string; hint?: string; keyId?: string }
  /** Drawn by the plugin. */
  | { type: 'custom'; key: string; label: string; hint?: string; render(el: HTMLElement, ctrl: FieldCtrl): Dispose | void };
export interface FormCtrl {
  values(): Values;
  set(key: string, v: unknown): void;
  onChange(fn: (v: Values) => void): Dispose;
}
export interface FieldCtrl {
  value(): unknown;
  values(): Values;
  set(v: unknown): void;
  onChange(fn: (v: Values) => void): Dispose;
}
export interface FormSpec {
  title: string;
  groups: { caption?: string; fields: FormField[]; help?: string }[];
  /** The button that sends it («Создать»). */
  submit: string;
  initial?: Values;
  /** Why the values cannot go (shown, the sheet stays); null: they can. */
  validate?(v: Values): string | null;
  /** A value changed: what else to set (a file chosen gives a name). */
  onChange?(changed: string, v: Values): Values | void;
  /** Right of the sheet's title («Квартал Q4 2026 ⌄»). */
  headerExtra?(el: HTMLElement, form: FormCtrl): Dispose | void;
}
export interface SheetSpec {
  title: string;
  render: (el: HTMLElement, sheet: { close(button?: string): void }) => Dispose | void;
  /** The plugin draws the whole sheet (its header, body, footer, keys); the core gives the dimmed window, the place
   *  over it and «a sheet is open» (ТЗ 27: the goals' own sheets as they were). */
  bare?: boolean;
  /** At the bottom, right to left as written; the primary one on ↩. */
  buttons?: { id: string; label: string; primary?: boolean }[];
  /** A line at the bottom left. */
  note?: string;
}
export interface MenuItem {
  label: string;
  run(): void;
  danger?: boolean;
  disabled?: boolean;
  /** A check left of it (the one chosen of a list); since 1.5. */
  checked?: boolean;
  /** A grey line under it, not a command; since 1.5. */
  hint?: string;
}
/** A list of tasks the plugin draws (the board's cards, ТЗ 34). Since 1.6. */
export interface TaskListSpec {
  /** The task chosen in it now (null: none), and the date its place in the list stands by: ⌥⇧← → moves that one. */
  selected(): { ref: HeadingRef; date?: 'SCHEDULED' | 'DEADLINE' | 'event' } | null;
  /** ↩ and the menu's «Открыть» (false); ⌥↩ and its second item (true). */
  open(other: boolean): void;
  /** The second item's name (by default «Открыть во второй панели»). */
  otherLabel?: string;
  /** ⎋: the choice let go. */
  clear(): void;
  /** ⌘R. */
  refresh?(): void;
  /** More at the end of the menu (the board's «В архив», «Удалить»). */
  more?(h: HeadingRef): (MenuItem | 'sep')[];
}
export interface ChooseItem {
  id: string;
  label: string;
  hint?: string;
}
export type Named = 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'gray';
export interface StatusSet {
  name: string;
  states: { name: string; done: boolean; color?: Named }[];
}
/** A place: a file, or a heading in it. */
export type Place = { path: string } | HeadingRef;
export interface ReviewAction {
  id: string;
  label: string;
  /** A command of the manifest in `"scope": "review"`: its keys run the action. */
  command?: string;
  /** A word after the label («COMPLETED»). */
  sub?: string;
  /** The look: the main one, a «done» one (green). */
  kind?: 'primary' | 'ok';
  /** Not now (no text of the mark yet, the goal is closed already). */
  disabled?(h: HeadingInfo): boolean;
  /** What it does to the heading: then the next card, or this one again. */
  run(h: HeadingInfo): 'next' | 'stay' | Promise<'next' | 'stay'>;
}
/** What a part of the card is drawn for: the heading now, and the card's place in the queue. */
export interface ReviewCard {
  heading: HeadingInfo;
  index: number;
  total: number;
}
/** A card's part drawn by the plugin: drawn again for each card (and when `redraw()` asks). */
export type CardRender = (el: HTMLElement, card: ReviewCard) => Dispose | void;
export interface ReviewSpec {
  title: string;
  items: HeadingRef[];
  actions: ReviewAction[];
  /** A line in the card's header after «3 из 7». */
  header?(h: HeadingInfo): string;
  /** Something under the card. */
  below?: Render<HeadingRef>;
  // ---- ТЗ 27 §2.3: a review of its own on the core's frame ----
  /** The card's header instead of «Разбор · 3 из 7 · file». */
  head?: CardRender;
  /** The strip of quick buttons under the header. */
  quick?: CardRender;
  /** A panel right of the narrowed editor. */
  aside?: CardRender;
  /** Lines folded in the narrowed editor, a note at the end of a line («3 — справа»), a line to show (a new `n`
   *  each time: the caret goes there). */
  narrow?(h: HeadingInfo): { fold?: number[]; note?: { line: number; text: string } | null; reveal?: { line: number; n: number; col?: number } | null };
  /** The drawers (:PROPERTIES:) shown open in the narrowed editor (else folded). */
  drawers?: boolean;
  /** A class of the plugin's on the review's frame (its own styles, as the goals' «greview»). */
  cls?: string;
  /** The toolbar's path while the review is shown (else its title). */
  crumbs?: string[];
  /** The summary instead of «Разобрано N из M» (under «Разбор закончен»); `end()` closes the review. */
  summary?: (el: HTMLElement, r: ReviewResult & { end(): void }) => Dispose | void;
  /** No «Пропустить» (the plugin has its own «Следующая»). */
  noSkip?: boolean;
  /** The command (`"scope": "review"`) whose keys go «Назад». */
  backCommand?: string;
  /** Before the card changes (an action's «next», «Назад», a key): what is being written is saved. */
  beforeStep?(h: HeadingInfo): void | Promise<void>;
  /** The card's widest, px (820). */
  width?: number;
  /** The card shown first (the cards before it are reached by «Назад»). */
  start?: number;
  // ---- ТЗ 28: a review of its own order and bar (the Inbox's) ----
  /** The bar's buttons drawn by the plugin instead of the actions' (the actions stay: their keys run them). */
  bar?: CardRender;
  /** Right of the bar («…»). */
  barEnd?: CardRender;
  /** The card after `cur` going `d` (an action's «next», «Назад», a key): its index, -1 the summary, `cur` none.
   *  By default the next one in the queue. */
  next?(cur: number, d: 1 | -1): number;
  /** The review left the window (its tab closed, «Закончить», another review started). */
  onClose?(): void;
}
/** The review shown (from `ui.review`): move it, draw the card again. */
export interface ReviewHandle {
  step(d: 1 | -1): Promise<void>;
  /** The card's parts drawn again (they read the file anew). */
  redraw(): void;
  /** Only the bar read again (an action's `disabled` changed: a note typed). */
  update(): void;
  /** Show the card `i` (-1: the summary), the review's tab brought to the front. */
  show(i: number): void;
  /** The queue now (a task moved to another file, gone from its file); `cur`: the card shown then. */
  setItems(items: HeadingRef[], cur?: number): void;
  /** The review closed, as «Закончить». */
  end(): void;
}
export interface ReviewResult {
  total: number;
  /** The cards an action moved on from. */
  done: number;
  /** The queue went through (else the tab was closed before). */
  finished: boolean;
}

export interface NetResponse {
  status: number;
  ok: boolean;
  /** Lower-case names. */
  headers: Record<string, string>;
  text: string;
}

export interface Ctx {
  /** The plugin's manifest id. */
  id: string;
  commands: {
    /** The handler of a command the manifest declares. */
    on(id: string, run: (arg?: unknown) => void | Promise<void>): Dispose;
    /** Not offered in the palette, its keys do nothing, while off. */
    setAvailable(id: string, on: boolean): void;
    /** The first shortcut of a command as set now («⌘↩»), '' none: for the plugin's own hints. */
    keyOf(id: string): string;
    /** A command of the plugin, or of the core: `file.open` {path, line?, beside?, focus?, neighbour?} (`neighbour`:
     *  in the other pane, made on the left when there is none, as from an agenda), `heading.reveal` {ref},
     *  `agenda.open`, `settings.open` {section?}, `heading.status` / `heading.schedule` / `heading.deadline` / `heading.tags` / `heading.priority`
     *  {ref} (the palette's step for it; the heading's file is the one shown), `capture.open` (the quick entry),
     *  `inbox.pickFile`, `inbox.createFile`. */
    run(id: string, arg?: unknown): Promise<void>;
  };
  ui: {
    /** The section of the navigator the manifest declares. */
    navSection(id: string, render: Render): Dispose;
    /** A kind of tab the manifest declares. */
    view<S>(id: string, spec: ViewSpec<S>): Dispose;
    /** Open the view in the active editor (one tab of a kind per editor) or in the other one. A view with `"toolbar":
     *  true` in the manifest also has a button in «Открыть в панели»: the second pane, or out of it. */
    open<S>(viewId: string, state: S, where?: 'here' | 'beside'): Promise<void>;
    notify(text: string, actions?: { label: string; run(): void }[]): void;
    /** The core's sheet with the fields; null: cancelled. */
    form(spec: FormSpec): Promise<Values | null>;
    /** The choice of a file and a heading in it (or the file alone). */
    pickPlace(o?: { kind?: 'file' | 'heading'; title?: string; levels?: number[] }): Promise<Place | null>;
    /** The calendar of three months, as for SCHEDULED. */
    pickDate(o?: {
      initial?: Date;
      title?: string;
      /** What the date is for, as the core's calendar says it («Дедлайн», «День отметки»), with the stamp's day names
       *  of the file and the date it has now (a dashed frame). */
      kind?: 'SCHEDULED' | 'DEADLINE' | 'MARK';
      names?: string[];
      current?: Date | null;
    }): Promise<Date | null>;
    /** A review by cards in a tab: one heading at a time, narrowed; it ends when the queue is through or closed. */
    review(spec: ReviewSpec): Promise<ReviewResult>;
    /** The core's sheet with the plugin's content; the button pressed (null: ⎋). */
    sheet(spec: SheetSpec): Promise<string | null>;
    /** The core's context menu at a point of the window. */
    menu(items: (MenuItem | 'sep')[], at: { x: number; y: number }): void;
    /** A choice from a list in the palette; null: ⎋. */
    choose(o: { title: string; placeholder?: string; items: ChooseItem[] }): Promise<string | null>;
    /** Close the tabs of a view of the plugin. */
    close(viewId: string): void;
    /** A control of the core in the plugin's element: the calendar of three months, the choice of a place in
     *  columns, lines with lists — as the form's fields. `set` changes its value from outside. */
    widget(el: HTMLElement, field: FormField, value: unknown, onChange: (v: unknown) => void): {
      set(v: unknown): void;
      dispose(): void;
      /** The choice of a place: ↑↓ in the list in focus, which list takes them. */
      move(d: 1 | -1): void;
      focusList(which: 'file' | 'head'): void;
    };
    /** The number on the plugin's button of the navigator (0: none). */
    setBadge(navId: string, n: number): void;
    /** What the core's month under a review's card (the widget `month`) shows: the layers of entries ('task',
     *  'deadline', 'event', 'wait', 'done') and the files left out — the calendar's choice; null: every dated entry. */
    setMonthFilter(f: { layers: string[]; hidden: string[] } | null): void;
    /** The core's move of a heading to another place («Перенести в…»): where it went, null — cancelled. `before`:
     *  just before the write (a row's fade); `quiet`: the plugin tells of it, no toast of the core; `onUndo`: the
     *  move taken back (⌘Z, «Отменить»). */
    refile(ref: HeadingRef, o?: { before?(): void | Promise<void>; quiet?: boolean; onUndo?(): void }): Promise<{ path: string; line: number; title: string; label: string } | null>;
    /** The review shown now (its parts move and redraw it); null when there is none of the plugin's. */
    currentReview(): ReviewHandle | null;
    /** A block of «Сегодня» the manifest declares (`todayBlocks`): the core gives the card, the plugin draws its
     *  content; `setHidden(true)` leaves it out (nothing to show), the others take its place. Since 1.4. */
    todayBlock(id: string, render: (el: HTMLElement, block: { setHidden(hidden: boolean): void }) => Dispose | void): Dispose;
    /** What the plugin adds to a card of «1-1 сегодня» (the person's file, relative): a line under the person («Цели:
     *  3 активных») and a button. Since 1.4. */
    oneOnOne(spec: { line?(path: string): string | null | Promise<string | null>; action?: { label: string; available?(path: string): boolean | Promise<boolean>; run(path: string): void } }): Dispose;
    /** A view of a file the manifest declares (`fileViews`): the tab of the file shows it instead of the text («Доска»).
     *  `render(el, { path, heading? }, { showText })`; `defaultFor(text)` — a file opened the first time is shown so.
     *  `heading`: the tab shows one branch of the file (`openFileView` with a heading); `setHeading` — that heading is
     *  now there or so named (the tab's name follows), since 1.9. Since 1.5. */
    fileView(id: string, spec: { render(el: HTMLElement, file: { path: string; heading?: HeadingRef }, view: { showText(): void; setHeading(h: HeadingRef): void }): Dispose | void; defaultFor?(text: string): boolean }): Dispose;
    /** A file in a view of the plugin, in a tab of its own: the whole file, or — `heading` — one branch («Ветка как
     *  mindmap»: the tab is named «file › heading», «Текст» shows the heading in the editor). A tab that shows that
     *  branch in that view already is shown again. false — no such file or heading. Since 1.9. */
    openFileView(viewId: string, file: { path: string; heading?: HeadingRef }, where?: 'here' | 'beside'): Promise<boolean>;
    /** The heading the user is at: the caret's in the editor, the branch of a view on one heading; null — none. Since
     *  1.9. */
    currentHeading(): HeadingRef | null;
    /** An item of the menu of a heading — in the navigator's outline and in the editor on a heading's line — where
     *  `when` says so. Since 1.9. */
    headingAction(spec: { label: string; when?(h: HeadingInfo): boolean; run(h: HeadingRef): void }): Dispose;
    /** The file tab shown now goes to a view of the plugin (null: the text); false — the tab is not a file's. Since 1.5. */
    showAs(viewId: string | null): Promise<boolean>;
    /** A link at the end of the lines of the editor it names («Открыть доску ⌥⌘B» right of «#+BOARD»); the file does
     *  not change. Since 1.5. */
    editorLink(spec: { label(text: string, line: number): string | null; run(path: string, line: number): void }): Dispose;
    /** A heading with its subtree, narrowed, in an editor in the plugin's element (the board's card at the side): edits
     *  go to the file at once, the Org keys work. `onRef` — where the heading is now (its line, its title as edited).
     *  Since 1.5. */
    editor(el: HTMLElement, h: HeadingRef, o?: { onRef?(h: HeadingRef): void }): { focus(): void; dispose(): void };
    /** A list of tasks in the plugin's element (ТЗ 34): while the focus is in `el`, the keys of «Задачи в списках»,
     *  the palette's «ВЫДЕЛЕННАЯ ЗАДАЧА» and the inspector act on the task the list has chosen; `menu(at)` shows the
     *  core's menu of that task (status, priority, dates, tags, refile, link, the plugins' actions, `more`). The
     *  changes are the core's transactions, one step of ⌘Z each. Since 1.6. */
    taskList(el: HTMLElement, spec: TaskListSpec): { menu(at: { x: number; y: number }): void; dispose(): void };
    /** An action of the plugin on a task («действия с задачей», ТЗ 34): an item of the menu of a task in every list
     *  and a command of the palette's «ВЫДЕЛЕННАЯ ЗАДАЧА», where `when` says so. Since 1.6. */
    taskAction(spec: { label: string; when?(h: HeadingInfo): boolean; run(h: HeadingRef): void }): Dispose;
    /** A piece of the plugin in a place another plugin declares (`contributes.slots` of its manifest), e.g.
     *  `calendar.weekCell`: `render` draws it for each item of that place with the place's `data`. Since 1.8. */
    slot<D = unknown>(id: string, render: (el: HTMLElement, data: D) => Dispose | void): Dispose;
    /** Draw in `el` the pieces the plugins put into a place of this plugin (one child each, in the plugins' order;
     *  drawn again when one comes or goes); `update` gives them new data. Since 1.8. */
    drawSlot<D = unknown>(el: HTMLElement, id: string, data: D): { update(data: D): void; dispose(): void };
  };
  /** Needs `index.read`. */
  index?: {
    query(q: Query): Promise<HeadingInfo[]>;
    heading(ref: HeadingRef): Promise<HeadingInfo | null>;
    /** The text under a heading (after its planning and drawers, up to its first subheading); null — not found.
     *  Since 1.7. */
    body(ref: HeadingRef): Promise<string | null>;
    outline(path: string): Promise<HeadingInfo[]>;
    files(): Promise<FileInfo[]>;
    /** The named colour of a status in the sets of the file (the plugin draws with var(--p-<colour>)). */
    statusTone(keyword: string, path: string): Promise<Named | null>;
    /** The Inbox file (a setting of the core: the quick entry writes there); null — not chosen, or not there:
     *  `chosen` is the setting then (a file gone). `add`: where a new task goes in it. */
    inbox(): Promise<{ path: string | null; chosen: string | null; add: 'top' | 'end' }>;
    /** The notes folder open now (its path on this Mac; null: none), as `folder.changed` gives it: what the plugin
     *  keeps on this Mac per folder. */
    folder(): Promise<string | null>;
    /** The statuses the file knows: open and done keywords (for `@panopticon/api/org`), and its sets in order. */
    workflow(path: string): Promise<{ open: string[]; done: string[]; sets: StatusSet[]; logbook: boolean }>;
  };
  /** Needs `files.read` (or `files.edit`). */
  files?: { read(path: string): Promise<string> };
  /** Needs `files.edit`. One step of ⌘Z, as an edit by hand. */
  edit?: {
    transaction(label: string, build: (tx: Tx) => void, o?: { onUndo?(): void }): Promise<'ok' | 'conflict' | 'error'>;
    /** Take back the last step of the journal (a toast's «Отменить»): false — there is none, or its files changed. */
    undo(): Promise<boolean>;
    /** A file of the folder, made empty when it is not there yet (an archive, `<file>_archive`); false — not made.
     *  Since 1.5. */
    ensureFile(path: string): Promise<boolean>;
  };
  /** The functions the manifest's `exports` names, for the other plugins. Since 1.8. */
  exports(fns: Record<string, (...args: never[]) => unknown>): Dispose;
  plugins: {
    /** A function another plugin exports; undefined when that plugin is off, not there, or does not give it. The
     *  arguments and the result are data (copied). Since 1.8. */
    call<T = unknown>(id: string, fn: string, ...args: unknown[]): Promise<T | undefined>;
  };
  /** The plugin's own: in the notes folder (goes with the notes) and on this Mac. */
  storage: { folder: Store; local: Store };
  events: { on(e: EventName, fn: (payload: unknown) => void): Dispose };
  /** Needs `clipboard`. */
  clipboard?: { write(text: string): Promise<void> };
  /** Needs `net`: only to the hosts of the manifest's `net` («jira.company.ru», «*.company.ru»); 30 s, 10 MB. */
  net?: { fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<NetResponse> };
  /** Sets of statuses from code (they replace the plugin's earlier ones; [] none); the manifest's stay. */
  statusSets: { set(defs: StatusSet[], o?: { ifMissing?: boolean }): void };
  /** The values of the settings the manifest declares. */
  settings: {
    values(): Values;
    onChange(fn: (v: Values) => void): Dispose;
    /** What a declared field shows that depends on the values: its options (a `pair`: both lists), its hint; a `file`
     *  shown (null: not chosen); a `text` tidied when left. */
    dynamic(key: string, spec: { options?(v: Values): Opt[] | [Opt[], Opt[]]; hint?(v: Values): string; show?(path: string | null): string; clean?(text: string): string }): Dispose;
  };
}
