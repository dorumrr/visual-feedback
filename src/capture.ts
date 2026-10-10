import { look, shots } from "./seen";

export type CaptureOptions = {
  mode?: "dom" | "display";
  maxWidth?: number;
  type?: "image/webp" | "image/png";
  quality?: number;
};

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = canvas.getContext("2d");
  if (!result) throw new Error("no 2d context");
  return result;
}

// The page background paints the whole viewport, beyond the root element's own box.
function background(): string {
  for (const element of [document.documentElement, document.body]) {
    const color = element ? getComputedStyle(element).backgroundColor : "";
    if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
  }
  // No page colour: the browser paints Canvas, which follows the page's colour scheme.
  const probe = document.createElement("i");
  probe.style.backgroundColor = "Canvas";
  document.documentElement.append(probe);
  try {
    return getComputedStyle(probe).backgroundColor;
  } finally {
    probe.remove();
  }
}

function scaled(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxWidth: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxWidth / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  context(canvas).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

let active = 0;

// An image it cannot read (cross-origin without CORS) becomes its grey placeholder, not a failure.
async function dom(maxWidth: number): Promise<HTMLCanvasElement> {
  const { snapdom } = await import("@zumer/snapdom");
  active++;
  try {
    // snapdom() copies the page; toCanvas() renders the copy later, which can be slow.
    const page = look();
    const result = await snapdom(document.documentElement, {
      clip: "viewport",
      scale: 1,
      dpr: Math.min(devicePixelRatio, maxWidth / document.documentElement.clientWidth),
      backgroundColor: background(),
    });
    // The viewport can be wider than the width the ratio was taken from (a scrollbar).
    const canvas = await result.toCanvas();
    const shot =
      canvas.width > maxWidth ? scaled(canvas, canvas.width, canvas.height, maxWidth) : canvas;
    shots.set(shot, page);
    return shot;
  } finally {
    // Its image-decoding iframe stays in <body> after a capture; it makes a new one when needed.
    if (--active === 0) {
      for (const frame of document.querySelectorAll("body > iframe[data-snapdom-internal]")) {
        frame.remove();
      }
    }
  }
}

async function display(stream: MediaStream, maxWidth: number): Promise<HTMLCanvasElement> {
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    // A stream that never plays would keep the widget opening for good; dom capture takes over.
    let wait: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        video.play(),
        new Promise((_, reject) => {
          wait = setTimeout(() => reject(new Error("no video frame")), 2000);
        }),
      ]);
    } finally {
      clearTimeout(wait);
    }
    if (!video.videoWidth) throw new Error("no video frame");
    const shot = scaled(video, video.videoWidth, video.videoHeight, maxWidth);
    shots.set(shot, look());
    return shot;
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

/** `stream` is the getDisplayMedia answer for mode "display", asked for by the caller. */
export async function capture(
  options: CaptureOptions = {},
  stream?: Promise<MediaStream>,
): Promise<HTMLCanvasElement> {
  const maxWidth = options.maxWidth ?? 1920;
  if (stream) {
    try {
      return await display(await stream, maxWidth);
    } catch {
      // Refused, cancelled or unsupported: SPEC §5 falls back to "dom".
    }
  }
  return dom(maxWidth);
}

export function encode(
  canvas: HTMLCanvasElement,
  options: { type?: string | undefined; quality?: number | undefined } = {},
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not encode the image"))),
      options.type ?? "image/webp",
      options.quality ?? 0.85,
    ),
  );
}
