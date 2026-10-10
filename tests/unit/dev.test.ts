import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../..", import.meta.url));
let copy = "";
let source = "";
let original = "";
let dev: ChildProcess | undefined;

beforeAll(() => {
  // A copy of the project, so the test never edits the real src/ or deletes the real dist/.
  copy = mkdtempSync(join(tmpdir(), "vf-dev-"));
  for (const path of ["package.json", "tsconfig.json", "tsdown.config.ts", "src", "tests"]) {
    cpSync(join(repo, path), join(copy, path), { recursive: true });
  }
  symlinkSync(join(repo, "node_modules"), join(copy, "node_modules"), "dir");
  source = join(copy, "src", "index.ts");
  original = readFileSync(source, "utf8");
});

function listen(port: number): Promise<{ port: number; close: () => Promise<void> } | null> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(null));
    probe.listen(port, "127.0.0.1", () => {
      const address = probe.address();
      const close = () => new Promise<void>((done) => probe.close(() => done()));
      resolve(typeof address === "object" && address ? { port: address.port, close } : null);
    });
  });
}

/**
 * A free port whose next one is free too: the fixture server also listens on port + 1. Taken
 * below the ephemeral ranges (macOS 49152+, Linux 32768+), so no outgoing connection takes it.
 */
async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = await listen(20_000 + Math.floor(Math.random() * 10_000));
    if (!first) continue;
    const next = await listen(first.port + 1);
    await first.close();
    if (next) {
      await next.close();
      return first.port;
    }
  }
  throw new Error("no two free ports in a row");
}

async function served(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

let output = "";

async function waitFor(url: string, check: (body: string) => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const body = await served(url);
    if (body !== null && check(body)) return body;
    await new Promise((r) => setTimeout(r, 200));
  }
  // Name the wait and what the dev server printed, its errors included.
  throw new Error(
    `timed out waiting for ${url} (${check.name || "any body"})\n${output.slice(-1500)}`,
  );
}

afterAll(async () => {
  if (dev && dev.exitCode === null) {
    const exited = new Promise((resolve) => dev?.once("exit", resolve));
    dev.kill("SIGTERM");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
  }
  if (copy) rmSync(copy, { recursive: true, force: true });
});

it("npm run dev serves the playground and a rebuilt entry after a source change", async () => {
  const pkg = JSON.parse(readFileSync(join(copy, "package.json"), "utf8"));
  expect(pkg.scripts.dev).toBe("node tests/dev.mjs");
  const port = await freePort();
  const entry = `http://127.0.0.1:${port}/dist/index.mjs`;
  dev = spawn(process.execPath, ["tests/dev.mjs"], {
    cwd: copy,
    env: { ...process.env, DEV_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  dev.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const built = new Promise<void>((resolve, reject) => {
    dev?.on("error", reject);
    dev?.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (/Rebuilt in|Build complete/.test(output)) resolve();
    });
  });

  const page = await waitFor(`http://127.0.0.1:${port}/`, () => true);
  // It names the page it serves, so a developer opens the playground.
  expect(output).toContain(`playground: http://127.0.0.1:${port}/\n`);
  expect(page).toContain("visual-feedback playground");
  const before = await waitFor(entry, () => true);
  expect(before).not.toContain("devProbe");
  // The first build must be finished, or it would pick up the change below by itself.
  await built;
  expect(await served(entry)).toBe(before);

  writeFileSync(source, `${original}export const devProbe = 1;\n`);
  const rebuilt = (body: string) => body.includes("devProbe");
  expect(await waitFor(entry, rebuilt)).toContain("devProbe");
}, 60_000);
