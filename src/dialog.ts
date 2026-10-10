const LAYOUT = `.backdrop{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;box-sizing:border-box;background:none;color:inherit;display:grid;place-items:center;overflow:auto}.backdrop:not([open]){display:none}.backdrop::backdrop{background:none}.dialog{box-sizing:border-box;width:min(560px,100% - 32px);display:grid;gap:12px}.dialog.wide{width:min(1100px,100% - 32px)}.header{display:flex;align-items:center;justify-content:space-between;gap:8px}.title{margin:0}.minimise{margin-left:auto}.body{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:start}.body>.stage:only-child{grid-column:1/-1}.stage{position:relative;display:grid;gap:8px;min-width:0}.image{display:block;max-width:100%;max-height:min(60vh,100vh - 22em);margin:0 auto;color:var(--_mark)}.toolbar+.stage>.image{touch-action:none}.selection{position:absolute;pointer-events:none;box-sizing:border-box}.text-input{position:absolute;transform:translateY(-50%);min-width:6em;margin:0;box-sizing:content-box}.toolbar{display:flex;flex-direction:column;gap:4px}.dialog svg,.draft svg{width:1.15em;height:1.15em;flex:none;stroke-linecap:round}.divider{display:block}.strip{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px}.thumb{position:relative;display:flex}.thumb-pick{position:relative;display:block;margin:0;padding:0;line-height:0}.thumb-image{display:block;height:3em;width:auto}.thumb-number{position:absolute;left:4px;top:4px;line-height:1.2}.thumb-remove{position:absolute;top:-.5em;right:-.5em}.add,.capture-view{display:inline-flex;align-items:center;gap:6px}.composer{display:grid;gap:8px}.note{box-sizing:border-box;width:100%;min-height:64px;resize:vertical}.footer{display:flex;align-items:center;justify-content:space-between;gap:8px}.composer-bar,.actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px}.send{display:inline-flex;align-items:center;gap:6px}.split{position:relative;display:flex;margin-left:auto}.send-more{display:inline-flex;align-items:center}.menu{position:absolute;right:0;bottom:calc(100% + 6px);z-index:1;display:grid;min-width:max-content}.menu[hidden]{display:none}.save-pdf{display:inline-flex;align-items:center;gap:8px}.draft{position:fixed;z-index:var(--_z);box-sizing:border-box;max-width:calc(100% - 2 * var(--_off));display:flex;flex-wrap:wrap;align-items:center;gap:8px}.draft-thumbs{display:flex;gap:4px}.draft-thumbs .thumb-image{height:1.75em}.drafting>.trigger{display:none}.live{position:fixed;width:1px;height:1px;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}`;

const THEME = `.backdrop{background:var(--_bd)}.dialog,.draft{background:var(--_s);color:var(--_t);border:1px solid var(--_b);border-radius:var(--_r);box-shadow:var(--_sh);padding:14px}.draft{padding:8px}.title{margin-left:4px;font-size:1.1em;font-weight:600}.header button,.toolbar button,.thumb-remove{font:inherit;width:2.15em;height:2.15em;padding:0;display:grid;place-items:center;border:0;border-radius:calc(var(--_r) / 2);background:none;color:var(--_m);cursor:pointer}.header button:hover,.toolbar button:hover:not(:disabled){background:color-mix(in srgb,var(--_t) 8%,transparent);color:var(--_t)}.body{padding:12px;border-radius:calc(var(--_r) * .75);background:color-mix(in srgb,var(--_t) 5%,var(--_s))}.toolbar{padding:4px;border:1px solid var(--_b);border-radius:calc(var(--_r) * .75);background:var(--_s)}.toolbar [aria-pressed=true]{background:color-mix(in srgb,var(--_a) 16%,transparent);color:var(--_a)}.toolbar button:disabled{opacity:.35;cursor:default}.divider{width:20px;margin:4px auto;border-top:1px solid var(--_b)}.image{border-radius:calc(var(--_r) / 2);box-shadow:0 0 0 1px var(--_b),0 2px 8px rgb(0 0 0/10%)}.toolbar+.stage>.image{cursor:crosshair}.selection{border:2px dashed var(--_f);border-radius:4px}.text-input{font-family:inherit;font-weight:600;line-height:1.2;color:var(--_mark);background:color-mix(in srgb,var(--_s) 85%,transparent);border:1px dashed var(--_mark);border-radius:4px;padding:0 4px;outline:none}.thumb-pick{border:2px solid transparent;border-radius:calc(var(--_r) / 2.5);background:none;overflow:hidden;cursor:pointer}.thumb-pick[aria-current=true]{border-color:var(--_a)}.thumb-image{border-radius:calc(var(--_r) / 4);box-shadow:0 0 0 1px var(--_b)}.thumb-number{font-size:.75em;font-weight:600;padding:0 4px;border-radius:4px;background:var(--_s);color:var(--_t)}.thumb-remove{width:1.5em;height:1.5em;border:1px solid var(--_b);border-radius:50%;background:var(--_s)}.label{font-size:.9em;font-weight:600;color:var(--_m)}.composer{padding:8px;border:1px solid var(--_b);border-radius:var(--_r);background:var(--_s);transition:border-color .15s,box-shadow .15s}.composer:focus-within{border-color:var(--_f);box-shadow:0 0 0 3px color-mix(in srgb,var(--_f) 22%,transparent)}.note{font:inherit;color:inherit;background:none;border:0;border-radius:calc(var(--_r) / 2);padding:4px 6px}.note:focus-visible{outline:none}.note::placeholder{color:var(--_m)}.category{font:inherit;color:inherit;background:color-mix(in srgb,var(--_t) 5%,var(--_s));border:1px solid var(--_b);border-radius:calc(var(--_r) / 2);padding:6px 8px}.send,.actions button,.add,.draft button{font:inherit;font-weight:600;height:2.25em;padding:0 .9em;border:1px solid var(--_b);border-radius:calc(var(--_r) / 1.6);background:var(--_s);color:inherit;cursor:pointer}.add{border-style:dashed;color:var(--_m)}.send,.draft .capture-view{background:var(--_a);color:var(--_at);border-color:var(--_a)}.split .send{border-radius:calc(var(--_r) / 1.6) 0 0 calc(var(--_r) / 1.6)}.send-more{font:inherit;height:2.25em;padding:0 .55em;border:1px solid var(--_a);border-left-color:color-mix(in srgb,var(--_at) 40%,var(--_a));border-radius:0 calc(var(--_r) / 1.6) calc(var(--_r) / 1.6) 0;background:var(--_a);color:var(--_at);cursor:pointer}.send-more:disabled{opacity:.6;cursor:progress}.send:where([data-ink=dark]),.send-more:where([data-ink=dark]),.draft .capture-view:where([data-ink=dark]){color:#000}.menu{padding:4px;border:1px solid var(--_b);border-radius:calc(var(--_r) / 1.6);background:var(--_s);color:var(--_t);box-shadow:var(--_sh)}.save-pdf{font:inherit;padding:.5em .8em;border:0;border-radius:calc(var(--_r) / 2.5);background:none;color:inherit;cursor:pointer;white-space:nowrap}.save-pdf:hover,.save-pdf:focus-visible{background:color-mix(in srgb,var(--_t) 8%,transparent)}.draft button:disabled{opacity:.5;cursor:default}.draft-label{margin:0 4px;font-size:.9em;font-weight:600}[aria-disabled=true]{opacity:.6;cursor:progress}.note:disabled,.category:disabled{opacity:.6}.hint{margin:0 4px;font-size:.85em;color:var(--_m)}.error{margin:0 4px;font-weight:500}.status{margin:8px 4px}`;

