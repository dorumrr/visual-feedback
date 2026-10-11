// npm run release: sets the version, commits, pushes, starts the publish workflow and watches it.
// Not "publish": npm runs a script of that name inside `npm publish` itself.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const NAME = "visual-feedback";
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
// The same words the publish workflow refuses in a heading it publishes.
const WAITING = /not (yet )?released|unreleased/i;

/** The version to offer: the package's own while npm lacks it, else the next patch. */
export function next(current, published) {
  if (!published || newer(current, published)) return current;
  const [, major, minor, patch] = SEMVER.exec(published) ?? [];
  return `${major}.${minor}.${Number(patch) + 1}`;
}

/** Each CHANGELOG entry, newest first: its version, whether its heading waits for a date, its lines. */
function entries(changelog) {
  const headings = [...changelog.matchAll(/^## ([^\s(]+)(.*)$/gm)];
  return headings.map((found, i) => ({
    version: found[1],
    waiting: WAITING.test(found[0]),
    text: changelog.slice(found.index + found[0].length, headings[i + 1]?.index),
  }));
}

export function top(changelog) {
  return entries(changelog)[0];
}

/** The version to offer: the newest entry's while it waits to be released, else as next() says. */
export function offer(current, published, changelog) {
  const entry = top(changelog);
  return entry?.waiting && SEMVER.test(entry.version) ? entry.version : next(current, published);
}

/** Why `version` cannot be released from this CHANGELOG, or undefined when it can. */
export function refusal(changelog, version) {
  const [entry, previous] = entries(changelog);
  if (!entry) return `CHANGELOG.md has no "## ${version}" entry: write it first.`;
  if (entry.version !== version) {
    if (entries(changelog).some((other) => other.version === version)) {
      return `CHANGELOG.md's "## ${version}" entry is not the newest one: move it above "## ${entry.version}".`;
    }
    return entry.waiting
      ? `CHANGELOG.md's newest entry, "## ${entry.version}", waits to be released, not ${version}: release ${entry.version}, or change that heading first.`
      : `CHANGELOG.md's newest entry is "## ${entry.version}", already dated: write a "## ${version} (not released yet)" entry above it first.`;
  }
  // The publish workflow's grep wants exactly one such line, with a space or nothing after the
  // version; a CR before the line's end counts as something.
  const lines = changelog
    .split("\n")
    .filter((line) => line === `## ${version}` || line.startsWith(`## ${version} `)).length;
  if (lines !== 1) {
    return `CHANGELOG.md needs exactly one "## ${version}" heading, with a space or nothing after the version, as the publish workflow checks; it has ${lines}.`;
  }
  if (!/^\s*- /m.test(entry.text)) {
    return `CHANGELOG.md's "## ${version}" entry lists no change: add its lines first.`;
  }
  // Measured from the release before, the entry below: npm may be out of reach, and package.json
  // already bumped by a release that failed.
  const [major, minor] = (SEMVER.exec(version) ?? []).slice(1).map(Number);
  const [baseMajor, baseMinor] = (SEMVER.exec(previous?.version ?? "") ?? []).slice(1).map(Number);
  // Before 1.0 a breaking change ships in the next minor version, from 1.0 in the next major.
  if (/(?<![\w-])breaking:/i.test(entry.text)) {
    if (baseMajor === 0 && major === 0 && minor === baseMinor) {
      return `CHANGELOG.md's "## ${version}" entry holds a Breaking: change, so it ships as a new minor version, 0.${baseMinor + 1}.0, not ${version}: rename the heading.`;
    }
    if (baseMajor > 0 && major === baseMajor) {
      return `CHANGELOG.md's "## ${version}" entry holds a Breaking: change, so it ships as a new major version, ${baseMajor + 1}.0.0, not ${version}: rename the heading.`;
    }
  }
  return undefined;
}

export function newer(a, b) {
  const [x, y] = [a, b].map((v) => (SEMVER.exec(v) ?? []).slice(1).map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** The changelog with its `## <version>` heading dated, as the publish workflow requires. */
export function dated(changelog, version, today) {
  const heading = new RegExp(`^## ${version.replaceAll(".", "\\.")}( .*)?$`, "m");
  const found = heading.exec(changelog);
  if (!found) throw new Error(`CHANGELOG.md has no "## ${version}" entry: write it first.`);
  if (!WAITING.test(found[0])) return changelog;
  return changelog.replace(heading, `## ${version} (${today})`);
}

/** Sets the top-level version, and in a lockfile the root package's, nothing else. */
export function setVersion(json, version) {
  return json
    .replace(/^ {2}"version": "[^"]*"/m, `  "version": "${version}"`)
    .replace(/("": \{\n\s+"name": "[^"]*",\n\s+"version": )"[^"]*"/, `$1"${version}"`);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const file = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

/** Runs a command in the repo; output is shown live unless `quiet`, then returned trimmed. */
function run(command, args, quiet = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

function must(command, args, quiet = false) {
  const result = run(command, args, quiet);
  if (!result.ok) throw new Error(`${command} ${args.join(" ")} failed.`);
  return result.out;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  // Piped answers arrive before their question and are lost: it would end with nothing said.
  if (!process.stdin.isTTY) throw new Error("Run it in a terminal: it asks before it publishes.");
  const ask = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (must("git", ["branch", "--show-current"], true) !== "main") {
      throw new Error("Run it on main: a real publish runs from main only.");
    }
    if (must("git", ["status", "--porcelain"], true)) {
      throw new Error("Commit or stash your changes first: the release commit holds only its own.");
    }
    must("git", ["fetch", "--quiet", "origin", "main"]);
    if (must("git", ["rev-list", "--count", "HEAD..origin/main"], true) !== "0") {
      throw new Error("main is behind origin/main: pull first.");
    }
    // `git push origin main` sends every local commit, not only the release commit.
    const unpushed = must("git", ["log", "--oneline", "origin/main..HEAD"], true);
    if (unpushed) {
      console.log(
        `These commits are not on origin/main yet; the release pushes them too:\n${unpushed}`,
      );
      if ((await ask.question("Release them too? [y/N] ")).trim().toLowerCase() !== "y") {
        console.log("Stopped: nothing was changed, committed, pushed or published.");
        return;
      }
    }
    const current = JSON.parse(readFileSync(file("package.json"), "utf8")).version;
    const view = run("npm", ["view", NAME, "version"], true);
    const published = view.ok ? view.out : undefined;
    const changelog = readFileSync(file("CHANGELOG.md"), "utf8");
    const entry = top(changelog);
    const state = entry
      ? `${entry.version}${entry.waiting ? ", not released yet" : ", dated"}`
      : "none";
    console.log(
      `package.json: ${current}, on npm: ${published ?? "not known (offline?)"}, CHANGELOG.md newest entry: ${state}`,
    );

    const question = ask.question("Version to publish: ");
    ask.write(offer(current, published, changelog));
    const version = (await question).trim();
    // Every check runs before the first file is written.
    if (!SEMVER.test(version)) throw new Error(`"${version}" is not a version like 1.2.3.`);
    if (published && !newer(version, published)) {
      throw new Error(`${version} is not newer than ${published}, which npm already has.`);
    }
    const refused = refusal(changelog, version);
    if (refused) throw new Error(refused);

    const today = new Date().toLocaleDateString("en-CA");
    writeFileSync(file("CHANGELOG.md"), dated(changelog, version, today));
    for (const name of ["package.json", "package-lock.json"]) {
      writeFileSync(file(name), setVersion(readFileSync(file(name), "utf8"), version));
    }
    const changed = must("git", ["status", "--porcelain"], true);
    if (changed) must("git", ["--no-pager", "diff", "--stat"]);

    const go = await ask.question(
      `${changed ? `Commit "Release ${version}", push` : "Push"} and publish ${version}? [y/N] `,
    );
    if (go.trim().toLowerCase() !== "y") {
      if (changed)
        must("git", ["checkout", "--", "CHANGELOG.md", "package.json", "package-lock.json"]);
      console.log("Stopped: nothing was committed, pushed or published.");
      return;
    }
    if (changed) {
      must("git", ["add", "CHANGELOG.md", "package.json", "package-lock.json"]);
      must("git", ["commit", "--quiet", "-m", `Release ${version}`]);
    }
    must("git", ["push", "origin", "main"]);

    const started = Date.now();
    must("gh", ["workflow", "run", "publish.yml", "--ref", "main", "-f", "dry_run=false"]);
    let id;
    for (let i = 0; i < 30 && !id; i++) {
      await sleep(2000);
      const runs = JSON.parse(
        must(
          "gh",
          [
            "run",
            "list",
            "--workflow",
            "publish.yml",
            "--event",
            "workflow_dispatch",
            "--limit",
            "5",
            "--json",
            "databaseId,createdAt,url",
          ],
          true,
        ),
      );
      // Its clock may differ from this one by a few seconds.
      const mine = runs.find((r) => Date.parse(r.createdAt) >= started - 10_000);
      if (mine) {
        id = String(mine.databaseId);
        console.log(`Watching ${mine.url}`);
      }
    }
    if (!id) throw new Error("The publish run did not show up: see the Actions tab.");

    // GitHub gives a step's log only once the run ends, so this shows the steps as they go.
    if (!run("gh", ["run", "watch", id, "--exit-status", "--interval", "5"]).ok) {
      // A publish that waited on a failed check says only that: the check run has the reason.
      const sha = must("git", ["rev-parse", "HEAD"], true);
      const check = run(
        "gh",
        [
          "run",
          "list",
          "--workflow",
          "check.yml",
          "--commit",
          sha,
          "--limit",
          "1",
          "--json",
          "databaseId",
          "--jq",
          ".[0].databaseId",
        ],
        true,
      ).out;
      const failed = check && check !== "null" ? check : id;
      console.log(`\nWhat failed (gh run view ${failed} --log-failed):`);
      console.log(
        run("gh", ["run", "view", failed, "--log-failed"], true)
          .out.split("\n")
          .slice(-80)
          .join("\n"),
      );
      throw new Error(`The publish run failed: gh run view ${failed} --log-failed`);
    }

    for (let i = 0; i < 30; i++) {
      if (run("npm", ["view", `${NAME}@${version}`, "version"], true).out === version) break;
      await sleep(4000);
    }
    const live = run("npm", ["view", `${NAME}@${version}`, "version"], true).out === version;
    console.log(
      live
        ? `\nSUCCESS: ${NAME}@${version} is on npm.`
        : `\nThe run passed, but npm does not show ${version} yet.`,
    );
    if (
      (await ask.question(`Tag v${version} and push the tag? [y/N] `)).trim().toLowerCase() === "y"
    ) {
      must("git", ["tag", `v${version}`]);
      must("git", ["push", "origin", `v${version}`]);
    }
  } finally {
    ask.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error.message}`);
    process.exit(1);
  });
}
