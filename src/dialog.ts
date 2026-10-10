const LAYOUT = `.backdrop{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;box-sizing:border-box;background:none;color:inherit;display:grid;place-items:center;overflow:auto}.backdrop:not([open]){display:none}.backdrop::backdrop{background:none}.dialog{box-sizing:border-box;width:min(560px,100% - 32px);display:grid;gap:8px}.dialog.wide{width:min(1100px,100% - 32px)}.image{display:block;max-width:100%;max-height:60vh;margin:0 auto;color:var(--_mark)}.toolbar+.image{touch-action:none}.toolbar{display:flex;flex-wrap:wrap;gap:8px}.note{box-sizing:border-box;width:100%;min-height:96px;resize:vertical}.actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.live{position:fixed;width:1px;height:1px;margin:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}`;

const THEME = `.backdrop{background:var(--_bd)}.dialog{background:var(--_s);color:var(--_t);border-radius:var(--_r);box-shadow:var(--_sh);padding:16px}.title{margin:0 0 4px;font-size:1.15em}.label{font-weight:600}.image{border:1px solid var(--_b);border-radius:calc(var(--_r) / 2)}.error{margin:0}.note,.category,.actions button,.toolbar button{font:inherit;color:inherit;background:var(--_s);border:1px solid var(--_b);border-radius:calc(var(--_r) / 2)}.note,.category{padding:8px}.note::placeholder{color:var(--_m)}.actions button,.toolbar button{padding:6px 14px;cursor:pointer}.toolbar button:disabled{opacity:.5;cursor:default}.toolbar [aria-pressed=true]{border-color:var(--_a);box-shadow:inset 0 0 0 1px var(--_a)}.toolbar+.image{cursor:crosshair}.actions .send{font-weight:600;background:var(--_a);color:var(--_at);border-color:var(--_a)}.actions .send:where([data-ink=dark]){color:#000}.actions [aria-disabled=true]{opacity:.6;cursor:progress}.note:disabled,.category:disabled{opacity:.6}.status{margin:0}`;

import { annotate, type Tool } from "./annotate";
import { look, type Seen, shots } from "./seen";
import type { FeedbackReport, Mark } from "./shared/report";
import type { FeedbackEvent, FeedbackEvents, FeedbackOptions, FeedbackStrings } from "./widget";

type Texts = Omit<FeedbackStrings, "trigger">;

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
  undo: "Undo",
  clear: "Clear",
  cancel: "Cancel",
  send: "Send",
  sending: "Sending…",
  sent: "Thanks, it's sent.",
  error: "It didn't send. Your note is kept.",
  retry: "Try again",
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

/** What the user wrote and drew, taken once when Send is pressed. */
export type Draft = { note: string; category: string | undefined; marks: Mark[] };

export type Handlers = {
  close(): void;
  retry(): void;
  emit<E extends FeedbackEvent>(event: E, ...args: FeedbackEvents[E]): void;
  /** The options as they are at Send, after any update(). */
  options(): FeedbackOptions;
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
  /** The screenshot, or null for the capture error; the page stops scrolling. */
  capture(image: HTMLCanvasElement | null): void;
  /** Lets the page scroll, or stops it; unmount lets it scroll. */
  lock(on: boolean): void;
  unmount(): void;
};

