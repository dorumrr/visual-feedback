import { type Mark, TEXT_LIMIT } from "./shared/report";

export type Tool = Mark["tool"] | "select";

type Point = [number, number];
type Line = Exclude<Mark, { tool: "text" }>;
type Box = { x: number; y: number; width: number; height: number };
// What Undo takes back: a mark added, a mark moved from where it was, or a mark removed.
type Step = { kind: "add" } | { kind: "move" | "remove"; index: number; mark: Mark };

export type Annotator = {
  tool: Tool;
  /** The screenshot as it was taken, with no mark on it. */
  readonly clean: HTMLCanvasElement;
  readonly marks: readonly Mark[];
  readonly canUndo: boolean;
  readonly selected: boolean;
  /** Keeps a stroke still being drawn, so the image and the marks agree when it is sent. */
  end(): void;
  undo(): void;
  clear(): void;
  /** Removes the selected mark. */
  remove(): void;
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

function distance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy) : 0;
  const s = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + s * dx), py - (ay + s * dy));
}

function moved(mark: Mark, dx: number, dy: number): Mark {
  const by = ([x, y]: Point): Point => [x + dx, y + dy];
  if (mark.tool === "pen") return { ...mark, points: mark.points.map(by) };
  if (mark.tool === "arrow") return { ...mark, from: by(mark.from), to: by(mark.to) };
  return { ...mark, x: mark.x + dx, y: mark.y + dy };
}

// A click without a drag draws nothing, so it leaves no invisible mark in the report.
function drawn(mark: Mark): boolean {
  if (mark.tool === "text") return mark.text.trim() !== "";
  if (mark.tool === "pen") return mark.points.length > 1;
  if (mark.tool === "box") return mark.width > 0 || mark.height > 0;
  return mark.from[0] !== mark.to[0] || mark.from[1] !== mark.to[1];
}

/**
 * Douglas-Peucker: a slow drag records a point for each pixel moved. A point within a pixel of the
 * line its neighbours draw changes nothing a 4 px stroke shows, and only grows the report.
 */
function simplify(points: Point[], tolerance = 1): Point[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const spans: [number, number][] = [[0, points.length - 1]];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [from, to] = span;
    const a = points[from] as Point;
    const b = points[to] as Point;
    let far = -1;
    let most = tolerance;
    for (let i = from + 1; i < to; i++) {
      // To the segment, not the line through it: a stroke that turns back keeps its turn.
      const off = distance(points[i] as Point, a, b);
      if (off > most) {
        most = off;
        far = i;
      }
    }
    if (far === -1) continue;
    keep[far] = 1;
    spans.push([from, far], [far, to]);
  }
  return points.filter((_, i) => keep[i]);
}

