import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { defaultType, finish, focused, type Mounted, mount, near, read, signature } from "./widget";

/** The default `--vf-mark`, #e5243b. */
const MARK = [0xe5, 0x24, 0x3b];
/** WebP is lossy, so a stroke comes back a few units off its colour. */
const LOSSY = 20;

type Point = [number, number];
type Mark =
  | { tool: "pen"; points: Point[] }
  | { tool: "box"; x: number; y: number; width: number; height: number }
  | { tool: "arrow"; from: Point; to: Point }
  | { tool: "text"; x: number; y: number; text: string };

const trigger = (page: Page) => page.getByRole("button", { name: "Send feedback" });
const image = (page: Page) => page.locator("visual-feedback").locator("canvas.image");
const tool = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function opened(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  await page.goto("/widget/capture.html");
  // These tests are about drawing; the note rule has its own tests in send.spec.ts.
  await mount(page, { requireNote: false, ...options });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
}

/** CSS pixels of the page at fractions of the shown image's box. */
async function on(page: Page, path: number[][]): Promise<Point[]> {
  const box = await image(page).boundingBox();
  if (!box) throw new Error("no image");
  return path.map(([x = 0, y = 0]) => [box.x + box.width * x, box.y + box.height * y]);
}

async function drag(page: Page, path: number[][]): Promise<void> {
  const [first, ...rest] = await on(page, path);
  await page.mouse.move(...(first as Point));
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(...point, { steps: 6 });
  await page.mouse.up();
}

/** Pointer events of type touch, sent by the page itself, for browsers Playwright cannot touch-drag. */
async function synthetic(
  page: Page,
  path: number[][],
  end = "pointerup",
  release?: number[],
): Promise<void> {
  // The mouse's own pointer id, which the browser knows, so setPointerCapture accepts it.
  await page.evaluate(() =>
    document.addEventListener(
      "pointermove",
      (e) => Object.assign(window, { pointer: e.pointerId }),
      { once: true },
    ),
  );
  await page.mouse.move(2, 2);
  await page.mouse.move(3, 3);
  const points = await on(page, path);
  const [last] = await on(page, [release ?? path.at(-1) ?? []]);
  await page.evaluate(
    async ({ points, end, last }) => {
      const canvas = document
        .querySelector("visual-feedback")
        ?.shadowRoot?.querySelector<HTMLCanvasElement>("canvas.image");
      if (!canvas) throw new Error("no image");
      const id = (window as unknown as { pointer?: number }).pointer;
      if (typeof id !== "number") throw new Error("the mouse's pointer id was not seen");
      const fire = (type: string, [x = 0, y = 0]: number[], buttons: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            composed: true,
            cancelable: true,
            pointerId: id,
            pointerType: "touch",
            isPrimary: true,
            button: type === "pointermove" ? -1 : 0,
            buttons,
            clientX: x,
            clientY: y,
          }),
        );
      const [first, ...rest] = points;
      fire("pointerdown", first ?? [], 1);
      for (const point of rest) fire("pointermove", point, 1);
      fire(end, last ?? [], 0);
    },
    { points, end, last },
  );
}

async function send(page: Page): Promise<Mark[]> {
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await finish(page);
  return page.evaluate(
    () => (window as unknown as Mounted).reports.at(-1)?.screenshots[0]?.marks as never,
  );
}

/** RGB of the shown image at image pixels. */
function shown(page: Page, points: number[][]): Promise<number[][]> {
  return page.evaluate((points) => {
    const canvas = document
      .querySelector("visual-feedback")
      ?.shadowRoot?.querySelector<HTMLCanvasElement>("canvas.image");
    const context = canvas?.getContext("2d");
    return points.map(([x = 0, y = 0]) =>
      [...(context?.getImageData(x, y, 1, 1).data ?? [])].slice(0, 3),
    );
  }, points);
}

const middle = (mark: Mark | undefined): Point => {
  if (mark?.tool !== "pen") throw new Error(`not a pen mark: ${JSON.stringify(mark)}`);
  // Halfway along the middle segment: a stroke keeps only its corners, so this is on the line.
  const at = Math.max(1, Math.ceil(mark.points.length / 2));
  const [ax = 0, ay = 0] = mark.points[at - 1] ?? [];
  const [bx = ax, by = ay] = mark.points[at] ?? [];
  return [Math.round((ax + bx) / 2), Math.round((ay + by) / 2)];
};

// Two screen pixels in image pixels: the image is shown at about half size in the default window.
const SLACK = 4;

/** A point on the page background, away from every mark these tests draw. */
const AWAY: Point = [5, 5];

test("the shown image keeps its shape when the window's height limits it", async ({ page }) => {
  await opened(page);
  const [shown, natural, height, limit] = await image(page).evaluate(
    (canvas: HTMLCanvasElement) => [
      canvas.clientWidth / canvas.clientHeight,
      canvas.width / canvas.height,
      canvas.clientHeight,
      Math.min(
        innerHeight * 0.6,
        innerHeight - 22 * Number.parseFloat(getComputedStyle(canvas).fontSize),
      ),
    ],
  );
  // The height limit is the one that applies here.
  expect(Math.abs((height ?? 0) - (limit ?? 0))).toBeLessThan(1);
  expect(Math.abs((shown ?? 0) - (natural ?? 0))).toBeLessThan(0.02);
});

test("a pen stroke drawn by mouse is in the sent image in the mark colour, and in the marks", async ({
  page,
}) => {
  await opened(page);
  await expect(tool(page, "Draw")).toHaveAttribute("aria-pressed", "true");
  await drag(page, [
    [0.2, 0.5],
    [0.4, 0.5],
    [0.6, 0.5],
  ]);
  const marks = await send(page);
  expect(marks).toHaveLength(1);
  expect(marks[0]?.tool).toBe("pen");
  const centre = middle(marks[0]);
  const shot = await read(page, [centre, AWAY], MARK, true);
  expect(near(shot?.at[0], MARK, LOSSY), `stroke centre ${shot?.at[0]}`).toBe(true);
  expect(near(shot?.at[1], MARK, 60), `away ${shot?.at[1]}`).toBe(false);
  // The points are where the pointer went, in image pixels.
  const first = marks[0]?.tool === "pen" ? marks[0].points[0] : undefined;
  expect(Math.abs((first?.[0] ?? 0) - (shot?.width ?? 0) * 0.2)).toBeLessThan(4);
  expect(Math.abs((first?.[1] ?? 0) - (shot?.height ?? 0) * 0.5)).toBeLessThan(4);
  // Every point is in image pixels, inside the image.
  for (const [x, y] of marks[0]?.tool === "pen" ? marks[0].points : []) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(shot?.width ?? 0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(shot?.height ?? 0);
  }
  // PNG only where the canvas cannot encode WebP (SPEC §5), as WebKit on macOS.
  expect(shot?.type).toBe(await defaultType(page));
  expect(signature(shot?.magic)).toBe(shot?.type);
});

/** A CSS colour as the browser resolves it, as RGB numbers. */
function resolve(page: Page, color: string): Promise<number[]> {
  return page.evaluate((color) => {
    const probe = document.createElement("i");
    probe.style.color = color;
    document.body.append(probe);
    const value = getComputedStyle(probe).color.match(/\d+/g)?.map(Number) ?? [];
    probe.remove();
    return value.slice(0, 3);
  }, color);
}

