# Changelog

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
