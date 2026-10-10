import type { Tool } from "./annotate";
import type { CaptureOptions } from "./capture";
import type { FeedbackReport, Mark } from "./shared/report";

const SVG = "http://www.w3.org/2000/svg";

/** What each event passes to its handlers. */
export type FeedbackEvents = {
  open: [];
  close: [];
  submit: [report: FeedbackReport];
  sent: [report: FeedbackReport];
  error: [error: unknown];
  saved: [];
};

export type FeedbackEvent = keyof FeedbackEvents;

/** The texts the widget shows, by SPEC §12 key. */
export type FeedbackStrings = Record<
  | "trigger"
  | "title"
  | "capturing"
  | "captureError"
  | "sendWithout"
  | "noteLabel"
  | "notePlaceholder"
  | "noteRequired"
  | "categoryLabel"
  | "pen"
  | "box"
  | "arrow"
  | "text"
  | "select"
  | "remove"
  | "undo"
  | "clear"
  | "cancel"
  | "send"
  | "sending"
  | "sent"
  | "error"
  | "retry"
  | "triggerText"
  | "escHint"
  | "minimise"
  | "screenshot"
  | "addScreenshot"
  | "removeScreenshot"
  | "draft"
  | "captureView"
  | "reopen"
  | "discard"
  | "discardConfirm"
  | "keepEditing"
  | "moreSend"
  | "savePdf"
  | "pdfError",
  string
>;

export type FeedbackOptions = {
  onSubmit?: (report: FeedbackReport) => Promise<void>;
  endpoint?: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  capture?: CaptureOptions;
  tools?: Tool[];
  categories?: { id: string; label: string }[];
  requireNote?: boolean;
  redactUrl?: boolean;
  context?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  trigger?: "button" | "none";
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  shortcut?: string | false;
  strings?: Partial<FeedbackStrings>;
  theme?: "auto" | "light" | "dark";
  css?: string;
  unstyled?: boolean;
  container?: HTMLElement;
  tagName?: string;
  draft?: "session" | "memory";
};

export type FeedbackWidget = {
  open(): Promise<void>;
  close(): void;
  destroy(): void;
  /** A key given as undefined goes back to its default. */
  update(options: { [K in keyof FeedbackOptions]?: FeedbackOptions[K] | undefined }): void;
  on<E extends FeedbackEvent>(event: E, fn: (...args: FeedbackEvents[E]) => void): () => void;
};

function supported(): boolean {
  return (
    typeof document !== "undefined" &&
    "adoptedStyleSheets" in Document.prototype &&
    "adoptedStyleSheets" in ShadowRoot.prototype &&
    CSS.supports("color", "color-mix(in srgb, red, red)")
  );
}

function sheet(text: string): CSSStyleSheet {
  const result = new CSSStyleSheet();
  result.replaceSync(text);
  return result;
}

function variables(): string {
  // Floor browsers (SPEC §10) may lack AccentColor.
  const system = CSS.supports("color", "AccentColor");
  return `.vf{--_r:var(--vf-radius,16px);--_s:var(--vf-surface,Canvas);--_t:var(--vf-text,CanvasText);--_m:var(--vf-muted,color-mix(in srgb,var(--_t) 60%,transparent));--_b:var(--vf-border,color-mix(in srgb,var(--_t) 15%,transparent));--_a:var(--vf-accent,${system ? "AccentColor" : "#0b57d0"});--_at:var(--vf-accent-text,#fff);--_f:var(--vf-focus,var(--_a));--_mark:var(--vf-mark,#e5243b);--_bd:var(--vf-backdrop,rgb(0 0 0/45%));--_sh:var(--vf-shadow,0 12px 32px -12px rgb(0 0 0/35%));--_size:var(--vf-trigger-size,2.5em);--_off:var(--vf-offset,16px);--_z:var(--vf-z,2147483000)}`;
}

