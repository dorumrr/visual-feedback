import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { parseFeedbackRequest } from "../../src/server/index";
import { checkReport } from "../../src/shared/report";
import { confirmed } from "./widget";

type Setup = {
  submit?: "ok" | "hold" | "throw-once" | "throw-empty" | "throw-string" | "throw-timeout" | "none";
  endpoint?: string;
  headers?: "object" | "function";
  categories?: boolean;
  requireNote?: boolean;
  redactUrl?: boolean;
  context?: "value" | "async" | "throw" | "array" | "slow";
  /** Event handlers that throw, as a host's buggy listener would. */
  throwIn?: ("submit" | "sent" | "error")[];
};

type Page2 = {
  vf: { open(): Promise<void>; close(): void; destroy(): void };
  log: string[];
  times: Record<string, number>;
  contextCalls: number;
  payloads: unknown[];
  reports: {
    id: string;
    note: string;
    category?: string;
    screenshots: { image: Blob; marks: unknown[] }[];
  }[];
  release?: () => void;
};

const dialog = (page: Page) => page.getByRole("dialog", { name: "Send feedback" });
const note = (page: Page) => page.getByRole("textbox", { name: "Your note" });
const sendButton = (page: Page) => page.getByRole("button", { name: "Send", exact: true });
const image = (page: Page) => page.locator("visual-feedback").locator("canvas.image");
const log = (page: Page) => page.evaluate(() => (window as unknown as Page2).log);

/** Creates the widget in the page; functions are built there, since options cross as JSON. */
async function create(page: Page, setup: Setup = {}): Promise<void> {
  await page.evaluate(async (setup) => {
    const entry = "/dist/index.mjs";
    const { createFeedback } = await import(entry);
    const w = window as unknown as Page2;
    w.log = [];
    w.times = {};
    w.contextCalls = 0;
    w.payloads = [];
    w.reports = [];
    let failures = setup.submit === "throw-once" ? 1 : 0;
    const options: Record<string, unknown> = {};
    if (setup.submit && setup.submit !== "none") {
      options.onSubmit = async (report: Page2["reports"][number]) => {
        w.reports.push(report);
        if (setup.submit === "hold") await new Promise<void>((done) => (w.release = done));
        if (setup.submit === "throw-empty") throw new Error("");
        if (setup.submit === "throw-string") throw "Rate limited, try in a minute";
        if (setup.submit === "throw-timeout")
          throw new DOMException("Gateway slow", "TimeoutError");
        if (failures-- > 0) throw new Error("Server says no");
      };
    }
    if (setup.endpoint) options.endpoint = setup.endpoint;
    if (setup.headers === "object") options.headers = { "x-csrf": "token-1" };
    if (setup.headers === "function") options.headers = () => ({ "x-csrf": "token-2" });
    if (setup.categories) {
      options.categories = [
        { id: "bug", label: "Bug" },
        { id: "idea", label: "Idea" },
      ];
    }
    if (setup.requireNote !== undefined) options.requireNote = setup.requireNote;
    if (setup.redactUrl) options.redactUrl = true;
    if (setup.context === "value") options.context = () => ({ user: "u1" });
    if (setup.context === "async") options.context = async () => ({ user: "u2", plan: 3 });
    if (setup.context === "throw") {
      options.context = () => {
        throw new Error("No session");
      };
    }
    if (setup.context === "array") options.context = () => ["not", "an", "object"];
    if (setup.context === "slow") {
      options.context = () => {
        w.contextCalls++;
        return new Promise((done) => setTimeout(() => done({}), 400));
      };
    }
    w.vf = createFeedback(options);
    const on = (w.vf as unknown as { on(e: string, f: (x?: unknown) => void): void }).on;
    on("open", () => w.log.push("open"));
    on("close", () => w.log.push("close"));
    on("submit", (r) => w.log.push(`submit:${(r as { id: string }).id}`));
    on("sent", (r) => w.log.push(`sent:${(r as { id: string }).id}`));
    on("error", (e) => w.log.push(`error:${(e as Error).message}`));
    for (const event of ["submit", "sent", "error"]) on(event, (x) => w.payloads.push(x));
    for (const event of ["sent", "close"]) on(event, () => (w.times[event] = performance.now()));
    for (const event of setup.throwIn ?? []) {
      on(event, () => {
        throw new Error(`listener for ${event} broke`);
      });
    }
  }, setup);
}

type Received = {
  report: Awaited<ReturnType<typeof parseFeedbackRequest>>["report"];
  filename: string | undefined;
  headers: Record<string, string>;
  checked: ReturnType<typeof checkReport>;
};

