# visual-feedback: API

ESM only, with TypeScript types. On first open it imports `@zumer/snapdom` by name, so a page
needs a bundler, or an import map that points that name to the file. There are three entry points:

| import | for | runs in |
|---|---|---|
| `visual-feedback` | `createFeedback()`, `discardDraft()` and the types | browser |
| `visual-feedback/server` | `parseFeedbackRequest()`, `FeedbackRequestError` and the report types | any runtime with Web `Request` (Node 20+, Bun, Deno, edge) |
| `visual-feedback/react` | `<Feedback />` and the type `FeedbackProps` | browser, React 18+ |

## createFeedback(options: FeedbackOptions): FeedbackWidget
Without a document (a server render) or in a browser below SPEC §10, it returns a widget whose
methods do nothing: it draws nothing and fires no event.

```ts
import { createFeedback } from "visual-feedback";

const feedback = createFeedback({
  onSubmit: async (report) => {
    const body = new FormData();
    const screenshots = report.screenshots.map(({ image: _, ...shot }) => shot);
    body.append("report", JSON.stringify({ ...report, screenshots }));
    for (const [i, { image }] of report.screenshots.entries()) {
      const extension = image.type === "image/png" ? "png" : "webp";
      body.append(`image${i}`, image, `${report.id}-${i}.${extension}`);
    }
    const res = await fetch("/api/feedback", { method: "POST", body });
    if (!res.ok) throw new Error("It didn't send. Your note is kept.");
  },
});
```

### Options
| option | type | default | meaning |
|---|---|---|---|
| `onSubmit` | `(report) => Promise<void>` | – | Sends the report. A throw shows the send error state, using the error's message. Give this or `endpoint`; with both, `onSubmit` is used. |
| `endpoint` | `string` | – | POSTs `multipart/form-data` with a `report` part (JSON, each screenshot without its image) and one part per screenshot, `image0`, `image1` and on, named `<id>-<n>.webp` or `<id>-<n>.png`. An answer that is not 2xx, a redirect included, shows the send error state with the default `error` text. It is a same-origin `fetch`, so it sends cookies only to the page's own origin; another origin needs CORS on its server and a `connect-src` that allows it. |
| `headers` | `Record<string, string>` or `() => Record<string, string>` | – | Extra headers for `endpoint`. A function is called at Send; a throw shows the send error state, using the error's message. |
| `trigger` | `"tab" \| "button" \| "none"` | `"tab"` | `"tab"` touches the side edge, `"button"` is round, in the corner (SPEC §3). `"none"` draws no trigger; the host calls `open()`. A kept draft's bar still shows. |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Corner of the trigger. |
| `shortcut` | `string \| false` | `false` | For example `"Alt+Shift+F"`: any of `Alt`, `Shift`, `Control` and `Meta`, then one key, a letter, a digit or a key name such as `F2`, joined by `+`. The modifiers must match exactly, AltGr never matches, and any other modifier name, or no key, makes it match nothing. Without `Control` or `Meta` it does not fire while focus is in a form field (`input`, `textarea`, `select`) or editable content. It does nothing while the dialog is open or a draft is kept in the draft bar. The trigger's tooltip names it (SPEC §3). Opt-in; it is the widget's only listener on `window` or `document`, one `keydown` on `window` (SPEC §9 names what else the widget watches, and what the capture library keeps). |
| `tools` | `("pen" \| "box" \| "arrow" \| "text" \| "select")[]` | all five | Order is the toolbar order, and the first drawing tool is the one selected at open. Repeats and unknown names are ignored; an empty list, or Select alone, shows no toolbar. The Delete button is there only with Select. |
| `categories` | `{ id: string; label: string }[]` | none | Shows a category picker. |
| `requireNote` | `boolean` | `true` | |
| `capture.mode` | `"dom" \| "display"` | `"dom"` | SPEC §5. The type of `capture` is exported as `CaptureOptions`. |
| `capture.maxWidth` | `number` | `1920` | |
| `capture.type` | `"image/webp" \| "image/png"` | `"image/webp"` | |
| `capture.quality` | `number` | `0.85` | For WebP. |
| `redactUrl` | `boolean` | `false` | Drops the query string and the hash from `page.url`, the report's and each screenshot's. |
| `context` | `() => Record<string, unknown> \| Promise<…>` | – | Host data added to the report, such as a user id or the app version. Called at Send; a throw shows the send error state, using the error's message. |
| `strings` | `Partial<FeedbackStrings>` | English | SPEC §12 keys. Keys left out, or given as `undefined`, keep their English text. |
| `theme` | `"auto" \| "light" \| "dark"` | `"auto"` | THEMING.md. |
| `css` | `string` | – | Extra CSS added inside the shadow root, after the defaults. THEMING.md. |
| `unstyled` | `boolean` | `false` | Keeps only the layout-critical CSS and the focus ring. THEMING.md. |
| `container` | `HTMLElement` | `document.body` | Where the host element is appended. |
| `tagName` | `string` | `"visual-feedback"` | The custom element name, if it clashes. |
| `draft` | `"session" \| "memory"` | `"session"` | Where a draft folded in the draft bar is kept. `"session"` keeps it for this tab across page loads and route changes, as it was last folded, until it ends or a day after it was last folded or brought back (SPEC §7); `"memory"` keeps nothing on the device, so a page load ends it. One widget of a tag keeps a draft, the first whose element is in the page; when that element leaves, the next widget of the tag to need it takes over. Another one with the same `tagName` keeps its own in memory only. |

