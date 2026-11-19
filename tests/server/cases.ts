import assert from "node:assert/strict";
import { FeedbackRequestError, parseFeedbackRequest } from "../../src/server/index";
import { PNG, valid, WEBP } from "./sample";

// The same cases run on Node (parse.test.ts) and in Deno (parse.deno.ts).
export const cases: { name: string; run: () => Promise<void> }[] = [];
const add = (name: string, run: () => Promise<void>) => cases.push({ name, run });

type Part = string | Blob | [Blob, string];

function request(parts: [string, Part][], init: RequestInit = {}): Request {
  const form = new FormData();
  for (const [name, value] of parts) {
    if (Array.isArray(value)) form.append(name, value[0], value[1]);
    else if (typeof value === "string") form.append(name, value);
    else form.append(name, value, "image");
  }
  return new Request("https://example.test/api/feedback", { method: "POST", body: form, ...init });
}

const image = (data: Uint8Array, type: string): [Blob, string] => [
  new Blob([data as Uint8Array<ArrayBuffer>], { type }),
  "x.png",
];

type Report = Record<string, unknown>;
const first = (report: Report) => (report.screenshots as Report[])[0] as Report;
// The sample report with its one screenshot changed.
const withShot = (report: Report, change: Report): Report => ({
  ...report,
  screenshots: [{ ...first(report), ...change }],
});
// A report of n screenshots, each a copy of the sample's.
const shots = (n: number): Report => ({
  ...valid(),
  screenshots: Array.from({ length: n }, () => first(valid())),
});
// The sample report with no screenshots, for cases about its text alone.
const bare = (): Report => ({ ...valid(), screenshots: [] });
const images = (report: Report) =>
  (report.screenshots as { image: Blob }[]).map((shot) => shot.image);

async function refused(
  promise: Promise<unknown>,
  status: 400 | 413,
  message?: RegExp,
): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof FeedbackRequestError, String(error));
    assert.equal(error.status, status, error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
}

add(
  "a valid report with a PNG screenshot is returned whole, with the image typed from its bytes",
  async () => {
    const { report } = await parseFeedbackRequest(
      request([
        ["report", JSON.stringify(valid())],
        ["image0", image(PNG, "image/png")],
      ]),
    );
    const [out] = images(report);
    assert.deepEqual(
      { ...report, screenshots: [{ ...report.screenshots[0], image: null }] },
      withShot(valid(), { image: null }),
    );
    assert.ok(out instanceof Blob);
    assert.equal(out.type, "image/png");
    assert.deepEqual(new Uint8Array(await out.arrayBuffer()), PNG);
  },
);

add("a report with no screenshots and no image part gives an empty list", async () => {
  const { report } = await parseFeedbackRequest(
    request([["report", JSON.stringify({ ...valid(), screenshots: [] })]]),
  );
  assert.deepEqual(report.screenshots, []);
  assert.deepEqual(report.page, valid().page);
});

add("ten screenshots come back in order, each with its own image part", async () => {
  const report = shots(10);
  for (const [i, shot] of (report.screenshots as Report[]).entries()) {
    shot.scroll = { x: 0, y: i * 100 };
  }
  const { report: out } = await parseFeedbackRequest(
    request([
      ["report", JSON.stringify(report)],
      ...Array.from(
        { length: 10 },
        (_, i) =>
          [`image${i}`, i % 2 ? image(WEBP, "image/png") : image(PNG, "image/png")] as [
            string,
            Part,
          ],
      ).reverse(),
    ]),
  );
  assert.deepEqual(
    out.screenshots.map((shot) => [shot.scroll.y, shot.image.type]),
    Array.from({ length: 10 }, (_, i) => [i * 100, i % 2 ? "image/webp" : "image/png"]),
  );
});

add(
  "every image part is checked, not only the first: a spoofed or oversized image1 is refused",
  async () => {
    const two = shots(2);
    const svg = new TextEncoder().encode("<svg/>");
    await refused(
      parseFeedbackRequest(
        request([
          ["report", JSON.stringify(two)],
          ["image0", image(PNG, "image/png")],
          ["image1", image(svg, "image/png")],
        ]),
      ),
      400,
      /PNG or WebP/,
    );
    const big = new Uint8Array(PNG.byteLength + 1);
    big.set(PNG);
    await refused(
      parseFeedbackRequest(
        request([
          ["report", JSON.stringify(two)],
          ["image0", image(PNG, "image/png")],
          ["image1", image(big, "image/png")],
        ]),
        { maxImageBytes: PNG.byteLength },
      ),
      413,
      /image/,
    );
  },
);

add(
  "a screenshot whose image is null in the JSON is read, with the image from its part",
  async () => {
    const { report } = await parseFeedbackRequest(
      request([
        ["report", JSON.stringify(withShot(valid(), { image: null }))],
        ["image0", image(PNG, "image/png")],
      ]),
    );
    assert.equal(images(report)[0]?.type, "image/png");
  },
);

add("the body limit is exactly 10 times maxImageBytes plus 1 MiB plus 64 KiB", async () => {
  const limit = 10 * 1_000 + 1_048_576 + 65_536;
  const declared = (length: number) =>
    parseFeedbackRequest(
      new Request("https://example.test/", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(length),
        },
        body: "not multipart",
      }),
      { maxImageBytes: 1_000 },
    );
  await refused(declared(limit + 1), 413, /request/);
  // At the limit the size check passes, and the body is refused for its content instead.
  await refused(declared(limit), 400, /multipart/);
});

add("eleven screenshots are refused with 400 and name the list", () =>
  refused(
    parseFeedbackRequest(request([["report", JSON.stringify(shots(11))]])),
    400,
    /report\.screenshots /,
  ),
);

add(
  "a screenshot with no image part, or an image part with no screenshot, is refused",
  async () => {
    await refused(
      parseFeedbackRequest(request([["report", JSON.stringify(valid())]])),
      400,
      /image0/,
    );
    await refused(
      parseFeedbackRequest(
        request([
          ["report", JSON.stringify(valid())],
          ["image0", image(PNG, "image/png")],
          ["image1", image(PNG, "image/png")],
        ]),
      ),
      400,
      /image1/,
    );
    await refused(
      parseFeedbackRequest(
        request([
          ["report", JSON.stringify(valid())],
          ["image00", image(PNG, "image/png")],
        ]),
      ),
      400,
      /image00/,
    );
  },
);

