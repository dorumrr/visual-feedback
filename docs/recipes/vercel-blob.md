# Recipe: Vercel Blob

Each report becomes private blobs, named and shaped as in the S3 recipe (docs/recipes/s3.md):
`feedback/<id>/report.json` and `feedback/<id>/screenshot-<n>.png` or `.webp` for each screenshot.
People read them only
through your own route, behind your own admin check. `report.context` comes from the browser
(docs/API.md), so an admin view must not show it as proof of who sent a report. The images show the
screen as the user saw it, with nothing masked (SPEC §7).

It uses `fetch` and Vercel Blob's REST API, so it needs no package. The URLs, headers and token
shape are the ones `@vercel/blob` 2.8.1 sends; if Vercel changes its API, compare with that client.

## 1. Create the store

Create a Blob store with private access in your Vercel project. That sets `BLOB_READ_WRITE_TOKEN`
on the server. Never send it to the browser. Check it: open
`https://<store id>.private.blob.vercel-storage.com/feedback/<id>/report.json` without the token,
where the store id is the part after `vercel_blob_rw_` in the token, and Vercel refuses it.

Vercel refuses a request body over 4.5 MB, all screenshots of a report together, with 413, and the
widget then shows its send error. The route takes images up to 3 MB each; a smaller
`capture.maxWidth` (docs/API.md) keeps several screenshots under the limit.

## 2. The route

The widget posts to it with `createFeedback({ endpoint: "/api/feedback" })`. This is a Next.js
App Router route. As written, anyone who can reach `POST` can write: before production, put it
behind your own session check and a rate limit.

```ts
// app/api/feedback/route.ts
import { FeedbackRequestError, parseFeedbackRequest } from "visual-feedback/server";

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
    // Vercel refuses a request body over 4.5 MB, all screenshots together; this caps each image.
    const { report } = await parseFeedbackRequest(request, { maxImageBytes: 3_000_000 });
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
    const screenshots = report.screenshots.map((shot, i) => ({ ...shot, image: name(shot.image, i) }));
    // The images first: a report.json then always has its images beside it.
    for (const [i, { image }] of report.screenshots.entries()) {
      await store.put(report.id, name(image, i), image, image.type);
    }
    const json = JSON.stringify({ ...report, screenshots });
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
export async function GET(request: Request): Promise<Response> {
  if (!(await canRead(request))) return new Response(null, { status: 403 });
  const query = new URL(request.url).searchParams;
  const id = query.get("id") ?? "";
  const file = query.get("file") ?? "";
  // Only a report id and a known file name, so the read cannot leave feedback/<id>/.
  const known = file === "report.json" || /^screenshot-\d\.(png|webp)$/.test(file);
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
    },
  });
}
```
