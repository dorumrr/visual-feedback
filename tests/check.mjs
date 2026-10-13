// npm run check: every step of check:static, then of check:browser, each run even after a failure,
// then a summary and, when something failed, a block to paste into a fix request.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Biome puts its errors first, Playwright and Vitest their failures last: the block keeps both ends.
const HEAD = 30;
const TAIL = 90;

/** The npm scripts `npm run check` runs, in order; CI runs only check:static. */
export function steps(scripts) {
  const parts = [scripts["check:static"], scripts["check:browser"]]
    .flatMap((chain) => (chain ?? "").split("&&"))
    .map((part) => part.trim())
    .filter(Boolean);
  // A part dropped without a word would make a check that ran less read as passed.
  const odd = parts.filter((part) => !/^npm run [\w:-]+$/.test(part));
  if (odd.length || parts.length === 0) {
    throw new Error(
      `check:static and check:browser must be "npm run <script>" steps joined by &&; found ${JSON.stringify(odd.length ? odd : parts)}`,
    );
  }
  return parts.map((part) => part.slice("npm run ".length));
}

// Colours and cursor moves (ESC [), and links (ESC ] 8): terminal codes start with ESC.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC is the point.
const CODES = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b\[[0-9;?]*[A-Za-z]/g;

/** The text as a terminal shows it: no codes, and of a line redrawn with \r, its last state. */
export function plain(text) {
  return text
    .replace(CODES, "")
    .split("\n")
    .map((line) => line.replace(/\r$/, "").split("\r").at(-1))
    .join("\n");
}

/** The first and last lines of a long output, with the cut said where it is. */
export function ends(lines) {
  if (lines.length <= HEAD + TAIL) return lines.join("\n");
  const cut = lines.length - HEAD - TAIL;
  return [...lines.slice(0, HEAD), `[... ${cut} lines cut ...]`, ...lines.slice(-TAIL)].join("\n");
}

export function duration(ms) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** The table printed at the end, one row per step. */
export function summary(results, total) {
  const width = Math.max(...results.map((result) => result.name.length));
  const counts = ["PASS", "FAIL", "STOP"].map(
    (state) => results.filter((result) => result.state === state).length,
  );
  const rows = results.map(
    (result) => `  ${result.state}  ${result.name.padEnd(width)}  ${duration(result.ms)}`,
  );
  const stopped = counts[2] ? `, ${counts[2]} not run (stopped)` : "";
  return [
    `npm run check: ${counts[0]} passed, ${counts[1]} failed${stopped}, in ${duration(total)}`,
    ...rows,
  ].join("\n");
}

/** What to paste into a fix request: each failed step, its command and the end of its output. */
export function report(failed, facts) {
  const parts = failed.map((result) => {
    const lines = plain(result.output).trimEnd().split("\n");
    const kept = ends(lines);
    const cut =
      lines.length > HEAD + TAIL
        ? `(first ${HEAD} and last ${TAIL} of ${lines.length} lines; all in ${result.log})\n`
        : "";
    return `## ${result.name}: npm run ${result.name}, exit ${result.code}\n${cut}\`\`\`\n${kept}\n\`\`\``;
  });
  return [
    `npm run check failed: ${failed.map((result) => result.name).join(", ")}.`,
    facts,
    "Please find the cause and fix it.",
    "",
    ...parts,
  ].join("\n");
}

function run(name, root) {
  return new Promise((resolve) => {
    const started = Date.now();
    const env = { ...process.env, ...(process.stdout.isTTY ? { FORCE_COLOR: "1" } : {}) };
    // npm is npm.cmd on Windows, which only a shell runs.
    const child = spawn("npm", ["run", name], {
      cwd: root,
      env,
      shell: process.platform === "win32",
      stdio: ["inherit", "pipe", "pipe"],
    });
    let output = "";
    // Decoded as a stream, so a character split across two chunks stays whole.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output += chunk;
    });
    // A step that cannot start is a failure, with its reason, not a crash of the run.
    child.on("error", (error) => {
      output += `${error.message}\n`;
    });
    const done = (code, signal) =>
      resolve({ name, code: code ?? signal, output, ms: Date.now() - started });
    child.on("close", done);
    // A server the step left running can hold its pipes open: the step is over once npm exits.
    child.on("exit", (code, signal) => setTimeout(() => done(code, signal), 2000).unref());
  });
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

