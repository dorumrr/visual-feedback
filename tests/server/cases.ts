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
  "a valid report with a PNG image is returned whole, with the image typed from its bytes",
  async () => {
    const { report, image: out } = await parseFeedbackRequest(
      request([
        ["report", JSON.stringify(valid())],
        ["image", image(PNG, "image/png")],
      ]),
    );
    assert.deepEqual({ ...report, image: null }, { ...valid(), image: null });
    assert.ok(out instanceof Blob);
    assert.equal(out.type, "image/png");
    assert.deepEqual(new Uint8Array(await out.arrayBuffer()), PNG);
    assert.equal(report.image, out);
  },
);

add("a valid report with no image part gives a null image", async () => {
  const { report, image: out } = await parseFeedbackRequest(
    request([["report", JSON.stringify({ ...valid(), marks: [] })]]),
  );
  assert.equal(out, null);
  assert.equal(report.image, null);
  assert.deepEqual(report.marks, []);
});

add("the category is kept, and fields the report does not define are dropped", async () => {
  const { report } = await parseFeedbackRequest(
    request([
      ["report", JSON.stringify({ ...valid(), category: "bug", admin: true, image: null })],
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
          marks: [
            { tool: "pen", points: [[1, 2]], extra: 1 },
            { tool: "box", x: 0, y: 0, width: 1, height: 1, extra: 1 },
            { tool: "arrow", from: [0, 0], to: [1, 1], extra: 1 },
            { tool: "text", x: 3, y: 4, text: "cut \ud83d here\u0000", extra: 1 },
            { tool: "text", x: 0, y: 0, text: "x".repeat(280) },
            { tool: "text", x: 0, y: 0, text: "\u{1F600}".repeat(280) },
          ],
        }),
      ],
    ]),
  );
  assert.deepEqual(nested.report.page, { url: "u", title: "t" });
  assert.deepEqual(nested.report.viewport, { width: 1, height: 1, devicePixelRatio: 1 });
  assert.deepEqual(nested.report.scroll, { x: 0, y: 0 });
  assert.deepEqual(nested.report.marks, [
    { tool: "pen", points: [[1, 2]] },
    { tool: "box", x: 0, y: 0, width: 1, height: 1 },
    { tool: "arrow", from: [0, 0], to: [1, 1] },
    { tool: "text", x: 3, y: 4, text: "cut \ufffd here" },
    // The limit counts characters, so 280 emoji (560 UTF-16 units) still fit.
    { tool: "text", x: 0, y: 0, text: "x".repeat(280) },
    { tool: "text", x: 0, y: 0, text: "\u{1F600}".repeat(280) },
  ]);
  assert.equal(
    "category" in
      (await parseFeedbackRequest(request([["report", JSON.stringify(valid())]]))).report,
    false,
  );
});