add(
  "an image part named image, as 0.1 sent it, is refused with a message that names the change",
  () =>
    refused(
      parseFeedbackRequest(
        request([
          ["report", JSON.stringify({ ...valid(), screenshots: [] })],
          ["image", image(PNG, "image/png")],
        ]),
      ),
      400,
      /image0/,
    ),
);

add("the category is kept, and fields the report does not define are dropped", async () => {
  const { report } = await parseFeedbackRequest(
    request([
      [
        "report",
        JSON.stringify({ ...valid(), screenshots: [], category: "bug", admin: true, image: null }),
      ],
    ]),
  );
  assert.equal(report.category, "bug");
  assert.equal("admin" in report, false);
  const nested = await parseFeedbackRequest(
    request([
      [
        "report",
        JSON.stringify({
          ...valid(),
          page: { url: "u", title: "t", cookie: "x" },
          viewport: { width: 1, height: 1, devicePixelRatio: 1, extra: 1 },
          scroll: { x: 0, y: 0, extra: 1 },
          screenshots: [
            {
              extra: 1,
              page: { url: "v", title: "w", cookie: "x" },
              viewport: { width: 2, height: 2, devicePixelRatio: 2, extra: 1 },
              scroll: { x: 1, y: 1, extra: 1 },
              marks: [
                { tool: "pen", points: [[1, 2]], extra: 1 },
                { tool: "box", x: 0, y: 0, width: 1, height: 1, extra: 1 },
                { tool: "arrow", from: [0, 0], to: [1, 1], extra: 1 },
                { tool: "text", x: 3, y: 4, text: "cut \ud83d here\u0000", extra: 1 },
                { tool: "text", x: 0, y: 0, text: "x".repeat(280) },
                { tool: "text", x: 0, y: 0, text: "\u{1F600}".repeat(280) },
              ],
            },
          ],
        }),
      ],
      ["image0", image(PNG, "image/png")],
    ]),
  );
  assert.deepEqual(nested.report.page, { url: "u", title: "t" });
  assert.deepEqual(nested.report.viewport, { width: 1, height: 1, devicePixelRatio: 1 });
  assert.deepEqual(nested.report.scroll, { x: 0, y: 0 });
  const [shot] = nested.report.screenshots;
  assert.deepEqual(Object.keys(shot ?? {}).sort(), [
    "image",
    "marks",
    "page",
    "scroll",
    "viewport",
  ]);
  assert.deepEqual(shot?.page, { url: "v", title: "w" });
  assert.deepEqual(shot?.viewport, { width: 2, height: 2, devicePixelRatio: 2 });
  assert.deepEqual(shot?.scroll, { x: 1, y: 1 });
  assert.deepEqual(shot?.marks, [
    { tool: "pen", points: [[1, 2]] },
    { tool: "box", x: 0, y: 0, width: 1, height: 1 },
    { tool: "arrow", from: [0, 0], to: [1, 1] },
    { tool: "text", x: 3, y: 4, text: "cut \ufffd here" },
    // The limit counts characters, so 280 emoji (560 UTF-16 units) still fit.
    { tool: "text", x: 0, y: 0, text: "x".repeat(280) },
    { tool: "text", x: 0, y: 0, text: "\u{1F600}".repeat(280) },
  ]);
  const plain = { ...valid(), screenshots: [] };
  assert.equal(
    "category" in (await parseFeedbackRequest(request([["report", JSON.stringify(plain)]]))).report,
    false,
  );
});

add(
  "a WebP sent as image/png is returned as image/webp: the declared type is ignored",
  async () => {
    const { report } = await parseFeedbackRequest(
      request([
        ["report", JSON.stringify(valid())],
        ["image0", image(WEBP, "image/png")],
      ]),
    );
    assert.equal(images(report)[0]?.type, "image/webp");
    const png = await parseFeedbackRequest(
      request([
        ["report", JSON.stringify(valid())],
        ["image0", image(PNG, "image/webp")],
      ]),
    );
    assert.equal(images(png.report)[0]?.type, "image/png");
    const webp = await parseFeedbackRequest(
      request([
        ["report", JSON.stringify(valid())],
        ["image0", image(WEBP, "image/webp")],
      ]),
    );
    assert.equal(images(webp.report)[0]?.type, "image/webp");
  },
);

