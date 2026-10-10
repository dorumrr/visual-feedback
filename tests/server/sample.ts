// A synthetic report and real 1x1 images, shared by the server and recipe tests.
const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
export const PNG = bytes(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
);
export const WEBP = bytes("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=");

export function valid(): Record<string, unknown> {
  return {
    id: "0b6c3a52-7f1e-4c2a-9d3b-5e8f0a1b2c3d",
    createdAt: "2026-10-10T08:15:30.123Z",
    note: "The total is wrong",
    screenshots: [
      {
        marks: [
          {
            tool: "pen",
            points: [
              [1, 2],
              [3, 4],
            ],
          },
          { tool: "box", x: 5, y: 6, width: 7, height: 0 },
          { tool: "arrow", from: [8, 9], to: [10, 11] },
        ],
        page: { url: "https://example.test/bills?id=1#top", title: "Bills" },
        viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
        scroll: { x: 0, y: 140 },
      },
    ],
    page: { url: "https://example.test/bills?id=1#top", title: "Bills" },
    viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
    scroll: { x: 0, y: 140 },
    userAgent: "Test/1.0",
    language: "en-GB",
    timeZone: "Europe/London",
    context: { app: "1.2.3" },
  };
}
