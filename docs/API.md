# visual-feedback: API

ESM only, with TypeScript types. On first open it imports `@zumer/snapdom` by name, so a page
needs a bundler, or an import map that points that name to the file. There are three entry points:

| import | for | runs in |
|---|---|---|
| `visual-feedback` | `createFeedback()` and the types | browser |
| `visual-feedback/server` | `parseFeedbackRequest()`, `FeedbackRequestError` and the report types | any runtime with Web `Request` (Node 20+, Bun, Deno, edge) |
| `visual-feedback/react` | `<Feedback />` and the type `FeedbackProps` | browser, React 18+ |

## createFeedback(options: FeedbackOptions): FeedbackWidget

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
| `endpoint` | `string` | – | POSTs `multipart/form-data` with a `report` part (JSON, each screenshot without its image) and one part per screenshot, `image0`, `image1` and on, named `<id>-<n>.webp` or `<id>-<n>.png`. An answer that is not 2xx, a redirect included, shows the send error state with the default `error` text. It is a same-origin `fetch`, so it sends cookies only to the page's own origin. |
| `headers` | `Record<string, string>` or `() => Record<string, string>` | – | Extra headers for `endpoint`. |
| `trigger` | `"button" \| "none"` | `"button"` | `"none"` draws nothing; the host calls `open()`. |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Corner of the trigger. |
| `shortcut` | `string \| false` | `false` | For example `"Alt+Shift+F"`: any of `Alt`, `Shift`, `Control` and `Meta`, then one key, a letter, a digit or a key name such as `F2`, joined by `+`. The modifiers must match exactly, AltGr never matches, and any other modifier name makes it match nothing. Without `Control` or `Meta` it does not fire while focus is in a text field. It does nothing while the widget is open. Opt-in; it is the widget's only global listener, one `keydown` on `window` (SPEC §9 names what the capture library keeps). |
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
| `unstyled` | `boolean` | `false` | Keeps only the layout-critical CSS. THEMING.md. |
| `container` | `HTMLElement` | `document.body` | Where the host element is appended. |
| `tagName` | `string` | `"visual-feedback"` | The custom element name, if it clashes. |
| `draft` | `"session" \| "memory"` | `"session"` | Where a draft folded in the draft bar is kept. `"session"` keeps it for this tab across page loads, as it was last folded, until it ends or a day after it was last folded or brought back (SPEC §7); `"memory"` keeps nothing on the device, so a page load ends it. |

### FeedbackWidget
| member | meaning |
|---|---|
| `open(): Promise<void>` | Starts a capture. When a draft is kept in the draft bar, it opens the dialog on that draft instead, also once a page load has brought it back; when the dialog is open already, it does nothing. When the dialog cannot load or be shown, it rejects and `error` fires. |
| `close(): void` | Cancels and discards the draft, also when it is kept in the draft bar. Before `submit` fires, nothing is sent; after it, the delivery is not stopped, and `sent` or `error` still fires when it ends. |
| `destroy(): void` | Removes the element, its listeners and its stylesheet, but not what the capture library keeps (SPEC §9). If the dialog is open, or a draft is kept in the draft bar, `close` fires, and it is the last event: a delivery still under way fires neither `sent` nor `error`. |
| `on(event, fn): () => void` | Events: `open` (when a draft starts, and when a page load brings a kept draft back), `close` (when it ends: sent and closed, Cancel, Discard or `close()`; folding into the draft bar and opening it again fire neither), `submit` (with the report, before each attempt), `sent` (with the report), `error` (with the error), `saved` (after Save as PDF downloads the PDF; nothing is sent). The type `FeedbackEvents` maps each event to what it passes. Returns an unsubscribe function. |
| `update(options): void` | Merges these options into the current ones, key by key: a key given as `undefined` goes back to its default, and `strings` or `capture` replaces the whole object. `tagName` and `container` are ignored. The trigger, `position` (a draft bar already shown moves at its next fold), `theme`, `css`, `unstyled`, `strings.trigger`, `strings.triggerText` and `shortcut` change at once. The dialog's texts, `tools`, `categories` and `requireNote` apply from the next open, and the rest at the next capture or send. |

## FeedbackReport
```ts
type FeedbackReport = {
  id: string;                       // UUID v4 from crypto.getRandomValues, so plain http works
  createdAt: string;                // ISO 8601
  note: string;
  category?: string;
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
back to its default; `tagName` and `container` are read once), and unmounting destroys it. It is a
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
  lower-case UUID v4, and `createdAt` an ISO time from 1970 to 9999. Fields that `FeedbackReport`
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
- If any check fails, it throws a `FeedbackRequestError` that carries a `status` (400 or 413).
- Storing the report, and checking who sent it, is the host's job. `report.context` comes from the
  browser, so it is never proof of who sent it: take the user from your own session.