test("the mark colour is --vf-mark from an ancestor, resolved at each open, exact in a PNG, and thick", async ({
  page,
}) => {
  await page.goto("/widget/capture.html");
  await page.addStyleTag({ content: "body { --vf-mark: hsl(230 100% 56%) }" });
  await mount(page, { requireNote: false, capture: { type: "image/png" } });
  for (const color of ["hsl(230 100% 56%)", "hsl(130 100% 25%)"]) {
    await page.addStyleTag({ content: `body { --vf-mark: ${color} }` });
    const expected = await resolve(page, color);
    await trigger(page).click();
    await expect(image(page)).toBeVisible();
    await drag(page, [
      [0.2, 0.4],
      [0.6, 0.4],
    ]);
    const marks = await send(page);
    // At least 4 image pixels thick: the rows 2 above and 1 below the centre are fully covered.
    const [x, y] = middle(marks[0]);
    const shot = await read(
      page,
      [
        [x, y],
        [x, y - 2],
        [x, y + 1],
      ],
      MARK,
      true,
    );
    expect(shot?.at, `stroke rows vs ${expected}`).toEqual([expected, expected, expected]);
  }
});

test("Box draws a rectangle outline, with an empty inside", async ({ page }) => {
  await opened(page);
  await tool(page, "Box").click();
  await expect(tool(page, "Box")).toHaveAttribute("aria-pressed", "true");
  await expect(tool(page, "Draw")).toHaveAttribute("aria-pressed", "false");
  // Drawn from the bottom right up to the top left: the box is still stored top left first.
  await drag(page, [
    [0.5, 0.6],
    [0.3, 0.3],
  ]);
  const marks = await send(page);
  expect(marks).toHaveLength(1);
  const box = marks[0];
  if (box?.tool !== "box") throw new Error(`not a box: ${JSON.stringify(box)}`);
  const sent = await read(page, [], MARK);
  const [width, height] = [sent?.width ?? 0, sent?.height ?? 0];
  expect(Math.abs(box.x - width * 0.3)).toBeLessThan(6);
  expect(Math.abs(box.y - height * 0.3)).toBeLessThan(6);
  expect(Math.abs(box.width - width * 0.2)).toBeLessThan(6);
  expect(Math.abs(box.height - height * 0.3)).toBeLessThan(6);
  const [cx, cy] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
  const sides = [
    [box.x, cy],
    [box.x + box.width, cy],
    [cx, box.y],
    [cx, box.y + box.height],
  ];
  const shot = await read(page, [[cx, cy], ...sides], MARK, true);
  expect(near(shot?.at[0], MARK, 60), `inside ${shot?.at[0]}`).toBe(false);
  for (const [i, rgb] of (shot?.at ?? []).slice(1).entries()) {
    expect(near(rgb, MARK, LOSSY), `side ${i} ${rgb}`).toBe(true);
  }
});

test("Arrow draws a line with a head at its end", async ({ page }) => {
  await opened(page);
  await tool(page, "Arrow").click();
  await drag(page, [
    [0.3, 0.7],
    [0.6, 0.7],
  ]);
  const width = await page.evaluate(
    () =>
      document
        .querySelector("visual-feedback")
        ?.shadowRoot?.querySelector<HTMLCanvasElement>("canvas.image")
        ?.getContext("2d")?.lineWidth ?? 0,
  );
  const marks = await send(page);
  expect(marks).toHaveLength(1);
  const arrow = marks[0];
  if (arrow?.tool !== "arrow") throw new Error(`not an arrow: ${JSON.stringify(arrow)}`);
  const sent = await read(page, [], MARK);
  const [w, h] = [sent?.width ?? 0, sent?.height ?? 0];
  for (const [actual, expected] of [
    [arrow.from[0], w * 0.3],
    [arrow.from[1], h * 0.7],
    [arrow.to[0], w * 0.6],
    [arrow.to[1], h * 0.7],
  ]) {
    expect(Math.abs((actual ?? 0) - (expected ?? 0))).toBeLessThan(4);
  }
  const [[x1, y1], [x2, y2]] = [arrow.from, arrow.to];
  const shaft = [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)];
  // Half way along one side of the head, which leaves the tip at 30 degrees back from the line.
  // The head probes below assume a stroke at least 4 pixels wide.
  expect(width).toBeGreaterThanOrEqual(4);
  const size = width * 4;
  const head = [Math.round(x2 - size * 0.433), Math.round(y2 + size * 0.25)];
  const below = [Math.round(x2 - size * 0.433), Math.round(y2 + size * 0.6)];
  const other = [Math.round(x2 - size * 0.433), Math.round(y2 - size * 0.25)];
  // Where a head at the start would be: there is none.
  const start = [Math.round(x1 + size * 0.433), Math.round(y1 + size * 0.25)];
  const shot = await read(page, [shaft, head, below, other, start], MARK, true);
  expect(near(shot?.at[3], MARK, LOSSY), `other side of the head ${shot?.at[3]}`).toBe(true);
  expect(near(shot?.at[4], MARK, 60), `no head at the start ${shot?.at[4]}`).toBe(false);
  expect(near(shot?.at[0], MARK, LOSSY), `shaft ${shot?.at[0]}`).toBe(true);
  expect(near(shot?.at[1], MARK, LOSSY), `head ${shot?.at[1]}`).toBe(true);
  expect(near(shot?.at[2], MARK, 60), `below the head ${shot?.at[2]}`).toBe(false);
});

test("Undo removes the last mark and Clear removes all, back to the clean capture", async ({
  page,
}) => {
  await opened(page);
  await expect(tool(page, "Undo")).toBeDisabled();
  await expect(tool(page, "Clear")).toBeDisabled();
  const [width, height] = await image(page).evaluate((canvas: HTMLCanvasElement) => [
    canvas.width,
    canvas.height,
  ]);
  // On both strokes, in the page's green corner, and in the middle.
  const samples = [
    [Math.round(width * 0.4), Math.round(height * 0.3)],
    [Math.round(width * 0.4), Math.round(height * 0.6)],
    [width - 40, height - 40],
    [Math.round(width / 2), Math.round(height / 2)],
  ];
  const before = await shown(page, samples);
  await drag(page, [
    [0.2, 0.3],
    [0.6, 0.3],
  ]);
  await expect(tool(page, "Undo")).toBeEnabled();
  await drag(page, [
    [0.2, 0.6],
    [0.6, 0.6],
  ]);
  await tool(page, "Undo").click();
  await tool(page, "Undo").click();
  await expect(tool(page, "Undo")).toBeDisabled();
  expect(await shown(page, samples)).toEqual(before);
  await drag(page, [
    [0.2, 0.3],
    [0.6, 0.3],
  ]);
  await drag(page, [
    [0.2, 0.6],
    [0.6, 0.6],
  ]);
  await tool(page, "Undo").click();
  const marks = await send(page);
  expect(marks).toHaveLength(1);
  const kept = middle(marks[0]);
  // The undone stroke ran at 60% of the image's height, at the same x.
  const undone: Point = [kept[0], Math.round(height * 0.6)];
  const shot = await read(page, [kept, undone], MARK, true);
  expect(near(shot?.at[0], MARK, LOSSY), `kept mark ${shot?.at[0]}`).toBe(true);
  expect(near(shot?.at[1], MARK, 60), `undone mark ${shot?.at[1]}`).toBe(false);

  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  // This capture's own clean pixels, not the first dialog's.
  const fresh = await shown(page, samples);
  for (const y of [0.3, 0.6]) {
    await drag(page, [
      [0.2, y],
      [0.6, y],
    ]);
  }
  expect(await shown(page, samples)).not.toEqual(fresh);
  await tool(page, "Clear").click();
  await expect(tool(page, "Clear")).toBeDisabled();
  expect(await shown(page, samples)).toEqual(fresh);
  expect(await send(page)).toEqual([]);
  expect((await read(page, [], MARK))?.counted).toBe(0);
});

