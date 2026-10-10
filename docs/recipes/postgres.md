# Recipe: Postgres

Each report becomes one row: the `FeedbackReport` (docs/API.md) without its `image` as `jsonb`, the
image in `image` (`bytea`) with its type in `image_type`, and the user who sent it, taken from your
own session. `user_id` is the proof of who sent a report; `report.context` is not (docs/API.md).

To keep images in a bucket instead (docs/recipes/s3.md):

1. Install `aws4fetch` and set the `S3_*` variables as that recipe's step 1 says.
2. Copy its `bucket()` function into this route.
3. Before the insert, PUT the image to `url(report.id, "image.png")` or `"image.webp"`, as that
   recipe's `POST` does: with `"if-none-match": "*"`, so a reused id never replaces a stored
   image, and throw on any refusal but 412, so a row never lacks its image.
4. Insert `null` for `image` and keep `image_type`: `image/png` is the file `image.png`, and
   `image/webp` is `image.webp`.
5. Read images back with that recipe's `GET`, its `canRead` replaced by the same admin check your
   screens use.

The images show the screen as the user saw it, with nothing masked (SPEC §7), so read the table only
from your own admin screens.

## 1. Install and create the table

```sh
npm install postgres
```

```sql
create table feedback_reports (
  id uuid primary key,
  user_id text not null,
  created_at timestamptz not null,
  report jsonb not null,
  image bytea,
  image_type text
);
```

Set `DATABASE_URL` on the server. On a serverless host, use your provider's pooled URL, since each
instance opens its own connections; a pooler in transaction mode also needs `prepare: false` beside
`idle_timeout` below.

## 2. The route

The widget posts to it with `createFeedback({ endpoint: "/api/feedback" })`. This is a Next.js
App Router route.

```ts
// app/api/feedback/route.ts
import postgres from "postgres";
import { FeedbackRequestError, parseFeedbackRequest } from "visual-feedback/server";

let sql: postgres.Sql | undefined;

// Connects on the first send, so a build or an import never opens a connection.
function db(): postgres.Sql {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");
  // idle_timeout closes a pool a hot reload left behind, instead of holding its connections.
  sql ??= postgres(process.env.DATABASE_URL, { idle_timeout: 20 });
  return sql;
}

// Replace with your own session: the user who is signed in. Until then, nobody can send.
// Never take the user from report.context, which the browser controls.
async function currentUser(_request: Request): Promise<string | null> {
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user) return new Response(null, { status: 401 });
  try {
    const { report, image } = await parseFeedbackRequest(request);
    const { image: _, ...stored } = report;
    const bytes = image ? new Uint8Array(await image.arrayBuffer()) : null;
    // The report was parsed from JSON, so it is JSON; context is only typed as unknown values.
    const json = db().json(stored as postgres.JSONValue);
    // A "Try again" sends the same id, so the row it already wrote stays as it is.
    await db()`
      insert into feedback_reports (id, user_id, created_at, report, image, image_type)
      values (${report.id}, ${user}, ${report.createdAt}, ${json}, ${bytes},
        ${image?.type ?? null})
      on conflict (id) do nothing`;
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof FeedbackRequestError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}
```
