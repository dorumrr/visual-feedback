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

/** Builds the report and checks it with the same shape check the server uses. */
export async function build(
  draft: { note: string; category: string | undefined; marks: Mark[] },
  image: Blob | null,
  seen: Seen,
  settings: Settings,
): Promise<FeedbackReport> {
  const context = (await host(() => settings.context?.())) ?? {};
  const report = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    note: draft.note,
    ...(draft.category === undefined ? {} : { category: draft.category }),
    marks: image ? draft.marks : [],
    page: { url: pageUrl(seen.url, Boolean(settings.redactUrl)), title: seen.title },
    viewport: seen.viewport,
    scroll: seen.scroll,
    userAgent: navigator.userAgent,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    context,
  };
  return { ...checkReport(report), image };
}

/** Sends with onSubmit, or else POSTs what parseFeedbackRequest reads to the endpoint. */
export async function deliver(report: FeedbackReport, settings: Settings): Promise<void> {
  const { onSubmit, endpoint } = settings;
  if (onSubmit) return host(() => onSubmit(report));
  if (!endpoint) throw new Error("Neither onSubmit nor endpoint is set.");
  const body = new FormData();
  body.append("report", JSON.stringify({ ...report, image: undefined }));
  if (report.image) {
    const extension = report.image.type === "image/png" ? "png" : "webp";
    body.append("image", report.image, `${report.id}.${extension}`);
  }
  const { headers: given } = settings;
  const headers = typeof given === "function" ? await host(given) : (given ?? {});
  // A redirect is a failure: an expired session can send a login page that answers 200.
  const response = await fetch(endpoint, { method: "POST", body, headers, redirect: "manual" });
  if (!response.ok) throw new Error(`The endpoint answered ${response.status}.`);
}
