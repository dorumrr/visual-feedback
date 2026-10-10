import { type Mark, TEXT_LIMIT } from "./shared/report";

export type Tool = Mark["tool"];

type Point = [number, number];
type Line = Exclude<Mark, { tool: "text" }>;

export type Annotator = {
  tool: Tool;
  readonly marks: readonly Mark[];
  /** Keeps a stroke still being drawn, so the image and the marks agree when it is sent. */
  end(): void;
  undo(): void;
  clear(): void;
};

// Not capture.ts's own: a static import of that chunk makes WebKit fetch it a second time.
function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const result = canvas.getContext("2d");
  if (!result) throw new Error("no 2d context");
  return result;
}

function arrowHead(target: CanvasRenderingContext2D, [x1, y1]: Point, [x2, y2]: Point): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = target.lineWidth * 4;
  for (const side of [-1, 1]) {
    target.moveTo(x2, y2);
    target.lineTo(
      x2 - size * Math.cos(angle + (side * Math.PI) / 6),
      y2 - size * Math.sin(angle + (side * Math.PI) / 6),
    );
  }
}

function stroke(target: CanvasRenderingContext2D, mark: Line): void {
  target.beginPath();
  if (mark.tool === "pen") {
    for (const [i, [x, y]] of mark.points.entries()) {
      if (i === 0) target.moveTo(x, y);
      else target.lineTo(x, y);
    }
  } else if (mark.tool === "box") {
    target.rect(mark.x, mark.y, mark.width, mark.height);
  } else {
    target.moveTo(...mark.from);
    target.lineTo(...mark.to);
    arrowHead(target, mark.from, mark.to);
  }
  target.stroke();
}

// A click without a drag draws nothing, so it leaves no invisible mark in the report.
function drawn(mark: Mark): boolean {
  if (mark.tool === "text") return mark.text.trim() !== "";
  if (mark.tool === "pen") return mark.points.length > 1;
  if (mark.tool === "box") return mark.width > 0 || mark.height > 0;
  return mark.from[0] !== mark.to[0] || mark.from[1] !== mark.to[1];
}

