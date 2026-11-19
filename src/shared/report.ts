export type Mark =
  | { tool: "pen"; points: [number, number][] }
  | { tool: "box"; x: number; y: number; width: number; height: number }
  | { tool: "arrow"; from: [number, number]; to: [number, number] }
  | { tool: "text"; x: number; y: number; text: string };

/** The longest text label the widget lets a user type, and the server accepts. */
export const TEXT_LIMIT = 280;

/** The most screenshots one report holds, in the widget and on the server. */
export const SCREENSHOT_LIMIT = 10;

/** The most UTF-8 bytes of the report part, its images aside, the server accepts. */
export const REPORT_LIMIT = 1_048_576;

/** The most files one report holds, and the most bytes each, wherever a host sets lower ones. */
export const ATTACHMENT_LIMIT = 10;
export const ATTACHMENT_BYTES = 15_000_000;

/** The file types a report may carry, by type, with the name endings each may have. */
export const ATTACHMENT_TYPES: Readonly<Record<string, readonly string[]>> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt", ".log"],
  "text/csv": [".csv"],
  "text/markdown": [".md"],
  "application/json": [".json"],
};

/** The types above that have no magic bytes: their files must be UTF-8 text. */
export const TEXT_TYPES: readonly string[] = [
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
];

type Page = { url: string; title: string };
type Viewport = { width: number; height: number; devicePixelRatio: number };
type Scroll = { x: number; y: number };

export type Screenshot = {
  image: Blob;
  marks: Mark[];
  page: Page;
  viewport: Viewport;
  scroll: Scroll;
};

export type Attachment = {
  file: Blob;
  name: string;
  type: string;
  size: number;
};

export type FeedbackReport = {
  id: string;
  createdAt: string;
  note: string;
  category?: string;
  screenshots: Screenshot[];
  attachments?: Attachment[];
  page: Page;
  viewport: Viewport;
  scroll: Scroll;
  userAgent: string;
  language: string;
  timeZone: string;
  context: Record<string, unknown>;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Fields = Record<string, unknown>;

function fail(path: string): never {
  throw new TypeError(`report.${path} has the wrong shape`);
}

function object(value: unknown, path: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path);
  return value as Fields;
}

// Postgres jsonb, and other stores, refuse NUL and half a surrogate pair, such as a cut emoji.
const UNSTORABLE = /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const storable = (text: string) =>
  text.replace(UNSTORABLE, (found) => (found === "\0" ? "" : "\uFFFD"));

function string(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path);
  return storable(value);
}

// Only JSON's own shapes are walked; a host's Date or Map in context is left as it is.
function storableDeep(value: unknown): unknown {
  if (typeof value === "string") return storable(value);
  if (Array.isArray(value)) return value.map(storableDeep);
  if (value === null || typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  // Cleaning can turn "\0__proto__" into "__proto__", which Object.fromEntries would then keep.
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [storable(key), storableDeep(item)] as const)
      .filter(([key]) => key !== "__proto__"),
  );
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path);
  return value;
}

function point(value: unknown, path: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) fail(path);
  return [number(value[0], path), number(value[1], path)];
}

function mark(value: unknown, path: string): Mark {
  const fields = object(value, path);
  if (fields.tool === "pen") {
    if (!Array.isArray(fields.points)) fail(`${path}.points`);
    return {
      tool: "pen",
      points: fields.points.map((item, i) => point(item, `${path}.points[${i}]`)),
    };
  }
  if (fields.tool === "box") {
    return {
      tool: "box",
      x: number(fields.x, `${path}.x`),
      y: number(fields.y, `${path}.y`),
      width: number(fields.width, `${path}.width`),
      height: number(fields.height, `${path}.height`),
    };
  }
  if (fields.tool === "arrow") {
    return {
      tool: "arrow",
      from: point(fields.from, `${path}.from`),
      to: point(fields.to, `${path}.to`),
    };
  }
  if (fields.tool === "text") {
    const text = string(fields.text, `${path}.text`);
    if ([...text].length > TEXT_LIMIT) fail(`${path}.text`);
    return {
      tool: "text",
      x: number(fields.x, `${path}.x`),
      y: number(fields.y, `${path}.y`),
      text,
    };
  }
  return fail(`${path}.tool`);
}

/** A report as JSON carries it: each screenshot without its image, each attachment without its file. */
export type ReportFields = Omit<FeedbackReport, "screenshots" | "attachments"> & {
  screenshots: Omit<Screenshot, "image">[];
  attachments?: Omit<Attachment, "file">[];
};

