# Recipe: Postgres

Each report becomes one row in `feedback_reports`: the `FeedbackReport` (docs/API.md), its
screenshots without their images, as `jsonb`, and the user who sent it, taken from your own session.
Each screenshot's image becomes one row in `feedback_screenshots`, by its `position` in
`report.screenshots`: the image in `image` (`bytea`) and its type in `image_type`. `user_id` is the
proof of who sent a report; `report.context` is not (docs/API.md).

Files are off until you turn them on (step 3). Then each file the user attached becomes one row in
`feedback_attachments`, by its `position` in `report.attachments`: the name, type and size it was
sent with, its bytes in `file`, and `stored_name`, `file-<position>` with the ending its type
allows, such as `file-0.png`. The user's file name is kept as data, never used as a key. The
report's `attachments` list keeps `name`, `type`, `size` and `storedName`, without the files.

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
5. May users attach files? Then follow step 3 as well.

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

create table feedback_attachments (
  report_id uuid not null references feedback_reports (id) on delete cascade,
  position integer not null,
  name text not null,
  type text not null,
  size integer not null,
  stored_name text not null,
  file bytea not null,
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

// Off, a report with files gets 400. Turn on only as step 3 says.
const ATTACHMENTS = false;

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
    const { report } = await parseFeedbackRequest(request, { attachments: ATTACHMENTS });
    const { attachments, ...fields } = report;
    const screenshots = report.screenshots.map(({ image: _, ...shot }) => shot);
    const files = (attachments ?? []).map(({ file, ...entry }, position) => {
      // The parser checked that the name ends as its type allows; only that ending is taken.
      const ending = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
      return { file, entry: { ...entry, storedName: `file-${position}${ending}` } };
    });
    // The report was parsed from JSON, so it is JSON; context is only typed as unknown values.
    const json = db().json({
      ...fields,
      screenshots,
      ...(attachments && { attachments: files.map(({ entry }) => entry) }),
    } as postgres.JSONValue);
    const images = await Promise.all(
      report.screenshots.map(async ({ image }, position) => ({
        report_id: report.id,
        position,
        image: new Uint8Array(await image.arrayBuffer()),
        image_type: image.type,
      })),
    );
    const stored = await Promise.all(
      files.map(async ({ file, entry }, position) => ({
        report_id: report.id,
        position,
        name: entry.name,
        type: entry.type,
        size: entry.size,
        stored_name: entry.storedName,
        file: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    // One transaction, so a report row never lacks its screenshots or its files.
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
      if (inserted.length && stored.length) {
        await sql`insert into feedback_attachments ${sql(stored)}`;
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

## 3. Files, when users may attach them

A new install made the `feedback_attachments` table in step 1. An install made before files runs
only that one statement from step 1, and replaces its route with step 2's, keeping what the app
changed, such as its `currentUser`, the bucket PUT or `prepare: false`: an older route has no
`ATTACHMENTS` and stores no files. Then set `ATTACHMENTS` to
`true` in the route, together with the widget's `attachments` option (docs/API.md): the server
then checks each file by its bytes before the route sees it. With `ATTACHMENTS` still `false`, a
report with files is refused with 400 and nothing is written. When you update the route from a
later version of this recipe, keep `ATTACHMENTS` as the app set it.
