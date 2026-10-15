# Changelog

## 0.4.2 (2026-10-15)

- An empty note no longer shows "Write a few words first." Send is disabled until the note has
  text; on hover it shows `noteRequired`, now "Describe the issue.", as its tooltip, and the
  note's border turns `--vf-mark` red (SPEC §4).
- While a send is under way, Cancel (X) and Keep as draft look disabled too: dimmed, with no hand
  cursor.

## 0.4.1 (2026-10-14)

- The dialog fits the window, 16px from its edges, with nothing to scroll: on a large screen the
  image grows to the height left, and the dialog is as wide as the image needs. On a short
  screen the tool rail has two columns, and a phone in landscape gets the note beside the image
  (SPEC §2).
- While a send is under way, Cancel, Keep as draft and Esc do nothing. A send that takes over 30
  seconds fails with the new `timeout` text, and `error` fires with a `TimeoutError`; an
  `endpoint` request is aborted.
- The sent confirmation shows for half a second, or until a click, in place of 3 seconds.
- Clear asks first (new `clearConfirm` text), and Undo brings the cleared marks back.
- Delete sits under Select in the tool rail. New parts: `confirm-clear` and `side`.

## 0.4.0 (2026-10-13)

- Breaking: the trigger is a tab by default, in the corner `position` names, with a flag icon. It
  has no border: the text colour fills it, and on hover the colours swap. `--vf-offset` lifts the
  tab along its side edge, and no longer moves it off that edge. `trigger: "button"` keeps the
  round button, 16px from both edges, filled the same way (SPEC §3).
- Breaking: the trigger has no `title`. Its tooltip is the widget's own: it shows at once on hover
  or keyboard focus, beside the trigger with an arrow pointing at it, and has its own part,
  `trigger-tooltip`. Screen readers still hear it as the description.
- The README starts with a prompt to give a coding agent, naming the package by its npm page, and AGENTS.md asks the agent to fit the
  button to the app's design.
- The demo styles the tooltip as its "Click here" hint, and fades that hint while the tooltip
  shows.

## 0.3.3 (2026-10-13)

- The trigger stands out more: a swirl icon that fills it, in place of the speech bubble, ringed
  by a 1px border in the same colour (`--vf-text`). With `triggerText`, the icon stays small
  beside the label.
- The demo site shows a "Click here" hint at the trigger, and its thumbnails rest at 20% colour and
  fade to full colour on hover.

## 0.3.2 (2026-10-13)

- The README links a live demo: the playground on GitHub Pages, at
  https://dorumrr.github.io/visual-feedback/. The widget itself is unchanged.

## 0.3.1 (2026-10-12)

- The trigger shows its name as a tooltip. With a `shortcut` set, the tooltip names it too, the way
  the platform's keyboards do, such as `Send feedback (Option + Shift + F)` on a Mac and
  `(Alt + Shift + F)` elsewhere (SPEC §3).
- A `shortcut` with no key, such as `"Alt+"`, now matches nothing: before, a key press whose code
  was empty, as some virtual keyboards send, could open the widget.

## 0.3.0 (2026-10-11)

- Breaking: with no `--vf-*` variables set, the widget now matches the site by itself. It takes
  the page's accent (`theme-color`, else its coloured buttons, else its links), its button corners
  (up to 15px) and, with `theme: "auto"`, its background and text colour, light or dark following
  that background. A guess that does not contrast keeps the old default: the accent needs 3:1
  against the widget's background and the text 4.5:1; the hints, the text at 60%, take more of it
  where they would fall under 4.5:1. A site that wants the system colours back sets them, such as
  `--vf-accent: AccentColor`; any `--vf-*` it sets still wins, and setting only one of
  `--vf-surface` and `--vf-text` keeps the other at its default.
- The widget reads the page at load, at each open (a draft opened again from its bar too), when
  `theme` or `css` changes, and when the page switches its theme: a change to the attributes of
  `<html>` or `<body>` that changes the page's background, text colour or `color-scheme`, or a
  change of the system's light or dark. The trigger, the dialog and the draft bar follow a site's
  dark mode switch at once, or when the site's own colour fade ends. To see a switch it keeps one
  mutation observer and one media query listener, both removed by `destroy()` (SPEC §9).
