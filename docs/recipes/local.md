# Recipe: a local `.visual-feedback/` folder

For local development only: it writes only when `NODE_ENV` is `development`. `next dev` sets it;
start any other server with `NODE_ENV=development`.

Each report becomes one folder, `.visual-feedback/<id>/`, holding `image.png` or `image.webp` and
`report.json`. That file is the `FeedbackReport` (docs/API.md), with `image` set to the image's file
name, or `null` when the report has none.

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
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FeedbackRequestError, parseFeedbackRequest } from "visual-feedback/server";

export async function POST(request: Request): Promise<Response> {
  // Development only: a deployed disk can be read-only or wiped, and NODE_ENV may be unset.
  if (process.env.NODE_ENV !== "development") {
    return new Response("Local feedback storage works only in development.", { status: 503 });
  }
  try {
    const { report, image } = await parseFeedbackRequest(request);
    // report.id is a checked UUID, so it is safe as a folder name.
    const folder = join(process.cwd(), ".visual-feedback", report.id);
    const file = image ? `image.${image.type === "image/png" ? "png" : "webp"}` : null;
    await mkdir(folder, { recursive: true });
    // The image first: a report.json on disk then always has its image beside it.
    if (image && file)
      await writeFile(join(folder, file), new Uint8Array(await image.arrayBuffer()));
    await writeFile(
      join(folder, "report.json"),
      JSON.stringify({ ...report, image: file }, null, 2),
    );
    // After report.json, so a resend with another image type, or none, leaves no stray image.
    for (const old of ["image.png", "image.webp"]) {
      if (old !== file) await rm(join(folder, old), { force: true });
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