/** Copies to the clipboard where a clipboard tool exists; says whether it did. */
function clip(text) {
  for (const [command, args] of [
    ["pbcopy", []],
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
  ]) {
    // xclip and wl-copy stay running to serve what they copied: their output is not waited on.
    const copied = spawnSync(command, args, {
      input: text,
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 2000,
    });
    if (copied.status === 0) return true;
  }
  return false;
}

async function main() {
  const root = process.cwd();
  const { scripts } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  let names;
  try {
    names = steps(scripts);
  } catch (error) {
    console.error(`npm run check: ${error.message}`);
    return 1;
  }
  const logs = join(root, "artifacts", "check");
  // An earlier run's failure, left in place, could be pasted as if it were this run's.
  try {
    rmSync(logs, { recursive: true, force: true });
  } catch (error) {
    console.error(`npm run check: cannot clear ${logs}: ${error.message}`);
  }
  let stopped = false;
  // Ctrl+C reaches the running step too; the run ends after it, with its summary. A second one
  // ends it at once.
  process.on("SIGINT", () => {
    if (stopped) process.exit(130);
    stopped = true;
  });
  const started = Date.now();
  const results = [];
  for (const [index, name] of names.entries()) {
    if (stopped) {
      results.push({ name, state: "STOP", ms: 0 });
      continue;
    }
    console.log(`\n>>> [${index + 1}/${names.length}] npm run ${name}\n`);
    const result = await run(name, root);
    const state = result.code === 0 ? "PASS" : stopped ? "STOP" : "FAIL";
    results.push({ ...result, state });
  }
  console.log(`\n${summary(results, Date.now() - started)}`);
  const failed = results.filter((result) => result.state === "FAIL");
  if (failed.length === 0 && !stopped) return 0;
  if (failed.length === 0) return 1;

  // Numbered by position: two steps never share a log.
  for (const result of failed) {
    const index = results.indexOf(result) + 1;
    result.log = join("artifacts", "check", `${index}-${result.name.replaceAll(":", "-")}.log`);
  }
  const changed = git(root, ["status", "--porcelain"]).split("\n").filter(Boolean).length;
  const facts = `On ${process.platform}, Node ${process.version}, commit ${git(root, ["rev-parse", "--short", "HEAD"]) || "unknown"}, ${changed} uncommitted file(s).`;
  const text = report(failed, facts);
  // The block is printed whatever happens to the files: it is what the run is for.
  let saved = true;
  try {
    mkdirSync(logs, { recursive: true });
    for (const result of failed) writeFileSync(join(root, result.log), plain(result.output));
    writeFileSync(join(logs, "failed.md"), `${text}\n`);
  } catch (error) {
    saved = false;
    console.error(`npm run check: cannot write ${logs}: ${error.message}`);
  }
  console.log(`\n----- copy from here -----\n${text}\n----- copy to here -----`);
  const copied = process.stdout.isTTY && clip(text);
  const where = saved
    ? "The same text is in artifacts/check/failed.md; each failed step's whole output is next to it."
    : "";
  console.log(`\n${copied ? "Copied to the clipboard. " : ""}${where}`);
  return 1;
}

// A step's leftover server can keep this process alive, so it exits by hand, but only once the
// summary and the block are out: process.exit() drops what a pipe has not taken yet.
const exit = (code) =>
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(exit, (error) => {
    console.error(`npm run check: ${error.stack ?? error}`);
    exit(1);
  });
}
