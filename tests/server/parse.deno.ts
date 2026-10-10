import { cases } from "./cases";

// Only Deno defines this global; the declaration keeps the Node type check passing.
declare const Deno: { test(name: string, fn: () => Promise<void>): void };

// An empty list would make deno test pass with nothing run.
if (cases.length === 0) throw new Error("no server cases were registered");
for (const { name, run } of cases) Deno.test(name, run);
