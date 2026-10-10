import { expect, type Page } from "@playwright/test";

export type Mounted = {
  vf: {
    open(): Promise<void>;
    close(): void;
    destroy(): void;
    update(options: Record<string, unknown>): void;
    on(e: string, f: () => void): () => void;
  };
  events: string[];
  reports: { note: string; screenshots: { image: Blob; marks: unknown[] }[] }[];
  /** onSubmit waits for this, so a test can hold a send open. */
  hold?: Promise<void>;
  release?: () => void;
};

/** Loads the built package in the page and creates one widget as `window.vf`. */
export async function mount(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(async (options) => {
    const entry = "/dist/index.mjs";
    const { createFeedback } = await import(entry);
    const w = window as unknown as Mounted;
    w.events = [];
    w.reports = [];
    w.vf = createFeedback({
      onSubmit: async (report: never) => {
        w.reports.push(report);
        await w.hold;
      },
      ...options,
    });
    w.vf.on("open", () => w.events.push("open"));
    w.vf.on("close", () => w.events.push("close"));
    w.vf.on("saved", () => w.events.push("saved"));
  }, options);
}

/** Waits for the sent confirmation, then closes at once instead of waiting out its 3 s. */
export async function finish(page: Page): Promise<void> {
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

export function events(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as Mounted).events);
}

/** The focused element, followed through shadow roots, as its class or id. */
export function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active?.getAttribute("class") || active?.id || active?.tagName || "none";
  });
}

/** An init script: CSS.supports() answers false for any query naming `feature`. */
export function withoutSupport(feature: string): void {
  const supports = CSS.supports.bind(CSS) as (...args: string[]) => boolean;
  const patched = (...args: string[]) => !args.join(" ").includes(feature) && supports(...args);
  CSS.supports = patched as typeof CSS.supports;
}

export type Shot = {
  type: string;
  magic: string;
  width: number;
  height: number;
  /** RGB at each point asked for. */
  at: number[][];
  /** How many pixels in the whole image are within 8 of `count`. */
  counted: number;
};

/**
 * Reads an image of the last report back in the page, the first unless `shot` names another.
 * Points are CSS pixels of the viewport, or image pixels with `imagePixels`.
 */
export function read(
  page: Page,
  points: number[][],
  count: number[] = [0xff, 0x23, 0x57],
  imagePixels = false,
  shot = 0,
): Promise<Shot | null> {
  return page.evaluate(
    async ({ points, count, imagePixels, shot }) => {
      const image = (window as unknown as Mounted).reports.at(-1)?.screenshots[shot]?.image;
      if (!image) return null;
      const bitmap = await createImageBitmap(image);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("no 2d context");
      context.drawImage(bitmap, 0, 0);
      const ratio = imagePixels ? 1 : bitmap.width / document.documentElement.clientWidth;
      const pixel = ([x, y]: number[]) =>
        [
          ...context.getImageData(Math.floor((x ?? 0) * ratio), Math.floor((y ?? 0) * ratio), 1, 1)
            .data,
        ].slice(0, 3);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let counted = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ([0, 1, 2].every((c) => Math.abs((data[i + c] ?? 0) - (count[c] ?? 0)) <= 8)) counted++;
      }
      const head = new Uint8Array(await image.slice(0, 12).arrayBuffer());
      return {
        type: image.type,
        magic: String.fromCharCode(...head),
        width: bitmap.width,
        height: bitmap.height,
        at: points.map(pixel),
        counted,
      };
    },
    { points, count, imagePixels, shot },
  );
}

/** The image type its first bytes say, whatever type the Blob claims. */
export const signature = (magic = "") =>
  magic.startsWith("RIFF") && magic.slice(8, 12) === "WEBP"
    ? "image/webp"
    : magic.startsWith("\x89PNG\r\n\x1a\n")
      ? "image/png"
      : "unknown";

export const near = (actual: number[] | undefined, expected: number[], tolerance = 8) =>
  expected.every((value, i) => Math.abs((actual?.[i] ?? -999) - value) <= tolerance);

/** Serves the capture library through a wrapper that fails while window.failCapture is set:
 * at the call, or with "late" when the image is drawn; it waits for window.holdCapture first. */
export async function failable(page: Page) {
  await page.route("**/vendor/snapdom.mjs", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `import * as real from "/vendor/snapdom.mjs?real";
export const snapdom = async (...args) => {
  window.calls = (window.calls ?? 0) + 1;
  await window.holdCapture;
  if (window.failCapture === "late") {
    return Promise.resolve({ toCanvas: () => Promise.reject(new Error("forced late")) });
  }
  if (window.failCapture) return Promise.reject(new Error("forced"));
  return real.snapdom(...args);
};`,
    }),
  );
  await page.evaluate(() => {
    (window as unknown as { failCapture: boolean }).failCapture = true;
  });
}

/** The type the widget sends by default: WebP where this browser's canvas encodes it, else PNG. */
export function defaultType(page: Page): Promise<string> {
  return page.evaluate(() =>
    document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp")
      ? "image/webp"
      : "image/png",
  );
}