### FeedbackWidget
| member | meaning |
|---|---|
| `open(): Promise<void>` | Starts a capture. When a draft is kept in the draft bar, or this tab still keeps one, it opens the dialog on that draft instead, once it is back; when the dialog is open already, it does nothing. When the dialog cannot load or be shown, it rejects and `error` fires. |
| `close(): void` | Cancels and discards the draft, also when it is kept in the draft bar, and never asks first as the Cancel button can (SPEC §2); one a page load is still bringing back is only hidden, kept, with no event (SPEC §7). Before `submit` fires, nothing is sent; after it, the delivery is not stopped, and `sent` or `error` still fires when it ends. |
| `destroy(): void` | Removes the element, its listeners, its watch of the page's theme and its stylesheet, but not what the capture library keeps (SPEC §9). A delivery still under way fires neither `sent` nor `error` after it. The draft, open or folded, stays kept, so `close` does not fire: the next widget of the same tag made in this tab brings it back folded, as after a page load, so a route change keeps it. A host that removes the element gets the same for the draft, but its listeners and its watch of the page's theme stay until `destroy()`. A draft it cannot keep ends, and `close` fires as the last event: with `draft: "memory"`, a Send already handed to the host (`submit` fired), a widget that does not own its tag's draft, no screenshot (the capture error, or after "Send without screenshot"), a screenshot taken while it did not keep drafts, or sessionStorage that refuses it. To end the draft too, as at a logout, call `discardDraft()`. A draft whose IndexedDB write then fails (storage full) is lost, with no `close`: the widget is gone by then. |
| `on(event, fn): () => void` | Events: `open` (when a draft starts, and when a kept draft comes back), `close` (only when the draft ends: sent and closed, Cancel, Discard, `close()`, or a `destroy()` or removed element that does not keep it; folding into the draft bar, opening it again, and a `destroy()` or removal that keeps it fire none), `submit` (with the report, before each attempt), `sent` (with the report), `error` (with the error), `saved` (after Save as PDF downloads the PDF; nothing is sent). The type `FeedbackEvents` maps each event to what it passes. Returns an unsubscribe function. |
| `update(options): void` | Merges these options into the current ones, key by key: a key given as `undefined` goes back to its default, and `strings` or `capture` replaces the whole object. `tagName` and `container` are ignored. The trigger, `position` (a draft bar already shown moves at its next fold), `theme`, `css`, `unstyled`, `strings.trigger`, `strings.triggerText` and `shortcut` change at once, and a new `theme` or `css` reads the page's look again (THEMING.md). The dialog's texts, `tools`, `categories` and `requireNote` apply from the next open, and the rest at the next capture or send. |