add(
  "a WebP sent as image/png is returned as image/webp: the declared type is ignored",
  async () => {
    const { image: out } = await parseFeedbackRequest(
      request([
        ["report", JSON.stringify(valid())],
        ["image", image(WEBP, "image/png")],
      ]),
    );
    assert.equal(out?.type, "image/webp");
    const png = await parseFeedbackRequest(
      request([
        ["report", JSON.stringify(valid())],
        ["image", image(PNG, "image/webp")],
      ]),
    );
    assert.equal(png.image?.type, "image/png");
    const webp = await parseFeedbackRequest(
      request([
        ["report", JSON.stringify(valid())],
        ["image", image(WEBP, "image/webp")],
      ]),
    );
    assert.equal(webp.image?.type, "image/webp");
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
  ["an unknown tool", (r) => ({ ...r, marks: [{ tool: "circle" }] }), /report\.marks\[0\]\.tool/],
  [
    "a point with three numbers",
    (r) => ({ ...r, marks: [{ tool: "pen", points: [[1, 2, 3]] }] }),
    /report\.marks\[0\]\.points\[0\]/,
  ],
  [
    "a box with a text width",
    (r) => ({ ...r, marks: [{ tool: "box", x: 0, y: 0, width: "7", height: 1 }] }),
    /report\.marks\[0\]\.width/,
  ],
  [
    "an arrow with no end",
    (r) => ({ ...r, marks: [{ tool: "arrow", from: [0, 0] }] }),
    /report\.marks\[0\]\.to/,
  ],
  [
    "a text label whose text is a number",
    (r) => ({ ...r, marks: [{ tool: "text", x: 0, y: 0, text: 7 }] }),
    /report\.marks\[0\]\.text/,
  ],
  [
    "a text label with no place",
    (r) => ({ ...r, marks: [{ tool: "text", x: 0, text: "hi" }] }),
    /report\.marks\[0\]\.y/,
  ],
  [
    "a text label over 280 characters",
    (r) => ({ ...r, marks: [{ tool: "text", x: 0, y: 0, text: "x".repeat(281) }] }),
    /report\.marks\[0\]\.text/,
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
    (r) => ({ ...r, image: "data:image/png;base64,AAAA" }),
    /report\.image/,
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

const required = [
  "id",
  "createdAt",
  "note",
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
      parseFeedbackRequest(request([["report", JSON.stringify({ ...valid(), marks: {} })]])),
      400,
      /report\.marks /,
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
    (r) => ({ ...r, marks: [{ tool: "box", x: "INF", y: 0, width: 1, height: 1 }] }),
    /report\.marks\[0\]\.x/,
  ],
  [
    "a point",
    (r) => ({ ...r, marks: [{ tool: "pen", points: [[0, "INF"]] }] }),
    /report\.marks\[0\]\.points\[0\]/,
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
  const json = JSON.stringify(valid()).replace(
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
  const json = JSON.stringify(valid()).replace(
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
  const { report: out, image: got } = await parseFeedbackRequest(
    request([
      ["report", JSON.stringify({ ...report, note })],
      ["image", image(data, "image/png")],
    ]),
    { maxImageBytes: data.byteLength },
  );
  assert.equal(new Blob([JSON.stringify({ ...report, note })]).size, 1_048_576);
  assert.equal(out.note.length, note.length);
  assert.equal(got?.size, data.byteLength);
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
    const json = JSON.stringify({ ...valid(), note: "a\u0000b \ud83d c", userAgent: "x\udc00y" });
    const { report } = await parseFeedbackRequest(request([["report", json]]));
    assert.equal(report.note, "ab \ufffd c");
    assert.equal(report.userAgent, "x\ufffdy");
    // A whole pair is kept.
    const pair = await parseFeedbackRequest(
      request([["report", JSON.stringify({ ...valid(), note: "ok \ud83d\ude00" })]]),
    );
    assert.equal(pair.report.note, "ok \ud83d\ude00");
  },
);

add("context text is cleaned the same way, keys and nested values included", async () => {
  const json = JSON.stringify({
    ...valid(),
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
  await refused(parseFeedbackRequest(request([["image", image(PNG, "image/png")]])), 400);
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
          ["image", image(PNG, "image/png")],
          ["image", image(PNG, "image/png")],
        ]),
      ),
      400,
    );
    await refused(
      parseFeedbackRequest(
        request([
          ["report", json],
          ["image", "iVBORw0KGgo"],
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
            ["image", image(data, declared)],
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
          ["image", image(PNG, "image/png")],
        ]),
        {
          maxImageBytes,
        },
      );
    await refused(send(PNG.byteLength - 1), 413, /image/);
    assert.equal((await send(PNG.byteLength)).image?.size, PNG.byteLength);
  },
);

add("the default maxImageBytes is 10 000 000", async () => {
  const sized = (size: number) => {
    const data = new Uint8Array(size);
    data.set(PNG);
    return parseFeedbackRequest(
      request([
        ["report", JSON.stringify(valid())],
        ["image", image(data, "image/png")],
      ]),
    );
  };
  assert.equal((await sized(10_000_000)).image?.size, 10_000_000);
  await refused(sized(10_000_001), 413, /image/);
});

add(
  "a body over maxImageBytes plus 1 MiB is refused with 413 while it streams, without reading the rest",
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
