// A temporary app folder for a script that serves it: removed on any stop, and a folder a killed
// run left behind is removed by the next run. Runs of one script are never parallel.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const repo = fileURLToPath(new URL("..", import.meta.url));

/** The README's one code block in `lang`, as written. */
export function readmeBlock(lang) {
  const readme = readFileSync(join(repo, "README.md"), "utf8");
  const blocks = [...readme.matchAll(new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\`\`\``, "g"))];
  if (blocks.length !== 1) throw new Error(`README.md has ${blocks.length} ${lang} blocks, not 1`);
  return blocks[0]?.[1] ?? "";
}

export function tempApp(prefix) {
  for (const name of readdirSync(tmpdir())) {
    if (name.startsWith(prefix)) rmSync(join(tmpdir(), name), { recursive: true, force: true });
  }
  const dir = mkdtempSync(join(tmpdir(), prefix));
  let child;
  let stopping = false;
  // The child is stopped and gone before its folder is removed, so nothing writes into it meanwhile.
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    // A child killed by a signal has a signalCode and no exitCode; its exit event already fired.
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.on("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    process.exit(code);
  };
  // Set before any step that can fail or be interrupted, so the folder never stays behind.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => stop(0));
  const run = (command, args, options = {}) =>
    new Promise((resolve) => {
      child = spawn(command, args, { stdio: "inherit", ...options });
      child.on("error", () => resolve(1));
      child.on("exit", (code) => resolve(code ?? 1));
    });
  return { dir, run, stop };
}
