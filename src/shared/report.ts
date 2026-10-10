export type Mark =
  | { tool: "pen"; points: [number, number][] }
  | { tool: "box"; x: number; y: number; width: number; height: number }
  | { tool: "arrow"; from: [number, number]; to: [number, number] };

export type FeedbackReport = {
  id: string;
  createdAt: string;
  note: string;
  category?: string;
  image: Blob | null;
  marks: Mark[];
  page: { url: string; title: string };
  viewport: { width: number; height: number; devicePixelRatio: number };
  scroll: { x: number; y: number };
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
  return fail(`${path}.tool`);
}

/**
 * The one shape check for a report without its image, as JSON carries it. Returns a copy that
 * holds only the known fields, or throws a TypeError that names the first wrong field.
 */
export function checkReport(value: unknown): Omit<FeedbackReport, "image"> {
  const fields = object(value, "");
  // The id names stored files, so it must not carry a path.
  if (typeof fields.id !== "string" || !UUID_V4.test(fields.id)) fail("id");
  const createdAt = string(fields.createdAt, "createdAt");
  // Only toISOString's own output prints back unchanged: Date.parse rolls 30 February to March.
  const time = Date.parse(createdAt);
  // The widget's own time is always 1970 to 9999; stores such as Postgres refuse years outside it.
  const valid = time >= 0 && time < Date.UTC(10000, 0, 1);
  if (!valid || new Date(time).toISOString() !== createdAt) fail("createdAt");
  if (fields.image !== undefined && fields.image !== null) fail("image");
  if (!Array.isArray(fields.marks)) fail("marks");
  const page = object(fields.page, "page");
  const viewport = object(fields.viewport, "viewport");
  const scroll = object(fields.scroll, "scroll");
  return {
    id: fields.id,
    createdAt,
    note: string(fields.note, "note"),
    ...(fields.category === undefined ? {} : { category: string(fields.category, "category") }),
    marks: fields.marks.map((item, i) => mark(item, `marks[${i}]`)),
    page: { url: string(page.url, "page.url"), title: string(page.title, "page.title") },
    viewport: {
      width: number(viewport.width, "viewport.width"),
      height: number(viewport.height, "viewport.height"),
      devicePixelRatio: number(viewport.devicePixelRatio, "viewport.devicePixelRatio"),
    },
    scroll: { x: number(scroll.x, "scroll.x"), y: number(scroll.y, "scroll.y") },
    userAgent: string(fields.userAgent, "userAgent"),
    language: string(fields.language, "language"),
    timeZone: string(fields.timeZone, "timeZone"),
    context: storableDeep(object(fields.context, "context")) as Record<string, unknown>,
  };
}
