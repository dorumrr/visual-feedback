# Plan: long notes and attachments (0.5.0)

Tier: default  how hard each step is worked: low, medium or high, or default for ./phi.sh tier.

```
   [ ]  not started        [~]  in progress        [x]  done

   0. DECISIONS
   [x] Q4  The note has no length limit, on every site    done 19 Nov, Doru
   [x] Q5  Attachments: opt-in, 10 files, 15 MB each, safe types, all six recipes   done 19 Nov, Doru

   E. LONG NOTES AND ATTACHMENTS
   [x] E1  The note takes any length; a note over the server's cap says so before it sends
   [x] E2  Save as PDF puts a long note over as many pages as it needs   ships with E1, never after it
   [x] E3  The report type and parseFeedbackRequest carry attachments, only when the host opts in   BLOCKS E4, E6-E11
   [x] E4  With attachments on, the user adds and removes files, sees each limit it meets, and they arrive   BLOCKS E5, E12
   [x] E5  A kept draft brings its attachments back after a fold and a page load
   [x] E6  Recipe local stores attachments
   [x] E7  Recipe S3 stores attachments and serves them as downloads
   [x] E8  Recipe Postgres stores attachments            an existing install adds one table, only to opt in
   [x] E9  Recipe Supabase stores attachments
   [x] E10 Recipe Vercel Blob stores attachments         Vercel refuses a body over 4.5 MB
   [x] E11 Recipe GitHub Issues stores attachments       files stay in git history, said with its reason
   [ ] E12 AGENTS.md asks about attachments and gives its safety rule with the reason
   [ ] E13 Playground, README and CHANGELOG show 0.5.0
   [ ] E14 Clear PLAN.md once E1-E13 are done             Doru's instruction, 19 Nov
```

Each step: build, test in real browsers where it is visual, review; `/phi:auto-workflow` commits
each step on its own. A step is finished only when what its `Proves:` line names passes.

## Goal
Two additions in 0.5.0, neither of which changes what an existing installation does unless its host
opts in, except the one Doru chose: the note loses its 2000 character limit on every site.

## Decided
- **Note (Q4):** no length limit in the widget, on every site. The server keeps its 1 MiB cap on
  the report part (`src/server/index.ts:12`). Doru chose this over an opt-in option on 19 Nov 2026.
- **Attachments (Q5), decided by Doru on 19 Nov 2026:** off unless the host turns them on; at most
  10 files, 15 MB each, safe types only; a file the widget refuses tells the user which limit it
  met; all six recipes store them.
- **Proposed by the lead, inside those answers** (change any before E3 starts):
  - Widget option `attachments: boolean | { maxFiles?: number; maxBytes?: number;
    maxTotalBytes?: number }`, default `false`; `true` means 10 files and 15 MB each, with no
    total. A host can lower the limits, never raise them past 10 and 15 MB. `maxTotalBytes` caps
    all files of a report together, for a host such as Vercel that caps the whole request.
    The server takes the same three limits.
  - Safe types: PNG, JPEG, WebP, GIF, PDF, and UTF-8 text (`.txt`, `.log`, `.csv`, `.md`,
    `.json`). No SVG or HTML (they run scripts), no archives, no Office files (macros). The server
    checks each by its bytes, never by the browser's type or name: magic bytes for images and PDF,
    valid UTF-8 with no NUL for text.
  - Report field `attachments?: { file: Blob; name: string; type: string; size: number }[]`,
    absent when there are none, so a report with none is byte for byte today's. Multipart parts
    `file0`, `file1` and on; `name` passes the same `storable()` clean as other text and never
    names a stored path.
  - Server: `parseFeedbackRequest(request, { attachments: true | { maxFiles, maxBytes } })`.
    Without it, a request with a `file<n>` part or an `attachments` field is refused with 400 and a
    reason, never dropped, and the body cap is today's. No widget before 0.5 sends those names
    (`src/report.ts:122-128`), so only an opted-in widget meets it. With it, the cap grows by the
    files' allowance.
  - Save as PDF lists the attachments by name and size on the first page; it does not embed them.
- **Release:** 0.5.0, a minor version. No `Breaking:` line: no option, type or default a host
  already uses changes, and the longer note fits the existing `note: string`.

## Non-goals
Attachment types beyond the safe list, embedding files in the PDF, previews of non-image files,
drag and drop from outside the dialog's shadow root (no global listeners), virus scanning (the
host's job, said in AGENTS.md), and resumable or chunked uploads.