## discardDraft(tagName?: string): Promise<void>
Deletes the draft this tab keeps for a tag (default `"visual-feedback"`), as at a logout, so no
later widget of that tag brings it back: the id in sessionStorage and the record in IndexedDB. A
widget that holds it, open or folded, ends it, and `close` fires; one still bringing it back at a
page load stops, with no event, since it never showed it. It waits for a write still under
way, so none lands after it. It needs no widget on the page; with `<Feedback />`, import it from
`visual-feedback`. A widget made with a `tagName` needs that same name here. It rejects when the
device's storage cannot be reached; the id is already gone by then, so no widget brings the draft
back.

## FeedbackReport
```ts
type FeedbackReport = {
  id: string;                       // UUID v4 from crypto.getRandomValues, so plain http works
  createdAt: string;                // ISO 8601, as Date.prototype.toISOString() writes it
  note: string;
  category?: string;                // the chosen category's id; absent without `categories`
  screenshots: Screenshot[];        // at most 10; empty after "Send without screenshot"
  page: { url: string; title: string };
  viewport: { width: number; height: number; devicePixelRatio: number };
  scroll: { x: number; y: number };
  userAgent: string;
  language: string;
  timeZone: string;
  context: Record<string, unknown>;
};
type Screenshot = {
  image: Blob;                      // marks painted in
  marks: Mark[];                    // shapes and text labels, in image pixels
  page: { url: string; title: string };  // the page as it was when this screenshot was taken
  viewport: { width: number; height: number; devicePixelRatio: number };
  scroll: { x: number; y: number };
};
type Mark =
  | { tool: "pen"; points: [number, number][] }
  | { tool: "box"; x: number; y: number; width: number; height: number }
  | { tool: "arrow"; from: [number, number]; to: [number, number] }
  // A label, its text at most 280 characters, centred on y and starting at x.
  | { tool: "text"; x: number; y: number; text: string };
```

## `<Feedback {...options} />` (`visual-feedback/react`)
Its props are the options of `createFeedback`. It renders nothing where it stands: after it mounts
in the browser it creates the widget, a changed prop goes to `update()` (a prop that is gone goes
back to its default; `tagName` and `container` are read once), and unmounting destroys it, which
keeps a draft: call `discardDraft()` at a logout. It is a
client component, so a server component can render it with props that reach the browser as data,
such as `endpoint`; `onSubmit`, `headers` as a function, `context` and `container` need a client
component.

```tsx
import { Feedback } from "visual-feedback/react";

<Feedback endpoint="/api/feedback" />;
```

## parseFeedbackRequest(request, limits?) (`visual-feedback/server`)
```ts
const { report } = await parseFeedbackRequest(request, { maxImageBytes: 5_000_000 });
```
- It reads the multipart body that `endpoint` sends and checks the report's shape. `id` must be a
  lower-case UUID v4, and `createdAt` an ISO time from 1970 to 9999, in exactly the form
  `Date.prototype.toISOString()` writes (UTC, with milliseconds). Fields that `FeedbackReport`
  does not define, and `__proto__` keys at any depth, are dropped.
- In the report's text, `context` included, NUL characters are removed and half surrogate pairs (a
  cut emoji) become U+FFFD, so any store, Postgres `jsonb` included, can keep it.
- A report holds at most 10 screenshots, and screenshot `n` needs exactly one image part,
  `image<n>`. An image part with no screenshot is refused, and so is a part named `image`, which
  visual-feedback 0.1 sent.
- It checks that each image is a real WebP or PNG (magic bytes, not the declared type) and within
  `maxImageBytes`, which is `10_000_000` by default. The report part may be at most 1 MiB, and
  the whole body at most 10 times `maxImageBytes` plus 1 MiB plus 64 KiB for the multipart
  framing; a larger body is refused while it streams in.
- `report.screenshots[n].image` is the checked image of part `image<n>`, typed from its bytes.
- If any check fails, it throws a `FeedbackRequestError` that carries a `status` (400 or 413). A
  `maxImageBytes` that is not a number of bytes is a mistake in the host's code: it throws a
  `RangeError`.
- Storing the report, and checking who sent it, is the host's job. `report.context` comes from the
  browser, so it is never proof of who sent it: take the user from your own session.
