import type { Seen } from "./seen";
import { checkReport, type FeedbackReport, type Mark } from "./shared/report";

// getRandomValues, not randomUUID: randomUUID needs a secure context, and plain http must work.
function uuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pageUrl(href: string, redact: boolean): string {
  if (!redact) return href;
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return url.href;
}

export type Settings = {
  onSubmit?: ((report: FeedbackReport) => Promise<void>) | undefined;
  endpoint?: string | undefined;
  headers?: Record<string, string> | (() => Record<string, string>) | undefined;
  context?: (() => Record<string, unknown> | Promise<Record<string, unknown>>) | undefined;
  redactUrl?: boolean | undefined;
};

// The last error a host function threw, by identity: a string, or an Error from another frame.
let fromHost: unknown;

async function host<T>(call: () => T | Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    fromHost = error;
    throw error;
  }
}

/** The host's own error message, the only one the user is shown. */
export function shown(error: unknown): string | undefined {
  if (error !== fromHost) return undefined;
  const message = typeof error === "string" ? error : (error as { message?: unknown })?.message;
  return typeof message === "string" && message ? message : undefined;
}

/** One encoded screenshot, its marks, and the page as it was when it was taken. */
export type Shot = { image: Blob; marks: Mark[]; seen: Seen };

/** Builds the report and checks it with the same shape check the server uses. */
export async function build(
  draft: { note: string; category: string | undefined },
  shots: Shot[],
  seen: Seen,
  settings: Settings,
): Promise<FeedbackReport> {
  const context = (await host(() => settings.context?.())) ?? {};
  const facts = ({ url, title, viewport, scroll }: Seen) => ({
    page: { url: pageUrl(url, Boolean(settings.redactUrl)), title },
    viewport,
    scroll,
  });
  const report = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    note: draft.note,
    ...(draft.category === undefined ? {} : { category: draft.category }),
    screenshots: shots.map((shot) => ({ marks: shot.marks, ...facts(shot.seen) })),
    ...facts(seen),
    userAgent: navigator.userAgent,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    context,
  };
  const checked = checkReport(report);
  const screenshots = checked.screenshots.map((shot, i) => ({
    ...shot,
    image: (shots[i] as Shot).image,
  }));
  return { ...checked, screenshots };
}

/** How long a send may take before it fails as a TimeoutError. */
const SEND_TIMEOUT = 30_000;

// The errors this module's own limit made, so a host's own TimeoutError keeps its message.
const limits = new WeakSet<object>();

/** Whether the send failed on the widget's own 30 second limit. */
export function late(error: unknown): boolean {
  return typeof error === "object" && error !== null && limits.has(error);
}

/** Sends with onSubmit, or else POSTs what parseFeedbackRequest reads to the endpoint. */
export async function deliver(report: FeedbackReport, settings: Settings): Promise<void> {
  const stop = new AbortController();
  const timer = setTimeout(() => {
    const error = new DOMException("The send took over 30 seconds.", "TimeoutError");
    limits.add(error);
    stop.abort(error);
  }, SEND_TIMEOUT);
  // A host's promise cannot be stopped, only no longer waited for.
  const late = new Promise<never>((_, reject) =>
    stop.signal.addEventListener("abort", () => reject(stop.signal.reason), { once: true }),
  );
  try {
    return await Promise.race([send(report, settings, stop.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function send(
  report: FeedbackReport,
  settings: Settings,
  signal: AbortSignal,
): Promise<void> {
  const { onSubmit, endpoint } = settings;
  if (onSubmit) return host(() => onSubmit(report));
  if (!endpoint) throw new Error("Neither onSubmit nor endpoint is set.");
  const body = new FormData();
  const screenshots = report.screenshots.map(({ image: _, ...shot }) => shot);
  body.append("report", JSON.stringify({ ...report, screenshots }));
  for (const [i, { image }] of report.screenshots.entries()) {
    const extension = image.type === "image/png" ? "png" : "webp";
    body.append(`image${i}`, image, `${report.id}-${i}.${extension}`);
  }
  const { headers: given } = settings;
  const headers = typeof given === "function" ? await host(given) : (given ?? {});
  // A redirect is a failure: an expired session can send a login page that answers 200.
  const response = await fetch(endpoint, {
    method: "POST",
    body,
    headers,
    redirect: "manual",
    signal,
  });
  if (!response.ok) throw new Error(`The endpoint answered ${response.status}.`);
}