/** A fresh key on the test server's fake endpoint; `fail` posts answer 500 first. */
function endpoint(fail = 0): { url: string; received(page: Page): Promise<Received[]> } {
  const key = crypto.randomUUID();
  return {
    url: `/api/feedback/${key}${fail ? `?fail=${fail}` : ""}`,
    // The server's own parser reads the bytes the browser put on the wire.
    async received(page) {
      const kept = (await (await page.request.get(`/api/feedback/${key}`)).json()) as {
        headers: Record<string, string>;
        body: string;
      }[];
      return Promise.all(
        kept.map(async ({ headers, body }) => {
          const make = () =>
            new Request("http://localhost/api/feedback", {
              method: "POST",
              headers: { "content-type": headers["content-type"] ?? "" },
              body: Buffer.from(body, "base64"),
            });
          const parsed = await parseFeedbackRequest(make());
          const form = await make().formData();
          const part = form.get("image0");
          return {
            ...parsed,
            filename: part instanceof File ? part.name : undefined,
            headers,
            checked: checkReport(JSON.parse(String(form.get("report")))),
          };
        }),
      );
    },
  };
}

async function opened(page: Page, setup: Setup, url = "/widget/capture.html"): Promise<void> {
  // A goto that only adds a hash stays in the same document, with the old widget in it.
  await page.goto("about:blank");
  await page.goto(url);
  await create(page, setup);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(note(page)).toBeFocused();
}

/** Stops the page's clock: from here its timers run only when the test moves the clock on. */
async function freeze(page: Page): Promise<void> {
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1));
}

/** Draws one pen stroke, the default tool, and returns a point in its middle. */
async function stroke(page: Page): Promise<number[]> {
  const shown = await image(page).boundingBox();
  if (!shown) throw new Error("no image");
  const [x0, y0] = [shown.x + shown.width * 0.3, shown.y + shown.height * 0.3];
  const [x1, y1] = [shown.x + shown.width * 0.6, shown.y + shown.height * 0.6];
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 5 });
  await page.mouse.up();
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** The image pixel under a CSS point of the page, so a later read survives a layout shift. */
function imagePoint(page: Page, point: number[]): Promise<number[]> {
  return page.evaluate(([x = 0, y = 0]) => {
    const canvas = document
      .querySelector("visual-feedback")
      ?.shadowRoot?.querySelector("canvas.image") as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return [
      Math.round(((x - rect.left) * canvas.width) / rect.width),
      Math.round(((y - rect.top) * canvas.height) / rect.height),
    ];
  }, point);
}

/** RGB of the shown canvas at an image pixel. */
function pixel(page: Page, [x = 0, y = 0]: number[]): Promise<number[]> {
  return page.evaluate(
    ([x = 0, y = 0]) => {
      const canvas = document
        .querySelector("visual-feedback")
        ?.shadowRoot?.querySelector("canvas.image") as HTMLCanvasElement;
      return [...(canvas.getContext("2d")?.getImageData(x, y, 1, 1).data ?? [])].slice(0, 3);
    },
    [x, y],
  );
}

for (const headers of ["object", "function"] as const) {
  test(`endpoint: the server's parser accepts what the widget sends, with headers as an ${headers}`, async ({
    page,
  }) => {
    const api = endpoint();
    await opened(page, { endpoint: api.url, headers, categories: true, context: "value" });
    await page.getByRole("combobox", { name: "Type" }).selectOption("idea");
    await stroke(page);
    await note(page).fill("The total is wrong");
    await sendButton(page).click();
    await confirmed(page);
    const received = await api.received(page);
    expect(received).toHaveLength(1);
    const [got] = received as [Received];
    expect(got.report.note).toBe("The total is wrong");
    expect(got.report.category).toBe("idea");
    expect(got.report.context).toEqual({ user: "u1" });
    const [shot] = got.report.screenshots;
    expect(got.report.screenshots).toHaveLength(1);
    expect(shot?.marks).toHaveLength(1);
    expect(shot?.page).toEqual(got.report.page);
    expect(got.checked.id).toBe(got.report.id);
    expect(shot?.image.type).toMatch(/^image\/(webp|png)$/);
    expect(got.filename).toBe(
      `${got.report.id}-0.${shot?.image.type === "image/png" ? "png" : "webp"}`,
    );
    expect(got.headers["x-csrf"]).toBe(headers === "object" ? "token-1" : "token-2");
    expect(got.report.page.url).toMatch(/\/widget\/capture\.html$/);
    expect(await log(page)).toEqual(["open", `submit:${got.report.id}`, `sent:${got.report.id}`]);
    // The confirmation closes on its own half a second after sent, timed in the page so load
    // cannot skew it.
    await expect(dialog(page)).toHaveCount(0);
    const { sent = 0, close = 0 } = await page.evaluate(() => (window as unknown as Page2).times);
    expect(close - sent).toBeGreaterThanOrEqual(450);
    expect(close - sent).toBeLessThan(1000);
    expect((await log(page)).at(-1)).toBe("close");
  });
}