const wrongShapes: [string, (report: Record<string, unknown>) => unknown, RegExp][] = [
  ["a missing note", ({ note: _, ...rest }) => rest, /report\.note/],
  ["an id that is a path", (r) => ({ ...r, id: "../../etc/passwd" }), /report\.id/],
  ["an id in upper case", (r) => ({ ...r, id: String(r.id).toUpperCase() }), /report\.id/],
  ["a version 1 id", (r) => ({ ...r, id: "0b6c3a52-7f1e-1c2a-9d3b-5e8f0a1b2c3d" }), /report\.id/],
  ["the nil id", (r) => ({ ...r, id: "00000000-0000-0000-0000-000000000000" }), /report\.id/],
  [
    "an id with the wrong variant",
    (r) => ({ ...r, id: "0b6c3a52-7f1e-4c2a-7d3b-5e8f0a1b2c3d" }),
    /report\.id/,
  ],
  ["a date that is not ISO", (r) => ({ ...r, createdAt: "10/10/2026" }), /report\.createdAt/],
  [
    "a date that does not exist",
    (r) => ({ ...r, createdAt: "2026-13-45T00:00:00.000Z" }),
    /report\.createdAt/,
  ],
  [
    "a date that rolls over to the next month",
    (r) => ({ ...r, createdAt: "2026-02-30T00:00:00.000Z" }),
    /report\.createdAt/,
  ],
  [
    "a date after year 9999, which some stores refuse",
    (r) => ({ ...r, createdAt: "+010000-01-01T00:00:00.000Z" }),
    /report\.createdAt/,
  ],
  [
    "a date before 1970, which some stores refuse",
    (r) => ({ ...r, createdAt: "1969-12-31T23:59:59.999Z" }),
    /report\.createdAt/,
  ],
  [
    "an unknown tool",
    (r) => withShot(r, { marks: [{ tool: "circle" }] }),
    /report\.screenshots\[0\]\.marks\[0\]\.tool/,
  ],
  [
    "a point with three numbers",
    (r) => withShot(r, { marks: [{ tool: "pen", points: [[1, 2, 3]] }] }),
    /report\.screenshots\[0\]\.marks\[0\]\.points\[0\]/,
  ],
  [
    "a box with a text width",
    (r) => withShot(r, { marks: [{ tool: "box", x: 0, y: 0, width: "7", height: 1 }] }),
    /report\.screenshots\[0\]\.marks\[0\]\.width/,
  ],
  [
    "an arrow with no end",
    (r) => withShot(r, { marks: [{ tool: "arrow", from: [0, 0] }] }),
    /report\.screenshots\[0\]\.marks\[0\]\.to/,
  ],
  [
    "a text label whose text is a number",
    (r) => withShot(r, { marks: [{ tool: "text", x: 0, y: 0, text: 7 }] }),
    /report\.screenshots\[0\]\.marks\[0\]\.text/,
  ],
  [
    "a text label with no place",
    (r) => withShot(r, { marks: [{ tool: "text", x: 0, text: "hi" }] }),
    /report\.screenshots\[0\]\.marks\[0\]\.y/,
  ],
  [
    "a text label over 280 characters",
    (r) => withShot(r, { marks: [{ tool: "text", x: 0, y: 0, text: "x".repeat(281) }] }),
    /report\.screenshots\[0\]\.marks\[0\]\.text/,
  ],
  [
    "a viewport width as text",
    (r) => ({ ...r, viewport: { width: "1280", height: 720, devicePixelRatio: 1 } }),
    /report\.viewport\.width/,
  ],
  [
    "a scroll that is not finite",
    (r) => ({ ...r, scroll: { x: 0, y: null } }),
    /report\.scroll\.y/,
  ],
  ["a context that is an array", (r) => ({ ...r, context: [] }), /report\.context/],
  [
    "an image inside the JSON",
    (r) => withShot(r, { image: "data:image/png;base64,AAAA" }),
    /report\.screenshots\[0\]\.image/,
  ],
  ["screenshots that are not a list", (r) => ({ ...r, screenshots: {} }), /report\.screenshots /],
  [
    "a screenshot that is not an object",
    (r) => ({ ...r, screenshots: [7] }),
    /report\.screenshots\[0\] /,
  ],
  [
    "a screenshot whose viewport width is text",
    (r) => withShot(r, { viewport: { width: "1", height: 1, devicePixelRatio: 1 } }),
    /report\.screenshots\[0\]\.viewport\.width/,
  ],
  ["a category that is not text", (r) => ({ ...r, category: 3 }), /report\.category/],
  ["a page with no url", (r) => ({ ...r, page: { title: "x" } }), /report\.page\.url/],
  ["a list in place of the report", () => [valid()], /report\./],
];

for (const [name, change, field] of wrongShapes) {
  add(`a wrong shape is refused with 400 and names the field: ${name}`, () =>
    refused(
      parseFeedbackRequest(request([["report", JSON.stringify(change(valid()))]])),
      400,
      field,
    ),
  );
}

const requiredInShot = [
  "marks",
  "page",
  "page.url",
  "page.title",
  "viewport",
  "viewport.width",
  "viewport.height",
  "viewport.devicePixelRatio",
  "scroll",
  "scroll.x",
  "scroll.y",
];

for (const path of requiredInShot) {
  add(`a screenshot without ${path} is refused with 400 and names it`, () => {
    const report = valid();
    const shot = first(report);
    const [outer, inner] = path.split(".") as [string, string | undefined];
    if (inner) delete (shot[outer] as Record<string, unknown>)[inner];
    else delete shot[outer];
    return refused(
      parseFeedbackRequest(request([["report", JSON.stringify(report)]])),
      400,
      new RegExp(`report\\.screenshots\\[0\\]\\.${path.replace(".", "\\.")}( |$)`),
    );
  });
}

const required = [
  "id",
  "createdAt",
  "note",
  "screenshots",
  "page",
  "page.url",
  "page.title",
  "viewport",
  "viewport.width",
  "viewport.height",
  "viewport.devicePixelRatio",
  "scroll",
  "scroll.x",
  "scroll.y",
  "userAgent",
  "language",
  "timeZone",
  "context",
];

for (const path of required) {
  add(`a report without ${path} is refused with 400 and names it`, () => {
    const report = valid();
    const [outer, inner] = path.split(".") as [string, string | undefined];
    if (inner) delete (report[outer] as Record<string, unknown>)[inner];
    else delete report[outer];
    return refused(
      parseFeedbackRequest(request([["report", JSON.stringify(report)]])),
      400,
      new RegExp(`report\\.${path.replace(".", "\\.")}( |$)`),
    );
  });
}

add(
  "a report whose marks are not a list, or whose note is not text, is refused with 400",
  async () => {
    await refused(
      parseFeedbackRequest(request([["report", JSON.stringify(withShot(valid(), { marks: {} }))]])),
      400,
      /report\.screenshots\[0\]\.marks /,
    );
    await refused(
      parseFeedbackRequest(request([["report", JSON.stringify({ ...valid(), note: 1 })]])),
      400,
      /report\.note /,
    );
  },
);

