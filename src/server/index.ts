import {
  ATTACHMENT_BYTES,
  ATTACHMENT_LIMIT,
  type Attachment,
  checkReport,
  type FeedbackReport,
  REPORT_LIMIT,
  type ReportFields,
  SCREENSHOT_LIMIT,
  TEXT_TYPES,
} from "../shared/report";

export type { Attachment, FeedbackReport, Mark, Screenshot } from "../shared/report";

const DEFAULT_MAX_IMAGE_BYTES = 10_000_000;
// Room for the multipart boundaries and part headers around every part.
const FRAMING_BYTES = 65_536;
const IMAGE_PART = /^image\d+$/;
const FILE_PART = /^file\d+$/;
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

/** The type a file's own bytes show, or null for none a report may carry. */
function fileType(bytes: Uint8Array, claimed: string): string | null {
  const image = imageType(bytes);
  if (image) return image;
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  if (header.startsWith("%PDF-")) return "application/pdf";
  // Text has no magic bytes: it is text when it is all UTF-8, with no NUL in it.
  if (!TEXT_TYPES.includes(claimed) || bytes.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return claimed;
}

type Files = { maxFiles?: number; maxBytes?: number; maxTotalBytes?: number };
const LIMIT_KEYS = ["maxFiles", "maxBytes", "maxTotalBytes"];

function fileLimits(given: boolean | Files | undefined) {
  if (given === undefined || given === false) return undefined;
  // A string such as "false" from a config file, or a Map or a typo in a key, must not turn them on.
  if (given !== true) {
    const proto = typeof given === "object" && given !== null && Object.getPrototypeOf(given);
    if (proto !== Object.prototype && proto !== null) {
      throw new RangeError("attachments must be true, false or a plain object of limits.");
    }
    const unknown = Object.keys(given).find((key) => !LIMIT_KEYS.includes(key));
    if (unknown) throw new RangeError(`attachments has no limit named ${unknown}.`);
  }
  const { maxFiles = ATTACHMENT_LIMIT, maxBytes = ATTACHMENT_BYTES } = given === true ? {} : given;
  if (!Number.isInteger(maxFiles) || maxFiles < 0 || maxFiles > ATTACHMENT_LIMIT) {
    throw new RangeError(
      `attachments.maxFiles must be a whole number from 0 to ${ATTACHMENT_LIMIT}.`,
    );
  }
  if (typeof maxBytes !== "number" || !(maxBytes >= 0 && maxBytes <= ATTACHMENT_BYTES)) {
    throw new RangeError(
      `attachments.maxBytes must be a number of bytes up to ${ATTACHMENT_BYTES}.`,
    );
  }
  // Only after both are numbers: a BigInt would throw a TypeError when multiplied.
  const maxTotalBytes =
    given === true || given.maxTotalBytes === undefined ? maxFiles * maxBytes : given.maxTotalBytes;
  if (typeof maxTotalBytes !== "number" || !(maxTotalBytes >= 0))
    throw new RangeError("attachments.maxTotalBytes must be a number of bytes.");
  return { maxFiles, maxBytes, maxTotalBytes: Math.min(maxTotalBytes, maxFiles * maxBytes) };
}

async function checkFile(part: File, claimed: Omit<Attachment, "file">, i: number): Promise<Blob> {
  if (part.size !== claimed.size) {
    throw new FeedbackRequestError(
      400,
      `The file${i} part is not the size attachments[${i}] gives.`,
    );
  }
  const head = new Uint8Array(
    await part.slice(0, TEXT_TYPES.includes(claimed.type) ? part.size : 12).arrayBuffer(),
  );
  const type = fileType(head, claimed.type);
  if (type !== claimed.type) {
    throw new FeedbackRequestError(
      400,
      `The file${i} part is not the ${claimed.type} it says it is.`,
    );
  }
  return part.slice(0, part.size, type);
}

export async function parseFeedbackRequest(
  request: Request,
  limits: { maxImageBytes?: number; attachments?: boolean | Files } = {},
): Promise<{ report: FeedbackReport }> {
  const maxImageBytes = limits.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (!(maxImageBytes >= 0)) throw new RangeError("maxImageBytes must be a number of bytes.");
  const files = fileLimits(limits.attachments);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new FeedbackRequestError(400, "The request is not multipart/form-data.");
  }
  const body = await read(
    request,
    SCREENSHOT_LIMIT * maxImageBytes + (files?.maxTotalBytes ?? 0) + REPORT_LIMIT + FRAMING_BYTES,
  );
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new FeedbackRequestError(400, "The multipart body cannot be read.");
  }
  const reports = form.getAll("report");
  const [json] = reports;
  if (reports.length !== 1 || typeof json !== "string") {
    throw new FeedbackRequestError(400, "The request needs one report part, as text.");
  }
  if (form.has("image")) {
    throw new FeedbackRequestError(
      400,
      "The request has an image part named image; visual-feedback 0.2 sends image0, image1 and on.",
    );
  }
  if (new Blob([json]).size > REPORT_LIMIT) {
    throw new FeedbackRequestError(413, "The report is too large.");
  }
  let fields: ReportFields;
  try {
    // A host that merges context into its own objects must never meet a __proto__ key.
    fields = checkReport(
      JSON.parse(json, (key, value) => (key === "__proto__" ? undefined : value)),
    );
  } catch (error) {
    throw new FeedbackRequestError(400, error instanceof Error ? error.message : "Bad report.");
  }
  const count = fields.screenshots.length;
  const expected = new Set(Array.from({ length: count }, (_, i) => `image${i}`));
  for (const name of form.keys()) {
    if (IMAGE_PART.test(name) && !expected.has(name)) {
      throw new FeedbackRequestError(
        400,
        `The request has an image part, ${name}, with no screenshot.`,
      );
    }
  }
  const images: Blob[] = [];
  for (let i = 0; i < count; i++) {
    const parts = form.getAll(`image${i}`);
    const [part] = parts;
    if (parts.length !== 1 || typeof part === "string" || !part) {
      throw new FeedbackRequestError(400, `The request needs one image${i} part, as a file.`);
    }
    images.push(await checkImage(part, maxImageBytes));
  }
  const screenshots = fields.screenshots.map((shot, i) => ({ ...shot, image: images[i] as Blob }));
  const { attachments: claimed, ...rest } = fields;
  const parts = [...form.keys()].filter((name) => FILE_PART.test(name));
  if (!files) {
    if (claimed !== undefined || parts.length) {
      throw new FeedbackRequestError(400, "This endpoint takes no attachments.");
    }
    return { report: { ...rest, screenshots } };
  }
  const list = claimed ?? [];
  if (list.length > files.maxFiles) {
    throw new FeedbackRequestError(400, `The report has more than ${files.maxFiles} attachments.`);
  }
  for (const name of parts) {
    if (Number(name.slice(4)) >= list.length || name !== `file${Number(name.slice(4))}`) {
      throw new FeedbackRequestError(
        400,
        `The request has a file part, ${name}, with no attachment.`,
      );
    }
  }
  let total = 0;
  const attachments: Attachment[] = [];
  for (const [i, entry] of list.entries()) {
    const found = form.getAll(`file${i}`);
    const [part] = found;
    if (found.length !== 1 || typeof part === "string" || !part) {
      throw new FeedbackRequestError(400, `The request needs one file${i} part, as a file.`);
    }
    if (part.size > files.maxBytes)
      throw new FeedbackRequestError(413, `The file${i} part is too large.`);
    total += part.size;
    if (total > files.maxTotalBytes)
      throw new FeedbackRequestError(413, "The attachments are too large together.");
    attachments.push({ ...entry, file: await checkFile(part, entry, i) });
  }
  return { report: { ...rest, screenshots, ...(attachments.length ? { attachments } : {}) } };
}
