type Encode = (
  canvas: HTMLCanvasElement,
  options: { type: string; quality: number },
) => Promise<Blob>;

// Every page is as wide as A4, so a viewer shows each screenshot at the same width.
const WIDTH = 595.28;

/** A PDF 1.4 of JPEG pages, one per canvas, made in the browser with no library. */
export async function pdf(pages: HTMLCanvasElement[], encode: Encode): Promise<Blob> {
  const text = new TextEncoder();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const offsets: number[] = [];
  let size = 0;
  const add = (part: string | Uint8Array<ArrayBuffer>) => {
    const bytes = typeof part === "string" ? text.encode(part) : part;
    parts.push(bytes);
    size += bytes.length;
  };
  const begin = (n: number, head: string) => {
    offsets[n] = size;
    add(`${n} 0 obj\n${head}\n`);
  };
  // The second line's bytes above 127 tell a reader the file holds binary data.
  add("%PDF-1.4\n%âãÏÓ\n");
  begin(1, "<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  const kids = pages.map((_, i) => `${3 + 3 * i} 0 R`).join(" ");
  begin(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj`);
  for (const [i, page] of pages.entries()) {
    const jpeg = new Uint8Array(
      await (await encode(page, { type: "image/jpeg", quality: 0.9 })).arrayBuffer(),
    );
    const height = ((page.height * WIDTH) / page.width).toFixed(2);
    const n = 3 + 3 * i;
    begin(
      n,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${height}] /Resources << /XObject << /I ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>\nendobj`,
    );
    const draw = `q ${WIDTH} 0 0 ${height} 0 0 cm /I Do Q`;
    begin(n + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream\nendobj`);
    begin(
      n + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream`,
    );
    add(jpeg);
    add("\nendstream\nendobj\n");
  }
  const xref = size;
  const count = offsets.length;
  const rows = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  add(`xref\n0 ${count}\n0000000000 65535 f \n${rows}`);
  add(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

/** The first page: the category and the note, then the first screenshot under them, if any. */
export function cover(
  note: string,
  category: string | undefined,
  image: HTMLCanvasElement | undefined,
  font: string,
): HTMLCanvasElement {
  const width = image?.width ?? 1200;
  const scale = width / 1200;
  const size = Math.round(22 * scale);
  const line = Math.round(size * 1.4);
  const margin = Math.round(40 * scale);
  const page = document.createElement("canvas");
  const context = page.getContext("2d");
  if (!context) throw new Error("no 2d context");
  const lines: [string, string][] = [];
  const wrap = (paragraph: string, weight: string) => {
    context.font = `${weight} ${size}px ${font}`;
    let row = "";
    // Character by character, so text with no spaces (Chinese, a long URL) wraps too.
    for (const char of paragraph) {
      if (row && context.measureText(row + char).width > width - 2 * margin) {
        const space = row.lastIndexOf(" ");
        const cut = char !== " " && space > 0 ? space : row.length;
        lines.push([weight, row.slice(0, cut)]);
        row = row.slice(cut).trimStart();
      }
      row += char;
    }
    lines.push([weight, row]);
  };
  if (category) wrap(category, "600");
  for (const paragraph of (note || " ").split("\n")) wrap(paragraph, "400");
  const top = margin * 2 + lines.length * line;
  page.width = width;
  page.height = top + (image?.height ?? 0);
  // Setting the size clears the canvas and its font, so drawing starts here.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, page.width, page.height);
  context.fillStyle = "#111";
  context.textBaseline = "top";
  for (const [i, [weight, row]] of lines.entries()) {
    context.font = `${weight} ${size}px ${font}`;
    context.fillText(row, margin, margin + i * line);
  }
  if (image) context.drawImage(image, 0, top);
  return page;
}