// JSON has no literal for Infinity, but 1e999 parses to it.
const infinite: [string, (report: Record<string, unknown>) => unknown, RegExp][] = [
  ["a scroll", (r) => ({ ...r, scroll: { x: 0, y: "INF" } }), /report\.scroll\.y/],
  [
    "a viewport",
    (r) => ({ ...r, viewport: { width: "INF", height: 1, devicePixelRatio: 1 } }),
    /report\.viewport\.width/,
  ],
  [
    "a box",
    (r) => withShot(r, { marks: [{ tool: "box", x: "INF", y: 0, width: 1, height: 1 }] }),
    /report\.screenshots\[0\]\.marks\[0\]\.x/,
  ],
  [
    "a point",
    (r) => withShot(r, { marks: [{ tool: "pen", points: [[0, "INF"]] }] }),
    /report\.screenshots\[0\]\.marks\[0\]\.points\[0\]/,
  ],
];

for (const [name, change, field] of infinite) {
  add(`a number that is not finite is refused with 400: ${name}`, () => {
    const json = JSON.stringify(change(valid())).replace('"INF"', "1e999");
    assert.match(json, /1e999/);
    return refused(parseFeedbackRequest(request([["report", json]])), 400, field);
  });
}

add("__proto__ keys are dropped at every depth of the report", async () => {
  const json = JSON.stringify(bare()).replace(
    '"context":{"app":"1.2.3"}',
    '"context":{"app":"1.2.3","__proto__":{"polluted":1},"deep":{"__proto__":{"polluted":1}}}',
  );
  assert.match(json, /"deep":\{"__proto__"/);
  const { report } = await parseFeedbackRequest(request([["report", json]]));
  assert.equal(Object.hasOwn(report.context, "__proto__"), false);
  assert.equal(Object.hasOwn(report.context.deep as object, "__proto__"), false);
  assert.equal(report.context.app, "1.2.3");
  assert.equal(Object.getPrototypeOf(report.context), Object.prototype);
  assert.equal(Object.getPrototypeOf(report.context.deep), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

add("a key that becomes __proto__ once its NUL is removed is dropped too", async () => {
  // JSON can spell NUL inside a key; the cleaning that removes it must not make a __proto__.
  const json = JSON.stringify(bare()).replace(
    '"context":{"app":"1.2.3"}',
    '"context":{"app":"1.2.3","\\u0000__proto__":{"polluted":1},"deep":{"__pro\\u0000to__":{"polluted":1}}}',
  );
  assert.match(json, /__pro\\u0000to__/);
  const { report } = await parseFeedbackRequest(request([["report", json]]));
  assert.equal(Object.hasOwn(report.context, "__proto__"), false);
  assert.equal(Object.hasOwn(report.context.deep as object, "__proto__"), false);
  // What a host that merges the context into its own object would get.
  const merged: { polluted?: number } = Object.assign({}, report.context);
  assert.equal(merged.polluted, undefined);
  assert.equal(report.context.app, "1.2.3");
});

add("a report part over 1 MiB is refused with 413, even with no image", () =>
  refused(
    parseFeedbackRequest(
      request([["report", JSON.stringify({ ...valid(), note: "x".repeat(1_048_576) })]]),
    ),
    413,
    /report/,
  ),
);

add("a report just under 1 MiB beside an image at maxImageBytes is accepted", async () => {
  const report = valid();
  const json = JSON.stringify({ ...report, note: "" });
  const note = "x".repeat(1_048_576 - json.length);
  const data = new Uint8Array(1_000_000);
  data.set(PNG);
  const { report: out } = await parseFeedbackRequest(
    request([
      ["report", JSON.stringify({ ...report, note })],
      ["image0", image(data, "image/png")],
    ]),
    { maxImageBytes: data.byteLength },
  );
  assert.equal(new Blob([JSON.stringify({ ...report, note })]).size, 1_048_576);
  assert.equal(out.note.length, note.length);
  assert.equal(images(out)[0]?.size, data.byteLength);
});

add("ten images at maxImageBytes beside a report just under 1 MiB are accepted", async () => {
  const report = shots(10);
  const json = JSON.stringify({ ...report, note: "" });
  const note = "x".repeat(1_048_576 - json.length);
  const data = new Uint8Array(100_000);
  data.set(PNG);
  const { report: out } = await parseFeedbackRequest(
    request([
      ["report", JSON.stringify({ ...report, note })],
      ...Array.from(
        { length: 10 },
        (_, i) => [`image${i}`, image(data, "image/png")] as [string, Part],
      ),
    ]),
    { maxImageBytes: data.byteLength },
  );
  assert.deepEqual(
    images(out).map((blob) => blob.size),
    Array(10).fill(data.byteLength),
  );
});

add("a body over 10 times maxImageBytes plus 1 MiB is refused while it streams", async () => {
  let pulled = 0;
  const large = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      if (pulled > 64) controller.close();
      else controller.enqueue(new Uint8Array(65_536));
    },
  });
  await refused(
    parseFeedbackRequest(
      new Request("https://example.test/", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: large,
        duplex: "half",
      } as RequestInit),
      { maxImageBytes: 100_000 },
    ),
    413,
    /request/,
  );
  const limit = 10 * 100_000 + 1_048_576 + 65_536;
  assert.ok(pulled <= limit / 65_536 + 2 && pulled > limit / 65_536 - 1, `pulled ${pulled} chunks`);
});

add("an oversized body whose stream fails to cancel is still refused with 413", async () => {
  let pulled = 0;
  const stubborn = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      if (pulled > 64) controller.close();
      else controller.enqueue(new Uint8Array(65_536));
    },
    cancel() {
      throw new Error("cannot cancel");
    },
  });
  await refused(
    parseFeedbackRequest(
      new Request("https://example.test/", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: stubborn,
        duplex: "half",
      } as RequestInit),
      { maxImageBytes: 0 },
    ),
    413,
  );
});

add("the report cap counts bytes, not characters", async () => {
  const note = "\u00e9".repeat(600_000);
  assert.equal(note.length < 1_048_576, true);
  await refused(
    parseFeedbackRequest(request([["report", JSON.stringify({ ...valid(), note })]])),
    413,
    /report/,
  );
});

add("a body that breaks off while it streams is refused with 400", async () => {
  let pulled = 0;
  const broken = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      if (pulled > 2) controller.error(new Error("connection reset"));
      else controller.enqueue(new Uint8Array(16));
    },
  });
  await refused(
    parseFeedbackRequest(
      new Request("https://example.test/", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: broken,
        duplex: "half",
      } as RequestInit),
    ),
    400,
  );
});

