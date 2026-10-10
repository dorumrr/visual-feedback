import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SERVER = pathToFileURL(
  fileURLToPath(new URL("../../src/server/index.ts", import.meta.url)),
).href;

/** A recipe doc, its fenced blocks, and its code loaded as a module, so tests run what the doc shows. */
export function recipe(name: string) {
  return markdown(`docs/recipes/${name}`);
}

/** Any markdown file of the repo, by its path from the root, read the same way. */
export function markdown(path: string) {
  const doc = readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
  const folders: string[] = [];

  function block(lang: string): string {
    const found = [...doc.matchAll(new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\`\`\``, "g"))];
    if (found.length !== 1) throw new Error(`${path} has ${found.length} ${lang} blocks, not 1`);
    return found[0]?.[1] ?? "";
  }

  // The module runs from a temp folder, so each bare import is pointed at a file first.
  async function load<T>(source: string, imports: Record<string, string>): Promise<T> {
    let code = source;
    for (const [from, to] of Object.entries(imports)) {
      if (!code.includes(JSON.stringify(from))) throw new Error(`${path} does not import ${from}`);
      code = code.replaceAll(JSON.stringify(from), JSON.stringify(to));
    }
    const folder = mkdtempSync(join(tmpdir(), "vf-recipe-"));
    folders.push(folder);
    writeFileSync(join(folder, "route.ts"), code);
    return import(pathToFileURL(join(folder, "route.ts")).href);
  }

  function cleanup(): void {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  }

  return { doc, block, load, cleanup };
}