test("redactUrl drops the query and the hash from page.url, and without it both are kept", async ({
  page,
}) => {
  const api = endpoint();
  for (const redactUrl of [true, false]) {
    await opened(
      page,
      { endpoint: api.url, redactUrl, requireNote: false },
      "/widget/capture.html?account=42#bills",
    );
    await sendButton(page).click();
    await confirmed(page);
  }
  const received = await api.received(page);
  const [redacted, kept] = received.map((got) => got.report.page.url);
  const [shotRedacted, shotKept] = received.map((got) => got.report.screenshots[0]?.page.url);
  expect(redacted).toMatch(/\/widget\/capture\.html$/);
  expect(shotRedacted).toBe(redacted);
  expect(kept).toMatch(/\/widget\/capture\.html\?account=42#bills$/);
  expect(shotKept).toBe(kept);
});

test("the page facts in the report are those of the screenshot, not of the moment Send is pressed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/widget/capture.html");
  await create(page, { submit: "ok", requireNote: false });
  const before = await page.evaluate(() => {
    document.body.append(Object.assign(document.createElement("div"), { style: "height:5000px" }));
    scrollTo(0, 120);
    return { url: location.href, title: document.title, y: scrollY };
  });
  expect(before.y).toBe(120);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(note(page)).toBeFocused();
  await page.evaluate(() => {
    history.pushState(null, "", "/moved-after-capture");
    document.title = "Changed after capture";
    scrollTo(0, 400);
  });
  await page.setViewportSize({ width: 700, height: 500 });
  await sendButton(page).click();
  await confirmed(page);
  type Facts = {
    page: { url: string; title: string };
    viewport: { width: number; height: number };
    scroll: { x: number; y: number };
  };
  const [report] = (await page.evaluate(
    () => (window as unknown as Page2).reports,
  )) as unknown as (Facts & { screenshots: Facts[] })[];
  for (const facts of [report, report?.screenshots[0]]) {
    expect(facts?.page).toEqual({ url: before.url, title: before.title });
    expect(facts?.viewport).toMatchObject({ width: 800, height: 600 });
    expect(facts?.scroll).toEqual({ x: 0, y: 120 });
  }
});

test("the page facts are those of the moment the page was copied, not after a slow render", async ({
  page,
}) => {
  // The copy of the page is taken, then its rendering waits, as on a slow device.
  await page.route("**/vendor/snapdom.mjs", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `import * as real from "/vendor/snapdom.mjs?real";
export const snapdom = async (...args) => {
  const result = await real.snapdom(...args);
  window.copied?.();
  return { ...result, toCanvas: async (...a) => { await window.rendered; return result.toCanvas(...a); } };
};`,
    }),
  );
  await page.goto("/widget/capture.html");
  await create(page, { submit: "ok", requireNote: false });
  const before = await page.evaluate(() => {
    const w = window as unknown as {
      rendered: Promise<void>;
      render: () => void;
      copied: () => void;
    };
    w.rendered = new Promise((done) => (w.render = done));
    // While the render waits, the page moves on.
    w.copied = () => {
      history.pushState(null, "", "/moved-while-rendering");
      document.title = "Changed while rendering";
      setTimeout(() => w.render(), 50);
    };
    return { url: location.href, title: document.title };
  });
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(note(page)).toBeFocused();
  expect(await page.title()).toBe("Changed while rendering");
  await sendButton(page).click();
  await confirmed(page);
  const [report] = (await page.evaluate(() => (window as unknown as Page2).reports)) as unknown as {
    page: { url: string; title: string };
  }[];
  expect(report?.page).toEqual(before);
});

