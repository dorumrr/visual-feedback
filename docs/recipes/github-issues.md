# Recipe: GitHub Issues (private repo only)

Each report becomes an issue: the note, the page URL, the browser data and the screenshots, with
the category as a label. Each screenshot's image is committed to the repo with GitHub's contents
API, at `feedback/<id>/screenshot-<n>.png`, numbered from 0, and shown inside the issue, with its
own page URL under it when it was taken on another page than the report's. Then the
whole report is committed beside them as `feedback/<id>/report.json`, with each screenshot's `image`
set to its GitHub link and `issue` to the issue number: a resend that finds it opens no second
issue. The route checks on every send that the repo
is private, and refuses otherwise. It uses `fetch` and GitHub's REST API, so it needs no package.

`report.context` comes from the browser (docs/API.md): the issue shows it as data, never as proof
of who sent the report. The images show the screen as the user saw it, with nothing masked
(SPEC §7). Only people with access to the repo see them. GitHub shows an image in an issue through
a signed link that works for anyone who holds it, for a few minutes: show it, never share it.

## 1. Pick a layout

**A dedicated private repo (the default).** Create a private repo only for feedback, such as
`<app>-feedback`, never the code repo, with a README so it has a default branch. Images stay out of the code repo's clones, and making the
code repo public later exposes nothing. Images are committed to its default branch.

**The code repo, with an orphan branch.** Only when you are sure the code repo stays private
forever. Issues sit next to the code with one token, and images go to a branch `visual-feedback`
that shares no history with the code. A token cannot be limited to one branch, so the server's
token can also push to the code: a leak of it is a leak of write access to your source. But every clone and fetch downloads that branch unless it is
cloned with `--single-branch`, and if the repo is ever made public, every report is exposed. Create
the branch once, in a clean clone (git 2.23 or later):

```sh
git switch --orphan visual-feedback
git commit --allow-empty -m "visual-feedback images"
git push origin visual-feedback
git switch -
```

In both layouts, deleting a file or a branch does not remove its images or reports: commits stay reachable by
their SHA on GitHub until GitHub Support purges them. A later option, once it works with a
fine-grained token, is GitHub's own issue-attachment upload, which keeps images out of git history;
it is undocumented, so this recipe does not use it.

## 2. Token and settings

Create a fine-grained personal access token for that one repo, with **Issues: read and write** and
**Contents: read and write**, and set on the server:

| variable | for example |
|---|---|
| `GITHUB_FEEDBACK_REPO` | `acme/app-feedback` |
| `GITHUB_FEEDBACK_TOKEN` | the token; never send it to the browser |
| `GITHUB_FEEDBACK_BRANCH` | `visual-feedback` for the code-repo layout; unset for the default branch |

Send PNG from the widget, the image type this recipe was checked with inside an issue:
`createFeedback({ endpoint: "/api/feedback", capture: { type: "image/png" } })`. Without it the
widget sends WebP (docs/API.md): the route commits and links `screenshot-<n>.webp` the same way, but whether
the issue shows a WebP image inline is not checked.

## 3. The route

This is a Next.js App Router route on the Node.js runtime (it uses `Buffer`). As written, anyone who
can reach `POST` can open issues, with any category as a label: before production, put it behind
your own session check and a rate limit.

```ts
// app/api/feedback/route.ts
import {
  type FeedbackReport,
  FeedbackRequestError,
  parseFeedbackRequest,
} from "visual-feedback/server";

function github() {
  const { GITHUB_FEEDBACK_REPO: repo, GITHUB_FEEDBACK_TOKEN: token } = process.env;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) {
    throw new Error("Set GITHUB_FEEDBACK_REPO (owner/name) and GITHUB_FEEDBACK_TOKEN.");
  }
  return async (method: string, path: string, body?: object, accept = "github+json") => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: `application/vnd.${accept}`,
        "x-github-api-version": "2022-11-28",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
    });
    return { status: response.status, json: response.ok ? await response.json() : null };
  };
}

// GitHub refuses an issue body over 65,536 characters; report.json keeps every field in full.
function cut(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

// A fence longer than any run of backticks in the text, so the text shows as written.
function fenced(text: string, max: number): string {
  const shown = cut(text, max);
  const longest = Math.max(2, ...[...shown.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${shown}\n${fence}`;
}

// A screenshot of another page than the report's names its own, as a draft can span routes.
function shots(report: FeedbackReport, imageUrls: string[], share: number): string {
  return imageUrls
    .map((url, i) => {
      const page = report.screenshots[i]?.page.url ?? report.page.url;
      const where = page === report.page.url ? "" : `\n${fenced(page, 2_000 * share)}`;
      return `![Screenshot ${i + 1}](<${url}>)${where}`;
    })
    .join("\n\n");
}