import { type Annotator, annotate, type Tool } from "./annotate";
import { icon } from "./icon";
import { look, type Seen, shots } from "./seen";
import { type FeedbackReport, type Mark, SCREENSHOT_LIMIT } from "./shared/report";
import type { FeedbackEvent, FeedbackEvents, FeedbackOptions, FeedbackStrings } from "./widget";

const ICONS = {
  pen: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zm9.5-13.5 4 4",
  box: "M6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9A2.5 2.5 0 0 1 6.5 5z",
  arrow: "M5 19 19 5M9 5h10v10",
  text: "M5 7V5h14v2M12 5v14m-3 0h6",
  select: "M6 3l12 7-5.5 1.5L10 17z",
  remove: "M5 5h14v14H5zm4 4 6 6m0-6-6 6",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  clear: "M4 7h16m-10 4v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  cancel: "M6 6l12 12M18 6 6 18",
  send: "M5 12h13m-6-7 7 7-7 7",
  minimise: "M5 17h14",
  add: "M12 5v14M5 12h14",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zm8 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  more: "m7 10 5 5 5-5",
  pdf: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6m-6 4h6",
};

type Texts = Omit<FeedbackStrings, "trigger" | "triggerText">;

const ENGLISH: Texts = {
  title: "Send feedback",
  capturing: "Taking a screenshot…",
  captureError: "Couldn't take a screenshot.",
  sendWithout: "Send without screenshot",
  noteLabel: "Your note",
  notePlaceholder: "What happened, or what would you change?",
  noteRequired: "Write a few words first.",
  categoryLabel: "Type",
  pen: "Draw",
  box: "Box",
  arrow: "Arrow",
  text: "Text",
  select: "Select",
  remove: "Delete",
  undo: "Undo",
  clear: "Clear",
  cancel: "Cancel",
  send: "Send",
  sending: "Sending…",
  sent: "Thanks, it's sent.",
  error: "It didn't send. Your note is kept.",
  retry: "Try again",
  escHint: "Esc keeps it as a draft",
  minimise: "Keep as draft",
  screenshot: "Screenshot",
  addScreenshot: "Add screenshot",
  removeScreenshot: "Remove screenshot",
  draft: "Feedback draft",
  captureView: "Capture this view",
  reopen: "Open",
  discard: "Discard",
  moreSend: "More send options",
  savePdf: "Save as PDF",
  pdfError: "Couldn't save the PDF.",
};

// A key given as undefined, as an i18n lookup can return, keeps its English text.
const texts = (strings: Partial<FeedbackStrings> = {}): Texts =>
  Object.assign(
    {},
    ENGLISH,
    ...Object.entries(strings).map(([key, text]) => (text === undefined ? {} : { [key]: text })),
  );

/** Tells a screen reader the screenshot is being taken; returns what removes it. */
export function announce(root: ShadowRoot, strings?: Partial<FeedbackStrings>): () => void {
  const live = element("p", "live", { role: "status" });
  root.append(live);
  // Filled in after it is in the page, so it is read out as a change.
  const frame = requestAnimationFrame(() => {
    live.textContent = texts(strings).capturing;
  });
  return () => {
    cancelAnimationFrame(frame);
    live.remove();
  };
}