function facts(fields: Fields, path: string): Pick<Screenshot, "page" | "viewport" | "scroll"> {
  const at = path ? `${path}.` : "";
  const page = object(fields.page, `${at}page`);
  const viewport = object(fields.viewport, `${at}viewport`);
  const scroll = object(fields.scroll, `${at}scroll`);
  return {
    page: { url: string(page.url, `${at}page.url`), title: string(page.title, `${at}page.title`) },
    viewport: {
      width: number(viewport.width, `${at}viewport.width`),
      height: number(viewport.height, `${at}viewport.height`),
      devicePixelRatio: number(viewport.devicePixelRatio, `${at}viewport.devicePixelRatio`),
    },
    scroll: { x: number(scroll.x, `${at}scroll.x`), y: number(scroll.y, `${at}scroll.y`) },
  };
}

// A path could leave a store's folder; a control or bidi character could disguise the name's ending.
const unsafeName = (name: string) =>
  name === "." ||
  name === ".." ||
  [...name].some(
    (char) =>
      char === "/" ||
      char === "\\" ||
      char < " " ||
      (char >= "\u007f" && char <= "\u009f") ||
      char === "\u061c" ||
      char === "\u200e" ||
      char === "\u200f" ||
      (char >= "\u202a" && char <= "\u202e") ||
      (char >= "\u2066" && char <= "\u2069"),
  );

function attachment(value: unknown, path: string): Omit<Attachment, "file"> {
  const fields = object(value, path);
  if (fields.file !== undefined && fields.file !== null) fail(`${path}.file`);
  // Checked before NULs are dropped, so a name with one is refused, not changed.
  if (typeof fields.name === "string" && unsafeName(fields.name)) fail(`${path}.name`);
  const name = string(fields.name, `${path}.name`);
  const type = string(fields.type, `${path}.type`);
  const endings = Object.hasOwn(ATTACHMENT_TYPES, type) ? ATTACHMENT_TYPES[type] : undefined;
  const lower = name.toLowerCase();
  if (!name || new TextEncoder().encode(name).length > 255 || unsafeName(name))
    fail(`${path}.name`);
  if (!endings) fail(`${path}.type`);
  if (!endings.some((ending) => lower.endsWith(ending) && lower.length > ending.length)) {
    fail(`${path}.name`);
  }
  const size = number(fields.size, `${path}.size`);
  if (!Number.isInteger(size) || size < 0) fail(`${path}.size`);
  return { name, type, size };
}

function screenshot(value: unknown, path: string): Omit<Screenshot, "image"> {
  const fields = object(value, path);
  // The images travel beside the JSON, never inside it.
  if (fields.image !== undefined && fields.image !== null) fail(`${path}.image`);
  if (!Array.isArray(fields.marks)) fail(`${path}.marks`);
  return {
    marks: fields.marks.map((item, i) => mark(item, `${path}.marks[${i}]`)),
    ...facts(fields, path),
  };
}

/**
 * The one shape check for a report without its images, as JSON carries it. Returns a copy that
 * holds only the known fields, or throws a TypeError that names the first wrong field.
 */
export function checkReport(value: unknown): ReportFields {
  const fields = object(value, "");
  // The id names stored files, so it must not carry a path.
  if (typeof fields.id !== "string" || !UUID_V4.test(fields.id)) fail("id");
  const createdAt = string(fields.createdAt, "createdAt");
  // Only toISOString's own output prints back unchanged: Date.parse rolls 30 February to March.
  const time = Date.parse(createdAt);
  // The widget's own time is always 1970 to 9999; stores such as Postgres refuse years outside it.
  const valid = time >= 0 && time < Date.UTC(10000, 0, 1);
  if (!valid || new Date(time).toISOString() !== createdAt) fail("createdAt");
  const shots = fields.screenshots;
  if (!Array.isArray(shots) || shots.length > SCREENSHOT_LIMIT) fail("screenshots");
  const files = fields.attachments;
  if (files !== undefined && (!Array.isArray(files) || files.length > ATTACHMENT_LIMIT)) {
    fail("attachments");
  }
  return {
    id: fields.id,
    createdAt,
    note: string(fields.note, "note"),
    ...(fields.category === undefined ? {} : { category: string(fields.category, "category") }),
    screenshots: shots.map((item, i) => screenshot(item, `screenshots[${i}]`)),
    ...(files === undefined
      ? {}
      : { attachments: files.map((item, i) => attachment(item, `attachments[${i}]`)) }),
    ...facts(fields, ""),
    userAgent: string(fields.userAgent, "userAgent"),
    language: string(fields.language, "language"),
    timeZone: string(fields.timeZone, "timeZone"),
    context: storableDeep(object(fields.context, "context")) as Record<string, unknown>,
  };
}
