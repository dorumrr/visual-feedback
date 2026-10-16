# Recipe: Postgres

Each report becomes one row in `feedback_reports`: the `FeedbackReport` (docs/API.md), its
screenshots without their images, as `jsonb`, and the user who sent it, taken from your own session.
Each screenshot's image becomes one row in `feedback_screenshots`, by its `position` in
`report.screenshots`: the image in `image` (`bytea`) and its type in `image_type`. `user_id` is the
proof of who sent a report; `report.context` is not (docs/API.md).

To keep images in a bucket instead (docs/recipes/s3.md):

1. Install `aws4fetch` and set the `S3_*` variables as that recipe's step 1 says.
2. Copy its `bucket()` function into this route.
3. Before the insert, PUT each image to `url(report.id, "screenshot-<position>.png")` or `.webp`,
   as that recipe's `POST` does:
   with `"if-none-match": "*"`, so a reused id never replaces a stored image, and throw on any
   refusal but 412, so a row never lacks its image.
4. Insert `null` for `image` and keep `image_type`: `image/png` is the file
   `screenshot-<position>.png`, and `image/webp` is `screenshot-<position>.webp`.
5. Read images back with that recipe's `GET`, its `canRead` replaced by the same admin check your
   screens use.

The images show the screen as the user saw it, with nothing masked (SPEC §7), so read the table only
from your own admin screens.

## Questions to ask

1. Which database? The route uses the `postgres` package; where the app already reaches the
   database with another client, such as Prisma, Drizzle or `pg`, say this adds a second one.
2. How does the app's session give the signed-in user's id? The route ships closed on
   `currentUser` until it does.
3. Images in the table, or in a bucket? A bucket adds the S3 recipe's setup above, its package and
   its `S3_*` settings: then ask its questions too.
4. Where will admins read reports? This recipe stores them and ships no read route.

## 1. Install and create the table

```sh
npm install postgres
```

```sql
create table feedback_reports (
  id uuid primary key,
  user_id text not null,
  created_at timestamptz not null,
  report jsonb not null
);

create table feedback_screenshots (
  report_id uuid not null references feedback_reports (id) on delete cascade,
  position integer not null,
  image bytea,
  image_type text not null,
  primary key (report_id, position)
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
    const { report } = await parseFeedbackRequest(request);
    const screenshots = report.screenshots.map(({ image: _, ...shot }) => shot);
    // The report was parsed from JSON, so it is JSON; context is only typed as unknown values.
    const json = db().json({ ...report, screenshots } as postgres.JSONValue);
    const images = await Promise.all(
      report.screenshots.map(async ({ image }, position) => ({
        report_id: report.id,
        position,
        image: new Uint8Array(await image.arrayBuffer()),
        image_type: image.type,
      })),
    );
    // One transaction, so a report row never lacks its screenshots.
    await db().begin(async (sql) => {
      // A "Try again" sends the same id, so the rows it already wrote stay as they are.
      const inserted = await sql`
        insert into feedback_reports (id, user_id, created_at, report)
        values (${report.id}, ${user}, ${report.createdAt}, ${json})
        on conflict (id) do nothing
        returning id`;
      if (inserted.length && images.length) {
        await sql`insert into feedback_screenshots ${sql(images)}`;
      }
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof FeedbackRequestError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}
```