## E1  The note takes any length; a note over the server's cap says so before it sends
Depends: Q4
Touches: src/dialog.ts, src/report.ts, src/widget.ts, docs/SPEC.md, docs/API.md, tests/e2e/send.spec.ts, CHANGELOG.md
Skill: /phi:feat
Remove `NOTE_LIMIT` and `maxlength` (`src/dialog.ts:240`, `:815`). With `endpoint`, the widget
measures the report part before it sends and, over 1 MiB, shows a new `noteTooLong` text naming the
limit, with the note kept, in place of the server's bare 413 (`src/report.ts:139`). `onSubmit` has
no cap. SPEC §4 and §12, API.md, and the strings type change in the same step. A user sees this in
a browser.
Proves: Playwright in three browsers: the note has no `maxlength`; a 50,000 character note with
emoji and CJK arrives whole through `onSubmit`, and through `endpoint`, the stored body parsed with
`parseFeedbackRequest` as `tests/e2e/send.spec.ts:132` does; a multibyte note under 1 MiB in
characters but over it in UTF-8 bytes shows `noteTooLong` and sends nothing, and one just under
it in bytes sends. The test at `tests/e2e/send.spec.ts:498` is replaced, not deleted.

## E2  Save as PDF puts a long note over as many pages as it needs
Depends: E1
Touches: src/pdf.ts, src/dialog.ts, docs/SPEC.md, tests/e2e/pdf.spec.ts
Skill: /phi:fix
Today the first page is as tall as the note (`src/pdf.ts:93-96`), so a long note makes a canvas a
browser cannot draw, and SPEC §4 says never a blank page. A user sees this in a browser.
Proves: Playwright in three browsers: a note of 5,000 numbered lines saves a PDF whose page count
equals the count worked out from the line height, every page has ink in its top and bottom bands,
and the last page has ink where the last line falls (the PDF is JPEG pages with no text layer,
`tests/e2e/pdf.spec.ts:80-90`); the same test fails on the code before the fix.

## E3  The report type and parseFeedbackRequest carry attachments, only when the host opts in
Depends: Q5, E1
Touches: src/shared/report.ts, src/server/index.ts, src/index.ts, tests/server/, tests/unit/types.test.ts, docs/API.md, CHANGELOG.md
Skill: /phi:feat
The shape check today keeps only known fields (`src/shared/report.ts:163-187`) and the server
ignores parts it does not know (`src/server/index.ts:111-118`), so both need the new field and part
rule from Decided. Shared limits live in `src/shared/report.ts`, as `SCREENSHOT_LIMIT` does.
Proves: cases on Node and Deno: valid attachments come back as Blobs typed from their bytes; too
many, too big, a wrong type behind a safe name, a missing part and a stray part are each refused
with a reason and 400 or 413; without the `attachments` limit, a request with files is refused and
every existing case passes unchanged, the body cap included; both entries export the type.

## E4  With attachments on, the user adds and removes files, sees each limit it meets, and they arrive
Depends: E2, E3
Touches: src/dialog.ts, src/report.ts, src/widget.ts, src/pdf.ts, docs/SPEC.md, docs/API.md, docs/THEMING.md, tests/e2e/, tests/unit/, CHANGELOG.md
Skill: /phi:feat
An Attach button and a list of files with a remove button each, in the composer, with part names
and `--vf-*` variables (THEMING.md). New strings for the button, the list, and each refusal: too
many, too big, a type it does not take, each naming the file and the limit. Cancel asks first when a
file would be lost. Works in "Send without screenshot" too. The PDF lists the files. A user sees
this in a browser.
Proves: Playwright in three browsers: with the option off, the dialog's parts and the multipart
body's part names, headers and report JSON, boundary left out, equal a baseline recorded from
0.4.3 before any E4 code changes; with it on, files are added, removed, and arrive through `onSubmit` and through
`endpoint` and `parseFeedbackRequest`; each refusal shows its text and keeps the file out; axe
passes with the list shown; size-limit passes.