add(
  "NUL characters are removed and lone surrogates replaced, so any store can keep the text",
  async () => {
    const json = JSON.stringify({ ...bare(), note: "a\u0000b \ud83d c", userAgent: "x\udc00y" });
    const { report } = await parseFeedbackRequest(request([["report", json]]));
    assert.equal(report.note, "ab \ufffd c");
    assert.equal(report.userAgent, "x\ufffdy");
    // A whole pair is kept.
    const pair = await parseFeedbackRequest(
      request([["report", JSON.stringify({ ...bare(), note: "ok \ud83d\ude00" })]]),
    );
    assert.equal(pair.report.note, "ok \ud83d\ude00");
  },
);

add("context text is cleaned the same way, keys and nested values included", async () => {
  const json = JSON.stringify({
    ...bare(),
    context: { "k\u0000ey": "v\ud800", list: ["a\u0000", { deep: "\udc00" }], n: 1, ok: true },
  });
  const { report } = await parseFeedbackRequest(request([["report", json]]));
  assert.deepEqual(report.context, {
    key: "v\ufffd",
    list: ["a", { deep: "\ufffd" }],
    n: 1,
    ok: true,
  });
});

add("a report part that is not JSON is refused with 400", () =>
  refused(parseFeedbackRequest(request([["report", "{note:"]])), 400),
);

add("a request with no report part, or two, is refused with 400", async () => {
  await refused(parseFeedbackRequest(request([["image0", image(PNG, "image/png")]])), 400);
  const json = JSON.stringify(valid());
  await refused(
    parseFeedbackRequest(
      request([
        ["report", json],
        ["report", json],
      ]),
    ),
    400,
  );
});

add(
  "a report sent as a file, two images, or an image sent as text are refused with 400",
  async () => {
    const json = JSON.stringify(valid());
    await refused(parseFeedbackRequest(request([["report", new Blob([json])]])), 400);
    await refused(
      parseFeedbackRequest(
        request([
          ["report", json],
          ["image0", image(PNG, "image/png")],
          ["image0", image(PNG, "image/png")],
        ]),
      ),
      400,
    );
    await refused(
      parseFeedbackRequest(
        request([
          ["report", json],
          ["image0", "iVBORw0KGgo"],
        ]),
      ),
      400,
    );
  },
);

add("a body that is not multipart/form-data is refused with 400", async () => {
  await refused(
    parseFeedbackRequest(
      new Request("https://example.test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ report: valid() }),
      }),
    ),
    400,
  );
  // A form, not multipart: formData() reads it, so only the content-type check refuses it.
  await refused(
    parseFeedbackRequest(
      new Request("https://example.test/", {
        method: "POST",
        body: new URLSearchParams({ report: JSON.stringify(valid()) }),
      }),
    ),
    400,
    /multipart/,
  );
  await refused(
    parseFeedbackRequest(
      new Request("https://example.test/", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: "not multipart",
      }),
    ),
    400,
  );
});

const spoofed: [string, Uint8Array][] = [
  ["HTML", new TextEncoder().encode("<!doctype html><script>alert(1)</script>")],
  ["SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
  ["a JPEG", Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1)],
  ["a RIFF that is not WebP", new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt ")],
  ["an empty file", new Uint8Array(0)],
  ["a PNG signature cut short", PNG.slice(0, 6)],
  ["a PNG signature with its last byte wrong", Uint8Array.of(...PNG.slice(0, 7), 0)],
  ["a RIFF cut short before WEBP", WEBP.slice(0, 10)],
];

for (const [name, data] of spoofed) {
  for (const declared of ["image/png", "image/webp"]) {
    add(`a spoofed image is refused with 400: ${name} sent as ${declared}`, () =>
      refused(
        parseFeedbackRequest(
          request([
            ["report", JSON.stringify(valid())],
            ["image0", image(data, declared)],
          ]),
        ),
        400,
        /PNG or WebP/,
      ),
    );
  }
}

add(
  "an image over maxImageBytes is refused with 413, and one at the limit is accepted",
  async () => {
    const send = (maxImageBytes: number) =>
      parseFeedbackRequest(
        request([
          ["report", JSON.stringify(valid())],
          ["image0", image(PNG, "image/png")],
        ]),
        {
          maxImageBytes,
        },
      );
    await refused(send(PNG.byteLength - 1), 413, /image/);
    assert.equal(images((await send(PNG.byteLength)).report)[0]?.size, PNG.byteLength);
  },
);

add("the default maxImageBytes is 10 000 000", async () => {
  const sized = (size: number) => {
    const data = new Uint8Array(size);
    data.set(PNG);
    return parseFeedbackRequest(
      request([
        ["report", JSON.stringify(valid())],
        ["image0", image(data, "image/png")],
      ]),
    );
  };
  assert.equal(images((await sized(10_000_000)).report)[0]?.size, 10_000_000);
  await refused(sized(10_000_001), 413, /image/);
});

add(
  "a body over 10 times maxImageBytes plus 1 MiB is refused with 413 while it streams, without reading the rest",
  async () => {
    let pulled = 0;
    // Finite, so a missing cap ends in a failed case rather than a hung run.
    const large = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 64) controller.close();
        else controller.enqueue(new Uint8Array(65_536));
      },
    });
    await refused(
      parseFeedbackRequest(
        new Request("https://example.test/", {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=x" },
          body: large,
          duplex: "half",
        } as RequestInit),
        { maxImageBytes: 0 },
      ),
      413,
      /request/,
    );
    assert.ok(pulled <= 1_048_576 / 65_536 + 2, `pulled ${pulled} chunks`);
  },
);

add(
  "a declared content-length over the limit is refused with 413 before the body is read",
  async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 32) controller.close();
        else controller.enqueue(new Uint8Array(65_536));
      },
    });
    await refused(
      parseFeedbackRequest(
        new Request("https://example.test/", {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data; boundary=x",
            "content-length": "2000000",
          },
          body,
          duplex: "half",
        } as RequestInit),
        { maxImageBytes: 0 },
      ),
      413,
    );
    assert.equal(pulled <= 1, true, `pulled ${pulled} chunks`);
  },
);

