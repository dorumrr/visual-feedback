const SVG = "http://www.w3.org/2000/svg";

/** A line icon in a 24 by 24 box, hidden from screen readers. */
export function icon(d: string, part: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const path = document.createElementNS(SVG, "path");
  const attributes = {
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linejoin": "round",
    part,
  };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}