function issueBody(report: FeedbackReport, imageUrls: string[]): string {
  // A fence can be as long as its text, so a report of backticks can pass GitHub's limit at the
  // usual cuts: they shrink until it fits. At a tenth, the longest report is far under it.
  let body = "";
  for (const share of [1, 0.5, 0.25, 0.1]) {
    body = bodyAt(report, imageUrls, share);
    if (body.length <= 65_536) break;
  }
  return body;
}

function bodyAt(report: FeedbackReport, imageUrls: string[], share: number): string {
  const { page, viewport, userAgent, language, timeZone, createdAt, id } = report;
  const screen = `${viewport.width}x${viewport.height} @${viewport.devicePixelRatio}x`;
  // Each fence starts its own line: after other text on that line it is no block.
  return [
    fenced(report.note || "(no note)", 10_000 * share),
    // The angle brackets keep a ( or ) in a branch name from ending the link.
    shots(report, imageUrls, share) || "No screenshot.",
    `**Page:**\n${fenced(page.url, 2_000 * share)}`,
    `**Browser:**\n${fenced(`${userAgent}\n${screen}, ${language}, ${timeZone}`, 1_000 * share)}`,
    `**Sent:** ${createdAt}, report \`${id}\``,
    `**Context, from the browser:**\n${fenced(JSON.stringify(report.context, null, 2), 6_000 * share)}`,
  ].join("\n\n");
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { report } = await parseFeedbackRequest(request);
    const api = github();
    const repo = await api("GET", "");
    // Checked on every send: a repo made public later must not receive reports.
    if (repo.status !== 200) throw new Error(`GitHub answered ${repo.status} for the repo.`);
    if (repo.json.private !== true) {
      return new Response("The feedback repo must be private.", { status: 503 });
    }
    const branch = process.env.GITHUB_FEEDBACK_BRANCH || repo.json.default_branch;
    const ref = `?ref=${encodeURIComponent(branch)}`;
    const folder = `feedback/${report.id}`;
    // The plain JSON answer refuses a file over 1 MB; the object one only leaves out its content.
    const stored = (name: string) =>
      api("GET", `/contents/${folder}/${name}${ref}`, undefined, "github.object");
    // report.json is written last, so its presence means the issue exists: a resend stops here.
    const marker = await stored("report.json");
    if (marker.status === 200) return new Response(null, { status: 204 });
    if (marker.status !== 404) throw new Error(`GitHub answered ${marker.status} for report.json.`);
    const put = async (name: string, bytes: Uint8Array) => {
      const content = Buffer.from(bytes).toString("base64");
      const message = `Feedback ${report.id}: ${name}`;
      // No sha, so GitHub only creates: an existing file is never replaced (422).
      let commit = await api("PUT", `/contents/${folder}/${name}`, { message, content, branch });
      // Two commits to one branch at once: GitHub refuses the second with 409.
      for (let retry = 0; commit.status === 409 && retry < 2; retry++) {
        commit = await api("PUT", `/contents/${folder}/${name}`, { message, content, branch });
      }
      if (commit.status === 201) return;
      // GitHub also answers 422 for a missing branch, so only a file already there counts.
      if (commit.status !== 422 || (await stored(name)).status !== 200) {
        throw new Error(`GitHub answered ${commit.status} for ${name}.`);
      }
    };
    const imageUrls: string[] = [];
    for (const [i, { image }] of report.screenshots.entries()) {
      const name = `screenshot-${i}.${image.type === "image/png" ? "png" : "webp"}`;
      await put(name, new Uint8Array(await image.arrayBuffer()));
      const path = `${branch.split("/").map(encodeURIComponent).join("/")}/${folder}/${name}`;
      imageUrls.push(`https://github.com/${repo.json.full_name}/blob/${path}?raw=true`);
    }
    // GitHub refuses a label name over 50 characters, and one that is only space.
    const category = cut(report.category?.replace(/\s+/g, " ").trim() ?? "", 49);
    const title = cut(report.note.split("\n")[0]?.trim() || "Feedback", 80);
    const issue = await api("POST", "/issues", {
      title,
      body: issueBody(report, imageUrls),
      labels: ["feedback", ...(category ? [category] : [])],
    });
    if (issue.status !== 201) throw new Error(`GitHub answered ${issue.status} for the issue.`);
    const screenshots = report.screenshots.map((shot, i) => ({ ...shot, image: imageUrls[i] }));
    const json = JSON.stringify({ ...report, screenshots, issue: issue.json.number }, null, 2);
    await put("report.json", new TextEncoder().encode(json));
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof FeedbackRequestError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
}
```

If the issue opens but `report.json` cannot be written, a "Try again" opens a second issue for the
same report. Two sends of one report at the same moment can also both open one, since the check
and the writes are separate. Each issue body names the report id, so the two are easy to match.
