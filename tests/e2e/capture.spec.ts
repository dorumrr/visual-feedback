import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  defaultType,
  events,
  failable,
  finish,
  focused,
  type Mounted,
  mount,
  near,
  read,
  signature,
} from "./widget";

const GREEN = [0x65, 0xff, 0x6b];
const PINK = [0xff, 0x23, 0x57];
const GREY = [0xcc, 0xcc, 0xcc];
const PAPER = [0xee, 0xef, 0xf1];

const trigger = (page: Page) => page.getByRole("button", { name: "Send feedback" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Send feedback" });

/** Opens the widget, sends, and reads the report's image back in the page. */
async function send(page: Page, note = "note") {
  await expect(dialog(page)).toBeVisible();
  await page.getByRole("textbox", { name: "Your note" }).fill(note);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await finish(page);
}

/** The trigger's centre and four points inside its box, in CSS pixels. */
async function triggerPoints(page: Page): Promise<number[][]> {
  const box = await trigger(page).boundingBox();
  if (!box) throw new Error("no trigger");
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  const d = box.width / 4;
  return [
    [cx, cy],
    [cx - d, cy],
    [cx + d, cy],
    [cx, cy - d],
    [cx, cy + d],
  ];
}

test.describe("on a page with a known colour under the trigger", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/widget/capture.html");
  });

  test("the image shows the page under the trigger and none of the trigger's colour", async ({
    page,
  }) => {
    await mount(page);
    const points = await triggerPoints(page);
    await trigger(page).click();
    await expect(page.locator("visual-feedback").locator("canvas.image")).toBeVisible();
    // The note view shows the same capture: green where the trigger was.
    const shown = await page.evaluate(([x = 0, y = 0]) => {
      const canvas = document
        .querySelector("visual-feedback")
        ?.shadowRoot?.querySelector<HTMLCanvasElement>("canvas.image");
      const ratio = (canvas?.width ?? 0) / document.documentElement.clientWidth;
      const data = canvas?.getContext("2d")?.getImageData(x * ratio, y * ratio, 1, 1).data;
      return data ? [...data].slice(0, 3) : [];
    }, points[0] ?? []);
    expect(near(shown, GREEN), `note view ${shown}`).toBe(true);
    await send(page, "hello");
    expect(await page.locator("visual-feedback").locator("canvas").count()).toBe(0);
    const shot = await read(page, [...points, [8, 8]]);
    expect(shot).not.toBeNull();
    for (const [i, rgb] of (shot?.at ?? []).slice(0, 5).entries()) {
      expect(near(rgb, GREEN), `point ${i}: ${rgb}`).toBe(true);
    }
    expect(near(shot?.at[5], PAPER), `page background ${shot?.at[5]}`).toBe(true);
    expect(shot?.counted).toBe(0);
    // PNG only where the canvas cannot encode WebP (SPEC §5), as WebKit on macOS.
    expect(shot?.type).toBe(await defaultType(page));
    const report = await page.evaluate(() => {
      const last = (window as unknown as Mounted).reports.at(-1) as unknown as Record<
        string,
        unknown
      >;
      return { ...last, image: undefined, id: typeof last.id, createdAt: typeof last.createdAt };
    });
    expect(report).toMatchObject({
      note: "hello",
      marks: [],
      id: "string",
      createdAt: "string",
      page: { url: `${new URL(page.url()).origin}/widget/capture.html`, title: "capture fixture" },
      scroll: { x: 0, y: 0 },
      context: {},
    });
    expect(await events(page)).toEqual(["open", "close"]);
  });

  test("a second capture shows a style changed through the CSSOM, not a cached image", async ({
    page,
  }) => {
    await mount(page);
    const points = await triggerPoints(page);
    await trigger(page).click();
    await send(page);
    await page.evaluate(() => {
      const sheet = [...document.styleSheets].find((s) => s.href?.endsWith("capture.css"));
      sheet?.insertRule(".corner{background:#60e4f9!important}", sheet.cssRules.length);
    });
    await trigger(page).click();
    await send(page);
    const shot = await read(page, points, [0x60, 0xe4, 0xf9]);
    expect(near(shot?.at[0], [0x60, 0xe4, 0xf9]), `under the trigger ${shot?.at[0]}`).toBe(true);
  });

  test("the image is the scrolled viewport, not the top of the page", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 1450));
    await mount(page);
    await trigger(page).click();
    await send(page);
    const shot = await read(page, [[100, 100]], [0x60, 0xe4, 0xf9]);
    expect(near(shot?.at[0], [0x60, 0xe4, 0xf9]), `band ${shot?.at[0]}`).toBe(true);
    const report = await page.evaluate(() => (window as unknown as Mounted).reports.at(-1));
    expect((report as unknown as { scroll: object }).scroll).toEqual({ x: 0, y: 1450 });
  });

  test("a page with no background of its own is captured on its own Canvas colour", async ({
    page,
  }) => {
    await page.addStyleTag({ content: ":root{color-scheme:dark;background:none}" });
    await mount(page);
    await trigger(page).click();
    await send(page);
    const shot = await read(page, [[8, 8]]);
    const canvas = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.backgroundColor = "Canvas";
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return (color.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    });
    expect(Math.max(...canvas)).toBeLessThan(80);
    expect(near(shot?.at[0], canvas), `page ${shot?.at[0]} against Canvas ${canvas}`).toBe(true);
  });

  test("open, close and open again before the first capture runs gives one capture", async ({
    page,
  }) => {
    await failable(page);
    await page.evaluate(() => {
      (window as unknown as { failCapture: boolean }).failCapture = false;
    });
    await mount(page);
    await page.evaluate(async () => {
      const vf = (window as unknown as Mounted).vf;
      vf.open();
      vf.close();
      await vf.open();
    });
    await expect(page.locator("visual-feedback").locator("canvas.image")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { calls: number }).calls)).toBe(1);
    expect(await events(page)).toEqual(["open"]);
  });

  test("a send still waiting when the dialog closes cannot touch the next dialog", async ({
    page,
  }) => {
    await mount(page);
    await page.evaluate(() => {
      const w = window as unknown as Mounted;
      w.hold = new Promise((resolve) => {
        w.release = resolve;
      });
    });
    await trigger(page).click();
    await page.getByRole("textbox", { name: "Your note" }).fill("first");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Mounted).reports.length))
      .toBe(1);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await trigger(page).click();
    await expect(page.locator("visual-feedback").locator("canvas.image")).toBeVisible();
    await page.evaluate(() => (window as unknown as Mounted).release?.());
    await page.waitForTimeout(200);
    await expect(dialog(page)).toBeVisible();
    await send(page, "second");
    expect(await page.evaluate(() => (window as unknown as Mounted).reports.length)).toBe(2);
  });

  test("control: with the hiding undone by css, the trigger is in the image", async ({ page }) => {
    await mount(page, { css: ".trigger{visibility:visible}" });
    const points = await triggerPoints(page);
    await trigger(page).click();
    await send(page);
    const shot = await read(page, points);
    expect(near(shot?.at[0], PINK), `centre ${shot?.at[0]}`).toBe(true);
    expect(shot?.counted).toBeGreaterThan(100);
  });

  test("the image is the viewport at the device pixel ratio, in WebP or else PNG", async ({
    page,
  }) => {
    await mount(page);
    await trigger(page).click();
    await send(page);
    const shot = await read(page, []);
    const css = await page.evaluate(() => [
      document.documentElement.clientWidth,
      document.documentElement.clientHeight,
      devicePixelRatio,
    ]);
    const [width = 0, height = 0, ratio = 0] = css;
    // WebKit's desktop device has ratio 2, which the 1920 default maxWidth caps.
    const scale = Math.min(ratio, 1920 / width);
    expect(shot?.width).toBe(Math.round(width * scale));
    expect(Math.abs((shot?.height ?? 0) - Math.round(height * scale))).toBeLessThanOrEqual(1);
    expect(["image/webp", "image/png"]).toContain(shot?.type);
    expect(signature(shot?.magic)).toBe(shot?.type);
  });

  test("capture.maxWidth scales the image down, and capture.type png gives a PNG", async ({
    page,
  }) => {
    await mount(page, { capture: { maxWidth: 400, type: "image/png" } });
    const points = await triggerPoints(page);
    await trigger(page).click();
    await send(page);
    const shot = await read(page, points);
    expect(shot?.width).toBe(400);
    const [width = 1, height = 0] = await page.evaluate(() => [
      document.documentElement.clientWidth,
      document.documentElement.clientHeight,
    ]);
    expect(Math.abs((shot?.height ?? 0) - Math.round((height * 400) / width))).toBeLessThanOrEqual(
      1,
    );
    expect(shot?.type).toBe("image/png");
    expect(signature(shot?.magic)).toBe("image/png");
    expect(near(shot?.at[0], GREEN), `centre ${shot?.at[0]}`).toBe(true);
  });

  test("capture leaves no node behind in the page, and a second capture still works", async ({
    page,
  }) => {
    await mount(page);
    const nodes = () => page.evaluate(() => document.querySelectorAll("*").length);
    const before = await nodes();
    for (let i = 0; i < 2; i++) {
      await trigger(page).click();
      await expect(page.locator("visual-feedback").locator("canvas.image")).toBeVisible();
      expect(await nodes()).toBe(before);
      await page.keyboard.press("Escape");
      expect(await nodes()).toBe(before);
      expect(await page.locator("visual-feedback").locator("canvas").count()).toBe(0);
    }
  });

  test("close() while capturing shows the trigger again and opens nothing", async ({ page }) => {
    await mount(page);
    await page.evaluate(async () => {
      const vf = (window as unknown as Mounted).vf;
      const wrapper = document.querySelector("visual-feedback")?.shadowRoot?.querySelector(".vf");
      const opening = vf.open();
      while (!wrapper?.classList.contains("capturing")) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      vf.close();
      await opening;
    });
    await expect(trigger(page)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    expect(await focused(page)).toBe("trigger");
    expect(await events(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  });

  test("the capture library loads on first open, not before", async ({ page }) => {
    const loaded: string[] = [];
    page.on("request", (request) => loaded.push(new URL(request.url()).pathname));
    await mount(page);
    expect(loaded.filter((path) => /snapdom|capture-/.test(path))).toEqual([]);
    await trigger(page).click();
    await expect(dialog(page)).toBeVisible();
    expect(loaded.filter((path) => /snapdom/.test(path)).length).toBe(1);
    expect(loaded.filter((path) => /\/dist\/capture-.+\.mjs$/.test(path)).length).toBe(1);
  });

  test("a second click on Send while it sends sends nothing more", async ({ page }) => {
    await mount(page);
    await page.evaluate(() => {
      (window as unknown as Mounted).hold = new Promise(() => {});
    });
    await trigger(page).click();
    await expect(dialog(page)).toBeVisible();
    await page.getByRole("textbox", { name: "Your note" }).fill("once");
    const button = page.getByRole("button", { name: "Send", exact: true });
    const sent = () => page.evaluate(() => (window as unknown as Mounted).reports.length);
    await button.click();
    await expect.poll(sent).toBe(1);
    // While it sends, the same button reads "Sending…", aria-disabled; a user can still click it.
    const busy = page.getByRole("button", { name: "Sending…" });
    await expect(busy).toHaveAttribute("aria-disabled", "true");
    await busy.click({ force: true });
    await page.waitForTimeout(300);
    expect(await sent()).toBe(1);
  });

  test("the page background fills the viewport where only <body> has one", async ({ page }) => {
    await page.addStyleTag({
      content: "html{background:none}body{margin:24px;background:#eeeff1}",
    });
    await mount(page);
    await trigger(page).click();
    await send(page);
    const shot = await read(page, [[4, 4]]);
    expect(near(shot?.at[0], PAPER), `outside the body ${shot?.at[0]}`).toBe(true);
  });
});

test("an image it cannot read (cross-origin, no CORS) is a grey box", async ({ page }) => {
  await page.goto("/capture/cross-origin.html");
  await page.locator("#img").evaluate((img: HTMLImageElement) => img.decode());
  await mount(page);
  const box = await page.locator("#img").boundingBox();
  if (!box) throw new Error("no image");
  await trigger(page).click();
  await send(page);
  // A quarter in, clear of the placeholder's small label.
  const shot = await read(page, [[box.x + box.width / 4, box.y + box.height / 4]]);
  expect(near(shot?.at[0], GREY), `inside the image ${shot?.at[0]}`).toBe(true);
});

test.describe("at device pixel ratio 2", () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 800, height: 600 } });
  test("the image has twice the CSS pixels", async ({ page }) => {
    await page.goto("/widget/capture.html");
    await mount(page);
    const points = await triggerPoints(page);
    await trigger(page).click();
    await send(page);
    const shot = await read(page, points);
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    expect(shot?.width).toBe(width * 2);
    expect(near(shot?.at[0], GREEN), `centre ${shot?.at[0]}`).toBe(true);
  });
});