add(
  "a maxImageBytes that is not a number of bytes is a host error, not a request error",
  async () => {
    for (const maxImageBytes of [Number.NaN, -1]) {
      await assert.rejects(
        parseFeedbackRequest(request([["report", JSON.stringify(valid())]]), { maxImageBytes }),
        RangeError,
      );
    }
  },
);

add("FeedbackRequestError is an Error with its name and status", async () => {
  const error = new FeedbackRequestError(413, "too large");
  assert.ok(error instanceof Error);
  assert.equal(error.name, "FeedbackRequestError");
  assert.equal(error.status, 413);
  assert.equal(error.message, "too large");
});

// Attachments: a file part beside the report, with its name, type and size in the report.
const PDF = new TextEncoder().encode("%PDF-1.4\n%âã\n1 0 obj\nendobj\n");
const TEXT = new TextEncoder().encode("step 1: open the bill\nstep 2: it shows £0\n");
const file = (data: Uint8Array, name: string, type = ""): [Blob, string] => [
  new Blob([data as Uint8Array<ArrayBuffer>], { type }),
  name,
];
const entry = (name: string, type: string, data: Uint8Array) => ({ name, type, size: data.length });
const withFiles = (...files: Report[]): Report => ({ ...bare(), attachments: files });
const parse = (parts: [string, Part][], attachments?: unknown) =>
  parseFeedbackRequest(
    request(parts),
    attachments === undefined ? {} : { attachments: attachments as true },
  );

add("with attachments on, each file comes back as a Blob typed from its bytes", async () => {
  const sent = withFiles(
    entry("bill.png", "image/png", PNG),
    entry("Invoice 12.PDF", "application/pdf", PDF),
    entry("steps.log", "text/plain", TEXT),
  );
  const { report } = await parse(
    [
      ["report", JSON.stringify(sent)],
      ["file0", file(PNG, "x", "application/octet-stream")],
      ["file1", file(PDF, "x")],
      ["file2", file(TEXT, "x", "image/png")],
    ],
    true,
  );
  const files = report.attachments ?? [];
  assert.deepEqual(
    files.map(({ file: _, ...rest }) => rest),
    sent.attachments,
  );
  assert.deepEqual(
    files.map(({ file }) => file.type),
    ["image/png", "application/pdf", "text/plain"],
  );
  const third = files[2];
  assert.ok(third);
  assert.deepEqual(new Uint8Array(await third.file.arrayBuffer()), TEXT);
});

add("a report with no attachments field keeps none, with attachments on or off", async () => {
  for (const on of [undefined, true]) {
    const { report } = await parse([["report", JSON.stringify(bare())]], on);
    assert.equal(Object.hasOwn(report, "attachments"), false);
  }
});

add("with attachments off, the default, a report with files is refused with 400", async () => {
  const sent = withFiles(entry("bill.png", "image/png", PNG));
  await refused(
    parse([
      ["report", JSON.stringify(sent)],
      ["file0", file(PNG, "bill.png")],
    ]),
    400,
    /takes no attachments/,
  );
  await refused(parse([["report", JSON.stringify(sent)]]), 400, /takes no attachments/);
  await refused(
    parse([
      ["report", JSON.stringify(bare())],
      ["file0", file(PNG, "bill.png")],
    ]),
    400,
    /takes no attachments/,
  );
});

add("attachments on raises the body limit by the files' total, and only then", async () => {
  const limit = 10 * 1_000 + 1_048_576 + 65_536;
  const declared = (length: number, attachments?: { maxFiles: number; maxBytes: number }) =>
    parseFeedbackRequest(
      new Request("https://example.test/", {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(length),
        },
        body: "not multipart",
      }),
      attachments ? { maxImageBytes: 1_000, attachments } : { maxImageBytes: 1_000 },
    );
  await refused(declared(limit + 1), 413, /request/);
  const files = { maxFiles: 2, maxBytes: 500 };
  await refused(declared(limit + 1_000), 413, /request/);
  await refused(declared(limit + 1_000, files), 400, /multipart/);
  await refused(declared(limit + 1_001, files), 413, /request/);
});

add("more files than maxFiles, or than 10, are refused with 400", async () => {
  const two = withFiles(...Array.from({ length: 3 }, () => entry("a.png", "image/png", PNG)));
  const parts: [string, Part][] = [0, 1, 2].map((i) => [`file${i}`, file(PNG, "a.png")]);
  await refused(
    parse([["report", JSON.stringify(two)], ...parts], { maxFiles: 2 }),
    400,
    /more than 2 attachments/,
  );
  const eleven = withFiles(...Array.from({ length: 11 }, () => entry("a.png", "image/png", PNG)));
  await refused(parse([["report", JSON.stringify(eleven)]], true), 400, /report\.attachments /);
});

add(
  "a file over maxBytes, or files over maxTotalBytes together, are refused with 413",
  async () => {
    const one = withFiles(entry("s.txt", "text/plain", TEXT));
    await refused(
      parse(
        [
          ["report", JSON.stringify(one)],
          ["file0", file(TEXT, "s.txt")],
        ],
        { maxBytes: TEXT.length - 1 },
      ),
      413,
      /file0 part is too large/,
    );
    const both = withFiles(entry("a.txt", "text/plain", TEXT), entry("b.txt", "text/plain", TEXT));
    await refused(
      parse(
        [
          ["report", JSON.stringify(both)],
          ["file0", file(TEXT, "a.txt")],
          ["file1", file(TEXT, "b.txt")],
        ],
        { maxTotalBytes: 2 * TEXT.length - 1 },
      ),
      413,
      /too large together/,
    );
  },
);

