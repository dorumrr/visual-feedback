import { afterEach, expect, it, vi } from "vitest";
import { deliver } from "../../src/report";
import { parseFeedbackRequest } from "../../src/server/index";
import type { FeedbackReport } from "../../src/shared/report";
import { PNG, valid, WEBP } from "../server/sample";

afterEach(() => vi.unstubAllGlobals());

const blob = (bytes: Uint8Array, type: string) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], { type });

it("endpoint posts one image part per screenshot, in order, that the server's parser reads back", async () => {
  const sample = valid() as unknown as FeedbackReport;
  const [shot] = sample.screenshots as FeedbackReport["screenshots"];
  const images = [blob(PNG, "image/png"), blob(WEBP, "image/webp"), blob(PNG, "image/png")];
  const report: FeedbackReport = {
    ...sample,
    screenshots: images.map((image, i) => ({
      ...(shot as FeedbackReport["screenshots"][number]),
      image,
      scroll: { x: 0, y: i * 100 },
    })),
  };
  let sent: FormData | undefined;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent = init.body as FormData;
    return new Response(null, { status: 204 });
  });
  await deliver(report, { endpoint: "/api/feedback" });
  const form = sent as FormData;
  expect([...form.keys()]).toEqual(["report", "image0", "image1", "image2"]);
  expect([0, 1, 2].map((i) => (form.get(`image${i}`) as File).name)).toEqual([
    `${report.id}-0.png`,
    `${report.id}-1.webp`,
    `${report.id}-2.png`,
  ]);
  const { report: read } = await parseFeedbackRequest(
    new Request("http://localhost/api/feedback", { method: "POST", body: form }),
  );
  expect(read.screenshots.map((one) => [one.scroll.y, one.image.type])).toEqual([
    [0, "image/png"],
    [100, "image/webp"],
    [200, "image/png"],
  ]);
});
