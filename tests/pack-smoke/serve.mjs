// Packs this package, installs the tarball into a fresh app outside the repo (never a folder
// install, which would skip the "files" list), adds the README's layout and the local recipe's
// route, and serves the app with next dev on FIXTURE_PORT.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readmeBlock, repo, tempApp } from "../temp-app.mjs";

const port = process.env.FIXTURE_PORT ?? "4177";
// Next.js sends usage data to Vercel unless this is set.
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const { dir: app, run, stop } = tempApp("visual-feedback-pack-smoke-");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// The app gets the versions this repo tests with.
const lock = JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8")).packages;
const version = (name) => `${name}@${lock[`node_modules/${name}`].version}`;

try {
  const [packed] = JSON.parse(
    execFileSync(npm, ["pack", "--json", "--pack-destination", app], {
      cwd: repo,
      encoding: "utf8",
      shell: process.platform === "win32",
    }),
  );
  writeFileSync(
    join(app, "package.json"),
    `${JSON.stringify({ name: "pack-smoke-app", private: true, type: "module" }, null, 2)}\n`,
  );
  // Next.js refuses a TypeScript app without @types/node.
  const dependencies = [
    "next",
    "react",
    "react-dom",
    "typescript",
    "@types/react",
    "@types/node",
  ].map(version);
  const install = [
    "install",
    "--no-audit",
    "--no-fund",
    "--prefer-offline",
    `./${packed.filename}`,
  ];
  // Windows runs npm.cmd only through a shell.
  const shell = process.platform === "win32";
  if ((await run(npm, [...install, ...dependencies], { cwd: app, env, shell })) !== 0)
    await stop(1);
  mkdirSync(join(app, "app/api/feedback"), { recursive: true });
  writeFileSync(join(app, "app/layout.tsx"), readmeBlock("tsx"));
  writeFileSync(
    join(app, "app/page.tsx"),
    "export default function Page() {\n  return <h1>Pack smoke</h1>;\n}\n",
  );
  const local = readFileSync(join(repo, "docs/recipes/local.md"), "utf8");
  const routes = [...local.matchAll(/```ts\n([\s\S]*?)```/g)];
  if (routes.length !== 1) throw new Error(`local.md has ${routes.length} ts blocks, not 1`);
  writeFileSync(join(app, "app/api/feedback/route.ts"), routes[0]?.[1] ?? "");
} catch (error) {
  console.error(error);
  await stop(1);
}
const next = join(app, "node_modules/next/dist/bin/next");
// The local recipe writes to the server's working folder, so that is the app, as in a real project.
const dev = [next, "dev", "-H", "127.0.0.1", "-p", port];
await stop(await run(process.execPath, dev, { cwd: app, env }));