test("the toolbar follows the tools option, and an empty list draws nothing", async ({ page }) => {
  await opened(page, { tools: ["arrow", "pen", "arrow", "circle"] });
  const toolbar = page.locator("visual-feedback").locator(".toolbar button");
  // Icon buttons: their names are their labels.
  expect(
    await toolbar.evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label"))),
  ).toEqual(["Arrow", "Draw", "Undo", "Clear"]);
  await expect(tool(page, "Arrow")).toHaveAttribute("aria-pressed", "true");
  await expect(tool(page, "Arrow")).toHaveAttribute("part", "tool tool-active");
  await expect(tool(page, "Draw")).toHaveAttribute("part", "tool");
  await page.addStyleTag({ content: "visual-feedback { --vf-accent: rgb(1, 2, 3) }" });
  await expect(tool(page, "Arrow")).toHaveCSS("border-top-color", "rgb(1, 2, 3)");
  await expect(tool(page, "Draw")).not.toHaveCSS("border-top-color", "rgb(1, 2, 3)");
  await drag(page, [
    [0.3, 0.5],
    [0.5, 0.5],
  ]);
  expect((await send(page)).map((mark) => mark.tool)).toEqual(["arrow"]);

  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await mount(page, { requireNote: false, tools: [] });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await expect(page.locator("visual-feedback").locator(".toolbar")).toHaveCount(0);
  // Nothing can be drawn, so the image pans and zooms by touch and shows no crosshair.
  await expect(image(page)).toHaveCSS("touch-action", "auto");
  await expect(image(page)).not.toHaveCSS("cursor", "crosshair");
  await drag(page, [
    [0.3, 0.5],
    [0.5, 0.5],
  ]);
  expect(await send(page)).toEqual([]);
});

test("a click without a drag adds no mark", async ({ page }) => {
  await opened(page);
  for (const name of ["Draw", "Box", "Arrow"]) {
    await tool(page, name).click();
    const [point] = await on(page, [[0.4, 0.4]]);
    await page.mouse.click(...(point as Point));
  }
  await expect(tool(page, "Undo")).toBeDisabled();
  expect(await send(page)).toEqual([]);
});

test("a drag that leaves the image keeps drawing, held inside the image's edges", async ({
  page,
}) => {
  await opened(page);
  await drag(page, [
    [0.5, 0.5],
    [1.3, 0.5],
  ]);
  // Down over the label and the note, still inside the window.
  await drag(page, [
    [0.5, 0.5],
    [0.5, 1.2],
  ]);
  // Drawing does not take the focus from the note.
  await expect(page.getByRole("textbox", { name: "Your note" })).toBeFocused();
  await tool(page, "Arrow").click();
  await drag(page, [
    [0.5, 0.5],
    [-0.08, -0.08],
  ]);
  const [width, height] = await image(page).evaluate((canvas: HTMLCanvasElement) => [
    canvas.width,
    canvas.height,
  ]);
  const marks = await send(page);
  const points = marks[0]?.tool === "pen" ? marks[0].points : [];
  expect(points.at(-1)?.[0]).toBe(width);
  const down = marks[1]?.tool === "pen" ? marks[1].points : [];
  expect(down.at(-1)?.[1]).toBe(height);
  const arrow = marks[2];
  expect(arrow?.tool === "arrow" && arrow.to).toEqual([0, 0]);
});

for (const end of ["pointercancel", "lostpointercapture"]) {
  test(`touch-type pointer events draw, and a stroke the browser takes away (${end}) is kept`, async ({
    page,
  }) => {
    await opened(page);
    // Only Chromium can drive a real touch drag; elsewhere this is what keeps a finger from panning.
    await expect(image(page)).toHaveCSS("touch-action", "none");
    const [width, height] = await image(page).evaluate((canvas: HTMLCanvasElement) => [
      canvas.width,
      canvas.height,
    ]);
    // On the taken stroke, half way along it.
    const on = [[Math.round((width ?? 0) * 0.3), Math.round((height ?? 0) * 0.5)]];
    const before = await shown(page, on);
    // The end event comes at the image's corner, as a cancel's own point can be anything.
    await synthetic(
      page,
      [
        [0.2, 0.5],
        [0.4, 0.5],
      ],
      end,
      [0.01, 0.01],
    );
    await expect(tool(page, "Undo")).toBeEnabled();
    expect(await shown(page, on)).not.toEqual(before);
    // What a browser sends next: the other end event, then a move with the button still held.
    await image(page).evaluate((canvas: HTMLCanvasElement, end) => {
      const pointerId = (window as unknown as { pointer: number }).pointer;
      const at = {
        bubbles: true,
        composed: true,
        pointerId,
        isPrimary: true,
        clientX: 1,
        clientY: 1,
      };
      const other = end === "pointercancel" ? "lostpointercapture" : "pointercancel";
      canvas.dispatchEvent(new PointerEvent(other, { ...at, pointerType: "touch" }));
      canvas.dispatchEvent(
        new PointerEvent("pointermove", { ...at, pointerType: "touch", buttons: 1 }),
      );
    }, end);
    const marks = await send(page);
    expect(marks.map((mark) => mark.tool)).toEqual(["pen"]);
    // It ends where the user stopped, not at the end event's point.
    const last = marks[0]?.tool === "pen" ? marks[0].points.at(-1) : undefined;
    expect(last?.[0]).toBeCloseTo((width ?? 0) * 0.4, -1);
    expect(last?.[1]).toBeCloseTo((height ?? 0) * 0.5, -1);
    const shot = await read(page, [middle(marks[0])], MARK, true);
    expect(near(shot?.at[0], MARK, LOSSY), `stroke centre ${shot?.at[0]}`).toBe(true);
  });
}

test("with unstyled, marks are still drawn in the mark colour", async ({ page }) => {
  await opened(page, { unstyled: true });
  await drag(page, [
    [0.2, 0.5],
    [0.6, 0.5],
  ]);
  const marks = await send(page);
  const shot = await read(page, [middle(marks[0])], MARK, true);
  expect(near(shot?.at[0], MARK, LOSSY), `stroke centre ${shot?.at[0]}`).toBe(true);
});

