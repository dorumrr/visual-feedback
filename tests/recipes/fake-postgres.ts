// A fake of the postgres client, as far as the recipe uses it: postgres(url, options), sql.json,
// sql.begin with its transaction's tagged template, and sql(rows) for a bulk insert.
type Report = { id: string; user_id: string; created_at: Date; report: unknown };
type Shot = { report_id: string; position: number; image: Uint8Array | null; image_type: string };
type Json = { json: unknown };
type Rows = { rows: Record<string, unknown>[] };
type Tx = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<{ id: string }[]>;
  (rows: Record<string, unknown>[]): Rows;
};

export const store = {
  clients: [] as { url: string; options: Record<string, unknown> }[],
  reports: [] as Report[],
  shots: [] as Shot[],
  // Stands in for a database that refuses the screenshot rows, such as a full disk.
  refuseShots: false,
};

const REPORT =
  "insert into feedback_reports (id, user_id, created_at, report) values (?, ?, ?, ?) on conflict (id) do nothing returning id";
const SHOTS = "insert into feedback_screenshots ?";
const SHOT_COLUMNS = ["report_id", "position", "image", "image_type"];

const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

// jsonb refuses what JSON text allows: a NUL, and half of a surrogate pair.
function storable(value: unknown): boolean {
  if (typeof value === "string") return !value.includes("\u0000") && !LONE.test(value);
  if (Array.isArray(value)) return value.every(storable);
  if (value && typeof value === "object") {
    return Object.entries(value).every(([key, item]) => storable(key) && storable(item));
  }
  return true;
}

// The rows a transaction adds, seen with the committed ones, and kept only by its commit.
type Pending = { reports: Report[]; shots: Shot[] };

function insert(
  added: Pending,
  strings: TemplateStringsArray,
  values: unknown[],
): { id: string }[] {
  const reports = [...store.reports, ...added.reports];
  const shots = [...store.shots, ...added.shots];
  const text = strings.join("?").replace(/\s+/g, " ").trim();
  if (text === REPORT) {
    const [id, user, createdAt, value] = values as [string, string, string, Json];
    if (!(value && "json" in value)) throw new Error("report is not sent as sql.json");
    if (!storable(value.json)) throw new Error("unsupported Unicode escape sequence");
    if (reports.some((row) => row.id === id)) return [];
    const report = JSON.parse(JSON.stringify(value.json));
    added.reports.push({ id, user_id: user, created_at: new Date(createdAt), report });
    return [{ id }];
  }
  if (text === SHOTS) {
    const [{ rows }] = values as [Rows];
    if (store.refuseShots) throw new Error("refused");
    for (const row of rows) {
      const keys = Object.keys(row).sort();
      if (keys.join() !== [...SHOT_COLUMNS].sort().join()) throw new Error(`columns ${keys}`);
      const shot = row as Shot;
      if (!reports.some((report) => report.id === shot.report_id)) throw new Error("foreign key");
      if (shots.some((s) => s.report_id === shot.report_id && s.position === shot.position)) {
        throw new Error("duplicate key");
      }
      shots.push(shot);
      added.shots.push(shot);
    }
    return [];
  }
  throw new Error(`the fake has no statement: ${text}`);
}

export default function postgres(url: string, options: Record<string, unknown> = {}) {
  store.clients.push({ url, options });
  return {
    json: (json: unknown): Json => ({ json }),
    // As Postgres: a failed statement aborts the rest, and its commit keeps nothing.
    async begin(fn: (tx: Tx) => Promise<unknown>): Promise<void> {
      const added: Pending = { reports: [], shots: [] };
      let state: "open" | "aborted" | "ended" = "open";
      const run = (strings: TemplateStringsArray, values: unknown[]) => {
        if (state === "ended") throw new Error("the transaction has ended");
        if (state === "aborted") throw new Error("current transaction is aborted");
        try {
          return insert(added, strings, values);
        } catch (error) {
          state = "aborted";
          throw error;
        }
      };
      const tx = ((
        first: TemplateStringsArray | Record<string, unknown>[],
        ...values: unknown[]
      ) =>
        "raw" in first ? Promise.resolve().then(() => run(first, values)) : { rows: first }) as Tx;
      let done = false;
      try {
        await fn(tx);
        done = true;
      } finally {
        const kept = done && state === "open";
        state = "ended";
        if (kept) {
          store.reports.push(...added.reports);
          store.shots.push(...added.shots);
        }
      }
    },
  };
}
