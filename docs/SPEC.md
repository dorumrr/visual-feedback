# visual-feedback: behaviour

## 1. What it is
A user reports a problem or an idea from the page they are on. They capture the screen, mark it
up, write a note and send it. The host app receives one report and decides where it goes. The
package sends nothing by itself, and stores nothing but an unsent draft on the user's own device
(§7).

## 2. Flow
```
idle --open--> capturing --image ready--> annotating --Send--> sending --ok--> sent --0.5 s or a click--> idle
                   |                          |   ^                |
                   +--fails--> capture error  |   |                +--fails--> send error
                                              |   +--Open, or Capture this view (capturing first)
                                              +--Esc / Keep as draft / Add screenshot--> draft
annotating, draft --Cancel (it may ask first, below) / Discard--> idle
```
- **idle:** the trigger shows, a tab (`trigger: "tab"`) or a round button (`trigger: "button"`), or
  nothing shows (`trigger: "none"`, where the host calls `open()`).
- **capturing:** the trigger and any open panel are hidden, so they are not in the image. The
  screen is captured (SPEC §5), and a screen reader is told the `capturing` text.
- **capture error:** the `captureError` text, with "Try again" (back to capturing), "Send without
  screenshot" (annotating with no image: no toolbar, no screenshots in the report) and Cancel or Esc
  (idle). This is the first screenshot only; a later one that fails is the draft's (below).
