# visual-feedback: behaviour

## 1. What it is
A user reports a problem or an idea from the page they are on. They capture the screen, mark it
up, write a note and send it. The host app receives one report and decides where it goes. The
package stores nothing and sends nothing by itself.

## 2. Flow
```
idle --open--> capturing --image ready--> annotating --Send--> sending --ok--> sent --3 s--> idle
                   |                          |                    |
                   +--fails--> capture error  +--Cancel/Esc--> idle +--fails--> send error
```
- **idle:** the trigger button shows (`trigger: "button"`), or nothing shows (`trigger: "none"`,
  where the host calls `open()`).
- **capturing:** the trigger and any open panel are hidden, so they are not in the image. The
  screen is captured (SPEC §5), and a screen reader is told the `capturing` text.
- **capture error:** the `captureError` text, with "Try again" (back to capturing), "Send without
  screenshot" (annotating with no image: no toolbar, no screenshots in the report) and Cancel or Esc
  (idle).
- **annotating:** a full-viewport overlay shows the image with a tool rail beside it, and the note
  field, with Send in a footer row under it. A close button in the header and Esc cancel.
- **sending:** the note, the category and the tools are disabled, and the Send button shows
  progress. Cancel and Esc still close the dialog.
- **sent:** a short confirmation, then idle.
- **send error:** the message comes from the host's error, or else the `error` text. The note and
  the marks are kept, and "Try again" sends the same report.

## 3. The trigger
- It is a small pill, 2.5em high by default (40 px on a 16 px site), in a corner (`position`), with
  an icon, the short `triggerText` label and the `trigger` accessible name; with only `triggerText`
  given, that text is the name too. A host that sets both keeps `triggerText` inside `trigger`, so
  speech control can say what it sees. It has no badge, and it does not move or pulse.
- It sits 16 px from the edges by default, and it respects `env(safe-area-inset-*)`.
- It does not watch the page. The host moves it off its own content with `position` or
  `--vf-offset`.

## 4. Annotating
- **Tools:** Pen (freehand), Box (rectangle outline), Arrow and Text. Text places a label where the
  image is clicked: Enter or clicking away keeps it, Escape drops that label only, and an empty one
  is not kept. Labels are one size, in the mark colour with a white outline. Select picks a mark by
  its line or a label by its text, and shows a dashed outline that never reaches the sent image: a
  drag moves it, kept whole inside the image; the arrow keys move it (Shift for ten); Delete,
  Backspace or the Delete button removes it; Escape lets go of it. Undo takes back the last add,
  move or removal, one at a time, and Clear removes all.
- **One colour** for the marks, `--vf-mark`, which defaults to a red that contrasts with most pages.
- Pointer events, so mouse, pen and touch all work. While drawing, touch never scrolls the page.
- **Note:** a textarea of 2000 characters at most, with a visible label (`noteLabel`). It is
  required unless `requireNote: false`.
- **Category:** shown only when `categories` is given, with a visible label (`categoryLabel`).
- Sending without any mark is allowed.

## 5. Capture
- **mode "dom"** (the default) serialises the DOM to an image, and needs no permission.
- **mode "display"** uses `getDisplayMedia` for exact pixels, after the browser asks the user. The
  image is what the user picks in the browser's prompt: this tab, another window or the whole
  screen. If the user refuses, the browser does not support it, or the shared screen gives no
  frame within 2 seconds, it falls back to "dom".
- **Size:** in "dom", the image is the visible viewport at the device pixel ratio; in "display",
  the shared surface. Both are scaled down to `maxWidth` (1920 by default).
- **Format:** WebP by default, or PNG if the browser cannot encode WebP.
- **Fonts and images:** what cannot be drawn (for example a cross-origin image without CORS) shows
  as a grey box. It never makes the capture fail.

## 6. The report
Defined in `docs/API.md` (`FeedbackReport`). It holds:
- the screenshots, at most 10, or none after "Send without screenshot". Each has its flattened
  image with the marks painted in, the marks as vectors, and the page URL and title, the viewport
  and the scroll position as they were when it was taken;
- the note and the category;
- the page URL and title, the viewport and the scroll position, as they were at the screenshot,
  or at the capture error after "Send without screenshot";
- the user agent, the language, the time zone and the time of Send;
- whatever the host's `context()` returns.

## 7. Privacy
- The image is what the user sees. Nothing on the page is masked, hidden or redacted, password
  fields included. Only the widget itself is left out (SPEC §2, capturing).
- The image is never kept after `close()`.
- No console logs, network logs, cookies, storage or keystrokes are collected.
- The query string and the hash of the URL are kept unless `redactUrl: true` is set.

## 8. Accessibility
- The overlay is a `role="dialog"` with `aria-modal="true"` and a label.
- Focus stays inside the dialog, and Escape cancels it. While it is open, the page does not
  scroll. On close, focus goes back to the trigger, or to where it was before.
- Every control has an accessible name and a visible focus ring (`--vf-focus`).
- With the keyboard alone, the user can still write the note, choose a category and send without
  marks.
- `prefers-reduced-motion` turns off every transition.
- `prefers-color-scheme` sets the default theme (`theme: "auto"`).

## 9. Budgets
- **Loader** (the trigger and the `open()` wiring): 3 KB or less, minified and gzipped.
- **Annotator and dialog:** 15 KB or less, gzipped. This does not include the capture library.
- **Idle cost:** no work after the first paint of the trigger. After the first screenshot, the
  capture library (snapdom) keeps 12 listeners on `window` and `document` and up to 5 mutation observers
  until the page unloads, and offers no way to remove them; `destroy()` removes everything else.
- CI fails when a budget is exceeded.

## 10. Browsers
The browsers that support constructable stylesheets (`adoptedStyleSheets`) and `color-mix()`:
Chrome 111+, Firefox 113+ and Safari 16.4+. Older browsers get no trigger and no error.

## 11. Content Security Policy
- The widget's own CSS goes in through constructable stylesheets. It uses no `<style>` tags and
  no inline `style` attributes, so a strict `style-src` does not block it. While the dialog is
  open, the scroll lock sets `overflow` on `<html>` through the CSSOM, which a CSP allows, and
  puts back what was there on close.
- Capture (`@zumer/snapdom`) renders through `data:` image URLs, so a site with a CSP needs
  `img-src 'self' data:`. With same-origin styles and images, that is all it needs: it
  works under `style-src 'self'`, with no `'unsafe-inline'`, in Chromium, Firefox and WebKit
  (`tests/e2e/capture-csp.spec.ts`).
- Cross-origin fonts, stylesheets and images are downloaded again with `fetch()`, which
  `connect-src` governs. Where `connect-src` does not allow their origin, they are treated as §5
  says for anything that cannot be drawn.

## 12. Default copy
These are the default texts. Each one can be replaced through `strings` (`docs/API.md`).

| key | text |
|---|---|
| trigger | Send feedback |
| title | Send feedback |
| capturing | Taking a screenshot… |
| captureError | Couldn't take a screenshot. |
| sendWithout | Send without screenshot |
| noteLabel | Your note |
| notePlaceholder | What happened, or what would you change? |
| noteRequired | Write a few words first. |
| categoryLabel | Type |
| pen / box / arrow / text / select | Draw / Box / Arrow / Text / Select |
| remove | Delete |
| undo / clear | Undo / Clear |
| cancel / send | Cancel / Send |
| sending | Sending… |
| sent | Thanks, it's sent. |
| error | It didn't send. Your note is kept. |
| retry | Try again |
| triggerText | Feedback, or the `trigger` text when only that is replaced |
| escHint | Esc to cancel |
