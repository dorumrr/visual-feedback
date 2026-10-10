import type { FeedbackReport } from "./shared/report";

/** The page as a screenshot saw it. */
export type Seen = Pick<FeedbackReport, "viewport" | "scroll"> & { url: string; title: string };

/** What the page looked like when each screenshot was taken. */
export const shots = new WeakMap<HTMLCanvasElement, Seen>();

export function look(): Seen {
  return {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    scroll: { x: scrollX, y: scrollY },
  };
}