export function mount(parent: HTMLElement, handlers: Handlers, settings: Settings = {}): Mounted {
  const tools = settings.tools ?? ["pen", "box", "arrow"];
  const text = texts(settings.strings);
  const backdrop = element("dialog", "backdrop", {
    "aria-modal": "true",
    "aria-labelledby": "vf-title",
  });
  const panel = element("div", "dialog");
  const title = element("h2", "title", { id: "vf-title" });
  title.textContent = text.title;
  backdrop.append(panel);

  let marks = (): Mark[] => [];
  // Set by each annotating view: the controls a send locks, and the button that sends.
  let locked: (HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement)[] = [];
  let inert: HTMLElement[] = [];
  let primary: HTMLButtonElement | undefined;
  let draft: Draft | undefined;
  let actions: HTMLElement | undefined;
  let failure: HTMLElement | undefined;

  function toolbar(image: HTMLCanvasElement): HTMLElement[] {
    const choices = [...new Set(tools)].filter((tool) => ["pen", "box", "arrow"].includes(tool));
    if (choices.length === 0) return [];
    const bar = element("div", "toolbar");
    const undo = button("undo", text.undo, () => annotator.undo());
    const clear = button("clear", text.clear, () => annotator.clear());
    const update = () => {
      const none = annotator.marks.length === 0;
      const root = parent.getRootNode() as ShadowRoot;
      // A disabled button drops the focus out of the dialog, past the Tab trap.
      if (none && (root.activeElement === undo || root.activeElement === clear)) {
        buttons.find((choice) => choice.getAttribute("aria-pressed") === "true")?.focus();
      }
      undo.disabled = clear.disabled = none;
    };
    const annotator = annotate(image, update);
    const pick = (tool: Tool) => {
      annotator.tool = tool;
      for (const [i, choice] of buttons.entries()) {
        const active = choices[i] === tool;
        choice.setAttribute("aria-pressed", String(active));
        choice.setAttribute("part", active ? "tool tool-active" : "tool");
      }
    };
    const buttons = choices.map((tool) => button("tool", text[tool], () => pick(tool)));
    pick(choices[0] as Tool);
    update();
    marks = () => {
      annotator.end();
      return [...annotator.marks];
    };
    bar.append(...buttons, undo, clear);
    locked.push(...buttons, undo, clear);
    return [bar];
  }

  // What Send encodes: the image on show now, or none.
  let current: HTMLCanvasElement | null = null;
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
        const image = current ? await capture.encode(current, options.capture) : null;
        const built = await module.build(draft, image, seen, options);
        if (mounted) report = built;
      }
      // Closed before submit: nothing is sent.
      if (!mounted || !report) return;
      handlers.emit("submit", report);
      await module.deliver(report, options);
      handlers.emit("sent", report);
      if (mounted) sent();
    } catch (error) {
      handlers.emit("error", error);
      if (mounted) failed(module?.shown(error));
    }
  }

  function show(view: View): void {
    current = view.error ? null : view.image;
    marks = () => [];
    locked = [];
    inert = [];
    primary = undefined;
    draft = undefined;
    failure = undefined;
    actions = element("div", "actions");
    const cancel = button("cancel", text.cancel, handlers.close);
    if (view.error) {
      const message = element("p", "error", { role: "alert" });
      message.textContent = text.captureError;
      const retry = button("retry", text.retry, handlers.retry);
      actions.append(
        cancel,
        button("send-without", text.sendWithout, () => show({ image: null })),
        retry,
      );
      panel.classList.remove("wide");
      panel.replaceChildren(title, message, actions);
      retry.focus();
      return;
    }
    const label = element("label", "label", { for: "vf-note" });
    label.textContent = text.noteLabel;
    const note = element("textarea", "note", {
      id: "vf-note",
      placeholder: text.notePlaceholder,
      maxlength: String(NOTE_LIMIT),
    });
    const required = element("p", "error", { id: "vf-note-error", role: "alert" });
    required.textContent = text.noteRequired;
    note.addEventListener("input", () => {
      if (!note.value.trim()) return;
      note.removeAttribute("aria-invalid");
      note.removeAttribute("aria-describedby");
      required.remove();
    });
    const fields: HTMLElement[] = [label, note];
    let category: HTMLSelectElement | undefined;
    if (settings.categories?.length) {
      const name = element("label", "label", { for: "vf-category" });
      name.textContent = text.categoryLabel;
      category = element("select", "category", { id: "vf-category" });
      for (const choice of settings.categories) {
        const option = document.createElement("option");
        option.value = choice.id;
        option.textContent = choice.label;
        category.append(option);
      }
      fields.push(name, category);
    }
    const image = view.image;
    if (image) {
      image.className = "image";
      image.setAttribute("part", "image");
      // snapdom sizes its canvas inline, which beats max-height and squashes the image.
      image.removeAttribute("style");
      inert.push(image);
    }
    const drawing = image ? [...toolbar(image), image] : [];
    const send = button("send", text.send, () => {
      if (draft) {
        // Sending, or a send error: the same draft goes again, never a second one at once.
        if (send.getAttribute("aria-disabled") !== "true") void deliver(draft);
        return;
      }
      if (settings.requireNote !== false && !note.value.trim()) {
        note.setAttribute("aria-invalid", "true");
        note.setAttribute("aria-describedby", required.id);
        note.after(required);
        note.focus();
        return;
      }
      draft = { note: note.value, category: category?.value, marks: marks() };
      void deliver(draft);
    });
    primary = send;
    locked.push(note, ...(category ? [category] : []));
    actions.append(cancel, send);
    panel.classList.toggle("wide", Boolean(image));
    panel.replaceChildren(title, ...drawing, ...fields, actions);
    ink(send);
    note.focus();
  }

  function sending(): void {
    if (!primary) return;
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
    panel.replaceChildren(title, status);
    status.focus();
    done = setTimeout(handlers.close, 3000);
  }

  function failed(message = text.error): void {
    if (!primary || !actions) return;
    failure = element("p", "error", { role: "alert" });
    failure.textContent = message;
    actions.before(failure);
    primary.removeAttribute("aria-disabled");
    primary.textContent = text.retry;
    primary.setAttribute("part", "retry");
    primary.focus();
  }

  // Escape: close at once, not on the later native close event. Chrome can skip cancel, so both.
  backdrop.addEventListener("cancel", (event) => {
    event.preventDefault();
    handlers.close();
  });
  backdrop.addEventListener("close", handlers.close);
  // Every Tab is handled here, so the trap holds where the browser skips buttons (WebKit).
  backdrop.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (item) => !item.matches(":disabled") && item.getClientRects().length > 0,
    );
    const active = (parent.getRootNode() as ShadowRoot).activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    const step = event.shiftKey ? -1 : 1;
    const next = index < 0 ? (event.shiftKey ? items.length - 1 : 0) : index + step;
    items.at(next % items.length)?.focus();
  });

  parent.append(backdrop);
  try {
    backdrop.showModal();
  } catch (error) {
    backdrop.remove();
    throw error;
  }
  let done: ReturnType<typeof setTimeout> | undefined;
  let scrollLocked = false;
  const lock = (on: boolean) => {
    if (on !== scrollLocked) (on ? lockScroll : unlockScroll)();
    scrollLocked = on;
  };
  return {
    show,
    capture(image) {
      // Without an image, the page as it is at the capture error.
      seen = (image && shots.get(image)) ?? look();
      show(image ? { image } : { error: true });
      lock(true);
    },
    lock,
    unmount() {
      mounted = false;
      clearTimeout(done);
      lock(false);
      backdrop.removeEventListener("close", handlers.close);
      if (backdrop.open) backdrop.close();
      backdrop.remove();
    },
  };
}