- **annotating:** a full-viewport overlay shows the image with a tool rail beside it, a strip of
  the report's screenshots under it, and the note field, with Send in a footer row under that.
  The dialog fits the window, 16 px from its edges (or the safe area's), with nothing to scroll:
  the image takes the height the rest leaves, growing past the screenshot's own size on a large
  screen, and the dialog is as wide as the image needs. Below
  760 px of height the tool rail has two columns, and below 700 px a question lies over the
  header in place of adding a row; on a landscape screen under 500 px high, the note and Send go
  beside the image.
  Esc and the header's Keep as draft fold it into the draft; the header's close button (Cancel)
  discards it. When that would throw away a note, a mark, a second screenshot or a chosen category,
  Cancel first asks `discardConfirm`, with "Discard", `minimise` (before Send, with a screenshot) and
  `keepEditing`, which has the focus; Keep editing, and Esc on the question, take the question back
  and put the focus on Cancel. Without a screenshot ("Send without screenshot"), Esc cancels,
  after the same question when it would throw work away.
- **draft:** a small bar in the trigger's corner, in place of the trigger: the `draft` label with
  the number of screenshots, small copies of them, "Capture this view", "Open" and "Discard". The
  page scrolls, and a single-page app can change route, while it shows. "Capture this view" takes
  another screenshot of the page as it is now, the bar and the dialog left out, adds it, and opens
  the dialog on it; a capture that fails opens the dialog on the kept draft with the
  `captureError` text, where Esc keeps the draft again and Cancel discards it, after the same question when it would throw work away. "Open", and `open()`, open the dialog as it was. A full page load in the same tab, or a route
  change that removes the widget and makes the next one, brings the draft back, folded in the bar, as it was when it was last folded: its screenshots, marks, note and
  category. Undo starts after the marks it brought back. With `draft: "memory"`, a page load ends
  it.
- **sending:** the note, the category and the tools are disabled, and the Send button shows
  progress. The Esc hint goes, as it is absent with no screenshot: from Send on, Esc keeps no
  draft. Until the send ends, Cancel, Keep as draft and Esc do nothing. A send that has not ended
  after 30 seconds fails, with the `timeout` text.
- **sent:** the `sent` confirmation for half a second, or until a click anywhere on the overlay,
  then idle.
- **send error:** the message is the `timeout` text after 30 seconds, else the host's error, or
  else the `error` text. The note and
  the marks are kept, and "Try again" sends the same report. Cancel and Esc, after
  the same question when it would throw work away, close the dialog, and the draft goes with it.

## 3. The trigger
- By default it is a small tab, 2.5em square (40 px on a 16 px site), in the corner `position`
  names, square on both edges there, with a flag icon and the `trigger` accessible name.
  `--vf-offset` lifts it along its side edge, and then its end side is rounded too.
  `trigger: "button"` makes it a round button in that corner instead, 16 px from both edges.
  Either has no border: the text colour fills it, and the icon and label take the background
  colour. On hover, on a device that can hover, the two swap back.
  A host that gives `triggerText` gets that short label beside a small icon, in a wider tab, or a
  pill as a button; with only `triggerText` given, that text is the name too. A host that sets
  both keeps `triggerText` inside `trigger`, so speech control can say what it sees. It has no
  badge, and it does not move or pulse.
- Its tooltip is its own, not the browser's `title`: a pill beside it, on the page's side, with an
  arrow pointing at it. It fades in at once on keyboard focus, or on hover where the device can
  hover, and out at the same speed.
  It reads the name. With a `shortcut` that can match, it is the name and the keys, each modifier
  once, joined by ` + `, as the platform's keyboards name them: Option, Command, Control and Shift
  on a Mac, iPhone or iPad (`navigator.platform`), as in `Send feedback (Option + Shift + F)`;
  Alt, Win, Ctrl and Shift on Windows; Alt, Super, Ctrl and Shift elsewhere. A screen reader reads
  the tooltip as the description.
- It respects `env(safe-area-inset-*)`.
- It is hidden while there is a draft, whether the dialog is open or kept in the draft bar.
- It does not move to keep clear of the page's content. The host moves it off its own content
  with `position` or `--vf-offset`.

## 4. Annotating
- **Tools:** Pen (freehand), Box (rectangle outline), Arrow and Text. Text places a label where the
  image is clicked: Enter or clicking away keeps it, Escape drops that label only, and an empty one
  is not kept; a label holds up to 280 characters. Labels are one size, in the mark colour with a white outline. Select picks a mark by
  its line or a label by its text, and shows a dashed outline that never reaches the sent image: a
  drag moves it, kept whole inside the image; the arrow keys move it (Shift for ten); Delete,
  Backspace or the Delete button, under Select in the tool rail, removes it; Escape lets go of
  it. Clear asks `clearConfirm` first, with Clear and `keepEditing`, then removes every mark on the
  shown screenshot. Undo takes back the last add, move, removal or Clear, one at a time.
- **One colour** for the marks, `--vf-mark`, which defaults to a red that contrasts with most pages.
- Pointer events, so mouse, pen and touch all work. While drawing, touch never scrolls the page.
- **Note:** a textarea of 2000 characters at most, with a visible label (`noteLabel`). It is
  required unless `requireNote: false`: while it is empty or only spaces, Send is disabled, still
  focusable, with `noteRequired` as its tooltip, and the pointer on it turns the note's border red;
  after a tap on a touch screen the border stays red until the note has text.
- **Category:** shown only when `categories` is given, with a visible label (`categoryLabel`).
- **Save as PDF:** Send is a split button; its caret ("More send options") opens a menu with "Save
  as PDF". It downloads `feedback-<date>.pdf`, dated by the user's clock and made in the browser:
  the category and the note,
  then the first screenshot, on page 1, and each other screenshot on a page of its own, marks
  included. Nothing is sent, the dialog and the draft stay as they are, and the `saved` event
  fires. While the menu is open, Esc closes the menu only, from Send and the menu button too, and
  puts the focus on the menu button; Tab closes it too. A PDF that cannot be made, a page the browser has no memory to draw
  included (as on iOS), shows the `pdfError` text, never a blank page, and
  neither `saved` nor `error` fires, since nothing failed to send; one asked for while another is being made is ignored.
- **Screenshots:** a report holds up to 10. Each keeps its own marks and its own Undo; the tool
  chosen stays the same across them. The strip numbers them in the order they are sent: a click
  shows one, and its remove button, there only when there are two or more, takes one out. "Add
  screenshot" folds the dialog into the draft, and is gone at 10. The note and the category are one
  for the whole report.
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
- **Known limit:** in "dom", text cut by `-webkit-line-clamp` with a fractional line height (such as
  15px at 1.35) shows one line fewer than the page. The cause is in the capture library, snapdom
  3.3.0; this repository patches its own copy for its tests, which does not reach a host's install.

## 6. The report
Defined in `docs/API.md` (`FeedbackReport`). It holds:
- the screenshots, at most 10, or none after "Send without screenshot". Each has its flattened
  image with the marks painted in, the marks as vectors, and the page URL and title, the viewport
  and the scroll position as they were when it was taken;
- the note and the category;
- the page URL and title, the viewport and the scroll position, as they were at the first
  screenshot, or at the capture error after "Send without screenshot";
- the user agent, the language, the time zone and the time of Send;
- whatever the host's `context()` returns.

## 7. Privacy
- The image is what the user sees. Nothing on the page is masked, hidden or redacted, password
  fields included. Only the widget itself is left out (SPEC §2, capturing).
- No screenshot is kept after the draft ends: Send, Cancel, Discard, `close()` or `discardDraft()`.
- No console logs, network logs, cookies or keystrokes are collected. Nothing is stored, with one
  exception: a draft folded in the draft bar is kept on this device for this tab, so a page load
  does not lose it. sessionStorage holds its id, and IndexedDB its screenshots with each one's
  page facts (the whole URL: `redactUrl` applies only to the sent report), marks, note and category. It is deleted when the draft ends: the moment Send succeeds, or at Cancel, Discard,
  `close()` or `discardDraft()`, which a host calls at a logout. `destroy()`, or the host removing the element, keeps it, open or folded, for the next
  widget of that tag in this tab, unless its Send was already handed to the host; a click while
  this tab keeps one opens it. One widget of a tag keeps a draft, the first whose element is in
  the page; when that element leaves, the next widget of the tag to need it takes over, and never
  writes over a draft still kept. Any other keeps its own in memory.
  A `close()` made while a page load is still bringing it back hides it on
  that page and keeps it. A day after it was last folded or brought back, it no longer comes back,
  and it is deleted the next time this site opens the dialog or keeps a draft, in any tab: nothing
  of the widget runs on the device to delete it sooner. A tab the browser duplicates copies
  sessionStorage, so the copy shares that draft. `draft: "memory"` keeps
  it in memory only, and does not delete one an earlier page kept.
- The query string and the hash of the URL are kept unless `redactUrl: true` is set.

## 8. Accessibility
- The overlay is a `role="dialog"` with `aria-modal="true"` and a label.
- Focus stays inside the dialog. Escape, except on the Send menu, a label being typed or a selected
  mark (§4), or on Cancel's question (§2),
  keeps an unsent draft that has a screenshot in the draft bar, and moves the focus to it ("Capture
  this view", or "Open" at 10 screenshots). With no screenshot, or after a send error, it cancels,
  asking first as Cancel does; while sending it does nothing, and once sent it closes at once.
  While the dialog is open, the page does not scroll. On close, focus goes back to the trigger,
  or to where it was before.
- Every control has an accessible name and a visible focus ring (`--vf-focus`), `unstyled`
  included (THEMING.md).
- With the keyboard alone, the user can still write the note, choose a category and send without
  marks.
- `prefers-reduced-motion` turns off every transition.
- With `theme: "auto"`, the page's own background sets light or dark, and `prefers-color-scheme`
  where the page shows none (THEMING.md).

## 9. Budgets
- **Loader** (the trigger and the `open()` wiring): 15 KB or less, minified and gzipped.
- **Annotator and dialog:** 135 KB or less, gzipped. This does not include the capture library.
- **Idle cost:** no work after the first paint of the trigger, past reading one sessionStorage
  key and the page's colours and button corners at load, and reading them again when the page
  switches its theme (THEMING.md section 1). To see a switch, it keeps one mutation observer on
  the attributes of `<html>` and `<body>` and on the children of `<html>` (to find a new
  `<body>`), and one `change` listener on `prefers-color-scheme`, both gone at `destroy()`. A
  change the observer sees that leaves the page's colours alone reads the colours of `<html>` and
  `<body>` and scans nothing else; a system switch always reads the page. Only when this tab kept a draft does the dialog load, to bring it back. After the first screenshot, the
  capture library (snapdom) keeps 12 listeners on `window` and `document` and up to 5 mutation observers
  until the page unloads, and offers no way to remove them; `destroy()` removes everything else
  but a draft it keeps (§7). The opt-in `shortcut` adds one `keydown` listener on `window`, gone at
  `destroy()` or `update({ shortcut: false })`.
- CI fails when a budget is exceeded.

## 10. Browsers
The browsers that support constructable stylesheets (`adoptedStyleSheets`) and `color-mix()`:
Chrome 111+, Firefox 113+ and Safari 16.4+. Older browsers get no trigger and no error.

## 11. Content Security Policy
- The widget's own CSS goes in through constructable stylesheets. It uses no `<style>` tags, and
  sets the few inline styles it needs (the selection frame, a label being typed, the theme's
  `color-scheme` and the colours and corners it found on the page) through the CSSOM, so a strict `style-src` does not block it. While the dialog is
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
| noteRequired | Describe the issue. |
| categoryLabel | Type |
| pen / box / arrow / text / select | Draw / Box / Arrow / Text / Select |
| remove | Delete |
| undo / clear | Undo / Clear |
| clearConfirm | Clear all marks on this screenshot? |
| cancel / send | Cancel / Send |
| sending | Sending… |
| sent | Thanks, it's sent. |
| error | It didn't send. Your note is kept. |
| timeout | It didn't send in 30 seconds. Check your internet connection, then try again. |
| retry | Try again |
| triggerText | none: the icon alone |
| escHint | Esc keeps it as a draft |
| minimise | Keep as draft |
| screenshot | Screenshot (each one is named with its number, as "Screenshot 2") |
| addScreenshot | Add screenshot |
| removeScreenshot | Remove screenshot (with the number, as "Remove screenshot 2") |
| draft | Feedback draft (the bar shows the number of screenshots after it) |
| captureView / reopen / discard | Capture this view / Open / Discard |
| discardConfirm / keepEditing | Discard this feedback? / Keep editing |
| moreSend / savePdf | More send options / Save as PDF |
| pdfError | Couldn't save the PDF. |
