# Changelog

## 0.2.0 (not released yet)

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