add("bytes that are not the type they claim are refused with 400, whatever the name", async () => {
  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  const lies: [string, string, Uint8Array][] = [
    ["a.png", "image/png", html],
    ["a.pdf", "application/pdf", PNG],
    ["a.jpg", "image/jpeg", WEBP],
    ["a.gif", "image/gif", html],
    ["a.txt", "text/plain", PNG],
    ["a.txt", "text/plain", new Uint8Array([0x61, 0x00, 0x62])],
    ["a.csv", "text/csv", new Uint8Array([0x61, 0xff, 0x62])],
    ["a.log", "text/plain", PDF],
  ];
  for (const [name, type, data] of lies) {
    await refused(
      parse(
        [
          ["report", JSON.stringify(withFiles(entry(name, type, data)))],
          ["file0", file(data, name, type)],
        ],
        true,
      ),
      400,
      /file0 part is not the/,
    );
  }
});

add("a type off the safe list, or a name that does not end in its type, is refused", async () => {
  const shapes: [string, string][] = [
    ["a.svg", "image/svg+xml"],
    ["a.html", "text/html"],
    ["a.zip", "application/zip"],
    ["a.exe", "image/png"],
    ["a.png.html", "image/png"],
    [".png", "image/png"],
    ["../a.png", "image/png"],
    ["a\\b.png", "image/png"],
    ["a\nb.png", "image/png"],
    ["..", "image/png"],
    [`${"a".repeat(252)}.png`, "image/png"],
    [`${"合".repeat(84)}.png`, "image/png"],
    ["a\u202egnp.exe.png", "image/png"],
    ["a\u0085b.png", "image/png"],
    ["a\u2067b.png", "image/png"],
    ["a\u200fb.png", "image/png"],
    ["a\u061cb.png", "image/png"],
    ["dir/a.png", "image/png"],
    ["a\u0000b.png", "image/png"],
  ];
  for (const [name, type] of shapes) {
    await refused(
      parse([["report", JSON.stringify(withFiles(entry(name, type, PNG)))]], true),
      400,
      /report\.attachments\[0\]\./,
    );
  }
});

add(
  "a missing, doubled, text-only, stray or wrong-size file part is refused with 400",
  async () => {
    const one = JSON.stringify(withFiles(entry("a.png", "image/png", PNG)));
    const cases: [[string, Part][], RegExp][] = [
      [[], /one file0 part/],
      [
        [
          ["file0", file(PNG, "a.png")],
          ["file0", file(PNG, "a.png")],
        ],
        /one file0 part/,
      ],
      [[["file0", "not a file"]], /one file0 part/],
      [
        [
          ["file0", file(PNG, "a.png")],
          ["file1", file(PNG, "a.png")],
        ],
        /file1, with no attachment/,
      ],
      [
        [
          ["file0", file(PNG, "a.png")],
          ["file00", file(PNG, "a.png")],
        ],
        /file00, with no attachment/,
      ],
      [[["file0", file(new Uint8Array([...PNG, 0]), "a.png")]], /not the size/],
    ];
    for (const [parts, message] of cases) {
      await refused(parse([["report", one], ...parts], true), 400, message);
    }
  },
);

add(
  "attachment limits that are not counts or bytes, or above 10 and 15 MB, are host errors",
  async () => {
    const bad = [
      { maxFiles: 11 },
      { maxFiles: 1.5 },
      { maxFiles: -1 },
      { maxBytes: 15_000_001 },
      { maxBytes: Number.NaN },
      { maxTotalBytes: -1 },
      { maxFiles: "10" },
      { maxBytes: null },
      { maxTotalBytes: null },
      { maxBytes: "500" },
      { maxTotalBytes: "300" },
      { maxTotalBytes: Number.NaN },
      { maxFiles: null },
      { maxFiles: 3n },
      { maxBytes: 1_000n },
    ];
    for (const attachments of bad) {
      await assert.rejects(parse([["report", JSON.stringify(bare())]], attachments), RangeError);
    }
  },
);

add("every safe type is taken, by the bytes and the name ending it has", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const gif = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
  const text = (value: string) => new TextEncoder().encode(value);
  const safe: [string, string, Uint8Array][] = [
    ["a.png", "image/png", PNG],
    ["a.JPG", "image/jpeg", jpeg],
    ["a.jpeg", "image/jpeg", jpeg],
    ["a.webp", "image/webp", WEBP],
    ["a.gif", "image/gif", gif],
    ["a.pdf", "application/pdf", PDF],
    ["a.txt", "text/plain", text("plain")],
    ["a.log", "text/plain", text("log line")],
    ["a.csv", "text/csv", text("a,b\n1,2\n")],
    ["a.md", "text/markdown", text("# Steps\n")],
    ["a.json", "application/json", text('{"a":1}')],
  ];
  // Ten at most in one report: the eleventh goes in a request of its own.
  for (const group of [safe.slice(0, 10), safe.slice(10)]) {
    const { report: got } = await parse(
      [
        ["report", JSON.stringify(withFiles(...group.map(([n, t, d]) => entry(n, t, d))))],
        ...group.map(([name, , data], i): [string, Part] => [`file${i}`, file(data, name)]),
      ],
      true,
    );
    assert.deepEqual(
      got.attachments?.map(({ file }) => file.type),
      group.map(([, type]) => type),
    );
  }
});

add("with attachments off, even an empty attachments list is refused", () =>
  refused(
    parse([["report", JSON.stringify({ ...bare(), attachments: [] })]]),
    400,
    /takes no attachments/,
  ),
);

add(
  "the body limit grows by maxTotalBytes when it is the smaller, and by 150 MB for true",
  async () => {
    const limit = 10 * 1_000 + 1_048_576 + 65_536;
    const declared = (length: number, attachments: true | Record<string, number>) =>
      parseFeedbackRequest(
        new Request("https://example.test/", {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data; boundary=x",
            "content-length": String(length),
          },
          body: "not multipart",
        }),
        { maxImageBytes: 1_000, attachments },
      );
    const capped = { maxFiles: 2, maxBytes: 500, maxTotalBytes: 300 };
    await refused(declared(limit + 300, capped), 400, /multipart/);
    await refused(declared(limit + 301, capped), 413, /request/);
    await refused(declared(limit + 150_000_000, true), 400, /multipart/);
    await refused(declared(limit + 150_000_001, true), 413, /request/);
  },
);

