import { expect } from "vitest";

/** The shell of one workflow step, by its name, as GitHub would run it. */
export function shell(workflow: string, name: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const run = lines.findIndex((line, i) => i > start && /^\s+run: \|$/.test(line));
  // The step's own block: a later step's run would be a different script.
  const next = lines.findIndex((line, i) => i > start && /^\s+- /.test(line));
  expect(run, `${name} has a run: | block`).toBeGreaterThan(-1);
  expect(next === -1 || run < next, `${name} has its own run: | block`).toBe(true);
  const depth = (line: string) => line.length - line.trimStart().length;
  const indent = depth(lines.slice(run + 1).find((line) => line.trim() !== "") ?? "");
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && depth(line) < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n").trimEnd();
}