const LAYOUT = `.vf{display:contents;font-family:var(--vf-font,inherit);color-scheme:light dark}.trigger{font:inherit;position:fixed;z-index:var(--_z);box-sizing:border-box;height:var(--_size);margin:0;padding:0 14px 0 12px;display:flex;align-items:center;gap:8px;white-space:nowrap}.trigger[data-icon]{width:var(--_size);padding:0;justify-content:center}[data-y=bottom]{bottom:calc(var(--_off) + env(safe-area-inset-bottom,0px))}[data-y=top]{top:calc(var(--_off) + env(safe-area-inset-top,0px))}[data-x=right]{right:calc(var(--_off) + env(safe-area-inset-right,0px))}[data-x=left]{left:calc(var(--_off) + env(safe-area-inset-left,0px))}.trigger svg{width:1.15em;height:1.15em}.capturing,.capturing .backdrop{visibility:hidden}:focus-visible{outline:2px solid var(--_f);outline-offset:2px}@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;

const THEME = `.trigger{font-weight:600;border:1px solid var(--_b);border-radius:999px;background:var(--_s);color:var(--_t);box-shadow:var(--_sh);cursor:pointer;transition:background-color .15s}.trigger:hover{background:color-mix(in srgb,var(--_s) 90%,var(--_t))}`;

// The dialog draws its icons with ./icon; sharing it would put a chunk into the loader's budget.
function icon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const path = document.createElementNS(SVG, "path");
  const attributes = {
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linejoin": "round",
    part: "trigger-icon",
  };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  path.setAttribute("d", "M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z");
  svg.append(path);
  return svg;
}

function field(element: HTMLElement): boolean {
  return element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
}

function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

// Symbol.for keys are shared by every copy of this package on the page (two bundles, a hot reload).
const DISCONNECTED = Symbol.for("visual-feedback.disconnected");

type Hooked = HTMLElement & { [DISCONNECTED]?: () => void };

// The widget of each tag whose element is in a page owns the draft that tag keeps; others keep
// theirs in memory only, so two never bring back, or overwrite, one draft.
const owners = new Map<string, HTMLElement>();
// The owner's way to end its own draft, for discardDraft().
const enders = new WeakMap<HTMLElement, () => void>();
// Set once a widget loads the dialog: before that, no draft write can be queued.
let dialogs: Promise<typeof import("./dialog")> | undefined;
let discarding: Promise<void> = Promise.resolve();

/**
 * Deletes the draft this tab keeps for a tag, as at a logout, so no later widget of the tag brings
 * it back; a widget holding it, open or folded, ends it.
 */
export async function discardDraft(tagName = "visual-feedback"): Promise<void> {
  // Read before the owner ends: its own end removes the id without waiting for the delete. The id
  // goes now, so a widget opened during the waits below has nothing to bring back.
  const key = `visual-feedback:${tagName}`;
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
  } catch {}
  const owner = owners.get(tagName);
  if (owner) enders.get(owner)?.();
  // Queued behind any earlier call, so a call that found the id gone still waits for its delete.
  const mine = discarding.then(async () => {
    // A destroyed widget may still be writing the draft: delete it only after that lands.
    await (await dialogs?.catch(() => undefined))?.settled();
    if (id) await (await import("./keep")).forget(id);
  });
  discarding = mine.catch(() => {});
  await mine;
}

const noop: FeedbackWidget = {
  open: async () => {},
  close() {},
  destroy() {},
  update() {},
  on: () => () => {},
};

export function createFeedback(options: FeedbackOptions = {}): FeedbackWidget {
  if (!supported()) return noop;
  const tag = options.tagName ?? "visual-feedback";
  if (!customElements.get(tag)) {
    customElements.define(
      tag,
      class extends HTMLElement {
        disconnectedCallback() {
          (this as Hooked)[DISCONNECTED]?.();
        }
      },
    );
  }
  const host = document.createElement(tag);
  const root = host.attachShadow({ mode: "open" });
  const wrapper = document.createElement("div");
  wrapper.className = "vf";
  root.append(wrapper);
  let view: typeof import("./dialog") | undefined;

  type Handler = (...args: unknown[]) => void;
  const handlers = new Map<FeedbackEvent, Set<Handler>>();
  // A host's listener that throws is reported, never allowed to change what the widget does.
  const call = (fns: Iterable<Handler>, args: unknown[]) => {
    for (const fn of [...fns]) {
      try {
        fn(...args);
      } catch (error) {
        reportError(error);
      }
    }
  };
  const emit = <E extends FeedbackEvent>(event: E, ...args: FeedbackEvents[E]) =>
    call(handlers.get(event) ?? [], args);
  // The error event has reported a failed open; a click or a key has no caller to reject to.
  const start = () => void widget.open().catch(() => {});

  let state: "idle" | "opening" | "open" | "destroyed" = "idle";
  let dialog: ReturnType<typeof import("./dialog").mount> | undefined;
  // Each open and each close starts a new session, so work left from an older one stops.
  let session = 0;
  let returnFocus: Element | null = null;
  let pending: Promise<void> | undefined;

  let trigger: HTMLButtonElement | undefined;
  let label: HTMLSpanElement | undefined;
  let unlisten: (() => void) | undefined;

  // Alt changes event.key on macOS (Alt+F types ƒ), so the key's code is matched too.
  function listen(shortcut: string): () => void {
    const parts = shortcut.toLowerCase().split("+");
    const key = parts.pop();
    const names = ["alt", "shift", "control", "meta"];
    const mods = names.map((name) => parts.includes(name)).join();
    // Without Control or Meta, keys typed into a field stay with the field.
    const typing = !/control|meta/.test(shortcut.toLowerCase());
    const on = (event: KeyboardEvent) => {
      if (
        // Autofill dispatches plain keydown Events, with no key or modifier state.
        event instanceof KeyboardEvent &&
        state === "idle" &&
        !event.repeat &&
        !event.isComposing &&
        !event.getModifierState("AltGraph") &&
        parts.every((part) => names.includes(part)) &&
        [event.altKey, event.shiftKey, event.ctrlKey, event.metaKey].join() === mods &&
        [event.code.replace(/^(Key|Digit)/, ""), event.key].some(
          (name) => name.toLowerCase() === key,
        ) &&
        !(typing && field(event.composedPath()[0] as HTMLElement))
      ) {
        event.preventDefault();
        start();
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }

  let base: CSSStyleSheet[] = [];
  let extra: CSSStyleSheet[] = [];
  function sheets(): void {
    const dialogCss = view?.css(Boolean(options.unstyled)).map(sheet) ?? [];
    root.adoptedStyleSheets = [...base, ...dialogCss, ...extra];
  }

  function apply(): void {
    wrapper.style.colorScheme = options.theme?.replace("auto", "") ?? "";
    base = [sheet(variables() + LAYOUT), ...(options.unstyled ? [] : [sheet(THEME)])];
    extra = options.css ? [sheet(options.css)] : [];
    sheets();
    if (options.trigger === "none") {
      trigger?.remove();
      trigger = undefined;
    } else {
      if (!trigger) {
        trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "trigger";
        trigger.setAttribute("part", "trigger");
        label = document.createElement("span");
        label.setAttribute("part", "trigger-text");
        trigger.append(icon(), label);
        trigger.addEventListener("click", start);
        wrapper.prepend(trigger);
      }
      const [y, x] = (options.position ?? "bottom-right").split("-");
      trigger.dataset.y = y;
      trigger.dataset.x = x;
      const { trigger: name, triggerText } = options.strings ?? {};
      trigger.setAttribute("aria-label", name || triggerText || "Send feedback");
      // Icon only unless the host gives a visible text.
      trigger.toggleAttribute("data-icon", !triggerText);
      if (label) {
        label.textContent = triggerText ?? "";
        label.hidden = !triggerText;
      }
    }
    unlisten?.();
    unlisten = options.shortcut ? listen(options.shortcut) : undefined;
  }

  apply();
  // A script in <head> runs before <body> exists.
  (options.container ?? document.body ?? document.documentElement).append(host);
  // Asked each time: when the owner's element leaves the page, the next widget to ask takes over.
  const keeps = () => {
    if (options.draft === "memory") return false;
    if (!owners.get(tag)?.isConnected && host.isConnected) owners.set(tag, host);
    return owners.get(tag) === host;
  };
  // A draft this tab kept before a page load, or a route change, shows its bar again.
  restore();

  function restore(): boolean {
    try {
      if (!keeps() || !sessionStorage.getItem(`visual-feedback:${tag}`)) return false;
    } catch {
      return false;
    }
    state = "opening";
    pending = show(++session, true);
    pending.catch(() => {});
    return true;
  }

  // Hidden, so neither the trigger nor the dialog is in the image (SPEC §2, capturing). A modal
  // dialog gets visibility: visible from the browser, so the backdrop is hidden by name.
  function hide(on: boolean): void {
    wrapper.classList.toggle("capturing", on);
  }

  // Asked before any await: getDisplayMedia needs the click's activation, which a slow import outlasts.
  function requestDisplay(): Promise<MediaStream> | undefined {
    const media = navigator.mediaDevices;
    if (options.capture?.mode !== "display" || typeof media?.getDisplayMedia !== "function") return;
    hide(true);
    const stream = media.getDisplayMedia({ video: true });
    stream.catch(() => {});
    return stream;
  }

  function stop(stream?: Promise<MediaStream>): void {
    stream?.then(
      (media) => {
        for (const track of media.getTracks()) track.stop();
      },
      () => {},
    );
  }

  async function grab(
    module: typeof import("./capture"),
    mine: number,
    stream?: Promise<MediaStream>,
  ): Promise<HTMLCanvasElement | null> {
    hide(true);
    const quiet = view?.announce(root, options.strings);
    try {
      return await module.capture(options.capture, stream);
    } catch {
      return null;
    } finally {
      quiet?.();
      if (mine === session) hide(false);
    }
  }

  function cancel(): void {
    session++;
    hide(false);
  }

  /** Returns whether the draft stays kept; when not, it has ended. */
  function teardown(keep?: boolean): boolean {
    const stays = dialog?.unmount(keep) ?? false;
    dialog = undefined;
    // WebKit does not focus a clicked button, so body here means the trigger opened it.
    const target =
      returnFocus?.isConnected && returnFocus !== document.body ? returnFocus : trigger;
    returnFocus = null;
    (target as HTMLElement | undefined)?.focus?.();
    return stays;
  }

  async function show(mine: number, kept?: boolean): Promise<void> {
    returnFocus = deepActive();
    const stream = kept ? undefined : requestDisplay();
    try {
      // A failed load is not kept, so the next open tries again.
      dialogs ??= import("./dialog").catch((error) => {
        dialogs = undefined;
        throw error;
      });
      const [loaded, capture] = await Promise.all([dialogs, import("./capture")]);
      if (mine !== session) return stop(stream);
      view = loaded;
      sheets();
      const image = kept ? null : await grab(capture, mine, stream);
      if (mine !== session) return;
      // The host app may have removed the element while the dialog loaded; showModal() would throw.
      if (!host.isConnected) {
        state = "idle";
        return;
      }
      dialog = view.mount(
        wrapper,
        {
          close: () => widget.close(),
          // A half-updated dialog cannot go on: close it, then report why.
          retry: () =>
            void retry(capture).catch((error) => {
              widget.close();
              emit("error", error);
            }),
          emit,
          options: () => options,
          keeps,
        },
        options,
      );
      const mounted = dialog;
      if (!kept) mounted.capture(image);
      else {
        const back = await mounted.revive();
        // Closed or destroyed while it came back: it stays kept. A dialog a later open() mounted
        // meanwhile is left alone, and so is the focus.
        if (mine !== session) {
          mounted.unmount(true);
          return;
        }
        // Nothing kept after all (expired, storage off).
        if (!back) {
          state = "idle";
          mounted.unmount();
          return;
        }
      }
    } catch (error) {
      stop(stream);
      if (mine === session) {
        state = "idle";
        hide(false);
        teardown();
      }
      emit("error", error);
      throw error;
    }
    state = "open";
    emit("open");
  }

  // The lock is off while capturing, so the image has the page's own scrollbar and layout.
  async function retry(capture: typeof import("./capture")): Promise<void> {
    if (wrapper.classList.contains("capturing")) return;
    const mine = session;
    dialog?.lock(false);
    const image = await grab(capture, mine, requestDisplay());
    if (mine !== session) return;
    dialog?.capture(image);
  }

  const widget: FeedbackWidget = {
    open() {
      // A kept draft still coming back opens once it is back.
      if (state === "opening" && pending) {
        const mine = session;
        // Once it is back, or found gone, the click still opens something, unless closed meanwhile.
        return pending.then(() => (mine === session ? widget.open() : undefined));
      }
      // Open, or kept as a draft: a draft bar's dialog opens again.
      if (state !== "idle") return dialog?.reopen(), Promise.resolve();
      // A draft this tab still keeps opens, not a new capture: it comes back, then opens.
      if (restore()) return widget.open();
      state = "opening";
      pending = show(++session);
      return pending;
    },
    close() {
      end();
    },
    destroy() {
      if (state === "destroyed") return;
      const wasOpen = state === "open";
      state = "destroyed";
      cancel();
      unlisten?.();
      // Gone with the page, as at a route change: the draft stays kept, as across a page load,
      // and close fires only when it ended.
      const ended = wasOpen && !teardown(true);
      const closers = ended ? [...(handlers.get("close") ?? [])] : [];
      handlers.clear();
      host.remove();
      call(closers, []);
    },
    update(next) {
      if (state === "destroyed") return;
      // tagName and container are read only at creation, so new ones change nothing.
      // Every reader takes an undefined key as left out, so it falls back to the default.
      options = { ...options, ...next } as FeedbackOptions;
      apply();
    },
    on(event, fn) {
      if (state === "destroyed") return () => {};
      const set = handlers.get(event) ?? new Set();
      handlers.set(event, set);
      const handler = fn as Handler;
      set.add(handler);
      return () => set.delete(handler);
    },
  };
  function end(keep?: boolean): void {
    if (state !== "open" && state !== "opening") return;
    const wasOpen = state === "open";
    state = "idle";
    cancel();
    // Also while opening: capture hid the trigger, which can take the focus with it.
    const stays = teardown(keep);
    if (wasOpen && !stays) emit("close");
  }

  enders.set(host, () => end());
  // The host app may remove the element (a route change) while the dialog is open: it closes,
  // and the draft stays kept. A move reconnects it before the microtask runs, so it keeps all.
  (host as Hooked)[DISCONNECTED] = () =>
    queueMicrotask(() => {
      if (!host.isConnected) end(true);
    });
  return widget;
}