/** Draws on `canvas` in image pixels, and repaints it from a clean copy on every change. */
export function annotate(
  canvas: HTMLCanvasElement,
  onChange: () => void,
  textLabel: string,
  kept: readonly Mark[] = [],
): Annotator {
  const clean = document.createElement("canvas");
  clean.width = canvas.width;
  clean.height = canvas.height;
  context(clean).drawImage(canvas, 0, 0);
  const target = context(canvas);
  // Marks a draft kept from an earlier page; Undo starts after them.
  const marks: Mark[] = [...kept];
  const history: Step[] = [];
  let tool: Tool = "pen";
  let selected: number | null = null;
  // The selected mark as it was when the drag began, and where the drag began.
  let dragging: { id: number; start: Point; mark: Mark } | null = null;
  let hovered: Point | null = null;
  let frame: HTMLDivElement | null = null;
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
    outlineSelection();
    hover();
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

  /** The box a mark covers in image pixels, its line and outline included. */
  function bounds(mark: Mark): Box {
    if (mark.tool === "box") {
      const pad = target.lineWidth / 2;
      return {
        x: mark.x - pad,
        y: mark.y - pad,
        width: mark.width + 2 * pad,
        height: mark.height + 2 * pad,
      };
    }
    if (mark.tool === "text") {
      target.save();
      target.font = font();
      const width = target.measureText(mark.text).width;
      target.restore();
      const half = size / 2 + outline;
      return {
        x: mark.x - outline,
        y: mark.y - half,
        width: width + 2 * outline,
        height: 2 * half,
      };
    }
    const points = mark.tool === "pen" ? mark.points : [mark.from, mark.to];
    // An arrow's head reaches four line widths past its end.
    const pad = target.lineWidth * (mark.tool === "arrow" ? 4 : 0.5);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
  }

  /** The newest mark under a point, near its line, or inside a label. */
  function hit(at: Point): number | null {
    // About ten screen pixels, so a thin line is easy to pick.
    const near = Math.max(target.lineWidth * 2, (10 * canvas.width) / canvas.clientWidth);
    for (let index = marks.length - 1; index >= 0; index--) {
      const mark = marks[index] as Mark;
      if (mark.tool === "text") {
        const box = bounds(mark);
        if (
          at[0] >= box.x &&
          at[0] <= box.x + box.width &&
          at[1] >= box.y &&
          at[1] <= box.y + box.height
        ) {
          return index;
        }
        continue;
      }
      const corners: Point[] =
        mark.tool === "box"
          ? [
              [mark.x, mark.y],
              [mark.x + mark.width, mark.y],
              [mark.x + mark.width, mark.y + mark.height],
              [mark.x, mark.y + mark.height],
              [mark.x, mark.y],
            ]
          : mark.tool === "arrow"
            ? [mark.from, mark.to]
            : mark.points;
      const segments = corners.length > 1 ? corners.slice(1) : corners;
      if (segments.some((to, i) => distance(at, corners[i] as Point, to) <= near)) return index;
    }
    return null;
  }

  /** The mark moved by up to dx and dy; it never goes further out, and is never pushed in. */
  function within(mark: Mark, dx: number, dy: number): Mark {
    const box = bounds(mark);
    // Limits round inward, so a mark never ends up even half a pixel further out.
    const limit = (by: number, start: number, size: number, room: number) =>
      Math.max(
        Math.ceil(Math.min(0, -start)),
        Math.min(Math.round(by), Math.floor(Math.max(0, room - start - size))),
      );
    const x = limit(dx, box.x, box.width, canvas.width);
    const y = limit(dy, box.y, box.height, canvas.height);
    return x || y ? moved(mark, x, y) : mark;
  }

  // Above the image, never painted into it, so it never reaches the sent image.
  function outlineSelection(): void {
    const mark = selected === null ? undefined : marks[selected];
    if (!mark) {
      frame?.remove();
      frame = null;
      return;
    }
    if (!frame) {
      frame = document.createElement("div");
      frame.className = "selection";
      frame.setAttribute("part", "selection");
      canvas.after(frame);
    }
    const box = bounds(mark);
    const scale = canvas.clientWidth / canvas.width;
    // A few screen pixels outside the mark, so the dashes never sit on its own line.
    const gap = 4;
    frame.style.left = `${canvas.offsetLeft + canvas.clientLeft + box.x * scale - gap}px`;
    frame.style.top = `${canvas.offsetTop + canvas.clientTop + box.y * scale - gap}px`;
    frame.style.width = `${box.width * scale + 2 * gap}px`;
    frame.style.height = `${box.height * scale + 2 * gap}px`;
  }

  function select(index: number | null): void {
    if (index === selected) return;
    // A drag still under way is recorded first, so Undo can take it back.
    finishDrag();
    selected = index;
    paint();
    onChange();
  }

  // A key or a button can move or remove the mark under a pointer that has not moved.
  function hover(): void {
    if (tool !== "select" || dragging) return;
    canvas.style.cursor = hovered !== null && hit(hovered) !== null ? "grab" : "default";
  }

  function finishDrag(): void {
    const before = dragging?.mark;
    dragging = null;
    if (before) hover();
    if (!before || selected === null) return;
    if (marks[selected] !== before) history.push({ kind: "move", index: selected, mark: before });
    onChange();
  }

  function nudge(dx: number, dy: number): void {
    if (selected === null) return;
    finishDrag();
    const before = marks[selected] as Mark;
    const after = within(before, dx, dy);
    if (after === before) return;
    marks[selected] = after;
    history.push({ kind: "move", index: selected, mark: before });
    paint();
    onChange();
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
    history.push({ kind: "add" });
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
    if (tool === "select") {
      // Focused, so arrow keys and Delete work on what was just picked.
      canvas.focus({ preventScroll: true });
      const index = hit(start);
      select(index);
      if (index === null) return;
      canvas.setPointerCapture(event.pointerId);
      dragging = { id: event.pointerId, start, mark: marks[index] as Mark };
      canvas.style.cursor = "grabbing";
      return;
    }
    if (tool === "text") {
      // The default is prevented, so the open label never blurs: it is kept here.
      write(true);
      place(start);
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    current = { id: event.pointerId, start, mark: shape(tool, start, start) };
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
    finishDrag();
    select(null);
    if (!current) return;
    if (current.mark.tool === "pen") current.mark.points = simplify(current.mark.points);
    if (drawn(current.mark)) {
      marks.push(current.mark);
      history.push({ kind: "add" });
    }
    current = null;
    paint();
    onChange();
  }

  canvas.addEventListener("pointermove", (event) => {
    hovered = point(event);
    hover();
    if (dragging?.id === event.pointerId && selected !== null) {
      if (event.buttons === 0) return finishDrag();
      const [x, y] = point(event);
      marks[selected] = within(dragging.mark, x - dragging.start[0], y - dragging.start[1]);
      paint();
      return;
    }
    if (current?.id !== event.pointerId) return;
    // A release the canvas never heard of (a context menu took it): the stroke ends there.
    if (event.buttons === 0) return end();
    extend(event);
    paint();
  });
  // The release point counts too: the last move can fall short of it.
  canvas.addEventListener("pointerup", (event) => {
    if (dragging?.id === event.pointerId) return finishDrag();
    if (current?.id !== event.pointerId) return;
    extend(event);
    end();
  });
  canvas.addEventListener("pointerleave", () => {
    hovered = null;
  });
  // The browser took the pointer (a gesture, a lost capture): keep what was drawn, not its last point.
  for (const type of ["pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(type, (event) => {
      if (dragging?.id === (event as PointerEvent).pointerId) finishDrag();
      else if (current?.id === (event as PointerEvent).pointerId) end();
    });
  }
  canvas.addEventListener("keydown", (event) => {
    if (selected === null) return;
    // Whole image pixels, so left and right steps are the same size.
    const step =
      Math.max(1, Math.round(canvas.width / canvas.clientWidth)) * (event.shiftKey ? 10 : 1);
    const moves: Record<string, Point> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const by = moves[event.key];
    if (by) nudge(...by);
    else if (event.key === "Delete" || event.key === "Backspace") annotator.remove();
    // Escape lets go of the selection first; the next Escape closes the dialog.
    else if (event.key === "Escape") select(null);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });

  const annotator: Annotator = {
    clean,
    get tool() {
      return tool;
    },
    set tool(next) {
      tool = next;
      // Only Select takes keys on the image, so only then is it in the Tab order.
      if (next === "select") canvas.tabIndex = 0;
      else canvas.removeAttribute("tabindex");
      select(null);
      // Drawing tools keep the stylesheet's crosshair.
      if (next === "select") hover();
      else canvas.style.cursor = "";
    },
    marks,
    get canUndo() {
      return history.length > 0;
    },
    get selected() {
      return selected !== null;
    },
    end,
    undo() {
      finishDrag();
      const step = history.pop();
      if (!step) return;
      if (step.kind === "add") marks.pop();
      else if (step.kind === "move") marks[step.index] = step.mark;
      else marks.splice(step.index, 0, step.mark);
      selected = null;
      paint();
      onChange();
    },
    clear() {
      finishDrag();
      marks.length = 0;
      history.length = 0;
      selected = null;
      paint();
      onChange();
    },
    remove() {
      finishDrag();
      if (selected === null) return;
      const [mark] = marks.splice(selected, 1);
      if (mark) history.push({ kind: "remove", index: selected, mark });
      selected = null;
      paint();
      onChange();
    },
  };
  if (marks.length) paint();
  return annotator;
}
