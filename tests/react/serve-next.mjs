// Builds tests/react/next-app with Next.js and serves it on FIXTURE_PORT, from a temporary copy,
// so the build's own files never land in the tracked tree.
import { cpSync, mkdirSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, parse, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readmeBlock, repo, tempApp } from "../temp-app.mjs";

const next = join(repo, "node_modules/next/dist/bin/next");
const port = process.env.FIXTURE_PORT ?? "4175";
// Next.js sends usage data to Vercel unless this is set.
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const { dir: app, run, stop } = tempApp("visual-feedback-next-");

try {
  cpSync(fileURLToPath(new URL("next-app", import.meta.url)), app, { recursive: true });
  // The repo's packages, and this package by name, the way an app that installed it sees them.
  mkdirSync(join(app, "node_modules"));
  for (const name of readdirSync(join(repo, "node_modules"))) {
    symlinkSync(join(repo, "node_modules", name), join(app, "node_modules", name));
  }
  symlinkSync(repo, join(app, "node_modules/visual-feedback"));
  // The README's React example, as written, is the root layout of the /readme route group.
  writeFileSync(join(app, "app/(readme)/layout.tsx"), readmeBlock("tsx"));
  // Turbopack compiles nothing outside its root, and the links lead into the repo: the root is
  // the deepest folder that holds both.
  const [a, b] = [realpathSync(app), realpathSync(repo)].map((path) => path.split(sep));
  let shared = 0;
  while (shared < a.length && a[shared] === b[shared]) shared++;
  const root = a.slice(0, shared).join(sep) || parse(app).root;
  writeFileSync(
    join(app, "next.config.mjs"),
    `export default { turbopack: { root: ${JSON.stringify(root)} } };\n`,
  );
} catch (error) {
  console.error(error);
  await stop(1);
}
const node = (args) => run(process.execPath, [next, ...args], { env });
const built = await node(["build", app]);
if (built !== 0) await stop(built);
await stop(await node(["start", app, "-H", "127.0.0.1", "-p", port]));
