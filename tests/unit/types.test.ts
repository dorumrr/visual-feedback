import { expect, it } from "vitest";
import type { FeedbackOptions, FeedbackReport, Screenshot } from "../../src/index";
import type { Screenshot as ServerScreenshot } from "../../src/server/index";

// Type-checked by tsc -p tests: every tool docs/API.md lists is a valid value.
const options: FeedbackOptions = { tools: ["pen", "box", "arrow", "text", "select"] };

it("the tools option takes every tool the docs list", () => {
  expect(options.tools).toHaveLength(5);
});

// Type-checked too: both entry points export the screenshot shape docs/API.md shows.
const shot: Screenshot = {
  image: new Blob(),
  marks: [{ tool: "text", x: 1, y: 2, text: "here" }],
  page: { url: "https://example.test/", title: "Example" },
  viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
  scroll: { x: 0, y: 0 },
};
const fromServer: ServerScreenshot = shot;
const screenshots: FeedbackReport["screenshots"] = [shot, fromServer];

it("a report's screenshots are the exported Screenshot type", () => {
  expect(screenshots).toHaveLength(2);
});