add(
  "a maxTotalBytes over maxFiles x maxBytes adds no more, and a partial limit keeps the rest",
  async () => {
    const limit = 10 * 1_000 + 1_048_576 + 65_536;
    const declared = (length: number, attachments: Record<string, number>) =>
      parseFeedbackRequest(
        new Request("https://example.test/", {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data; boundary=x",
            "content-length": String(length),
          },
          body: "not multipart",
        }),
        { maxImageBytes: 1_000, attachments },
      );
    const wide = { maxFiles: 2, maxBytes: 500, maxTotalBytes: 30_000_000 };
    await refused(declared(limit + 1_000, wide), 400, /multipart/);
    await refused(declared(limit + 1_001, wide), 413, /request/);
    // maxFiles alone: each file may still be 15 MB.
    await refused(declared(limit + 30_000_000, { maxFiles: 2 }), 400, /multipart/);
    await refused(declared(limit + 30_000_001, { maxFiles: 2 }), 413, /request/);
  },
);

add("a name of exactly 255 bytes in UTF-8 is taken", async () => {
  const name = `${"合".repeat(83)}${"a".repeat(2)}.png`;
  assert.equal(new TextEncoder().encode(name).length, 255);
  const { report } = await parse(
    [
      ["report", JSON.stringify(withFiles(entry(name, "image/png", PNG)))],
      ["file0", file(PNG, "x")],
    ],
    true,
  );
  assert.equal(report.attachments?.[0]?.name, name);
});

add("an attachments option that is not true, false or an object is a host error", async () => {
  for (const attachments of ["false", "0", 1, 0, null, [], ""]) {
    await assert.rejects(parse([["report", JSON.stringify(bare())]], attachments), RangeError);
  }
  // false is off, as a missing option is.
  await refused(
    parse([["report", JSON.stringify(withFiles(entry("a.png", "image/png", PNG)))]], false),
    400,
    /takes no attachments/,
  );
});

add("limits that are not a plain object, or hold an unknown key, are a host error", async () => {
  class Limits {
    maxFiles = 1;
  }
  const odd: unknown[] = [
    new Map([["maxFiles", 0]]),
    new Boolean(false),
    new String("false"),
    new Date(0),
    new Limits(),
    { maxfiles: 2 },
    { maxFiles: 2, total: 5 },
  ];
  for (const attachments of odd) {
    await assert.rejects(parse([["report", JSON.stringify(bare())]], attachments), RangeError);
  }
  // A plain object with no prototype is still a plain object.
  const bareLimits = Object.assign(Object.create(null), { maxFiles: 1 });
  const { report } = await parse([["report", JSON.stringify(bare())]], bareLimits);
  assert.equal(Object.hasOwn(report, "attachments"), false);
});

add("with attachments on, a file part in a report that declares none is refused", async () => {
  for (const report of [bare(), { ...bare(), attachments: [] }]) {
    await refused(
      parse(
        [
          ["report", JSON.stringify(report)],
          ["file0", file(PNG, "a.png")],
        ],
        true,
      ),
      400,
      /file0, with no attachment/,
    );
  }
});

add("a negative maxBytes is a host error", () =>
  assert.rejects(parse([["report", JSON.stringify(bare())]], { maxBytes: -1 }), RangeError),
);

add("half a surrogate pair in a name becomes U+FFFD, as in all report text", async () => {
  const { report } = await parse(
    [
      ["report", JSON.stringify(withFiles(entry("a\ud83d.png", "image/png", PNG)))],
      ["file0", file(PNG, "x")],
    ],
    true,
  );
  assert.equal(report.attachments?.[0]?.name, "a�.png");
});

add("a safe ending of another safe type is refused: a.pdf sent as a PNG", async () => {
  for (const [name, type] of [
    ["a.pdf", "image/png"],
    ["a.md", "text/plain"],
    ["a.png", "image/jpeg"],
  ]) {
    await refused(
      parse(
        [["report", JSON.stringify(withFiles(entry(name as string, type as string, PNG)))]],
        true,
      ),
      400,
      /report\.attachments\[0\]\.name/,
    );
  }
});

add("with attachments on, an empty attachments list comes back absent", async () => {
  const { report } = await parse(
    [["report", JSON.stringify({ ...bare(), attachments: [] })]],
    true,
  );
  assert.equal(Object.hasOwn(report, "attachments"), false);
});

add("a file exactly at maxBytes, and files exactly at maxTotalBytes, are taken", async () => {
  const both = withFiles(entry("a.txt", "text/plain", TEXT), entry("b.txt", "text/plain", TEXT));
  const { report } = await parse(
    [
      ["report", JSON.stringify(both)],
      ["file0", file(TEXT, "a.txt")],
      ["file1", file(TEXT, "b.txt")],
    ],
    { maxBytes: TEXT.length, maxTotalBytes: 2 * TEXT.length },
  );
  assert.equal(report.attachments?.length, 2);
});

add("an Exif JPEG, a GIF87a, an empty text file and a large image are taken", async () => {
  const exif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]);
  const gif87 = new TextEncoder().encode("GIF87a\x01\x00");
  const empty = new Uint8Array(0);
  // Bigger than maxImageBytes: that limit is for screenshots, never for attachments.
  const big = new Uint8Array(2_000);
  big.set(PNG);
  const files: [string, string, Uint8Array][] = [
    ["a.jpg", "image/jpeg", exif],
    ["a.gif", "image/gif", gif87],
    ["a.txt", "text/plain", empty],
    ["a.png", "image/png", big],
  ];
  const { report } = await parseFeedbackRequest(
    request([
      ["report", JSON.stringify(withFiles(...files.map(([n, t, d]) => entry(n, t, d))))],
      ...files.map(([name, , data], i): [string, Part] => [`file${i}`, file(data, name)]),
    ]),
    { maxImageBytes: 1_000, attachments: true },
  );
  assert.deepEqual(
    report.attachments?.map(({ size, file }) => [size, file.type]),
    files.map(([, type, data]) => [data.length, type]),
  );
});
