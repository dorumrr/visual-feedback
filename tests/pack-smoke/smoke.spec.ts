import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { shipped } from "../shipped";

// The one app the script made; it removes any older one before it starts.
function app(): string {
  const found = readdirSync(tmpdir()).filter((name) =>
    name.startsWith("visual-feedback-pack-smoke-"),
  );
  expect(found).toHaveLength(1);
  return join(tmpdir(), found[0] ?? "");
}

test("the packed package, installed in a fresh app, stores a report in its .visual-feedback/", async ({
  page,
}) => {
  // Installed from the tarball: a copy holding exactly the shipped files, not a link to the repo.
  const installed = join(app(), "node_modules/visual-feedback");
  expect(lstatSync(installed).isSymbolicLink()).toBe(false);
  const files = readdirSync(installed, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(installed.length + 1));
  expect(files.filter((path) => !path.startsWith("dist/")).sort()).toEqual(shipped());
  expect(files).toContain("dist/react.mjs");
  for (const path of files.filter((file) => file.startsWith("dist/"))) {
    expect(path).toMatch(/^dist\/[\w-]+\.(?:mjs|d\.mts)$/);
  }

  await page.goto("/");
  await page.getByRole("button", { name: "Send feedback" }).click();
  const note = `Pack smoke ${crypto.randomUUID()}`;
  await page.getByLabel("Your note").fill(note);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  // The confirmation shows for half a second, so it is read at every frame.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("*")].some(
        (host) => host.shadowRoot?.querySelector(".status")?.textContent === "Thanks, it's sent.",
      ),
    undefined,
    { polling: "raf" },
  );

  // Each browser sends its own report into the same app: this test's is the one with its note.
  const folder = join(app(), ".visual-feedback");
  const reports = readdirSync(folder).map((id) => ({
    id,
    report: JSON.parse(readFileSync(join(folder, id, "report.json"), "utf8")),
  }));
  const mine = reports.filter(({ report }) => report.note === note);
  expect(mine).toHaveLength(1);
  const [{ id, report }] = mine as [(typeof mine)[number]];
  expect(report.id).toBe(id);
  expect(report.screenshots).toHaveLength(1);
  const [{ image: file }] = report.screenshots;
  expect(file).toMatch(/^screenshot-0\.(png|webp)$/);
  const image = readFileSync(join(folder, id, file));
  expect(image.length).toBeGreaterThan(1000);
  // A real PNG or WebP file, by its first bytes.
  const head = image.subarray(0, 12).toString("latin1");
  expect(head.startsWith("\x89PNG") || (head.startsWith("RIFF") && head.endsWith("WEBP"))).toBe(
    true,
  );
});
