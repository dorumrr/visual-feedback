# Recipe: Vercel Blob

Each report becomes private blobs, named and shaped as in the S3 recipe (docs/recipes/s3.md):
`feedback/<id>/report.json` and `feedback/<id>/screenshot-<n>.png` or `.webp` for each screenshot.
People read them only
through your own route, behind your own admin check. `report.context` comes from the browser
(docs/API.md), so an admin view must not show it as proof of who sent a report. The images show the
screen as the user saw it, with nothing masked (SPEC §7).

Files the user attaches are off. To take them, set `ATTACHMENTS` at the top of the route to
`FILES`, only together with the widget's `attachments` option, with the same limits:
`attachments: { maxFiles: 10, maxBytes: 800_000, maxTotalBytes: 800_000 }`; off, a report
with files is refused with 400. On, each file is a private blob in the same folder,
`feedback/<id>/file-<n>` plus the ending its name has, lower-cased, which the server allows only
when it fits the file's type, such as `file-0.png` or `file-1.log`, numbered
from 0, with its content type, never under the user's file name. Each entry of `attachments` in
`report.json` keeps the user's `name`, its `type` and `size`, and `file`, the stored name. The
`GET` route serves a file only as a download, under that stored name.

It uses `fetch` and Vercel Blob's REST API, so it needs no package. The URLs, headers and token
shape are the ones `@vercel/blob` 2.8.1 sends; if Vercel changes its API, compare with that client.

## Questions to ask

1. Is there a Blob store with private access yet? If not, the developer creates one (section 1).
2. Does the route run on Vercel? There, a report's screenshots, files and note together must stay
   under 4.5 MB, and with files on the route's limits keep them there (section 1). Elsewhere, the
   developer may raise the image cap and `FILES` to what that server takes.
3. Who are the admins, and how does the app tell them from other users? The `GET` route's
   `canRead` needs it.

## 1. Create the store

Create a Blob store with private access in your Vercel project. That sets `BLOB_READ_WRITE_TOKEN`
on the server. Never send it to the browser. Check it: open
`https://<store id>.private.blob.vercel-storage.com/feedback/<id>/report.json` without the token,
where the store id is the part of the token between `vercel_blob_rw_` and the next `_` (never the
secret after it), and Vercel refuses it.

Vercel refuses a request body over 4.5 MB, all screenshots, files and the note of a report
together, with 413 before the route sees it, and the widget then shows its send error. With files
off, the route takes images up to 3 MB each; a smaller `capture.maxWidth` (docs/API.md) keeps
several screenshots under the limit.

With files on, the route's own limits keep every body it takes under 4.5 MB: at most 10
screenshots of 250 KB each, files of 800 KB together, the report part of 1 MiB and 64 KiB of
multipart framing make 4,414,112 bytes. In a body still under 4.5 MB, a screenshot, a file, the
files together or the report part over its size is refused by the route with 413 and a message
that names it, a body over 4,414,112 bytes with 413 "The request is too large.", and more than 10
files with 400; a larger body still meets Vercel's 413 first. Either way the widget shows its
send error. So turning files on also
refuses a screenshot over 250 KB that the 3 MB cap took. A browser that cannot encode WebP, such
as Safari, sends PNG whatever `capture.type` says (SPEC §5), and a PNG can be far larger: lower
`capture.maxWidth`, and `capture.quality` for WebP, until a screenshot of your busiest page, in
each browser your users have, is under 250 KB. To give files more room, take it from the
screenshots: 10 times the image cap, plus `maxTotalBytes`, must stay at 3,385,888 bytes or less.

## 2. The route

The widget posts to it with `createFeedback({ endpoint: "/api/feedback" })`. This is a Next.js
App Router route. As written, anyone who can reach `POST` can write: before production, put it
behind your own session check and a rate limit.

