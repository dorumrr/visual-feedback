# Recipe: Supabase

Each report becomes one row in a table and one image per screenshot in the private Storage bucket
`feedback`, named `<id>/screenshot-<n>.png` or `.webp`, numbered from 0. The row has the columns of
the Postgres recipe's `feedback_reports` (docs/recipes/postgres.md), except that `user_id` is the
Supabase user's uuid. The images are in Storage instead of a second table, and each screenshot's
`image` in `report` is its file name. Row-level security lets only your app's admins read either,
and nobody but your server can write.

`user_id` is the proof of who sent a report; `report.context` is not (docs/API.md). The images show
the screen as the user saw it, with nothing masked (SPEC §7).

## Questions to ask

1. Which Supabase project?
2. Does the app sign users in with Supabase Auth? This recipe needs it: each report is tied to a
   Supabase user, and admins are read from `app_metadata.role`. If not, offer the Postgres recipe.
3. Who are the admins, and is their `app_metadata.role` already `admin` (section 1)? The developer
   runs section 1's SQL in the SQL editor, and sets the role as section 1 says, with the service
   role.
4. Where will admins read reports? This recipe ships no read screen: row-level security lets an
   admin read them from the app's own screens.

## 1. Install and create the table, the bucket and the policies

```sh
npm install @supabase/supabase-js
```

Run this in the SQL editor. An admin is a user whose `app_metadata.role` is `admin`. Only your
server can set it, with the service role:
`supabase.auth.admin.updateUserById(id, { app_metadata: { role: "admin" } })`. A change, removal
included, reaches the user's token only at their next sign-in or token refresh (within an hour by
default). Never use `user_metadata` for this: users can edit their own.

```sql
create table feedback_reports (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null,
  report jsonb not null
);
alter table feedback_reports enable row level security;
grant select on feedback_reports to authenticated;
grant all on feedback_reports to service_role;
create policy "Admins read feedback" on feedback_reports for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

insert into storage.buckets (id, name, public) values ('feedback', 'feedback', false);
create policy "Admins read feedback images" on storage.objects for select to authenticated
  using (bucket_id = 'feedback' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

No policy allows an insert, an update or a delete, so only the service role, on your server, writes.
Deleting a user deletes their rows, which list their report ids, so remove their images under
`<id>/` first.

Check it: with the anon key, `select` on `feedback_reports` returns an empty list or a permission
error, never a row, and a download from `feedback` is refused.

An admin screen reads with the admin's own session, never the service role key:
`from("feedback_reports").select()` for the rows, filtered and paged as the screen needs, and
`storage.from("feedback").createSignedUrl("<id>/<image>", 60)` for a screenshot, where `<image>` is
its `image` in `report`, such as `screenshot-0.png`. A signed URL works for anyone who holds it for
those 60 seconds: show it, never share it.

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the server. The service role key bypasses
row-level security: never send it to the browser.

## 2. The route

The widget posts to it with `createFeedback({ endpoint: "/api/feedback" })`. This is a Next.js
App Router route. As written, it refuses every send until you fill in `currentUser`; then any
signed-in user can send, so put a rate limit in front of it before production.

```ts
// app/api/feedback/route.ts
import { createClient } from "@supabase/supabase-js";
import { FeedbackRequestError, parseFeedbackRequest } from "visual-feedback/server";

// Replace with your own session: the signed-in user's Supabase id (a uuid), for example from
// supabase.auth.getUser() in @supabase/ssr. Until then, nobody can send. Never use report.context.
async function currentUser(_request: Request): Promise<string | null> {
  return null;
}

function supabase() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user) return new Response(null, { status: 401 });
  try {
    const { report } = await parseFeedbackRequest(request);
    const db = supabase();
    const name = (image: Blob, i: number) =>
      `screenshot-${i}.${image.type === "image/png" ? "png" : "webp"}`;
    const screenshots = report.screenshots.map((shot, i) => ({ ...shot, image: name(shot.image, i) }));
    // The images first, so a row never lacks its images.
    for (const [i, { image }] of report.screenshots.entries()) {
      const upload = await db.storage
        .from("feedback")
        .upload(`${report.id}/${name(image, i)}`, image, { contentType: image.type, upsert: false });
      // A resend finds its image there (409); the id comes from the browser, so never replace it.
      const error = upload.error;
      const stored = error && "statusCode" in error && error.statusCode === "409";
      if (error && !stored) throw error;
    }
    // A "Try again" sends the same id, so the row it already wrote stays as it is.
    const insert = await db.from("feedback_reports").upsert(
      {
        id: report.id,
        user_id: user,
        created_at: report.createdAt,
        report: { ...report, screenshots },
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (insert.error) throw insert.error;
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof FeedbackRequestError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}
```
