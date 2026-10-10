import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = process.env.DEV_PORT || "5173";
const tsdown = fileURLToPath(new URL("../node_modules/tsdown/dist/run.mjs", import.meta.url));
const serve = fileURLToPath(new URL("serve.mjs", import.meta.url));

const children = [
  spawn(process.execPath, [tsdown, "--watch", "src"], { stdio: "inherit" }),
  spawn(process.execPath, [serve], {
    stdio: "inherit",
    env: { ...process.env, FIXTURE_PORT: port },
  }),
];
console.log(`playground: http://127.0.0.1:${port}/playground/`);

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => stop(0));
// A parent killed with SIGKILL sends no signal; being re-parented is the only sign.
const parent = process.ppid;
setInterval(() => process.ppid !== parent && stop(1), 1_000).unref();
for (const child of children) {
  // One half without the other is broken: a dead watcher serves a stale build.
  child.on("exit", (code) => stop(code || 1));
  child.on("error", () => stop(1));
}