export function css(unstyled: boolean): string[] {
  return unstyled ? [LAYOUT] : [LAYOUT, THEME];
}

/** What the dialog shows: the capture error, or the note with the image when there is one. */
export type View = { error: true } | { error?: false; image: HTMLCanvasElement | null };

/** One screenshot as Send takes it: its image, the marks on it and the page it shows. */
export type Shot = { image: HTMLCanvasElement; marks: Mark[]; seen: Seen };

/** What the user wrote and drew, taken once when Send is pressed. */
export type Draft = { note: string; category: string | undefined; shots: Shot[] };

export type Handlers = {
  close(): void;
  /** Takes a screenshot again and hands it to capture(). */
  retry(): void;
  emit<E extends FeedbackEvent>(event: E, ...args: FeedbackEvents[E]): void;
  /** The options as they are at Send, after any update(). */
  options(): FeedbackOptions;
  /** Whether this widget keeps its draft across page loads: on, and the one its tag's draft is. */
  keeps(): boolean;
};

export type Settings = {
  tools?: readonly Tool[] | undefined;
  categories?: readonly { id: string; label: string }[] | undefined;
  requireNote?: boolean | undefined;
  strings?: Partial<FeedbackStrings> | undefined;
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  name: string,
  attributes: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = name;
  result.setAttribute("part", name);
  for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
  return result;
}

function button(name: string, text: string, onClick: () => void): HTMLButtonElement {
  const result = element("button", name, { type: "button" });
  result.textContent = text;
  result.addEventListener("click", onClick);
  return result;
}

/** A button that shows only its icon; the text is its accessible name and its tooltip. */
function iconButton(name: string, text: string, d: string, onClick: () => void): HTMLButtonElement {
  const result = button(name, "", onClick);
  result.setAttribute("aria-label", text);
  result.title = text;
  result.append(icon(d, "icon"));
  return result;
}

// Halved step by step: one big step skips pixels in Chromium and WebKit, and a thin mark vanishes.
function copy(small: HTMLCanvasElement, image: HTMLCanvasElement): void {
  let source: HTMLCanvasElement = image;
  while (source.width > small.width * 2) {
    const half = document.createElement("canvas");
    half.width = Math.ceil(source.width / 2);
    half.height = Math.ceil(source.height / 2);
    half.getContext("2d")?.drawImage(source, 0, 0, half.width, half.height);
    source = half;
  }
  small.getContext("2d")?.drawImage(source, 0, 0, small.width, small.height);
}

/** A small copy of a screenshot, its marks included, for the strip and the draft bar. */
function thumbnail(image: HTMLCanvasElement): HTMLCanvasElement {
  const small = element("canvas", "thumb-image", { "aria-hidden": "true" });
  small.height = 96;
  small.width = Math.max(1, Math.round((96 * image.width) / Math.max(1, image.height)));
  copy(small, image);
  return small;
}

// Chromium's own pair, white on rgb(0 117 255), fails contrast, so unset text is black or white.
function ink(button: HTMLElement): void {
  const style = getComputedStyle(button);
  if (style.getPropertyValue("--vf-accent-text").trim()) return;
  let [r = 0, g = 0, b = 0] =
    /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/.exec(style.backgroundColor)?.slice(1).map(Number) ?? [];
  // Other colour syntax (oklch, color-mix) is read back through a canvas, in sRGB bytes.
  if (!/^rgb/.test(style.backgroundColor)) {
    const pixel = document.createElement("canvas").getContext("2d");
    if (!pixel) return;
    pixel.fillStyle = style.backgroundColor;
    pixel.fillRect(0, 0, 1, 1);
    [r = 0, g = 0, b = 0] = pixel.getImageData(0, 0, 1, 1).data;
  }
  const linear = (c: number) =>
    c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
  const light = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  // Black wins when its contrast, (L + .05) / .05, beats white's, 1.05 / (L + .05).
  if ((light + 0.05) ** 2 > 0.0525) button.dataset.ink = "dark";
}

// Symbol.for: shared by every copy of this package on the page (two bundles, a hot reload).
const LOCK = Symbol.for("visual-feedback.scroll-lock");

type Lock = { count: number; saved: [string, string, string][]; attribute: boolean };

function lock(): Lock {
  const html = document.documentElement as HTMLElement & { [LOCK]?: Lock };
  html[LOCK] ??= { count: 0, saved: [], attribute: false };
  return html[LOCK];
}

// One lock for every widget on the page, so the page's own overflow is saved once and comes back.
function lockScroll(): void {
  const state = lock();
  if (state.count++ > 0) return;
  const style = document.documentElement.style;
  state.attribute = document.documentElement.hasAttribute("style");
  state.saved = ["overflow-x", "overflow-y"].map((name) => [
    name,
    style.getPropertyValue(name),
    style.getPropertyPriority(name),
  ]);
  style.setProperty("overflow", "hidden", "important");
}

function unlockScroll(): void {
  const state = lock();
  if (--state.count > 0) return;
  const style = document.documentElement.style;
  for (const [name, value, priority] of state.saved) {
    if (value) style.setProperty(name, value, priority);
    else style.removeProperty(name);
  }
  state.saved = [];
  // Removing the last property leaves style="" behind on a root that had no style attribute.
  if (!state.attribute && !style.length) document.documentElement.removeAttribute("style");
}

