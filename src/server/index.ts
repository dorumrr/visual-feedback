import { checkReport, type FeedbackReport } from "../shared/report";

export type { FeedbackReport, Mark } from "../shared/report";

const DEFAULT_MAX_IMAGE_BYTES = 10_000_000;
// The report part's own cap; the body may hold it beside the image.
const REPORT_BYTES = 1_048_576;
// Room for the multipart boundaries and part headers around both parts.
const FRAMING_BYTES = 65_536;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export class FeedbackRequestError extends Error {
  readonly status: 400 | 413;

  constructor(status: 400 | 413, message: string) {
    super(message);
    this.name = "FeedbackRequestError";
    this.status = status;
  }
}

// Reads at most `limit` bytes, so an oversized body is refused before it fills memory.
async function read(request: Request, limit: number): Promise<Blob> {
  if (Number(request.headers.get("content-length")) > limit) {
    throw new FeedbackRequestError(413, "The request is too large.");
  }
  if (!request.body) throw new FeedbackRequestError(400, "The request has no body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    let next: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>;
    try {
      next = await reader.read();
    } catch {
      throw new FeedbackRequestError(400, "The request body broke off.");
    }
    const { done, value } = next;
    if (done) return new Blob(chunks);
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new FeedbackRequestError(413, "The request is too large.");
    }
    chunks.push(value);
  }
}

function imageType(bytes: Uint8Array): string | null {
  if (PNG.every((byte, i) => bytes[i] === byte)) return "image/png";
  const header = String.fromCharCode(...bytes.subarray(0, 12));
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

async function checkImage(part: File, maxImageBytes: number): Promise<Blob> {
  if (part.size > maxImageBytes) throw new FeedbackRequestError(413, "The image is too large.");
  const type = imageType(new Uint8Array(await part.slice(0, 12).arrayBuffer()));
  if (!type) throw new FeedbackRequestError(400, "The image is not a PNG or WebP.");
  return part.slice(0, part.size, type);
}

export async function parseFeedbackRequest(
  request: Request,
  limits: { maxImageBytes?: number } = {},
): Promise<{ report: FeedbackReport; image: Blob | null }> {
  const maxImageBytes = limits.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (!(maxImageBytes >= 0)) throw new RangeError("maxImageBytes must be a number of bytes.");
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new FeedbackRequestError(400, "The request is not multipart/form-data.");
  }
  const body = await read(request, maxImageBytes + REPORT_BYTES + FRAMING_BYTES);
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new FeedbackRequestError(400, "The multipart body cannot be read.");
  }
  const reports = form.getAll("report");
  const images = form.getAll("image");
  const [json] = reports;
  const [part] = images;
  if (reports.length !== 1 || typeof json !== "string") {
    throw new FeedbackRequestError(400, "The request needs one report part, as text.");
  }
  if (images.length > 1 || typeof part === "string") {
    throw new FeedbackRequestError(
      400,
      "The request has more than one image, or an image as text.",
    );
  }
  if (new Blob([json]).size > REPORT_BYTES) {
    throw new FeedbackRequestError(413, "The report is too large.");
  }
  let fields: Omit<FeedbackReport, "image">;
  try {
    // A host that merges context into its own objects must never meet a __proto__ key.
    fields = checkReport(
      JSON.parse(json, (key, value) => (key === "__proto__" ? undefined : value)),
    );
  } catch (error) {
    throw new FeedbackRequestError(400, error instanceof Error ? error.message : "Bad report.");
  }
  const image = part ? await checkImage(part, maxImageBytes) : null;
  return { report: { ...fields, image }, image };
}
