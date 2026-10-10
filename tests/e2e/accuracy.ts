import type { Page } from "@playwright/test";

// A pixel differs when any RGB channel is off by more than CHANNEL_TOLERANCE.
const CHANNEL_TOLERANCE = 32;
// A capture is accurate when at most this share of its pixels differ from the reference screenshot.
const MAX_DIFFERING_SHARE = 0.05;
// A capture is also inaccurate when this share of content pixels (not the page background) differ.
const MAX_CONTENT_DIFFERING_SHARE = 0.1;

type Snapdom = (
  element: Element,
  options: object,
) => Promise<{ toCanvas(): Promise<HTMLCanvasElement> }>;

export type Measurement =
  | { error: string }
  | {
      differingShare: number;
      contentShare: number;
      contentPixels: number;
      ms: number;
      width: number;
      height: number;
    };

export const isAccurate = (m: Measurement): boolean =>
  !("error" in m) &&
  Number.isFinite(m.differingShare) &&
  Number.isFinite(m.contentShare) &&
  m.contentPixels > 0 &&
  m.differingShare <= MAX_DIFFERING_SHARE &&
  m.contentShare <= MAX_CONTENT_DIFFERING_SHARE;

// Runs inside the page, so it must not reference anything outside its own body.
async function inPage({ reference, tolerance }: { reference: string; tolerance: number }) {
  const snapdom = (window as unknown as { snapdom: Snapdom }).snapdom;
  const width = innerWidth;
  const height = innerHeight;
  const canvas2d = () => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    return { c, ctx };
  };
  const clear = (c: string) => c === "transparent" || c === "rgba(0, 0, 0, 0)";
  // The page background paints the whole viewport, beyond the root element's own box.
  const backgroundColor =
    [document.documentElement, document.body]
      .map((el) => getComputedStyle(el).backgroundColor)
      .find((c) => !clear(c)) ?? "#ffffff";

  const shot = canvas2d();
  const start = performance.now();
  try {
    shot.ctx.fillStyle = backgroundColor;
    shot.ctx.fillRect(0, 0, width, height);
    const capture = await snapdom(document.documentElement, { clip: "viewport", scale: 1 });
    shot.ctx.drawImage(await capture.toCanvas(), 0, 0, width, height);
  } catch (error) {
    return { error: String(error) };
  }
  const ms = performance.now() - start;

  const img = new Image();
  img.src = `data:image/png;base64,${reference}`;
  await img.decode();
  const ref = canvas2d();
  ref.ctx.drawImage(img, 0, 0, width, height);
  const blank = canvas2d();
  blank.ctx.fillStyle = backgroundColor;
  blank.ctx.fillRect(0, 0, width, height);
  const a = ref.ctx.getImageData(0, 0, width, height).data;
  const b = shot.ctx.getImageData(0, 0, width, height).data;
  const blankData = blank.ctx.getImageData(0, 0, width, height).data;
  const differs = (x: Uint8ClampedArray, y: Uint8ClampedArray, i: number) =>
    [0, 1, 2].some((ch) => Math.abs((x[i + ch] ?? 0) - (y[i + ch] ?? 0)) > tolerance);
  let differing = 0;
  let content = 0;
  let contentDiffering = 0;
  for (let i = 0; i < a.length; i += 4) {
    const bad = differs(a, b, i);
    if (bad) differing++;
    if (differs(a, blankData, i)) {
      content++;
      if (bad) contentDiffering++;
    }
  }
  return {
    differingShare: differing / (width * height),
    contentShare: contentDiffering / Math.max(content, 1),
    contentPixels: content,
    ms,
    width,
    height,
  };
}

export async function measureCapture(
  page: Page,
  library: string,
  referencePage: Page = page,
): Promise<Measurement> {
  const reference = (await referencePage.screenshot()).toString("base64");
  await page.addScriptTag({ url: `/vendor/${library}.js` });
  return page.evaluate(inPage, { reference, tolerance: CHANNEL_TOLERANCE });
}
