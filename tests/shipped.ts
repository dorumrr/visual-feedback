import { readdirSync } from "node:fs";

/** What ships to npm outside dist/: the files a packed or installed copy must hold. */
export function shipped(): string[] {
  const recipes = readdirSync(new URL("../docs/recipes/", import.meta.url)).map(
    (name) => `docs/recipes/${name}`,
  );
  return [
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "AGENTS.md",
    "package.json",
    "docs/API.md",
    "docs/SPEC.md",
    "docs/THEMING.md",
    ...recipes,
  ].sort();
}