const FOCUSABLE = "button,textarea,input,select,a[href],[tabindex]:not([tabindex='-1'])";

const NOTE_LIMIT = 2000;

export type Mounted = {
  show(view: View): void;
  /**
   * The screenshot, or null when taking it failed. The first one opens the note view, or the
   * capture error; a later one is added to the draft, which opens again.
   */
  capture(image: HTMLCanvasElement | null): void;
  /** Opens a draft kept in the draft bar again; does nothing otherwise. */
  reopen(): void;
  /** Brings back, folded in the draft bar, the draft this tab kept before a page load. */
  revive(): Promise<boolean>;
  /** Lets the page scroll, or stops it; unmount lets it scroll. */
  lock(on: boolean): void;
  /**
   * With keep, the draft as it is now stays kept for the next widget of this tag in this tab.
   * Returns whether it is kept; when not, the draft has ended.
   */
  unmount(keep?: boolean): boolean;
};

/** One screenshot of the draft: its image, its marks with their Undo history, and its page. */
type Taken = {
  image: HTMLCanvasElement;
  annotator: Annotator | undefined;
  seen: Seen;
  /** The screenshot with no mark, as a PNG, for a draft kept across page loads. */
  blob: Promise<Blob> | undefined;
};

// Kept drafts are written one at a time, for every widget of the page, so a widget that brings
// one back waits for the one just removed to finish writing it.
let writing = Promise.resolve();

