# Recipe: a local `.visual-feedback/` folder

For local development only: it writes only when `NODE_ENV` is `development`. `next dev` sets it;
start any other server with `NODE_ENV=development`.

Each report becomes one folder, `.visual-feedback/<id>/`, holding `report.json` and one image per
screenshot: `screenshot-0.png` or `screenshot-0.webp`, then `screenshot-1`, and so on. That file is
the `FeedbackReport` (docs/API.md), with each screenshot's `image` set to its file name.

It does not work on hosts whose disk is read-only or wiped on each deploy or restart, such as
Vercel, Netlify, Cloudflare and most containers. Use another recipe there.

The images show the screen as the user saw it, with nothing masked (SPEC §7), so treat the folder
as private.

## 1. Keep the folder out of git

Add this line to `.gitignore`:

```gitignore
.visual-feedback/
```

## 2. The route

The widget posts to it with `createFeedback({ endpoint: "/api/feedback" })`. This is a Next.js
App Router route. Other servers that hand you a Web `Request` on Node can call the same function;
one that hands you Node's `IncomingMessage`, such as Express, needs an adapter first. The route
checks no user, so keep the dev server on localhost: `next dev` listens on every network
interface unless it is started as `next dev -H 127.0.0.1`.

```ts
// app/api/feedback/route.ts
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FeedbackRequestError, parseFeedbackRequest } from "visual-feedback/server";

export async function POST(request: Request): Promise<Response> {
  // Development only: a deployed disk can be read-only or wiped, and NODE_ENV may be unset.
  if (process.env.NODE_ENV !== "development") {
    return new Response("Local feedback storage works only in development.", { status: 503 });
  }
  try {
    const { report } = await parseFeedbackRequest(request);
    // report.id is a checked UUID, so it is safe as a folder name.
    const folder = join(process.cwd(), ".visual-feedback", report.id);
    const name = (image: Blob, i: number) =>
      `screenshot-${i}.${image.type === "image/png" ? "png" : "webp"}`;
    await mkdir(folder, { recursive: true });
    // The images first: a report.json on disk then always has its images beside it.
    for (const [i, { image }] of report.screenshots.entries()) {
      await writeFile(join(folder, name(image, i)), new Uint8Array(await image.arrayBuffer()));
    }
    const screenshots = report.screenshots.map((shot, i) => ({ ...shot, image: name(shot.image, i) }));
    await writeFile(
      join(folder, "report.json"),
      JSON.stringify({ ...report, screenshots }, null, 2),
    );
    // After report.json, so a resend with other images, or fewer, leaves no stray image.
    const kept = new Set(["report.json", ...screenshots.map((shot) => shot.image)]);
    for (const old of await readdir(folder)) {
      if (!kept.has(old)) await rm(join(folder, old), { force: true });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof FeedbackRequestError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}
```

A "Try again" sends the same report again, with the same `id`, so it writes over its own folder and
never makes a second one.
