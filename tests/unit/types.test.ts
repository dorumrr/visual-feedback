import { expect, it } from "vitest";
import type { FeedbackOptions } from "../../src/index";

// Type-checked by tsc -p tests: every tool docs/API.md lists is a valid value.
const options: FeedbackOptions = { tools: ["pen", "box", "arrow", "text", "select"] };

it("the tools option takes every tool the docs list", () => {
  expect(options.tools).toHaveLength(5);
});