test("a failing endpoint keeps the note and the marks, and Try again sends the same report", async ({
  page,
}) => {
  const api = endpoint(1);
  await opened(page, { endpoint: api.url });
  const mark = await imagePoint(page, await stroke(page));
  const drawn = await pixel(page, mark);
  // The default --vf-mark, #e5243b: the point is on the stroke, so "kept" can fail.
  expect(drawn).toEqual([0xe5, 0x24, 0x3b]);
  await note(page).fill("Keep me");
  await sendButton(page).click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("It didn't send. Your note is kept.");
  await expect(note(page)).toHaveValue("Keep me");
  expect(await pixel(page, mark)).toEqual(drawn);
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeFocused();
  await retry.click();
  await confirmed(page);
  const received = await api.received(page);
  expect(received).toHaveLength(2);
  const [first, second] = received as [Received, Received];
  expect(second.report.id).toBe(first.report.id);
  const [one, two] = [first, second].map((got) => got.report.screenshots[0]);
  expect(one?.marks).toHaveLength(1);
  expect(two?.marks).toEqual(one?.marks);
  const bytes = async (blob: Blob | undefined) => Buffer.from(await (blob as Blob).arrayBuffer());
  expect((await bytes(two?.image)).equals(await bytes(one?.image))).toBe(true);
  expect(second.report.note).toBe("Keep me");
  const id = first.report.id;
  expect(await log(page)).toEqual([
    "open",
    `submit:${id}`,
    "error:The endpoint answered 500.",
    `submit:${id}`,
    `sent:${id}`,
  ]);
});

test("onSubmit's error message is shown, and Try again sends the same report again", async ({
  page,
}) => {
  await opened(page, { submit: "throw-once" });
  await note(page).fill("Once more");
  await sendButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("Server says no");
  await page.getByRole("button", { name: "Try again" }).click();
  await confirmed(page);
  const ids = await page.evaluate(() => (window as unknown as Page2).reports.map((r) => r.id));
  expect(ids).toHaveLength(2);
  // Listeners get the report onSubmit got, and the Error itself.
  const payloads = await page.evaluate(() => {
    const { payloads, reports } = window as unknown as Page2;
    return [
      payloads[0] === reports[0],
      payloads[1] instanceof Error && payloads[1].message,
      payloads[2] === reports[1],
      payloads[3] === reports[1],
      payloads.length,
    ];
  });
  expect(payloads).toEqual([true, "Server says no", true, true, 4]);
  expect(ids[1]).toBe(ids[0]);
  expect(await log(page)).toEqual([
    "open",
    `submit:${ids[0]}`,
    "error:Server says no",
    `submit:${ids[0]}`,
    `sent:${ids[0]}`,
  ]);
});

test("an error with no message, or no way to send, shows the default send error", async ({
  page,
}) => {
  for (const submit of ["throw-empty", "none"] as const) {
    await opened(page, { submit });
    await note(page).fill("x");
    await sendButton(page).click();
    await expect(page.getByRole("alert")).toHaveText("It didn't send. Your note is kept.");
    expect((await log(page)).filter((entry) => entry.startsWith("error:"))).toHaveLength(1);
  }
});