- The note shows 4 rows when the dialog opens, and the screenshot leaves room for them, so Send
  stays in the window.

## 0.2.0 (2026-10-10)

- Breaking: a report holds `screenshots`, a list of up to 10, in place of `image` and `marks`.
  Each screenshot has its `image`, its `marks` and the `page`, `viewport` and `scroll` as they were
  when it was taken; the report's own `page`, `viewport` and `scroll` stay. "Send without
  screenshot" gives an empty list. `endpoint` sends the images as the parts `image0`, `image1` and
  on, and `parseFeedbackRequest` returns `{ report }` and refuses the old single `image` part, so
  update the widget and the server together. Its body limit is now 10 times `maxImageBytes`,
  plus 1 MiB for the report and 64 KiB for the multipart framing. Every recipe that stores files names each image `screenshot-<n>.png` or `.webp`; the
  Postgres recipe moves images to a new table, `feedback_screenshots`, one row per screenshot. New type: `Screenshot`.
- Several screenshots in one report, up to 10. A strip under the image shows each one; each
  keeps its own marks and Undo. "Add screenshot", Esc, or the header's "Keep as draft" fold the
  dialog into a small draft bar in the trigger's corner (the trigger is hidden while there is a
  draft, and with `trigger: "none"` the bar still shows), so the user can scroll or move to another
  route: "Capture this view" adds the next screenshot, "Open" (or `open()`) brings the dialog back,
  and "Discard" or the header's close button ends the draft. Breaking: Esc keeps a draft that has a
  screenshot instead of cancelling (with no screenshot, or after a send error, it closes, after Cancel's question where work would be lost; while sending, and once sent, it closes at once); `close` fires when the draft ends, not when it folds. New strings `minimise`,
  `screenshot`, `addScreenshot`, `removeScreenshot`, `draft`, `captureView`, `reopen` and
  `discard`, and the `escHint` text below reads "Esc keeps it as a draft". New part names: `minimise`, `stage`,
  `strip`, `thumb`, `thumb-pick`, `thumb-image`, `thumb-number`, `thumb-remove`, `add`, `draft`,
  `draft-label`, `draft-thumbs`, `capture-view`, `reopen`, `discard`; host CSS aimed at
  `.toolbar + .image` needs `.toolbar + .stage > .image`.
- A draft folded in the draft bar survives a full page load in the same tab: it comes back folded,
  with its screenshots, marks, note and category. It is kept in IndexedDB, its id in
  sessionStorage, until the draft ends or a day after it was last folded or brought back; new option `draft: "memory"` keeps
  nothing on the device. Breaking: `destroy()`, and the host removing the element, keep the draft,
  open or folded, and the next widget of that tag in the tab brings it back, so a React route
  change keeps it, except with `draft: "memory"`, once its Send was handed to the host, or for a
  widget that does not own its tag's draft; a new `discardDraft(tagName?)` deletes it, as at a
  logout. `close` fires only when a draft ends, so a
  `destroy()` or removal that keeps it fires none. A second widget with the same tag keeps its
  draft in memory only. A click while the tab keeps a draft opens that draft, and a draft brought back at a page load fires
  `open` with no click.
- Budgets: the loader is now 15 KB, and the annotator and dialog 135 KB, gzipped.
- A pen stroke keeps only the points its line needs, so many long strokes stay far under the
  1 MiB report limit. The GitHub Issues recipe shortens its fields until GitHub accepts the
  issue body, however long the report.
- Save as PDF: Send is a split button whose menu downloads `feedback-<date>.pdf`, made in the
  browser with no library: the category and the note above the first screenshot, then one page per
  screenshot, marks included. Nothing is sent and the draft stays; a new `saved` event tells the
  host. A PDF page the browser has no memory for (as on iOS) shows the PDF error, never a blank
  page. New strings `moreSend`, `savePdf` and `pdfError`; new part names `split`, `send-more`,
  `menu`, `save-pdf`.
- A new look: a tool rail with icons beside the screenshot, the note as a composer with Send in a
  footer row under it, a close button in the header, and an Esc hint. Text follows the site's font and
  size. In a short window the screenshot gives up height, so the note and Send stay in view.
- The trigger is a round icon button; new `strings.triggerText` (none by default) adds a short
  label beside the icon, as a pill. New `strings.escHint`. Code that types a full
  `FeedbackStrings` object needs every string key this release adds.
  `--vf-trigger-size` is now its height, and its width when it shows the icon alone, 2.5em by
  default (40px on a 16px site).
- Changed defaults: `--vf-radius` 16px and a softer `--vf-shadow`. New part names: `header`,
  `body`, `divider`, `icon`, `text-input`, `composer`, `composer-bar`, `hint`, `trigger-text`. Send no longer sits
  inside `.actions`: host CSS aimed at `.actions .send` needs `.send`. Cancel is now the header's
  close button, still `::part(cancel)`; `actions` holds the capture error's buttons and Cancel's
  question. The new
  `footer` part holds the hint and Send. `unstyled` now keeps the focus ring, in `--vf-focus`:
  host CSS that drew its own ring may need to set `outline` on `:focus-visible`.
- Breaking: Cancel asks "Discard this feedback?" before it throws away a note, a mark, a second screenshot or
  a chosen category, with Discard, Keep as draft and Keep editing. New `strings.discardConfirm` and
  `strings.keepEditing`; new parts `confirm`, `confirm-text`, `keep-draft` and `keep-editing`. Host
  tests that click Cancel after typing or drawing now click Discard too; `close()` never asks. Esc
  asks the same where it would discard: without a screenshot, and after a send error.
- A Text tool: a label typed where the image is clicked. It adds a mark kind,
  `{ tool: "text", x, y, text }`, to the report. A 0.1.0 server refuses a report that holds one,
  so update the widget and the server together. New `strings.text`. Text and Select are in the
  default toolbar; `tools: ["pen", "box", "arrow"]` keeps the 0.1.0 one.
- A Select tool: pick a mark, drag it or move it with the arrow keys, remove it with Delete or the
  new Delete button. Undo takes back adds, moves and removals one at a time. New `strings.select`
  and `strings.remove`, and parts `remove` and `selection`.
- Upgrading stored reports from 0.1.0: those reports keep their 0.1.0 shape, with `image` and
  `marks` at the top level and no `screenshots`. The file recipes stored their image as
  `image.png` or `image.webp`, which the 0.2.0 read routes do not serve: rename it to
  `screenshot-0` with its extension, or read old reports the old way. The Postgres recipe moves
  each old image into the new table:

  ```sql
  create table feedback_screenshots (
    report_id uuid not null references feedback_reports (id) on delete cascade,
    position integer not null,
    image bytea,
    image_type text not null,
    primary key (report_id, position)
  );
  insert into feedback_screenshots (report_id, position, image, image_type)
    select id, 0, image, image_type from feedback_reports where image_type is not null;
  alter table feedback_reports drop column image, drop column image_type;
  ```
- A mark keeps what was drawn when the browser takes the pointer away (a gesture, a lost
  capture), instead of disappearing.

## 0.1.0 (2026-10-10)

- A feedback button for any site: it takes a screenshot of the page, the user marks it up with
  Draw, Box and Arrow and writes a note, and the host receives one report (`docs/SPEC.md`).
- `createFeedback()` with `onSubmit` or `endpoint`, `update()`, `destroy()`, events, texts that can
  be replaced, an opt-in keyboard shortcut, and theming through CSS variables and `::part()`
  (`docs/API.md`, `docs/THEMING.md`).
- `visual-feedback/server`: `parseFeedbackRequest()` checks a report's shape, type and size.
- `visual-feedback/react`: `<Feedback />`.
- Storage recipes: a local folder, S3-compatible, Postgres, Supabase, Vercel Blob and GitHub Issues
  (`docs/recipes/`), and `AGENTS.md`, a guide for coding agents.