/** Draws on `canvas` in image pixels, and repaints it from a clean copy on every change. */
export function annotate(
  canvas: HTMLCanvasElement,
  onChange: () => void,
  textLabel: string,
): Annotator {
  const clean = document.createElement("canvas");
  clean.width = canvas.width;
  clean.height = canvas.height;
  context(clean).drawImage(canvas, 0, 0);
  const target = context(canvas);
  const marks: Mark[] = [];
  let current: { id: number; start: Point; mark: Line } | null = null;
  // The label being typed, and where it goes in image pixels.
  let editing: { input: HTMLInputElement; at: Point } | null = null;
  // One size for every label, in image pixels, so it scales with the image like the lines.
  const size = Math.max(16, Math.round(canvas.width / 60));
  const outline = Math.max(3, size / 5);

  function paint(): void {
    // snapdom leaves its pixel-ratio scale on the context; marks and the copy are in image pixels.
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(clean, 0, 0);
    // The canvas has color: var(--vf-mark), so the host's value resolves here, at paint time.
    target.strokeStyle = getComputedStyle(canvas).color;
    target.lineWidth = Math.max(4, Math.round(canvas.width / 240));
    target.lineCap = "round";
    target.lineJoin = "round";
    for (const mark of current ? [...marks, current.mark] : marks) {
      if (mark.tool !== "text") {
        stroke(target, mark);
        continue;
      }
      // A white outline under the mark colour reads on any background.
      target.save();
      target.font = font();
      target.textBaseline = "middle";
      target.lineWidth = outline;
      target.strokeStyle = "#fff";
      // Wider than the image: squeezed to fit, never cut off.
      const room = canvas.width - mark.x;
      target.strokeText(mark.text, mark.x, mark.y, room);
      target.fillStyle = getComputedStyle(canvas).color;
      target.fillText(mark.text, mark.x, mark.y, room);
      target.restore();
    }
  }

  function font(): string {
    return `600 ${size}px ${getComputedStyle(canvas).fontFamily}`;
  }

  function write(keep: boolean): void {
    if (!editing) return;
    const { input, at } = editing;
    editing = null;
    input.remove();
    target.font = font();
    // Near an edge, the label moves in so all of it, outline included, is in the image.
    const room = canvas.width - target.measureText(input.value).width - outline;
    const x = Math.round(Math.max(outline, Math.min(at[0], room)));
    const half = size / 2 + outline;
    const y = Math.round(Math.max(half, Math.min(at[1], canvas.height - half)));
    const mark: Mark = { tool: "text", x, y, text: input.value };
    if (!keep || !drawn(mark)) return;
    marks.push(mark);
    paint();
    onChange();
  }

  function place(at: Point): void {
    const input = document.createElement("input");
    input.className = "text-input";
    input.setAttribute("part", "text-input");
    input.setAttribute("aria-label", textLabel);
    input.maxLength = TEXT_LIMIT;
    const scale = canvas.clientWidth / canvas.width;
    // Placed over the image, at the click, at the size the label will be painted.
    input.style.top = `${canvas.offsetTop + canvas.clientTop + at[1] * scale}px`;
    input.style.fontSize = `${size * scale}px`;
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      // That Enter picks a word in a Japanese, Chinese or Korean input method; Safari sends 229.
      if (event.isComposing || event.keyCode === 229) return;
      // Escape drops this label only; the dialog stays open.
      event.preventDefault();
      event.stopPropagation();
      write(event.key === "Enter");
    });
    input.addEventListener("blur", () => write(true));
    canvas.after(input);
    // Less its own border and padding, so the typed text sits where it will be painted.
    const inset = input.clientLeft + Number.parseFloat(getComputedStyle(input).paddingLeft);
    input.style.left = `${canvas.offsetLeft + canvas.clientLeft + at[0] * scale - inset}px`;
    editing = { input, at };
    input.focus();
  }

  function point(event: PointerEvent): Point {
    const box = canvas.getBoundingClientRect();
    const x = ((event.clientX - box.left - canvas.clientLeft) * canvas.width) / canvas.clientWidth;
    const y = ((event.clientY - box.top - canvas.clientTop) * canvas.height) / canvas.clientHeight;
    return [
      Math.round(Math.min(canvas.width, Math.max(0, x))),
      Math.round(Math.min(canvas.height, Math.max(0, y))),
    ];
  }

  function shape(tool: Line["tool"], start: Point, end: Point): Line {
    if (tool === "pen") return { tool, points: [start] };
    if (tool === "arrow") return { tool, from: start, to: end };
    return {
      tool,
      x: Math.min(start[0], end[0]),
      y: Math.min(start[1], end[1]),
      width: Math.abs(end[0] - start[0]),
      height: Math.abs(end[1] - start[1]),
    };
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (current || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const start = point(event);
    if (annotator.tool === "text") {
      // The default is prevented, so the open label never blurs: it is kept here.
      write(true);
      place(start);
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    current = { id: event.pointerId, start, mark: shape(annotator.tool, start, start) };
  });
  function extend(event: PointerEvent): void {
    if (!current) return;
    const end = point(event);
    const last = current.mark.tool === "pen" ? current.mark.points.at(-1) : undefined;
    if (current.mark.tool === "pen") {
      if (last?.[0] !== end[0] || last?.[1] !== end[1]) current.mark.points.push(end);
    } else current.mark = shape(current.mark.tool, current.start, end);
  }

  function end(): void {
    write(true);
    if (!current) return;
    if (drawn(current.mark)) marks.push(current.mark);
    current = null;
    paint();
    onChange();
  }

  canvas.addEventListener("pointermove", (event) => {
    if (current?.id !== event.pointerId) return;
    // A release the canvas never heard of (a context menu took it): the stroke ends there.
    if (event.buttons === 0) return end();
    extend(event);
    paint();
  });
  // The release point counts too: the last move can fall short of it.
  canvas.addEventListener("pointerup", (event) => {
    if (current?.id !== event.pointerId) return;
    extend(event);
    end();
  });
  // The browser took the pointer (a gesture, a lost capture): keep what was drawn, not its last point.
  for (const type of ["pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(type, (event) => {
      if (current?.id === (event as PointerEvent).pointerId) end();
    });
  }

  const annotator: Annotator = {
    tool: "pen",
    marks,
    end,
    undo() {
      marks.pop();
      paint();
      onChange();
    },
    clear() {
      marks.length = 0;
      paint();
      onChange();
    },
  };
  return annotator;
}