test("the note is required: Send waits for it, says why on hover, and marks the note", async ({
  page,
}) => {
  await opened(page, { submit: "ok" });
  const composer = page.locator("visual-feedback .composer");
  const border = () => composer.evaluate((box) => getComputedStyle(box).borderTopColor);
  const mark = await composer.evaluate((box) => {
    const probe = document.createElement("i");
    probe.style.color = getComputedStyle(box).getPropertyValue("--_mark");
    box.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await note(page).fill("   ");
  await expect(sendButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(sendButton(page)).toHaveAttribute("title", "Describe the issue.");
  await expect(sendButton(page)).toHaveAccessibleDescription("Describe the issue.");
  expect(await border()).not.toBe(mark);
  await sendButton(page).hover();
  await expect.poll(border).toBe(mark);
  await page.mouse.move(0, 0);
  await expect.poll(border).not.toBe(mark);
  await sendButton(page).click({ force: true });
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await log(page)).toEqual(["open"]);
  await note(page).pressSequentially("ok");
  await expect(sendButton(page)).not.toHaveAttribute("aria-disabled");
  await expect(sendButton(page)).not.toHaveAttribute("title");
  await sendButton(page).hover();
  expect(await border()).not.toBe(mark);
  await note(page).fill("");
  await expect(sendButton(page)).toHaveAttribute("aria-disabled", "true");
  await note(page).fill("   ok");
  await sendButton(page).click();
  await confirmed(page);
  const notes = await page.evaluate(() => (window as unknown as Page2).reports.map((r) => r.note));
  expect(notes).toEqual(["   ok"]);
});

test("a tap on Send while it waits for a note leaves the note red until it has text", async ({
  page,
}) => {
  await opened(page, { submit: "ok" });
  const composer = page.locator("visual-feedback .composer");
  await sendButton(page).dispatchEvent("pointerenter", { pointerType: "touch" });
  await sendButton(page).dispatchEvent("pointerleave", { pointerType: "touch" });
  await expect(composer).toHaveClass(/\bwanted\b/);
  await expect(composer).toHaveCSS("border-top-color", "rgb(229, 36, 59)");
  await note(page).pressSequentially("ok");
  await expect(composer).not.toHaveClass(/\bwanted\b/);
});

test("while Send waits for a note, Esc still keeps the draft", async ({ page }) => {
  await opened(page, { submit: "ok" });
  await expect(sendButton(page)).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  await expect(note(page)).toBeHidden();
  await expect(page.getByRole("region", { name: "Feedback draft" })).toBeVisible();
});

test("with requireNote: false, an empty note is sent", async ({ page }) => {
  await opened(page, { submit: "ok", requireNote: false });
  await expect(sendButton(page)).not.toHaveAttribute("aria-disabled");
  await expect(sendButton(page)).not.toHaveAttribute("title");
  await sendButton(page).click();
  await confirmed(page);
  const notes = await page.evaluate(() => (window as unknown as Page2).reports.map((r) => r.note));
  expect(notes).toEqual([""]);
});

test("the note stops at 2000 characters", async ({ page }) => {
  await opened(page, { submit: "ok" });
  await expect(note(page)).toHaveAttribute("maxlength", "2000");
  await note(page).focus();
  await page.keyboard.insertText("a".repeat(2100));
  expect((await note(page).inputValue()).length).toBe(2000);
});

test("categories show a labelled picker and set report.category; without them there is none", async ({
  page,
}) => {
  await opened(page, { submit: "ok", categories: true });
  const picker = page.getByRole("combobox", { name: "Type" });
  await expect(picker).toHaveValue("bug");
  await picker.selectOption("idea");
  await note(page).fill("An idea");
  await sendButton(page).click();
  await confirmed(page);
  const categories = () =>
    page.evaluate(() =>
      (window as unknown as Page2).reports.map((r) => ("category" in r ? r.category : "absent")),
    );
  expect(await categories()).toEqual(["idea"]);
  await opened(page, { submit: "ok" });
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await note(page).fill("No type");
  await sendButton(page).click();
  await confirmed(page);
  expect(await categories()).toEqual(["absent"]);
});

// The hint and Send sit side by side, under the note box, inside the dialog.
async function footer(page: Page): Promise<void> {
  const root = page.locator("visual-feedback");
  type Rect = { x: number; y: number; width: number; height: number };
  const [panel, box, hint, send] = (await Promise.all(
    [
      page.getByRole("dialog"),
      root.locator(".composer"),
      root.locator(".footer .hint"),
      sendButton(page),
    ].map(async (at) => (await at.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }),
  )) as [Rect, Rect, Rect, Rect];
  for (const part of [hint, send]) {
    expect(part.width).toBeGreaterThan(0);
    expect(part.y).toBeGreaterThanOrEqual(box.y + box.height);
    expect(part.x).toBeGreaterThanOrEqual(panel.x);
    expect(part.x + part.width).toBeLessThanOrEqual(panel.x + panel.width);
    expect(part.y + part.height).toBeLessThanOrEqual(panel.y + panel.height);
  }
  expect(hint.x + hint.width).toBeLessThanOrEqual(send.x);
  expect(Math.abs(hint.y + hint.height / 2 - (send.y + send.height / 2))).toBeLessThan(4);
}

test("Send sits in a footer under the note, with the hint, and Tab goes note, category, Send", async ({
  page,
}) => {
  await opened(page, { submit: "ok", categories: true });
  const root = page.locator("visual-feedback");
  await expect(root.locator(".composer .send")).toHaveCount(0);
  await expect(root.locator(".footer .send")).toHaveCount(1);
  await expect(root.locator(".footer .hint")).toHaveText("Esc keeps it as a draft");
  await footer(page);
  await note(page).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Type" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(sendButton(page)).toBeFocused();
});

test("without categories, the footer still holds the hint and Send, and Tab goes note, Send", async ({
  page,
}) => {
  await opened(page, { submit: "ok" });
  await footer(page);
  await note(page).focus();
  await page.keyboard.press("Tab");
  await expect(sendButton(page)).toBeFocused();
});

test("in a short window the whole panel fits, a category included: nothing scrolls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await opened(page, { submit: "ok", categories: true });
  const root = page.locator("visual-feedback");
  const [top, bottom, overflow] = await root.locator(".dialog").evaluate((panel) => {
    const box = panel.getBoundingClientRect();
    const backdrop = panel.parentElement as HTMLElement;
    return [box.top, box.bottom, backdrop.scrollHeight - backdrop.clientHeight];
  });
  expect([top, bottom, overflow]).toEqual([expect.any(Number), expect.any(Number), 0]);
  expect(top).toBeGreaterThanOrEqual(16);
  expect(bottom).toBeLessThanOrEqual(420 - 16);
  await note(page).fill("short window");
  await sendButton(page).click();
  await confirmed(page);
});

test("the category picker is in the Tab order, after the note", async ({ page }) => {
  await opened(page, { submit: "ok", categories: true });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Type" })).toBeFocused();
});

for (const context of ["value", "async"] as const) {
  test(`context() ${context === "async" ? "as a promise" : "as a value"} goes into report.context`, async ({
    page,
  }) => {
    await opened(page, { submit: "ok", context });
    await note(page).fill("with context");
    await sendButton(page).click();
    await confirmed(page);
    const got = await page.evaluate(() =>
      (window as unknown as Page2).reports.map(
        (r) => (r as unknown as { context: unknown }).context,
      ),
    );
    expect(got).toEqual([context === "async" ? { user: "u2", plan: 3 } : { user: "u1" }]);
  });
}

test("a context() that throws, or gives no object, is a send error and nothing is submitted", async ({
  page,
}) => {
  for (const [context, shown] of [
    ["throw", "No session"],
    ["array", "It didn't send. Your note is kept."],
  ] as const) {
    await opened(page, { submit: "ok", context });
    await note(page).fill("x");
    await sendButton(page).click();
    await expect(page.getByRole("alert")).toHaveText(shown);
    const entries = await log(page);
    expect(entries.filter((entry) => entry.startsWith("submit:"))).toEqual([]);
    expect(entries.filter((entry) => entry.startsWith("error:"))).toHaveLength(1);
  }
});

test("while it sends, the controls are locked, drawing does nothing, and Cancel, Keep as draft and Esc wait for it", async ({
  page,
}) => {
  await opened(page, { submit: "hold", categories: true });
  await note(page).fill("hold on");
  await sendButton(page).click();
  const busy = page.getByRole("button", { name: "Sending…" });
  await expect(busy).toHaveAttribute("aria-disabled", "true");
  await expect(busy).toBeFocused();
  await expect(note(page)).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Type" })).toBeDisabled();
  for (const name of ["Draw", "Box", "Arrow", "Undo", "Clear"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  const before = await image(page).screenshot();
  await stroke(page);
  expect(Buffer.compare(await image(page).screenshot(), before)).toBe(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Keep as draft" })).toBeDisabled();
  // They look it too: dimmed, with no hand cursor.
  for (const name of ["Cancel", "Keep as draft"]) {
    await expect(page.getByRole("button", { name })).toHaveCSS("opacity", "0.35");
    await expect(page.getByRole("button", { name })).toHaveCSS("cursor", "default");
  }
  // A real press on each, not only their look.
  await page.getByRole("button", { name: "Cancel" }).click({ force: true });
  await page.getByRole("button", { name: "Keep as draft" }).click({ force: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Feedback draft" })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Page2).release?.());
  await confirmed(page);
  expect(await log(page)).toContainEqual(expect.stringMatching(/^sent:/));
});

test("closing the sent confirmation stops its timer, so it cannot close the next dialog", async ({
  page,
}) => {
  await opened(page, { submit: "ok" });
  // Held still, so the confirmation is closed by hand before its own timer runs.
  await freeze(page);
  await note(page).fill("first");
  await sendButton(page).click();
  await expect(page.getByRole("status")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await page.clock.resume();
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(note(page)).toBeFocused();
  await page.waitForTimeout(1000);
  await expect(dialog(page)).toBeVisible();
});

test("Send fills with --vf-accent and --vf-accent-text when the host sets them", async ({
  page,
}) => {
  await page.goto("/widget/capture.html");
  await page.addStyleTag({
    content: "body { --vf-accent: rgb(10, 80, 30); --vf-accent-text: rgb(250, 240, 200) }",
  });
  await create(page, { submit: "ok" });
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(sendButton(page)).toHaveCSS("background-color", "rgb(10, 80, 30)");
  await expect(sendButton(page)).toHaveCSS("color", "rgb(250, 240, 200)");
});

test("with no accent text set, Send's text contrasts at least 4.5:1 with the accent", async ({
  page,
}) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await opened(page, { submit: "ok" });
    const ratio = await sendButton(page).evaluate((button) => {
      const style = getComputedStyle(button);
      const rgb = (color: string) => {
        const pixel = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
        pixel.fillStyle = color;
        pixel.fillRect(0, 0, 1, 1);
        return [...pixel.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const lum = (color: string) => {
        const [r = 0, g = 0, b = 0] = rgb(color).map((c) =>
          c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4,
        );
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [a, b] = [lum(style.backgroundColor), lum(style.color)].sort((x, y) => y - x);
      return ((a ?? 0) + 0.05) / ((b ?? 0) + 0.05);
    });
    expect(ratio, scheme).toBeGreaterThanOrEqual(4.5);
  }
});

test("axe passes with categories, in the send error and in the sent confirmation", async ({
  page,
}) => {
  await opened(page, { endpoint: endpoint(1).url, categories: true });
  const scan = async () => {
    const result = await new AxeBuilder({ page }).include("visual-feedback").analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  };
  await scan();
  await note(page).fill("axe");
  await sendButton(page).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await scan();
  await page.getByRole("button", { name: "Try again" }).click();
  await confirmed(page);
  await scan();
});

test("a submit or sent listener that throws does not turn a delivered report into a send error", async ({
  page,
}) => {
  await opened(page, { submit: "ok", throwIn: ["submit", "sent"] });
  await note(page).fill("listeners break");
  await sendButton(page).click();
  await confirmed(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const ids = await page.evaluate(() => (window as unknown as Page2).reports.map((r) => r.id));
  expect(ids).toHaveLength(1);
  expect(await log(page)).toEqual(["open", `submit:${ids[0]}`, `sent:${ids[0]}`]);
});

test("an error listener that throws still leaves the send error and Try again", async ({
  page,
}) => {
  await opened(page, { submit: "throw-once", throwIn: ["error"] });
  await note(page).fill("x");
  await sendButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("Server says no");
  await expect(page.getByRole("button", { name: "Try again" })).toBeFocused();
  const entries = await log(page);
  expect(entries.filter((entry) => entry === "error:Server says no")).toHaveLength(1);
});

test("closing after submit does not stop the delivery: sent still fires", async ({ page }) => {
  await opened(page, { submit: "hold" });
  await note(page).fill("closing");
  await sendButton(page).click();
  await expect.poll(() => log(page)).toContainEqual(expect.stringMatching(/^submit:/));
  await page.evaluate(() => (window as unknown as Page2).vf.close());
  await expect(dialog(page)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Page2).release?.());
  await expect.poll(() => log(page)).toContainEqual(expect.stringMatching(/^sent:/));
  const entries = await log(page);
  expect(entries.indexOf("close")).toBeLessThan(entries.findIndex((e) => e.startsWith("sent:")));
});

test("closing before submit sends nothing", async ({ page }) => {
  await opened(page, { submit: "ok", context: "slow" });
  await note(page).fill("never");
  await sendButton(page).click();
  await page.evaluate(() => (window as unknown as Page2).vf.close());
  await expect(dialog(page)).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as Page2).contextCalls)).toBe(1);
  expect(await log(page)).toEqual(["open", "close"]);
  expect(await page.evaluate(() => (window as unknown as Page2).reports.length)).toBe(0);
});

test("a host that throws a string, not an Error, still has its message shown", async ({ page }) => {
  await opened(page, { submit: "throw-string" });
  await note(page).fill("x");
  await sendButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("Rate limited, try in a minute");
});

test("an endpoint that redirects, as to a login page, is a send error, not a false sent", async ({
  page,
}) => {
  const api = endpoint();
  await opened(page, { endpoint: `${api.url}?redirect=1` });
  await note(page).fill("x");
  await sendButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("It didn't send. Your note is kept.");
  expect((await log(page)).filter((entry) => entry.startsWith("sent:"))).toEqual([]);
  // The control: the server did get the post and answered with the redirect.
  expect(await api.received(page)).toHaveLength(1);
});

test("the host's css can set Send's text colour over the picked one", async ({ page }) => {
  await page.goto("/widget/capture.html");
  await page.addStyleTag({ content: "body { --vf-accent: #ffff00 }" });
  await page.evaluate(async () => {
    const entry = "/dist/index.mjs";
    const { createFeedback } = await import(entry);
    (window as unknown as Page2).vf = createFeedback({
      onSubmit: async () => {},
      css: ".send { color: rgb(1, 2, 3) }",
    });
  });
  await page.getByRole("button", { name: "Send feedback" }).click();
  // The light accent alone picks black text; the host's rule must still win.
  await expect(sendButton(page)).toHaveAttribute("data-ink", "dark");
  await expect(sendButton(page)).toHaveCSS("color", "rgb(1, 2, 3)");
});

for (const [accent, ink] of [
  ["oklch(0.95 0.1 100)", "dark"],
  ["oklch(0.3 0.1 260)", null],
] as const) {
  test(`an accent in ${accent} still gets readable text (${ink ? "black" : "white"})`, async ({
    page,
  }) => {
    await page.goto("/widget/capture.html");
    await page.addStyleTag({ content: `body { --vf-accent: ${accent} }` });
    await create(page, { submit: "ok" });
    await page.getByRole("button", { name: "Send feedback" }).click();
    if (ink) await expect(sendButton(page)).toHaveAttribute("data-ink", ink);
    else await expect(sendButton(page)).not.toHaveAttribute("data-ink");
  });
}

test("after a send error, Cancel asks first, since the note would be lost", async ({ page }) => {
  await opened(page, { submit: "throw-once" });
  await note(page).fill("Once more");
  await sendButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("Server says no");
  await page.getByRole("button", { name: "Cancel" }).click();
  const question = page.getByRole("group", { name: "Discard this feedback?" });
  await expect(question).toBeVisible();
  // The Send already ran, so the draft can no longer be folded: no Keep as draft here.
  await expect(question.getByRole("button")).toHaveText(["Discard", "Keep editing"]);
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

for (const click of [false, true]) {
  test(`the sent confirmation closes ${click ? "at once on a click" : "after half a second"}`, async ({
    page,
  }) => {
    await opened(page, { submit: "ok" });
    await freeze(page);
    await note(page).fill("thanks");
    await sendButton(page).click();
    await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
    if (click) {
      // Anywhere on the overlay, outside the panel as well.
      await page.mouse.click(4, 4);
      await expect(dialog(page)).toHaveCount(0);
      return;
    }
    await page.clock.runFor(450);
    await expect(dialog(page)).toBeVisible();
    await page.clock.runFor(100);
    await expect(dialog(page)).toHaveCount(0);
  });
}

const TIMEOUT = "It didn't send in 30 seconds. Check your internet connection, then try again.";

test("a host's own TimeoutError shows its own message, not the 30 second one", async ({ page }) => {
  await opened(page, { submit: "throw-timeout" });
  await note(page).fill("host limit");
  await sendButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("Gateway slow");
});

test("an onSubmit still pending after 30 seconds is a send error that says to check the connection", async ({
  page,
}) => {
  await opened(page, { submit: "hold" });
  await freeze(page);
  await note(page).fill("slow network");
  await sendButton(page).click();
  // The limit starts once the report is built and handed over.
  await expect.poll(() => log(page)).toContainEqual(expect.stringMatching(/^submit:/));
  await page.clock.runFor(29_000);
  await expect(page.getByRole("button", { name: "Sending…" })).toBeVisible();
  await page.clock.runFor(1_100);
  await expect(page.getByRole("alert")).toHaveText(TIMEOUT);
  await expect(page.getByRole("button", { name: "Try again" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeEnabled();
  expect(await log(page)).toContainEqual("error:The send took over 30 seconds.");
  // Try again sends the same report once more.
  await page.evaluate(() => (window as unknown as Page2).release?.());
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Page2).reports.length)).toBe(2);
  await page.evaluate(() => (window as unknown as Page2).release?.());
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  const ids = await page.evaluate(() => (window as unknown as Page2).reports.map((r) => r.id));
  expect(new Set(ids).size).toBe(1);
});

test("an endpoint request still under way after 30 seconds is aborted, with the same message", async ({
  page,
}) => {
  let aborted = false;
  // Never answered: only the widget's own limit ends the request.
  await page.route("**/api/hang", () => {});
  page.on("requestfailed", (request) => {
    if (request.url().endsWith("/api/hang")) aborted = true;
  });
  await opened(page, { endpoint: "/api/hang" });
  await freeze(page);
  await note(page).fill("no answer");
  const asked = page.waitForRequest("**/api/hang");
  await sendButton(page).click();
  await asked;
  await page.clock.runFor(30_100);
  await expect(page.getByRole("alert")).toHaveText(TIMEOUT);
  expect(await log(page)).toContainEqual("error:The send took over 30 seconds.");
  await expect.poll(() => aborted).toBe(true);
});

test("after a send error, Esc asks first too, and Discard ends the draft", async ({ page }) => {
  await opened(page, { submit: "throw-once" });
  await note(page).fill("Once more");
  await sendButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("Server says no");
  await page.keyboard.press("Escape");
  const question = page.getByRole("group", { name: "Discard this feedback?" });
  await expect(question).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  // Esc on the question takes it back; the next Esc asks again.
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await question.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