```ts
// app/api/feedback/route.ts
import { FeedbackRequestError, parseFeedbackRequest } from "visual-feedback/server";

// What fits Vercel's 4.5 MB body beside 10 screenshots of 250 KB and the report (section 1).
const FILES = { maxFiles: 10, maxBytes: 800_000, maxTotalBytes: 800_000 };
// Set to FILES only with the widget's attachments option and the same limits; false refuses files.
const ATTACHMENTS: typeof FILES | false = false;

// Replace with your own admin check, from your session. Until then, nobody can read.
async function canRead(_request: Request): Promise<boolean> {
  return false;
}

function blob() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  // A read-write token is vercel_blob_rw_<store id>_<secret>.
  const store = token?.split("_")[3];
  if (!token?.startsWith("vercel_blob_rw_") || !store) {
    throw new Error("Set BLOB_READ_WRITE_TOKEN.");
  }
  const auth = { authorization: `Bearer ${token}` };
  const path = (id: string, name: string) => `feedback/${id}/${name}`;
  return {
    // Next.js 14 caches a fetch in a route by default; a cached 404 would hide a stored report.
    read: (id: string, name: string) =>
      fetch(`https://${store}.private.blob.vercel-storage.com/${path(id, name)}`, {
        headers: auth,
        cache: "no-store",
      }),
    async put(id: string, name: string, body: BodyInit, type: string) {
      const query = new URLSearchParams({ pathname: path(id, name) });
      const put = await fetch(`https://vercel.com/api/blob/?${query}`, {
        method: "PUT",
        body,
        headers: {
          ...auth,
          "x-api-version": "12",
          "x-vercel-blob-access": "private",
          "x-content-type": type,
          "x-add-random-suffix": "0",
          "x-allow-overwrite": "1",
        },
      });
      if (!put.ok) throw new Error(`Vercel Blob answered ${put.status} for ${name}.`);
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    // With files on, the smaller image cap keeps every body the route takes under 4.5 MB.
    const maxImageBytes = ATTACHMENTS ? 250_000 : 3_000_000;
    const { report } = await parseFeedbackRequest(request, {
      maxImageBytes,
      attachments: ATTACHMENTS,
    });
    const store = blob();
    // The id comes from the browser: once a report is stored, a later request does not replace it.
    // Two requests with one id at the same moment still can; the check and the write are separate.
    const stored = await store.read(report.id, "report.json");
    await stored.body?.cancel();
    if (stored.ok) return new Response(null, { status: 204 });
    // Only a 404 means "not stored"; on any other answer, writing could replace a report.
    if (stored.status !== 404) {
      throw new Error(`Vercel Blob answered ${stored.status} for report.json.`);
    }
    const name = (image: Blob, i: number) =>
      `screenshot-${i}.${image.type === "image/png" ? "png" : "webp"}`;
    // The server checked that each name ends as its type does, so this is one of a known few.
    const fileName = (original: string, i: number) =>
      `file-${i}${original.slice(original.lastIndexOf(".")).toLowerCase()}`;
    const screenshots = report.screenshots.map((shot, i) => ({ ...shot, image: name(shot.image, i) }));
    const attachments = report.attachments?.map((item, i) => ({
      ...item,
      file: fileName(item.name, i),
    }));
    // The images and files first: a report.json then always has them beside it.
    for (const [i, { image }] of report.screenshots.entries()) {
      await store.put(report.id, name(image, i), image, image.type);
    }
    for (const [i, item] of (report.attachments ?? []).entries()) {
      await store.put(report.id, fileName(item.name, i), item.file, item.file.type);
    }
    const json = JSON.stringify({ ...report, screenshots, ...(attachments && { attachments }) });
    await store.put(report.id, "report.json", json, "application/json");
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof FeedbackRequestError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}

// GET /api/feedback?id=<report id>&file=report.json | screenshot-<n>.png | screenshot-<n>.webp
//   | an attachment's file, such as file-0.png
export async function GET(request: Request): Promise<Response> {
  if (!(await canRead(request))) return new Response(null, { status: 403 });
  const query = new URL(request.url).searchParams;
  const id = query.get("id") ?? "";
  const file = query.get("file") ?? "";
  // Only a report id and a known file name, so the read cannot leave feedback/<id>/.
  const download = /^file-\d\.(png|jpg|jpeg|webp|gif|pdf|txt|log|csv|md|json)$/.test(file);
  const known = file === "report.json" || /^screenshot-\d\.(png|webp)$/.test(file) || download;
  if (!/^[0-9a-f-]{36}$/.test(id) || !known) {
    return new Response(null, { status: 400 });
  }
  const object = await blob().read(id, file);
  if (!object.ok) {
    await object.body?.cancel();
    return new Response(null, { status: object.status === 404 ? 404 : 502 });
  }
  return new Response(object.body, {
    headers: {
      "content-type": object.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, no-store",
      // A file the user attached is saved, never opened in the app's own origin.
      ...(download
        ? {
            "content-disposition": `attachment; filename="${file}"`,
            "x-content-type-options": "nosniff",
          }
        : {}),
    },
  });
}
```