export function mount(parent: HTMLElement, handlers: Handlers, settings: Settings = {}): Mounted {
  const tools = settings.tools ?? ["pen", "box", "arrow", "text", "select"];
  const choices = [...new Set(tools)].filter((tool) =>
    ["pen", "box", "arrow", "text", "select"].includes(tool),
  );
  // Select alone has nothing to act on, so there is nothing to draw with.
  const drawing = choices.some((choice) => choice !== "select");
  const text = texts(settings.strings);
  const backdrop = element("dialog", "backdrop", {
    "aria-modal": "true",
    "aria-labelledby": "vf-title",
  });
  const panel = element("div", "dialog");
  const title = element("h2", "title", { id: "vf-title" });
  title.textContent = text.title;
  // One header for every view; its close button is the dialog's Cancel, which discards.
  const header = element("div", "header");
  const cancel = iconButton("cancel", text.cancel, ICONS.cancel, handlers.close);
  const keep = iconButton("minimise", text.minimise, ICONS.minimise, () => minimise());
  header.append(title, cancel);
  backdrop.append(panel);

  const taken: Taken[] = [];
  let at = 0;
  let tool: Tool | undefined;
  let annotator: Annotator | undefined;
  // Set by the toolbar: puts its Undo, Clear and Delete in step with the shown screenshot.
  let refresh = () => {};
  let body: HTMLElement | undefined;
  let stage: HTMLElement | undefined;
  let strip: HTMLElement | undefined;
  let note: HTMLTextAreaElement | undefined;
  let notice: HTMLElement | undefined;
  let bar: HTMLElement | undefined;
  let minimised = false;
  let folding = false;
  // Set by each annotating view: the controls a send locks, and the button that sends.
  let locked: (HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement)[] = [];
  let inert: HTMLElement[] = [];
  let primary: HTMLButtonElement | undefined;
  let draft: Draft | undefined;
  // Where a send error is shown: under the composer.
  let composer: HTMLElement | undefined;
  let failure: HTMLElement | undefined;
  const root = () => parent.getRootNode() as ShadowRoot;
  // Where this tab keeps its draft's id: one per widget tag, as the loader reads it.
  const key = `visual-feedback:${root().host.localName}`;
  const keeping = handlers.keeps;
  // The marks of screenshots brought back from an earlier page, given to their annotators.
  const restored = new WeakMap<HTMLCanvasElement, Mark[]>();
  let kept: string | undefined;
  // Each draft that ends bumps it, so a write queued for it stops.
  let ended = 0;
  let over = false;
  // Handed to the host: a draft whose delivery may succeed is never kept, so never sent twice.
  let submitted = false;
  let reviving = false;
  let picker: HTMLSelectElement | undefined;

  function toolbar(): HTMLElement[] {
    if (!drawing) return [];
    const toolbar = element("div", "toolbar");
    const undo = iconButton("undo", text.undo, ICONS.undo, () => annotator?.undo());
    const clear = iconButton("clear", text.clear, ICONS.clear, () => annotator?.clear());
    const remove = iconButton("remove", text.remove, ICONS.remove, () => annotator?.remove());
    // Only Select picks a mark, so without it Delete could never act.
    const actions = choices.includes("select") ? [remove, undo, clear] : [undo, clear];
    refresh = () => {
      const off = new Map([
        [undo, !annotator?.canUndo],
        [clear, !annotator?.marks.length],
        [remove, !annotator?.selected],
      ]);
      // A disabled button drops the focus out of the dialog, past the Tab trap.
      if (off.get(root().activeElement as HTMLButtonElement)) {
        buttons.find((choice) => choice.getAttribute("aria-pressed") === "true")?.focus();
      }
      for (const [control, disabled] of off) control.disabled = disabled;
    };
    const pick = (next: Tool) => {
      tool = next;
      if (annotator) annotator.tool = next;
      for (const [i, choice] of buttons.entries()) {
        const active = choices[i] === next;
        choice.setAttribute("aria-pressed", String(active));
        choice.setAttribute("part", active ? "tool tool-active" : "tool");
      }
    };
    const buttons = choices.map((choice) =>
      iconButton("tool", text[choice], ICONS[choice], () => pick(choice)),
    );
    // Open on something that draws, even when Select is listed first.
    pick(choices.find((choice) => choice !== "select") as Tool);
    toolbar.append(...buttons, element("span", "divider", { "aria-hidden": "true" }), ...actions);
    locked.push(...buttons, ...actions);
    return [toolbar];
  }

  // The shown screenshot's thumbnail, redrawn as its marks change.
  let thumb: HTMLCanvasElement | undefined;
  function changed(): void {
    refresh();
    const shown = taken[at]?.image;
    if (thumb && shown) copy(thumb, shown);
  }

  function add(image: HTMLCanvasElement): void {
    image.className = "image";
    image.setAttribute("part", "image");
    // snapdom sizes its canvas inline, which beats max-height and squashes the image.
    image.removeAttribute("style");
    const shot: Taken = {
      image,
      annotator: undefined,
      seen: shots.get(image) ?? look(),
      blob: undefined,
    };
    taken.push(shot);
    showShot(taken.length - 1);
    // Made once the image is in the page: marks take their colour from its style.
    if (drawing) {
      shot.annotator = annotate(image, changed, text.text, restored.get(image));
      annotator = shot.annotator;
      if (tool) annotator.tool = tool;
      changed();
    }
    const clean = shot.annotator?.clean ?? image;
    shot.blob = keeping()
      ? import("./capture").then((capture) => capture.encode(clean, { type: "image/png" }))
      : undefined;
    // A failed encode only means this screenshot is not kept across a page load.
    shot.blob?.catch(() => {});
  }

  function showShot(index: number): void {
    const focused = strip?.contains(root().activeElement) ?? false;
    // Ends a stroke or a label on the one left, and takes its selection outline away.
    annotator?.end();
    stage?.querySelector(":scope > .image")?.remove();
    at = index;
    const shot = taken[at] as Taken;
    annotator = shot.annotator;
    if (annotator && tool) annotator.tool = tool;
    stage?.prepend(shot.image);
    renderStrip();
    refresh();
    if (focused) strip?.querySelector<HTMLElement>("[aria-current=true]")?.focus();
  }

  function drop(index: number): void {
    if (taken.length < 2) return;
    const focused = strip?.contains(root().activeElement) ?? false;
    const [gone] = taken.splice(index, 1);
    if (index === at) {
      gone?.annotator?.end();
      annotator = undefined;
      showShot(Math.min(index, taken.length - 1));
    } else {
      if (index < at) at--;
      renderStrip();
    }
    if (focused) strip?.querySelector<HTMLElement>("[aria-current=true]")?.focus();
  }

  function renderStrip(): void {
    if (!strip) return;
    const items = taken.map((shot, i) => {
      const item = element("div", "thumb");
      const name = `${text.screenshot} ${i + 1}`;
      const pick = element("button", "thumb-pick", {
        type: "button",
        "aria-label": name,
        title: name,
        "aria-current": String(i === at),
      });
      const number = element("span", "thumb-number", { "aria-hidden": "true" });
      number.textContent = String(i + 1);
      const small = thumbnail(shot.image);
      if (i === at) thumb = small;
      pick.append(small, number);
      pick.addEventListener("click", () => showShot(i));
      item.append(pick);
      if (taken.length > 1) {
        const label = `${text.removeScreenshot} ${i + 1}`;
        item.append(iconButton("thumb-remove", label, ICONS.cancel, () => drop(i)));
      }
      return item;
    });
    const more = button("add", text.addScreenshot, () => minimise());
    more.prepend(icon(ICONS.add, "icon"));
    strip.replaceChildren(...items, ...(taken.length < SCREENSHOT_LIMIT ? [more] : []));
  }

  // Esc and the keep button fold an unsent draft into the bar; the page scrolls under it.
  function minimise(focus = true): void {
    if (minimised || !taken.length || draft) return;
    annotator?.end();
    minimised = true;
    // Already closed when Chrome took the Escape itself; then no close event will come.
    if (backdrop.open) {
      folding = true;
      backdrop.close();
    }
    // Out of the page while folded: WebKit kept the hidden state a capture gave it, inside it.
    backdrop.remove();
    lockPage(false);
    bar = draftBar();
    parent.append(bar);
    for (const accent of bar.querySelectorAll<HTMLElement>(".capture-view")) ink(accent);
    if (focus) bar.querySelector<HTMLElement>(".capture-view:enabled, .reopen")?.focus();
    store();
  }

  // The draft ended (sent, cancelled, discarded, closed): nothing of it stays on the device,
  // also when it ended while a page load was still bringing it back.
  function discard(): void {
    over = true;
    ended++;
    unkeep();
  }

  function unkeep(): void {
    const id = kept;
    kept = undefined;
    try {
      // The key may name another widget's draft by now; only this one's goes.
      if (id && id === sessionStorage.getItem(key)) sessionStorage.removeItem(key);
    } catch {}
    if (id) void import("./keep").then(({ forget }) => forget(id)).catch(() => {});
  }

  // Keeps the folded draft for this tab, as it is now, so a page load brings it back. Storage
  // can be off, full or private; the draft then lives in memory only, as before.
  function store(): boolean {
    // A screenshot taken while this widget did not keep drafts has no copy to keep.
    if (!keeping() || over || !taken.length || taken.some((shot) => !shot.blob)) return false;
    const turn = ended;
    try {
      const held = sessionStorage.getItem(key);
      // A draft another widget of this tag kept, and left, is not overwritten: this one stays
      // in memory only.
      if (held && held !== kept) return false;
      kept ??= [...crypto.getRandomValues(new Uint32Array(2))].join("-");
      // Set now, not once written: a widget made right after this one is gone must find it.
      sessionStorage.setItem(key, kept);
    } catch {
      return false;
    }
    const id = kept;
    const shots = taken.map((shot) => ({
      blob: shot.blob,
      marks: [...(shot.annotator?.marks ?? [])],
      seen: shot.seen,
    }));
    const draft = { note: note?.value ?? "", category: picker?.value };
    writing = writing.then(async () => {
      try {
        const images = [];
        for (const { blob, ...shot } of shots) {
          if (!blob) throw new Error("not kept");
          images.push({ ...shot, image: await blob });
        }
        const { keep, forget } = await import("./keep");
        if (turn !== ended) return;
        await keep(id, { saved: Date.now(), ...draft, shots: images });
        // Ended while it was written: discard() already let go of the key, so the record goes too.
        if (turn !== ended) await forget(id);
      } catch {
        // Not kept this time: an earlier fold must not come back in its place, nor a later write
        // queued behind this one land under a key that is gone.
        if (turn === ended) {
          ended++;
          unkeep();
        }
      }
    });
    return true;
  }

  function draftBar(): HTMLElement {
    const result = element("div", "draft", { role: "region", "aria-label": text.draft });
    const [y, x] = (handlers.options().position ?? "bottom-right").split("-");
    result.dataset.y = y;
    result.dataset.x = x;
    const label = element("span", "draft-label");
    label.textContent = `${text.draft} · ${taken.length}`;
    const thumbs = element("span", "draft-thumbs", { "aria-hidden": "true" });
    thumbs.append(...taken.map((shot) => thumbnail(shot.image)));
    const again = button("capture-view", text.captureView, handlers.retry);
    again.prepend(icon(ICONS.camera, "icon"));
    again.disabled = taken.length >= SCREENSHOT_LIMIT;
    result.append(
      label,
      thumbs,
      again,
      button("reopen", text.reopen, reopen),
      button("discard", text.discard, handlers.close),
    );
    return result;
  }

  function reopen(): void {
    if (!minimised) return;
    minimised = false;
    bar?.remove();
    bar = undefined;
    parent.append(backdrop);
    backdrop.showModal();
    lockPage(true);
    renderStrip();
    note?.focus();
  }

  // What Send encodes: every screenshot, in strip order, or none.
  let seen: Seen;
  // The report a send error keeps, so "Try again" sends the same one.
  let report: FeedbackReport | undefined;
  let mounted = true;

  async function deliver(draft: Draft): Promise<void> {
    sending();
    const options = handlers.options();
    let module: typeof import("./report") | undefined;
    try {
      module = await import("./report");
      if (!report) {
        const capture = await import("./capture");
        const shots = [];
        // One at a time: ten full-size encodes at once can run a phone out of memory.
        for (const shot of draft.shots) {
          shots.push({ ...shot, image: await capture.encode(shot.image, options.capture) });
        }
        // The report's own page is the first screenshot's still in it, not one removed.
        const built = await module.build(draft, shots, draft.shots[0]?.seen ?? seen, options);
        if (mounted) report = built;
      }
      // Closed before submit: nothing is sent.
      if (!mounted || !report) return;
      submitted = true;
      handlers.emit("submit", report);
      await module.deliver(report, options);
      // Sent: a load during the short confirmation must not bring it back.
      discard();
      handlers.emit("sent", report);
      if (mounted) sent();
    } catch (error) {
      handlers.emit("error", error);
      if (mounted) failed(module?.shown(error));
    }
  }

  // Builds the PDF in the page and downloads it; nothing is sent, and the draft stays as it is.
  let saving = false;
  let pdfError: HTMLElement | undefined;
  async function savePdf(note: string, category: string | undefined): Promise<void> {
    if (saving) return;
    saving = true;
    pdfError?.remove();
    annotator?.end();
    const font = getComputedStyle(panel).fontFamily;
    try {
      // Copied before the first await: a screenshot added, removed or marked while the PDF
      // builds must not change it.
      const pages = taken.map(({ image }) => {
        const page = document.createElement("canvas");
        page.width = image.width;
        page.height = image.height;
        const context = page.getContext("2d");
        // iOS gives no context past its canvas memory: the page would be saved blank.
        if (!context) throw new Error("no 2d context");
        context.drawImage(image, 0, 0);
        return page;
      });
      // Two awaits, not Promise.all: size-limit then counts the capture library in this chunk.
      const capture = await import("./capture");
      const writer = await import("./pdf");
      const [first, ...rest] = pages;
      const front = writer.cover(note, category, first, font);
      if (first) first.width = 0;
      // Each copy is freed once encoded, so a phone holds one fewer at a time.
      const file = await writer.pdf([front, ...rest], async (page, options) => {
        try {
          return await capture.encode(page, options);
        } finally {
          page.width = 0;
        }
      });
      // Cancelled while it was built: nothing is saved.
      if (!mounted) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      // The user's own date, not UTC: near midnight the two differ.
      const now = new Date();
      const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((part) => String(part).padStart(2, "0"))
        .join("-");
      link.download = `feedback-${day}.pdf`;
      link.hidden = true;
      panel.append(link);
      link.click();
      link.remove();
      // A download reads the URL after the click returns, so it is let go a little later.
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      handlers.emit("saved");
    } catch {
      if (!mounted || !composer) return;
      pdfError = element("p", "error", { role: "alert" });
      pdfError.textContent = text.pdfError;
      composer.after(pdfError);
    } finally {
      saving = false;
    }
  }

  function show(view: View): void {
    locked = [];
    inert = [];
    primary = undefined;
    draft = undefined;
    failure = undefined;
    composer = undefined;
    header.replaceChildren(title, cancel);
    if (view.error) {
      const message = element("p", "error", { role: "alert" });
      message.textContent = text.captureError;
      const retry = button("retry", text.retry, handlers.retry);
      const actions = element("div", "actions");
      actions.append(
        button("send-without", text.sendWithout, () => show({ image: null })),
        retry,
      );
      panel.classList.remove("wide");
      panel.replaceChildren(header, message, actions);
      retry.focus();
      return;
    }
    const label = element("label", "label", { for: "vf-note" });
    label.textContent = text.noteLabel;
    const field = element("textarea", "note", {
      id: "vf-note",
      placeholder: text.notePlaceholder,
      maxlength: String(NOTE_LIMIT),
    });
    note = field;
    const required = element("p", "error", { id: "vf-note-error", role: "alert" });
    required.textContent = text.noteRequired;
    field.addEventListener("input", () => {
      if (!field.value.trim()) return;
      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
      required.remove();
    });
    const fields: HTMLElement[] = [];
    let category: HTMLSelectElement | undefined;
    picker = undefined;
    if (settings.categories?.length) {
      const name = element("label", "label", { for: "vf-category" });
      name.textContent = text.categoryLabel;
      category = element("select", "category", { id: "vf-category" });
      picker = category;
      for (const choice of settings.categories) {
        const option = document.createElement("option");
        option.value = choice.id;
        option.textContent = choice.label;
        category.append(option);
      }
      fields.push(name, category);
    }
    const image = view.image;
    body = element("div", "body");
    if (image) {
      stage = element("div", "stage");
      strip = element("div", "strip");
      stage.append(strip);
      body.append(...toolbar(), stage);
      header.replaceChildren(title, keep, cancel);
      locked.push(keep);
      inert.push(stage);
    }
    const send = button("send", text.send, () => {
      if (draft) {
        // Sending, or a send error: the same draft goes again, never a second one at once.
        if (send.getAttribute("aria-disabled") !== "true") void deliver(draft);
        return;
      }
      if (settings.requireNote !== false && !field.value.trim()) {
        field.setAttribute("aria-invalid", "true");
        field.setAttribute("aria-describedby", required.id);
        box.after(required);
        field.focus();
        return;
      }
      annotator?.end();
      draft = {
        note: field.value,
        category: category?.value,
        shots: taken.map((shot) => ({
          image: shot.image,
          marks: [...(shot.annotator?.marks ?? [])],
          seen: shot.seen,
        })),
      };
      void deliver(draft);
    });
    send.append(icon(ICONS.send, "icon"));
    primary = send;
    locked.push(field, ...(category ? [category] : []));
    const box = element("div", "composer");
    box.append(field);
    // The category, when there is one, stays with the note; Send goes to the footer.
    if (fields.length) {
      const bar = element("div", "composer-bar");
      bar.append(...fields);
      box.append(bar);
    }
    composer = box;
    const footer = element("div", "footer");
    // Esc keeps a draft only when there is a screenshot to keep.
    if (image) {
      const hint = element("p", "hint");
      hint.textContent = text.escHint;
      footer.append(hint);
    }
    const more = iconButton("send-more", text.moreSend, ICONS.more, () =>
      menu(list.hidden === true),
    );
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    const list = element("div", "menu", { role: "menu", "aria-label": text.moreSend });
    list.hidden = true;
    const save = button("save-pdf", text.savePdf, () => {
      menu(false);
      more.focus();
      void savePdf(field.value, category?.selectedOptions[0]?.textContent ?? undefined);
    });
    save.setAttribute("role", "menuitem");
    save.prepend(icon(ICONS.pdf, "icon"));
    list.append(save);
    function menu(open: boolean): void {
      list.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      if (open) save.focus();
    }
    // Escape closes the menu only; the dialog's own Escape would fold or close the whole draft.
    list.addEventListener("keydown", (event) => {
      // Tab closes it too, and the dialog's Tab trap then moves on from the caret.
      if (event.key === "Tab") {
        menu(false);
        more.focus();
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      menu(false);
      more.focus();
    });
    // WebKit does not focus a clicked button: a press would blur the menu and close it first.
    list.addEventListener("mousedown", (event) => event.preventDefault());
    const split = element("div", "split");
    split.addEventListener("focusout", (event) => {
      if (!split.contains(event.relatedTarget as Node | null)) menu(false);
    });
    split.append(send, more, list);
    locked.push(more);
    footer.append(split);
    panel.classList.toggle("wide", Boolean(image));
    panel.replaceChildren(header, ...(image ? [body] : []), label, box, footer);
    // Added once the view is in the page, so the image's marks resolve their colour.
    if (image) add(image);
    ink(send);
    ink(more);
    field.focus();
  }

  function sending(): void {
    if (!primary) return;
    // From here Esc closes, so the hint that it keeps a draft goes, and so does a PDF failure.
    panel.querySelector(".hint")?.remove();
    pdfError?.remove();
    for (const control of locked) control.disabled = true;
    for (const item of inert) item.inert = true;
    failure?.remove();
    // aria-disabled, not disabled: a disabled button drops the focus out of the dialog.
    primary.setAttribute("aria-disabled", "true");
    primary.textContent = text.sending;
    primary.setAttribute("part", "send");
    primary.focus();
  }

  function sent(): void {
    const status = element("p", "status", { role: "status", tabindex: "-1" });
    status.textContent = text.sent;
    panel.classList.remove("wide");
    header.replaceChildren(title, cancel);
    panel.replaceChildren(header, status);
    status.focus();
    done = setTimeout(handlers.close, 3000);
  }

  function failed(message = text.error): void {
    if (!primary || !composer) return;
    failure = element("p", "error", { role: "alert" });
    failure.textContent = message;
    composer.after(failure);
    primary.removeAttribute("aria-disabled");
    primary.textContent = text.retry;
    primary.setAttribute("part", "retry");
    primary.focus();
  }

  // Escape: keep an unsent draft, else close at once, not on the later native close event.
  // Chrome can skip cancel, so both.
  backdrop.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (taken.length && !draft) minimise();
    else handlers.close();
  });
  // Folding into the draft bar closes the native dialog too. Its close event comes later, maybe
  // after the draft opened again, so that one event is passed over, whenever it comes. Any other
  // close is Escape that Chrome handled without a cancel event.
  const closed = () => {
    if (folding) folding = false;
    else if (taken.length && !draft) minimise();
    else handlers.close();
  };
  backdrop.addEventListener("close", closed);
  // Every Tab is handled here, so the trap holds where the browser skips buttons (WebKit).
  backdrop.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (item) =>
        !item.matches(":disabled") && !item.closest("[inert]") && item.getClientRects().length > 0,
    );
    const active = root().activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    const step = event.shiftKey ? -1 : 1;
    const next = index < 0 ? (event.shiftKey ? items.length - 1 : 0) : index + step;
    items.at(next % items.length)?.focus();
  });

  parent.append(backdrop);
  // The trigger stays hidden while there is a draft, open or folded: behind the dialog it would
  // sit under Send, and two controls would share one spot.
  parent.classList.add("drafting");
  // A draft a closed tab left behind goes after a day, even if no draft is folded again.
  if (keeping()) void import("./keep").then(({ sweep }) => sweep()).catch(() => {});
  let done: ReturnType<typeof setTimeout> | undefined;
  let scrollLocked = false;
  function lockPage(on: boolean): void {
    if (on !== scrollLocked) (on ? lockScroll : unlockScroll)();
    scrollLocked = on;
  }
  return {
    show,
    capture(image) {
      if (taken.length) {
        reopen();
        notice?.remove();
        if (image) add(image);
        else {
          notice = element("p", "error", { role: "alert" });
          notice.textContent = text.captureError;
          body?.after(notice);
        }
        return;
      }
      // Shown here, not at mount: a draft brought back from an earlier page starts folded.
      backdrop.showModal();
      // Without an image, the page as it is at the capture error.
      seen = (image && shots.get(image)) ?? look();
      show(image ? { image } : { error: true });
      lockPage(true);
    },
    reopen,
    async revive() {
      reviving = true;
      try {
        // A widget of this tag that was just removed may still be writing the draft.
        await writing;
        const id = sessionStorage.getItem(key);
        const { read, forget, KEPT_FOR } = await import("./keep");
        const draft = id ? await read(id) : undefined;
        if (!id || !draft?.shots.length || draft.saved < Date.now() - KEPT_FOR) {
          sessionStorage.removeItem(key);
          if (id) await forget(id);
          return false;
        }
        const images = [];
        for (const shot of draft.shots) {
          const bitmap = await createImageBitmap(shot.image);
          const image = document.createElement("canvas");
          image.width = bitmap.width;
          image.height = bitmap.height;
          image.getContext("2d")?.drawImage(bitmap, 0, 0);
          shots.set(image, shot.seen);
          restored.set(image, shot.marks);
          images.push(image);
        }
        // Closed while it was read: nothing comes back.
        if (!mounted) return false;
        kept = id;
        seen = draft.shots[0]?.seen ?? look();
        show({ image: images[0] ?? null });
        for (const image of images.slice(1)) add(image);
        showShot(0);
        if (note) note.value = draft.note;
        // A category the host has since taken away is left at the default.
        if ([...(picker?.options ?? [])].some((option) => option.value === draft.category)) {
          (picker as HTMLSelectElement).value = draft.category as string;
        }
        minimise(false);
        return true;
      } catch {
        return false;
      } finally {
        reviving = false;
      }
    },
    lock: lockPage,
    unmount(keep) {
      // Twice is harmless: a close() and a late page-load restore can both end it.
      if (!mounted) return false;
      const stays = reviving || (!!keep && !submitted && store());
      mounted = false;
      clearTimeout(done);
      lockPage(false);
      backdrop.removeEventListener("close", closed);
      if (backdrop.open) backdrop.close();
      backdrop.remove();
      bar?.remove();
      parent.classList.remove("drafting");
      // Closed while a page load brings it back: the user never saw it end, so it stays kept.
      if (reviving) ended++;
      // Not kept: the draft ended, and its record, if this one wrote it, goes with it.
      else if (!stays) discard();
      return stays;
    },
  };
}