test("a failure while the image is drawn also shows the capture error", async ({ page }) => {
  await page.goto("/widget/capture.html");
  await failable(page);
  await page.evaluate(() => {
    (window as unknown as { failCapture: string }).failCapture = "late";
  });
  await mount(page);
  await trigger(page).click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't take a screenshot.");
  await expect(trigger(page)).toBeVisible();
});

test("control: with the backdrop shown by css, Try again captures the dialog", async ({ page }) => {
  await page.goto("/widget/capture.html");
  await failable(page);
  await mount(page, { css: ".capturing .backdrop{visibility:visible}" });
  await trigger(page).click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't take a screenshot.");
  await page.evaluate(() => {
    (window as unknown as { failCapture: boolean }).failCapture = false;
  });
  await page.getByRole("button", { name: "Try again" }).click();
  await send(page);
  const shot = await read(page, [[8, 8]]);
  // The default backdrop, black at 45%, over the paper colour.
  const dimmed = PAPER.map((value) => Math.round(value * 0.55));
  expect(near(shot?.at[0], dimmed, 12), `backdrop over the page ${shot?.at[0]}`).toBe(true);
});

test.describe("when the capture fails", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/widget/capture.html");
    await failable(page);
    await mount(page);
    await trigger(page).click();
    await expect(page.getByRole("alert")).toHaveText("Couldn't take a screenshot.");
  });

  test("the capture error offers Try again, Send without screenshot and Cancel", async ({
    page,
  }) => {
    await expect(dialog(page)).toBeVisible();
    expect(await focused(page)).toBe("retry");
    for (const name of ["Try again", "Send without screenshot", "Cancel"]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
    const parts = await page.evaluate(() =>
      [...(document.querySelector("visual-feedback")?.shadowRoot?.querySelectorAll("[part]") ?? [])]
        .map((element) => element.getAttribute("part"))
        .sort(),
    );
    expect(parts).toEqual(
      [
        "actions",
        "backdrop",
        "cancel",
        "dialog",
        "error",
        "retry",
        "title",
        "trigger",
        "trigger-icon",
        "trigger-text",
        "send-without",
        "header",
        "icon",
      ].sort(),
    );
    await expect(page.getByRole("textbox", { name: "Your note" })).toHaveCount(0);
    expect(await events(page)).toEqual(["open"]);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    const checked = axe.passes
      .flatMap((rule) => rule.nodes)
      .map((node) => JSON.stringify(node.target))
      .filter((target) => target.startsWith('[["visual-feedback"') && /retry/.test(target));
    expect(checked.length).toBeGreaterThan(0);
  });

  test("Send without screenshot gives a report with image: null", async ({ page }) => {
    await page.getByRole("button", { name: "Send without screenshot" }).click();
    await expect(page.getByRole("textbox", { name: "Your note" })).toBeFocused();
    await expect(page.locator("visual-feedback").locator("canvas")).toHaveCount(0);
    await expect(page.locator("visual-feedback").locator(".toolbar")).toHaveCount(0);
    await send(page, "no picture");
    const report = await page.evaluate(() => {
      const last = (window as unknown as Mounted).reports.at(-1);
      return last && { image: last.image, note: last.note, marks: last.marks };
    });
    expect(report).toEqual({ image: null, note: "no picture", marks: [] });
  });

  test("Try again captures again, with the dialog hidden from the image", async ({ page }) => {
    await page.getByRole("button", { name: "Try again" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { calls: number }).calls))
      .toBe(2);
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText("Couldn't take a screenshot.");
    expect(await focused(page)).toBe("retry");
    await page.evaluate(() => {
      (window as unknown as { failCapture: boolean }).failCapture = false;
    });
    const points = await triggerPoints(page);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator("visual-feedback").locator("canvas.image")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Your note" })).toBeFocused();
    await send(page);
    const shot = await read(page, [...points, [8, 8]]);
    expect(near(shot?.at[0], GREEN), `under the trigger ${shot?.at[0]}`).toBe(true);
    expect(near(shot?.at[5], PAPER), `no backdrop over the page ${shot?.at[5]}`).toBe(true);
    expect(shot?.counted).toBe(0);
    expect(await events(page)).toEqual(["open", "close"]);
  });

  test("Escape and Cancel close it", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect(await focused(page)).toBe("trigger");
    expect(await events(page)).toEqual(["open", "close"]);
    await trigger(page).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await events(page)).toEqual(["open", "close", "open", "close"]);
  });
});