## E5  A kept draft brings its attachments back after a fold and a page load
Depends: E4
Touches: src/keep.ts, src/dialog.ts, docs/SPEC.md, docs/API.md, tests/e2e/keep.spec.ts, tests/e2e/draft.spec.ts
Skill: /phi:feat
Files are kept as bytes, as screenshots are (`src/keep.ts:12-15`), so a WebKit private window can
keep them. A record kept by 0.4 has no files and must come back as before. SPEC §7 names what the
device now keeps. A user sees this in a browser.
Proves: Playwright in three browsers: add files, fold, reload, open: the same files by name, type
and bytes; a 0.4 record comes back with none; after Send, Discard and `discardDraft()` IndexedDB
holds no record.

## E6  Recipe local stores attachments
Depends: E3
Touches: docs/recipes/local.md, tests/recipes/local.test.ts
Skill: /phi:feat
Its route deletes every file it did not list (`docs/recipes/local.md:64-67`), so the files must be
in that list.
Proves: a test sends a report with files through the recipe's route and reads them back; a hostile
file name cannot leave the folder; a report with none writes exactly today's files.

## E7  Recipe S3 stores attachments and serves them as downloads
Depends: E3
Touches: docs/recipes/s3.md, tests/recipes/s3.test.ts
Skill: /phi:feat
Its read route admits only `report.json` and screenshots (`docs/recipes/s3.md:122`) and serves the
stored type inline (`:131-135`).
Proves: a test stores a file and reads it back with `content-disposition: attachment`; an unknown
name still gets 400.

## E8  Recipe Postgres stores attachments
Depends: E3
Touches: docs/recipes/postgres.md, tests/recipes/postgres.test.ts, tests/recipes/fake-postgres.ts
Skill: /phi:feat
A new table beside `feedback_screenshots`, in the same transaction. The recipe gives the one
statement an existing install runs before it turns attachments on.
Proves: a test stores a report with files and reads rows and bytes back; a resend writes nothing
twice; a report with none writes today's rows.

## E9  Recipe Supabase stores attachments
Depends: E3
Touches: docs/recipes/supabase.md, tests/recipes/supabase.test.ts
Skill: /phi:feat
Proves: a test stores files and reads them back; an anonymous read is still refused.

## E10 Recipe Vercel Blob stores attachments
Depends: E3
Touches: docs/recipes/vercel-blob.md, tests/recipes/vercel-blob.test.ts
Skill: /phi:feat
Vercel refuses a body over 4.5 MB (`docs/recipes/vercel-blob.md:29-31`), so on Vercel the route
and the widget's `maxTotalBytes` must agree with what is left after the screenshots, and the
recipe says what fits and why.
Proves: a test stores files and reads them back; a request at the recipe's limits, with 10
screenshots, is under 4.5 MB, and one over them is refused by the route with a reason.

## E11 Recipe GitHub Issues stores attachments
Depends: E3
Touches: docs/recipes/github-issues.md, tests/recipes/github-issues.test.ts
Skill: /phi:feat
Files are committed beside the images and linked in the issue; a deleted file stays reachable by
SHA (`docs/recipes/github-issues.md:65-66`), and the recipe says so.
Proves: a test in both layouts commits the files, links them in the issue and lists them in
`report.json`; a public repo still gets nothing; the body stays under 65,536 characters with 10
files.

## E12 AGENTS.md asks about attachments and gives its safety rule with the reason
Depends: E4, E6, E7, E8, E9, E10, E11
Touches: AGENTS.md, tests/unit/pack.test.ts
Skill: /phi:feat
The agent asks whether to turn attachments on, and tells the developer why files go to private
storage and are served as downloads: a file is the user's, unchecked, and can hold anything.
Proves: `tests/unit/pack.test.ts:62` expects 9 safety rules in place of 8 and names the new rule's
lead; it fails on today's AGENTS.md and passes after the step.

## E13 Playground, README and CHANGELOG show 0.5.0
Depends: E4, E5
Touches: tests/fixtures/playground/, tests/e2e/playground.spec.ts, README.md, CHANGELOG.md
Skill: /phi:feat
Proves: the playground test sees an attachment listed with a download; `tests/recipes/readme.test.ts`
passes; Doru runs `npm run check`.

## E14 Clear PLAN.md once E1-E13 are done
Depends: E1, E2, E3, E4, E5, E6, E7, E8, E9, E10, E11, E12, E13
Touches: PLAN.md
Skill: /phi:cleanup
Doru asked on 19 Nov 2026 to clear this file when the plan is done. `CLAUDE.md` names PLAN.md only
as the place for a milestone under way, so it stays true.
Proves: PLAN.md is empty, and `grep -rn PLAN.md CLAUDE.md AGENTS.md README.md docs` names no step.
