# Changelog

## 0.2.0 (not released yet)

- Breaking: a report holds `screenshots`, a list of up to 10, in place of `image` and `marks`.
  Each screenshot has its `image`, its `marks` and the `page`, `viewport` and `scroll` as they were
  when it was taken; the report's own `page`, `viewport` and `scroll` stay. "Send without
  screenshot" gives an empty list. `endpoint` sends the images as the parts `image0`, `image1` and
  on, and `parseFeedbackRequest` returns `{ report }` and refuses the old single `image` part, so
  update the widget and the server together. Its body limit is now 10 times `maxImageBytes`, plus
  the report. Every recipe stores each image as `screenshot-<n>.png` or `.webp`; the Postgres
  recipe moves images to a new table, `feedback_screenshots`. New type: `Screenshot`.
- A new look: a tool rail with icons beside the screenshot, the note as a composer with Send in a
  footer row under it, a close button in the header, and an "Esc to cancel" hint. Text follows the site's font and
  size. In a short window the screenshot gives up height, so the note and Send stay in view.
- The trigger is a pill with an icon and a short label: new `strings.triggerText` ("Feedback"), and
  new `strings.escHint`; code that types a full `FeedbackStrings` object needs both keys.
  `--vf-trigger-size` is now its height, 2.5em by default (40px on a 16px site).
- Changed defaults: `--vf-radius` 16px and a softer `--vf-shadow`. New part names: `header`,
  `body`, `divider`, `icon`, `text-input`, `composer`, `composer-bar`, `hint`, `trigger-text`. Send no longer sits
  inside `.actions`: host CSS aimed at `.actions .send` needs `.send`. Cancel is now the header's
  close button, still `::part(cancel)`; `actions` holds only the capture error's buttons. The new
  `footer` part holds the hint and Send.
- A Text tool: a label typed where the image is clicked. It adds a mark kind,
  `{ tool: "text", x, y, text }`, to the report. A 0.1.0 server refuses a report that holds one,
  so update the widget and the server together. New `strings.text`.
- A Select tool: pick a mark, drag it or move it with the arrow keys, remove it with Delete or the
  new Delete button. Undo takes back adds, moves and removals one at a time. New `strings.select`
  and `strings.remove`, and parts `remove` and `selection`.
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