test("the annotating view passes axe, toolbar included", async ({ page }) => {
  await opened(page);
  await drag(page, [
    [0.2, 0.5],
    [0.6, 0.5],
  ]);
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target).join()}`)).toEqual([]);
  const checked = axe.passes
    .flatMap((rule) => rule.nodes)
    .map((node) => JSON.stringify(node.target))
    .filter((target) => target.startsWith('[["visual-feedback"') && /tool|undo/.test(target));
  expect(checked.length).toBeGreaterThan(0);
});

test.describe("real touch, which only Chromium can drive", () => {
  test.use({ hasTouch: true, viewport: { width: 800, height: 420 } });

  async function touch(page: Page, path: number[][]): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    const points = await on(page, path);
    const go = (type: string, at: Point[]) =>
      cdp.send("Input.dispatchTouchEvent", {
        type: type as "touchStart",
        touchPoints: at.map(([x, y]) => ({ x, y })),
      });
    const [first, ...rest] = points;
    await go("touchStart", [first as Point]);
    for (const point of rest) await go("touchMove", [point]);
    await go("touchEnd", []);
  }

  /** Opens with the dialog taller than the window, scrolled to its top. */
  async function scrollable(page: Page, css = ""): Promise<number> {
    await opened(page, { css });
    return page.evaluate(() => {
      const backdrop = document
        .querySelector("visual-feedback")
        ?.shadowRoot?.querySelector<HTMLElement>(".backdrop");
      if (!backdrop) return 0;
      backdrop.scrollTop = 0;
      return backdrop.scrollHeight - backdrop.clientHeight;
    });
  }

  const scrolled = (page: Page) =>
    page.evaluate(
      () =>
        document.querySelector("visual-feedback")?.shadowRoot?.querySelector(".backdrop")
          ?.scrollTop ?? -1,
    );

  // Finger moving up over the image: on a page that scrolls, that scrolls the dialog down.
  const UP = [
    [0.5, 0.9],
    [0.5, 0.7],
    [0.5, 0.5],
    [0.5, 0.3],
    [0.5, 0.1],
  ];

  test("a touch drag on the image draws, and does not scroll the dialog", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Playwright can touch-drag only through Chromium's CDP");
    expect(await scrollable(page)).toBeGreaterThan(20);
    await touch(page, UP);
    // A scroll lands after the touch ends, so give it frames to arrive before reading none.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await page.waitForTimeout(250);
    expect(await scrolled(page)).toBe(0);
    const marks = await send(page);
    expect(marks.map((mark) => mark.tool)).toEqual(["pen"]);
    const shot = await read(page, [middle(marks[0])], MARK, true);
    expect(near(shot?.at[0], MARK, LOSSY), `stroke centre ${shot?.at[0]}`).toBe(true);
  });

  test("control: with touch-action back to auto, the same drag scrolls the dialog", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Playwright can touch-drag only through Chromium's CDP");
    expect(
      await scrollable(page, ".toolbar + .stage > .image { touch-action: auto }"),
    ).toBeGreaterThan(20);
    await touch(page, UP);
    await expect.poll(() => scrolled(page)).toBeGreaterThan(0);
  });
});

test("Send while a stroke is still held down sends that stroke in both the image and the marks", async ({
  page,
}) => {
  await opened(page);
  const [from, to] = await on(page, [
    [0.2, 0.5],
    [0.6, 0.5],
  ]);
  await page.mouse.move(...(from as Point));
  await page.mouse.down();
  await page.mouse.move(...(to as Point), { steps: 6 });
  await page.getByRole("button", { name: "Send", exact: true }).focus();
  await page.keyboard.press("Enter");
  await finish(page);
  await page.mouse.up();
  const marks = await page.evaluate(
    () => (window as unknown as Mounted).reports.at(-1)?.screenshots[0]?.marks as Mark[],
  );
  expect(marks.map((mark) => mark.tool)).toEqual(["pen"]);
  const shot = await read(page, [middle(marks[0])], MARK, true);
  expect(near(shot?.at[0], MARK, LOSSY), `stroke centre ${shot?.at[0]}`).toBe(true);
});

test("the release point ends the mark, even past the last move", async ({ page }) => {
  await opened(page);
  await tool(page, "Arrow").click();
  await synthetic(
    page,
    [
      [0.3, 0.5],
      [0.4, 0.5],
    ],
    "pointerup",
    [0.6, 0.5],
  );
  const width = await image(page).evaluate((canvas: HTMLCanvasElement) => canvas.width);
  const marks = await send(page);
  const arrow = marks[0];
  if (arrow?.tool !== "arrow") throw new Error(`not an arrow: ${JSON.stringify(arrow)}`);
  expect(Math.abs(arrow.to[0] - width * 0.6)).toBeLessThan(4);
});

test("a flat box is kept as the line it shows", async ({ page }) => {
  await opened(page);
  await tool(page, "Box").click();
  await synthetic(page, [
    [0.3, 0.5],
    [0.6, 0.5],
  ]);
  const marks = await send(page);
  const box = marks[0];
  if (box?.tool !== "box") throw new Error(`not a box: ${JSON.stringify(box)}`);
  expect(box.height).toBe(0);
  const shot = await read(page, [[Math.round(box.x + box.width / 2), box.y]], MARK, true);
  expect(near(shot?.at[0], MARK, LOSSY), `line ${shot?.at[0]}`).toBe(true);
});

test("with marks, Tab reaches Undo and Clear, and disabling them keeps the focus in the dialog", async ({
  page,
}) => {
  await opened(page);
  await drag(page, [
    [0.2, 0.5],
    [0.6, 0.5],
  ]);
  await page.getByRole("textbox", { name: "Your note" }).focus();
  const seen: string[] = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    seen.push(await focused(page));
  }
  expect(seen).toEqual([
    "send",
    "send-more",
    "minimise",
    "cancel",
    "tool",
    "tool",
    "tool",
    "tool",
    "tool",
    "undo",
    "clear",
    "thumb-pick",
    "add",
    "note",
  ]);
  for (const name of ["Undo", "Clear"]) {
    if (name === "Clear") {
      await drag(page, [
        [0.2, 0.5],
        [0.6, 0.5],
      ]);
    }
    await tool(page, name).focus();
    await page.keyboard.press("Enter");
    await expect(tool(page, name)).toBeDisabled();
    await expect(tool(page, "Draw")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(tool(page, "Box")).toBeFocused();
  }
});

test("a move with no button pressed ends a stroke whose release was lost", async ({ page }) => {
  await opened(page);
  // Down and a move, then no pointerup: the next move arrives with no button held.
  await synthetic(
    page,
    [
      [0.2, 0.5],
      [0.4, 0.5],
    ],
    "pointermove",
    [0.2, 0.5],
  );
  await expect(tool(page, "Undo")).toBeEnabled();
  // A new drag draws a second, separate mark.
  await drag(page, [
    [0.2, 0.7],
    [0.4, 0.7],
  ]);
  const marks = await send(page);
  expect(marks).toHaveLength(2);
  const first = marks[0]?.tool === "pen" ? marks[0].points : [];
  expect(Math.max(...first.map(([x]) => x))).toBe(first.at(-1)?.[0]);
});

test("Undo and Clear look disabled while there are no marks", async ({ page }) => {
  await opened(page);
  for (const name of ["Undo", "Clear"]) await expect(tool(page, name)).toHaveCSS("opacity", "0.35");
  await drag(page, [
    [0.2, 0.5],
    [0.4, 0.5],
  ]);
  for (const name of ["Undo", "Clear"]) await expect(tool(page, name)).toHaveCSS("opacity", "1");
});

const label = (page: Page) => page.getByRole("textbox", { name: "Text", exact: true });

/**
 * Pixels of the mark colour and of white in a box of image pixels, on the shown canvas or, with
 * `sent`, on the last report's image.
 */
function colours(
  page: Page,
  box: [number, number, number, number],
  sent = false,
  extra: number[] = [-99, -99, -99],
): Promise<{ mark: number; white: number; extra: number }> {
  return page.evaluate(
    async ({ box: [x, y, width, height], sent, MARK, extra }) => {
      let canvas = document
        .querySelector("visual-feedback")
        ?.shadowRoot?.querySelector<HTMLCanvasElement>("canvas.image");
      if (sent) {
        const image = (window as unknown as Mounted).reports.at(-1)?.screenshots[0]?.image;
        const bitmap = image && (await createImageBitmap(image));
        canvas = document.createElement("canvas");
        canvas.width = bitmap?.width ?? 0;
        canvas.height = bitmap?.height ?? 0;
        if (bitmap) canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      }
      const data = canvas?.getContext("2d")?.getImageData(x, y, width, height).data ?? [];
      const near = (i: number, rgb: number[]) =>
        [0, 1, 2].every((c) => Math.abs((data[i + c] ?? 0) - (rgb[c] ?? 0)) <= 8);
      let mark = 0;
      let white = 0;
      let other = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (near(i, MARK)) mark++;
        if (near(i, [255, 255, 255])) white++;
        if (near(i, extra)) other++;
      }
      return { mark, white, extra: other };
    },
    { box, sent, MARK, extra },
  );
}

test("the Text tool places a label where it is clicked: Enter keeps it, in the image and the marks", async ({
  page,
}) => {
  await opened(page, { capture: { type: "image/png" } });
  const [width = 0, height = 0] = await image(page).evaluate((canvas: HTMLCanvasElement) => [
    canvas.width,
    canvas.height,
  ]);
  await tool(page, "Text").click();
  await expect(tool(page, "Text")).toHaveAttribute("aria-pressed", "true");
  const [at] = await on(page, [[0.3, 0.4]]);
  await page.mouse.click(...(at as Point));
  await expect(label(page)).toBeFocused();
  await label(page).fill("Broken");
  await label(page).press("Enter");
  await expect(label(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(tool(page, "Undo")).toBeEnabled();
  const marks = await send(page);
  expect(marks).toHaveLength(1);
  const mark = marks[0];
  expect(mark?.tool === "text" && mark.text).toBe("Broken");
  expect(mark?.tool === "text" && Math.abs(mark.x - width * 0.3)).toBeLessThan(SLACK);
  expect(mark?.tool === "text" && Math.abs(mark.y - height * 0.4)).toBeLessThan(SLACK);
  // The letters are painted in the mark colour with a white outline, right of where it was placed.
  const x = mark?.tool === "text" ? mark.x : 0;
  const y = mark?.tool === "text" ? mark.y : 0;
  const size = Math.max(16, Math.round(width / 60));
  const painted = await colours(page, [x, Math.round(y - size), size * 6, size * 2], true);
  expect(painted.mark).toBeGreaterThan(20);
  expect(painted.white).toBeGreaterThan(20);
  // Nowhere else: the whole image holds no more of the colour than the label's box.
  const shot = await read(page, [], MARK);
  expect(shot?.counted).toBe(painted.mark);
});

test("Escape drops only the label, an empty one is not kept, and clicking away keeps one", async ({
  page,
}) => {
  await opened(page, { capture: { type: "image/png" } });
  await tool(page, "Text").click();
  const [a, b, c] = await on(page, [
    [0.2, 0.3],
    [0.5, 0.5],
    [0.6, 0.6],
  ]);
  await page.mouse.click(...(a as Point));
  await label(page).fill("gone");
  await label(page).press("Escape");
  await expect(label(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.mouse.click(...(b as Point));
  await label(page).press("Enter");
  await expect(label(page)).toHaveCount(0);
  await expect(tool(page, "Undo")).toBeDisabled();
  // Neither the dropped nor the empty label is painted.
  const [width = 0, height = 0] = await image(page).evaluate((canvas: HTMLCanvasElement) => [
    canvas.width,
    canvas.height,
  ]);
  expect((await colours(page, [0, 0, width, height])).mark).toBe(0);
  await page.mouse.click(...(c as Point));
  await label(page).fill("kept");
  await page.getByRole("textbox", { name: "Your note" }).click();
  await expect(label(page)).toHaveCount(0);
  await expect(tool(page, "Undo")).toBeEnabled();
  const marks = await send(page);
  expect(marks.map((mark) => mark.tool === "text" && mark.text)).toEqual(["kept"]);
});

test("Send with a label still being typed keeps it, and the dropped one leaves no colour", async ({
  page,
}) => {
  await opened(page, { capture: { type: "image/png" } });
  await tool(page, "Text").click();
  const [at] = await on(page, [[0.4, 0.4]]);
  await page.mouse.click(...(at as Point));
  await label(page).fill("late");
  const marks = await send(page);
  expect(marks.map((mark) => mark.tool === "text" && mark.text)).toEqual(["late"]);
  // Painted into the sent image too, not only listed.
  expect((await read(page, [], MARK))?.counted).toBeGreaterThan(20);
  // Control for the colour count above: a page with no marks has none of the mark colour.
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  expect(await send(page)).toEqual([]);
  expect((await read(page, [], MARK))?.counted).toBe(0);
});

test("a second click while typing keeps the first label and starts another; Undo removes a label", async ({
  page,
}) => {
  await opened(page, { capture: { type: "image/png" } });
  const [width = 0, height = 0] = await image(page).evaluate((canvas: HTMLCanvasElement) => [
    canvas.width,
    canvas.height,
  ]);
  await tool(page, "Text").click();
  const [a, b] = await on(page, [
    [0.2, 0.3],
    [0.5, 0.6],
  ]);
  await page.mouse.click(...(a as Point));
  await label(page).fill("one");
  await page.mouse.click(...(b as Point));
  await expect(label(page)).toBeFocused();
  await expect(label(page)).toHaveValue("");
  await label(page).fill("two");
  await label(page).press("Enter");
  const whole: [number, number, number, number] = [0, 0, width, height];
  const both = (await colours(page, whole)).mark;
  expect(both).toBeGreaterThan(20);
  await tool(page, "Undo").click();
  // Undo removes the newest label, "two", and leaves "one".
  const size = Math.max(16, Math.round(width / 60));
  const box = (x: number, y: number): [number, number, number, number] => [
    Math.round(width * x),
    Math.round(height * y - size),
    size * 4,
    size * 2,
  ];
  expect((await colours(page, box(0.5, 0.6))).mark).toBe(0);
  expect((await colours(page, box(0.2, 0.3))).mark).toBeGreaterThan(10);
  expect((await colours(page, whole)).mark).toBeLessThan(both);
  await tool(page, "Clear").click();
  expect((await colours(page, whole)).mark).toBe(0);
  await expect(tool(page, "Undo")).toBeDisabled();
  await page.mouse.click(...(a as Point));
  await label(page).fill("one");
  await page.mouse.click(...(b as Point));
  await label(page).fill("two");
  await label(page).press("Enter");
  const marks = await send(page);
  expect(marks.map((mark) => mark.tool === "text" && mark.text)).toEqual(["one", "two"]);
});

test("Enter that confirms an IME composition does not end the label", async ({ page }) => {
  await opened(page);
  await tool(page, "Text").click();
  const [at] = await on(page, [[0.3, 0.3]]);
  await page.mouse.click(...(at as Point));
  await label(page).fill("日本");
  // What Safari and others send when Enter picks a word in a Japanese, Chinese or Korean IME.
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    await label(page).evaluate(
      (input, init) =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }),
        ),
      init,
    );
    await expect(label(page)).toBeFocused();
  }
  // Control: the same synthetic Enter without composition does end the label.
  await label(page).evaluate((input) =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    ),
  );
  await expect(label(page)).toHaveCount(0);
  const marks = await send(page);
  expect(marks.map((mark) => mark.tool === "text" && mark.text)).toEqual(["日本"]);
});

test("a label placed near the right edge moves left so the whole of it is in the image", async ({
  page,
}) => {
  await opened(page, { capture: { type: "image/png" } });
  const [width = 0, height = 0] = await image(page).evaluate((canvas: HTMLCanvasElement) => [
    canvas.width,
    canvas.height,
  ]);
  await tool(page, "Text").click();
  const [at] = await on(page, [[0.97, 0.5]]);
  await page.mouse.click(...(at as Point));
  await label(page).fill("This label is much too long to fit");
  await label(page).press("Enter");
  const marks = await send(page);
  const mark = marks[0];
  const x = mark?.tool === "text" ? mark.x : width;
  expect(x).toBeLessThan(width * 0.9);
  // Its right end is inside the image: the last column holds none of the mark colour.
  const size = Math.max(16, Math.round(width / 60));
  // The outline is centred on the letters' edge, so half of it is the margin left to the edge.
  const outline = Math.floor(Math.max(3, size / 5) / 2);
  const edge = await colours(
    page,
    [width - outline, Math.round(height / 2 - size), outline, size * 2],
    true,
  );
  expect(edge.mark + edge.white).toBe(0);
  const inside = await colours(page, [x, Math.round(height / 2 - size), width - x, size * 2], true);
  expect(inside.mark).toBeGreaterThan(20);
});

test("labels placed on the top and left edges stay whole, their outline included", async ({
  page,
}) => {
  await opened(page, { capture: { type: "image/png" } });
  const [width = 0, height = 0] = await image(page).evaluate((canvas: HTMLCanvasElement) => [
    canvas.width,
    canvas.height,
  ]);
  await tool(page, "Text").click();
  // On the top edge and on the left edge, away from the rounded corners, which take no clicks.
  const [topEdge, leftEdge] = await on(page, [
    [0.5, 0.004],
    [0.004, 0.5],
  ]);
  for (const [at, text] of [
    [topEdge, "Top"],
    [leftEdge, "Left"],
  ] as const) {
    await page.mouse.click(...(at as Point));
    await label(page).fill(text);
    await label(page).press("Enter");
  }
  await send(page);
  // The first row and column of the sent image hold no part of the label, not even its outline.
  const top = await colours(page, [0, 0, width, 1], true);
  const left = await colours(page, [0, 0, 1, height], true);
  expect(top.mark + top.white).toBe(0);
  expect(left.mark + left.white).toBe(0);
  const size = Math.max(16, Math.round(width / 60));
  const near = (x: number, y: number) =>
    colours(page, [x, y, size * 6, size * 2], true).then((found) => found.mark);
  expect(await near(Math.round(width / 2), 0)).toBeGreaterThan(20);
  expect(await near(0, Math.round(height / 2 - size))).toBeGreaterThan(20);
});

const selection = (page: Page) => page.locator("visual-feedback").locator(".selection");

/** Width and height of the image in image pixels, and image pixels per CSS pixel. */
async function measure(page: Page): Promise<[number, number, number]> {
  const [width = 0, height = 0, shown = 1] = await image(page).evaluate(
    (canvas: HTMLCanvasElement) => [canvas.width, canvas.height, canvas.clientWidth],
  );
  return [width, height, width / shown];
}

test("Select picks a box by its outline, a drag moves it, and Undo puts it back", async ({
  page,
}) => {
  await opened(page, { capture: { type: "image/png" } });
  const [width, height] = await measure(page);
  await tool(page, "Box").click();
  await drag(page, [
    [0.2, 0.2],
    [0.4, 0.4],
  ]);
  await tool(page, "Select").click();
  await drag(page, [
    [0.2, 0.3],
    [0.3, 0.35],
  ]);
  await expect(selection(page)).toBeVisible();
  // The left edge, a few pixels high, at its old and new place.
  const edge = (x: number): [number, number, number, number] => [
    Math.round(width * x) - 3,
    Math.round(height * 0.3) - 3,
    6,
    6,
  ];
  expect((await colours(page, edge(0.2))).mark).toBe(0);
  expect((await colours(page, edge(0.3))).mark).toBeGreaterThan(0);
  await tool(page, "Undo").click();
  expect((await colours(page, edge(0.2))).mark).toBeGreaterThan(0);
  expect((await colours(page, edge(0.3))).mark).toBe(0);
  // Undo once more removes the box itself.
  await tool(page, "Undo").click();
  expect((await colours(page, [0, 0, width, height])).mark).toBe(0);
  await expect(tool(page, "Undo")).toBeDisabled();
});

test("Delete, Backspace and the Delete button remove the selected mark; Escape only clears the selection", async ({
  page,
}) => {
  await opened(page, { capture: { type: "image/png" } });
  const [width, height] = await measure(page);
  const whole: [number, number, number, number] = [0, 0, width, height];
  await drag(page, [
    [0.2, 0.6],
    [0.5, 0.6],
  ]);
  await tool(page, "Select").click();
  await expect(tool(page, "Delete")).toBeDisabled();
  const [middle] = await on(page, [[0.35, 0.6]]);
  await page.mouse.click(...(middle as Point));
  await expect(selection(page)).toBeVisible();
  await expect(tool(page, "Delete")).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(selection(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await colours(page, whole)).mark).toBeGreaterThan(0);
  for (const key of ["Delete", "Backspace"]) {
    await page.mouse.click(...(middle as Point));
    await page.keyboard.press(key);
    expect((await colours(page, whole)).mark, key).toBe(0);
    await tool(page, "Undo").click();
    expect((await colours(page, whole)).mark, key).toBeGreaterThan(0);
  }
  await page.mouse.click(...(middle as Point));
  await tool(page, "Delete").click();
  expect((await colours(page, whole)).mark).toBe(0);
  expect(await send(page)).toEqual([]);
});

test("arrow keys move a selected text label, Shift by ten, and the report has its new place", async ({
  page,
}) => {
  await opened(page);
  const [width, height, ratio] = await measure(page);
  await tool(page, "Text").click();
  const [at] = await on(page, [[0.3, 0.3]]);
  await page.mouse.click(...(at as Point));
  await label(page).fill("Move me");
  await label(page).press("Enter");
  await tool(page, "Select").click();
  // Inside the label, a little right of where it starts.
  await page.mouse.click((at?.[0] ?? 0) + 15, at?.[1] ?? 0);
  await expect(selection(page)).toBeVisible();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("ArrowUp");
  // Each key press is one step: Undo takes back only the last one.
  await tool(page, "Undo").click();
  const marks = await send(page);
  const mark = marks[0];
  expect(mark?.tool).toBe("text");
  if (mark?.tool !== "text") return;
  // One step is a whole number of image pixels, about one screen pixel.
  const step = Math.max(1, Math.round(ratio));
  expect(Math.abs(mark.x - (width * 0.3 + 5 * step))).toBeLessThan(SLACK);
  expect(Math.abs(mark.y - (height * 0.3 + 10 * step))).toBeLessThan(SLACK);
});

test("a mark dragged past the edge stays whole inside the image", async ({ page }) => {
  await opened(page);
  const [width, height] = await measure(page);
  await tool(page, "Box").click();
  await drag(page, [
    [0.6, 0.6],
    [0.8, 0.8],
  ]);
  await tool(page, "Select").click();
  await drag(page, [
    [0.6, 0.7],
    [0.99, 0.99],
  ]);
  const marks = await send(page);
  const box = marks[0];
  expect(box?.tool).toBe("box");
  if (box?.tool !== "box") return;
  expect(box.x).toBeGreaterThan(width * 0.65);
  // Moved, not shrunk.
  expect(Math.abs(box.width - width * 0.2)).toBeLessThan(SLACK);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
});

test("a click on empty image or a change of tool clears the selection; arrows and labels can be picked", async ({
  page,
}) => {
  await opened(page);
  await tool(page, "Arrow").click();
  await drag(page, [
    [0.2, 0.2],
    [0.5, 0.5],
  ]);
  await tool(page, "Select").click();
  const [onArrow, empty] = await on(page, [
    [0.35, 0.35],
    [0.9, 0.1],
  ]);
  await page.mouse.click(...(onArrow as Point));
  await expect(selection(page)).toBeVisible();
  await page.mouse.click(...(empty as Point));
  await expect(selection(page)).toHaveCount(0);
  await page.mouse.click(...(onArrow as Point));
  await expect(selection(page)).toBeVisible();
  await tool(page, "Draw").click();
  await expect(selection(page)).toHaveCount(0);
  // The arrow was not moved by any of this.
  const [width, height] = await measure(page);
  const marks = await send(page);
  expect(marks.map((mark) => mark.tool)).toEqual(["arrow"]);
  const arrow = marks[0];
  if (arrow?.tool !== "arrow") return;
  expect(Math.abs(arrow.from[0] - width * 0.2)).toBeLessThan(SLACK);
  expect(Math.abs(arrow.from[1] - height * 0.2)).toBeLessThan(SLACK);
  expect(Math.abs(arrow.to[0] - width * 0.5)).toBeLessThan(SLACK);
});

test("a click inside a box selects nothing, and the outline of a selected mark is not in the sent image", async ({
  page,
}) => {
  await opened(page, { capture: { type: "image/png" } });
  const [width, height] = await measure(page);
  await tool(page, "Box").click();
  await drag(page, [
    [0.2, 0.2],
    [0.6, 0.6],
  ]);
  await tool(page, "Select").click();
  const [inside, edge] = await on(page, [
    [0.4, 0.4],
    [0.2, 0.4],
  ]);
  await page.mouse.click(...(inside as Point));
  await expect(selection(page)).toHaveCount(0);
  await page.mouse.click(...(edge as Point));
  await expect(selection(page)).toBeVisible();
  const dash = await selection(page).evaluate(
    (frame) => getComputedStyle(frame).borderTopColor.match(/\d+/g)?.map(Number) ?? [0, 0, 0],
  );
  // Sent with the box still selected: the dashes are above the image, never in it.
  await send(page);
  expect((await colours(page, [0, 0, width, height], true, dash)).extra).toBe(0);
});

test("Undo of a removal puts the mark back in its place among others; a pen line can be dragged", async ({
  page,
}) => {
  await opened(page);
  const [, height] = await measure(page);
  for (const y of [0.3, 0.5, 0.7]) {
    await drag(page, [
      [0.2, y],
      [0.5, y],
    ]);
  }
  await tool(page, "Select").click();
  const [second, bottom] = await on(page, [
    [0.35, 0.5],
    [0.35, 0.7],
  ]);
  await page.mouse.click(...(second as Point));
  await page.keyboard.press("Delete");
  await tool(page, "Undo").click();
  // The bottom line is dragged 30 screen pixels further down.
  const [, , ratio] = await measure(page);
  await page.mouse.move(...(bottom as Point));
  await page.mouse.down();
  await page.mouse.move(bottom?.[0] ?? 0, (bottom?.[1] ?? 0) + 30, { steps: 4 });
  await page.mouse.up();
  const marks = await send(page);
  const ys = marks.map((mark) => (mark.tool === "pen" ? mark.points[0]?.[1] : -1) ?? -1);
  // The middle line is back in the middle of the list, the order they were drawn in.
  expect(ys).toHaveLength(3);
  expect(Math.abs((ys[0] ?? 0) - height * 0.3)).toBeLessThan(SLACK);
  expect(Math.abs((ys[1] ?? 0) - height * 0.5)).toBeLessThan(SLACK);
  expect(Math.abs((ys[2] ?? 0) - (height * 0.7 + 30 * ratio))).toBeLessThan(4);
});

test("a mark dragged past the top-left stays inside, and Backspace in the note leaves a selected mark alone", async ({
  page,
}) => {
  await opened(page);
  await tool(page, "Box").click();
  await drag(page, [
    [0.3, 0.3],
    [0.5, 0.5],
  ]);
  await tool(page, "Select").click();
  // Well past the top-left corner, outside the image.
  await drag(page, [
    [0.3, 0.4],
    [-0.1, -0.1],
  ]);
  await expect(selection(page)).toBeVisible();
  const note = page.getByRole("textbox", { name: "Your note" });
  await note.click();
  await note.pressSequentially("abc");
  await note.press("Backspace");
  await expect(note).toHaveValue("ab");
  const marks = await send(page);
  const box = marks[0];
  expect(marks).toHaveLength(1);
  if (box?.tool !== "box") return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeLessThan(10);
});

test("with tools set to Select alone there is nothing to draw, so no tool rail is shown", async ({
  page,
}) => {
  await opened(page, { tools: ["select"] });
  await expect(page.locator("visual-feedback").locator(".toolbar")).toHaveCount(0);
});

test("while sending, Shift+Tab from Send leaves it, even with the image focusable for Select", async ({
  page,
}) => {
  await opened(page);
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.hold = new Promise((done) => (w.release = done));
  });
  await tool(page, "Select").click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sending…" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  // Past the inert image and the locked tools, to the close button in the header.
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.evaluate(() => (window as unknown as Mounted).release?.());
});

test("a mark on the edge does not jump when moved, a blocked move adds no Undo step, and Escape mid-drag keeps Undo", async ({
  page,
}) => {
  await opened(page);
  const [width] = await measure(page);
  await tool(page, "Box").click();
  // Ending outside the image, so the box reaches its left edge.
  await drag(page, [
    [0.3, 0.4],
    [-0.1, 0.6],
  ]);
  await tool(page, "Select").click();
  const [onEdge] = await on(page, [[0.15, 0.4]]);
  await page.mouse.click(...(onEdge as Point));
  await expect(selection(page)).toBeVisible();
  // Left is blocked by the edge: nothing moves, and Undo has only the box to take back.
  await page.keyboard.press("ArrowLeft");
  await tool(page, "Undo").click();
  await expect(tool(page, "Undo")).toBeDisabled();
  // Drawn again; a drag interrupted by Escape is still one step Undo takes back.
  await tool(page, "Box").click();
  await drag(page, [
    [0.3, 0.4],
    [-0.1, 0.6],
  ]);
  await tool(page, "Select").click();
  await page.mouse.move(...(onEdge as Point));
  await page.mouse.down();
  await page.mouse.move((onEdge?.[0] ?? 0) + 80, onEdge?.[1] ?? 0, { steps: 4 });
  // Moved off the edge during the drag, before Escape.
  const [, height] = await measure(page);
  expect((await colours(page, [0, Math.round(height * 0.45), 3, 10])).mark).toBe(0);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toBeVisible();
  await tool(page, "Undo").click();
  const marks = await send(page);
  const box = marks[0];
  expect(marks).toHaveLength(1);
  if (box?.tool !== "box") return;
  // Back on the edge, where it was drawn, not pushed inward.
  expect(box.x).toBeLessThan(width * 0.01);
});

test("with Select listed first, the dialog still opens on the first drawing tool", async ({
  page,
}) => {
  await opened(page, { tools: ["select", "pen"] });
  await expect(tool(page, "Draw")).toHaveAttribute("aria-pressed", "true");
  await expect(tool(page, "Select")).toHaveAttribute("aria-pressed", "false");
  await expect(tool(page, "Delete")).toHaveCount(1);
  await drag(page, [
    [0.2, 0.5],
    [0.5, 0.5],
  ]);
  expect((await send(page)).map((mark) => mark.tool)).toEqual(["pen"]);
});

test("with Select, the cursor is a hand over a mark, a closed hand while dragging, and an arrow elsewhere", async ({
  page,
}) => {
  await opened(page);
  await tool(page, "Box").click();
  await drag(page, [
    [0.2, 0.2],
    [0.5, 0.5],
  ]);
  const cursor = () => image(page).evaluate((canvas) => getComputedStyle(canvas).cursor);
  await tool(page, "Select").click();
  const [edge, empty] = await on(page, [
    [0.2, 0.35],
    [0.8, 0.8],
  ]);
  await page.mouse.move(...(edge as Point));
  await expect.poll(cursor).toBe("grab");
  await page.mouse.move(...(empty as Point));
  await expect.poll(cursor).toBe("default");
  await page.mouse.move(...(edge as Point));
  await expect.poll(cursor).toBe("grab");
  await page.mouse.down();
  await page.mouse.move((edge?.[0] ?? 0) + 20, edge?.[1] ?? 0, { steps: 3 });
  await expect.poll(cursor).toBe("grabbing");
  await page.mouse.up();
  await expect.poll(cursor).toBe("grab");
  for (const name of ["Draw", "Box", "Arrow", "Text"]) {
    await tool(page, name).click();
    await expect.poll(cursor).toBe("crosshair");
  }
});

test("with Select, the cursor follows a mark that a key moves or removes under a still pointer", async ({
  page,
}) => {
  await opened(page);
  await tool(page, "Box").click();
  await drag(page, [
    [0.2, 0.2],
    [0.5, 0.5],
  ]);
  const cursor = () => image(page).evaluate((canvas) => getComputedStyle(canvas).cursor);
  await tool(page, "Select").click();
  const [edge] = await on(page, [[0.2, 0.35]]);
  await page.mouse.click(...(edge as Point));
  await expect.poll(cursor).toBe("grab");
  // Shift steps are 10 image pixels; the box leaves the still pointer.
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(cursor).toBe("default");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(cursor).toBe("grab");
  await page.keyboard.press("Delete");
  await expect.poll(cursor).toBe("default");
});

test("a slow straight stroke keeps only the points its line needs, and still draws all of it", async ({
  page,
}) => {
  await opened(page);
  const [from, to] = await on(page, [
    [0.2, 0.5],
    [0.7, 0.5],
  ]);
  await page.mouse.move(...(from as Point));
  await page.mouse.down();
  // A point for every step, as a slow hand gives.
  await page.mouse.move(...(to as Point), { steps: 300 });
  await page.mouse.up();
  // Read before Send: the dialog, and its canvas, close after it.
  const width = await image(page).evaluate((canvas: HTMLCanvasElement) => canvas.width);
  const marks = await send(page);
  const points = marks[0]?.tool === "pen" ? marks[0].points : [];
  expect(points.length).toBeGreaterThanOrEqual(2);
  expect(points.length).toBeLessThanOrEqual(4);
  // From the press at 20 % to the release at 70 %, not a shorter piece of it.
  expect(Math.abs((points[0]?.[0] ?? 0) - width * 0.2)).toBeLessThan(4);
  expect(Math.abs((points.at(-1)?.[0] ?? 0) - width * 0.7)).toBeLessThan(4);
  const [ax = 0, ay = 0] = points[0] ?? [];
  const [bx = 0, by = 0] = points.at(-1) ?? [];
  // Along the whole line, a quarter, half and three quarters in, the mark is drawn.
  const along = [0.25, 0.5, 0.75].map((t) => [ax + (bx - ax) * t, ay + (by - ay) * t]);
  const shot = await read(page, along, MARK, true);
  for (const [i, at] of (shot?.at ?? []).entries()) {
    expect(near(at, MARK, LOSSY), `point ${i} ${at}`).toBe(true);
  }
});

test("a stroke that goes out and comes back along one line keeps its whole length", async ({
  page,
}) => {
  await opened(page);
  const [from, far, back] = await on(page, [
    [0.2, 0.5],
    [0.7, 0.5],
    [0.4, 0.5],
  ]);
  await page.mouse.move(...(from as Point));
  await page.mouse.down();
  await page.mouse.move(...(far as Point), { steps: 100 });
  await page.mouse.move(...(back as Point), { steps: 100 });
  await page.mouse.up();
  // Read before Send: the dialog, and its canvas, close after it.
  const width = await image(page).evaluate((canvas: HTMLCanvasElement) => canvas.width);
  const marks = await send(page);
  const points = marks[0]?.tool === "pen" ? marks[0].points : [];
  // The turn at 70 % is kept, so the line drawn reaches it.
  const reach = Math.max(...points.map(([x]) => x));
  expect(Math.abs(reach - width * 0.7)).toBeLessThan(4);
  // It starts where the press was and ends where the release was.
  expect(Math.abs((points[0]?.[0] ?? 0) - width * 0.2)).toBeLessThan(4);
  expect(Math.abs((points.at(-1)?.[0] ?? 0) - width * 0.4)).toBeLessThan(4);
  const y = points[0]?.[1] ?? 0;
  const shot = await read(page, [[Math.round(width * 0.65), y]], MARK, true);
  expect(near(shot?.at[0], MARK, LOSSY), `at 65 % ${shot?.at[0]}`).toBe(true);
});

/** Keeps the shown image's mark-coloured pixels as `window.inked`, to compare after a change. */
const snap = (page: Page) =>
  image(page).evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    const ink = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < ink.length; i++) {
      const [r = 0, g = 0, b = 0] = [data?.[i * 4], data?.[i * 4 + 1], data?.[i * 4 + 2]];
      ink[i] =
        Math.abs(r - 0xe5) < 24 && Math.abs(g - 0x24) < 24 && Math.abs(b - 0x3b) < 24 ? 1 : 0;
    }
    (window as unknown as { inked: Uint8Array[] }).inked ??= [];
    (window as unknown as { inked: Uint8Array[] }).inked.push(ink);
  });

/**
 * Ink with no ink of the other snap within 2 pixels, both ways: drawn and then gone, or drawn
 * only after the release.
 */
const lost = (page: Page) =>
  image(page).evaluate((canvas: HTMLCanvasElement) => {
    const [first, second] = (window as unknown as { inked: Uint8Array[] }).inked;
    const h = canvas.height;
    let total = 0;
    let gone = 0;
    for (const [before, after] of [
      [first, second],
      [second, first],
    ]) {
      const w = canvas.width;
      for (let i = 0; i < (before?.length ?? 0); i++) {
        if (!before?.[i]) continue;
        total++;
        const x = i % w;
        const y = Math.floor(i / w);
        let found = false;
        for (let dy = -2; dy <= 2 && !found; dy++) {
          for (let dx = -2; dx <= 2 && !found; dx++) {
            const [nx, ny] = [x + dx, y + dy];
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && after?.[ny * w + nx]) found = true;
          }
        }
        if (!found) gone++;
      }
    }
    return { total, gone };
  });

test("a circle that closes on its start looks the same after release as while drawn", async ({
  page,
}) => {
  await opened(page);
  // A curve: a looser simplification would cut across it with chords.
  const path = await on(
    page,
    Array.from({ length: 49 }, (_, i) => [
      0.5 + 0.25 * Math.cos((i / 48) * 2 * Math.PI),
      0.5 + 0.3 * Math.sin((i / 48) * 2 * Math.PI),
    ]),
  );
  const [first, ...rest] = path;
  await page.mouse.move(...(first as Point));
  await page.mouse.down();
  for (const point of rest) await page.mouse.move(...point, { steps: 4 });
  await snap(page);
  await page.mouse.up();
  await snap(page);
  const { total, gone } = await lost(page);
  expect(total).toBeGreaterThan(1000);
  // Simplified within a pixel of the drawn line: no ink drawn while drawing is gone after.
  expect(gone).toBe(0);
  const marks = await send(page);
  const points = marks[0]?.tool === "pen" ? marks[0].points : [];
  // The curve keeps its shape, with fewer points than the 192 moves.
  expect(points.length).toBeGreaterThanOrEqual(16);
  expect(points.length).toBeLessThan(192);
  const [ax = 0, ay = 0] = points[0] ?? [];
  const [bx = 0, by = 0] = points.at(-1) ?? [];
  expect(Math.hypot(ax - bx, ay - by)).toBeLessThan(4);
});