test.describe("display mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/widget/capture.html");
  });

  /** getDisplayMedia answers with a cyan canvas stream, and records what the page showed. */
  async function fakeDisplay(
    page: Page,
    answer: "stream" | "slow" | "refuse" | "missing" | "silent",
  ) {
    await page.evaluate((answer) => {
      const w = window as unknown as {
        display: { asked?: boolean; triggerShown?: boolean; stopped?: boolean };
        grant?: () => void;
      };
      w.display = {};
      if (answer === "missing") {
        Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: undefined });
        return;
      }
      navigator.mediaDevices.getDisplayMedia = async () => {
        w.display.asked = true;
        const button = document
          .querySelector("visual-feedback")
          ?.shadowRoot?.querySelector(".trigger");
        w.display.triggerShown = button ? getComputedStyle(button).visibility !== "hidden" : true;
        if (answer === "refuse") throw new DOMException("refused", "NotAllowedError");
        if (answer === "slow") await new Promise<void>((resolve) => (w.grant = resolve));
        // A granted stream that never gives a frame, as a canvas stream with no video track.
        if (answer === "silent") return new MediaStream();
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 600;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        const stream = canvas.captureStream();
        const paint = () => {
          context.fillStyle = "#60e4f9";
          context.fillRect(0, 0, 800, 600);
        };
        paint();
        setInterval(paint, 30);
        const [track] = stream.getVideoTracks();
        track?.addEventListener("ended", () => {});
        const stop = track?.stop.bind(track);
        if (track && stop) {
          track.stop = () => {
            w.display.stopped = true;
            stop();
          };
        }
        return stream;
      };
    }, answer);
  }

  /** Whether this browser plays a canvas stream at all; Playwright's WebKit on Linux does not. */
  function playsCanvasStream(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
      // Painted again and again, as the fake shared screen is.
      const canvas = document.createElement("canvas");
      const paint = setInterval(() => canvas.getContext("2d")?.fillRect(0, 0, 10, 10), 30);
      const video = document.createElement("video");
      video.muted = true;
      video.srcObject = canvas.captureStream();
      // Generous, so a busy machine does not turn a slow first frame into a skip.
      const timeout = new Promise((done) => setTimeout(done, 5000));
      await Promise.race([video.play().catch(() => {}), timeout]);
      clearInterval(paint);
      return video.videoWidth > 0;
    });
  }

  test("uses the shared surface, with the widget hidden and the stream stopped", async ({
    page,
    browserName,
  }) => {
    const plays = await playsCanvasStream(page);
    // Only Playwright's WebKit may lack it; elsewhere a false probe is a failure, not a skip.
    if (browserName !== "webkit") expect(plays).toBe(true);
    test.skip(!plays, "this browser gives a canvas stream no frame");
    await fakeDisplay(page, "stream");
    await mount(page, { capture: { mode: "display" } });
    await trigger(page).click();
    await send(page);
    const shot = await read(page, [[100, 100]], [0x60, 0xe4, 0xf9]);
    expect([shot?.width, shot?.height]).toEqual([800, 600]);
    expect(shot?.counted).toBe(800 * 600);
    expect(await page.evaluate(() => (window as unknown as { display: object }).display)).toEqual({
      asked: true,
      triggerShown: false,
      stopped: true,
    });
  });

  test("capture.maxWidth scales the shared surface down", async ({ page, browserName }) => {
    const plays = await playsCanvasStream(page);
    // Only Playwright's WebKit may lack it; elsewhere a false probe is a failure, not a skip.
    if (browserName !== "webkit") expect(plays).toBe(true);
    test.skip(!plays, "this browser gives a canvas stream no frame");
    await fakeDisplay(page, "stream");
    await mount(page, { capture: { mode: "display", maxWidth: 400 } });
    await trigger(page).click();
    await send(page);
    const shot = await read(page, [], [0x60, 0xe4, 0xf9]);
    expect([shot?.width, shot?.height]).toEqual([400, 300]);
  });

  test("getDisplayMedia is asked in the click, before the dialog code has loaded", async ({
    page,
  }) => {
    await fakeDisplay(page, "stream");
    await mount(page, { capture: { mode: "display" } });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waiting = 0;
    await page.route(/\/dist\/(dialog|capture)-.+\.mjs$/, async (route) => {
      waiting++;
      await held;
      await route.continue();
    });
    await trigger(page).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { display: { asked?: boolean } }).display.asked),
      )
      .toBe(true);
    expect(waiting).toBe(2);
    release();
    await send(page);
    expect(await page.evaluate(() => (window as unknown as { display: object }).display)).toEqual({
      asked: true,
      triggerShown: false,
      stopped: true,
    });
  });

  test("when the dialog code cannot load, the trigger shows again with the focus", async ({
    page,
  }) => {
    await fakeDisplay(page, "stream");
    await mount(page, { capture: { mode: "display" } });
    await page.route(/\/dist\/dialog-.+\.mjs$/, (route) => route.abort());
    const unhandled: string[] = [];
    page.on("pageerror", (error) => unhandled.push(error.message));
    await page.evaluate(() => {
      const w = window as unknown as Mounted;
      w.vf.on("error", () => w.events.push("error"));
    });
    await trigger(page).focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { display: { stopped?: boolean } }).display.stopped,
        ),
      )
      .toBe(true);
    await expect(trigger(page)).toBeVisible();
    expect(await focused(page)).toBe("trigger");
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => events(page)).toEqual(["error"]);
    // A host's own open() still rejects; the trigger's click leaves no unhandled rejection.
    const opened = await page.evaluate(() =>
      (window as unknown as Mounted).vf.open().then(
        () => "resolved",
        () => "rejected",
      ),
    );
    expect(opened).toBe("rejected");
    expect(await events(page)).toEqual(["error", "error"]);
    expect(unhandled).toEqual([]);
  });

  test("a stream granted after close() is stopped at once", async ({ page }) => {
    await fakeDisplay(page, "slow");
    await mount(page, { capture: { mode: "display" } });
    await trigger(page).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { display: { asked?: boolean } }).display.asked),
      )
      .toBe(true);
    await page.evaluate(() => (window as unknown as Mounted).vf.close());
    await page.evaluate(() => (window as unknown as { grant: () => void }).grant());
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { display: { stopped?: boolean } }).display.stopped,
        ),
      )
      .toBe(true);
    await expect(trigger(page)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
  });

  for (const answer of ["refuse", "missing", "silent"] as const) {
    const how = { refuse: "refused", missing: "missing", silent: "granted but gives no frame" };
    test(`falls back to dom when getDisplayMedia is ${how[answer]}`, async ({ page }) => {
      await fakeDisplay(page, answer);
      await mount(page, { capture: { mode: "display" } });
      const points = await triggerPoints(page);
      await trigger(page).click();
      await send(page);
      const shot = await read(page, points);
      expect(near(shot?.at[0], GREEN), `under the trigger ${shot?.at[0]}`).toBe(true);
      expect(shot?.counted).toBe(0);
    });
  }
});
