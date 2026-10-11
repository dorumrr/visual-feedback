type Rgba = [number, number, number, number];

const BUTTONS = 'button,[role="button"],input[type="submit"],input[type="button"]';
// Enough to see a site's style; reading every element of a long page would cost a frame.
const SAMPLE = 200;

let pixel: CanvasRenderingContext2D | null | undefined;

/** A colour as sRGB bytes and alpha; syntax other than rgb() (oklch, hex, names) goes through a canvas. */
function rgb(color: string): Rgba | undefined {
  const match = /^rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+)(%?))?\)/.exec(color);
  if (match) {
    const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1);
    return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
  }
  // One 1x1 canvas for every read: a page in oklch() would otherwise make hundreds per open.
  if (pixel === undefined) {
    const canvas = Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
    pixel = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!pixel || !color) return undefined;
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = "#0000";
  pixel.fillStyle = color;
  pixel.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = pixel.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

function luminance([r, g, b]: Rgba): number {
  const linear = (c: number) =>
    c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const css = ([r, g, b]: Rgba) => `rgb(${r} ${g} ${b})`;
const opaque = (color: Rgba | undefined): color is Rgba => (color?.[3] ?? 0) > 0.99;
// A brand colour has hue: greys, near white and near black are a site's neutrals.
function vivid(color: Rgba | undefined): color is Rgba {
  if (!opaque(color)) return false;
  const max = Math.max(color[0], color[1], color[2]);
  const min = Math.min(color[0], color[1], color[2]);
  const light = (max + min) / 510;
  return (max - min) / 255 >= 0.2 && light > 0.1 && light < 0.9;
}

function visible(element: Element): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function commonest(colors: Rgba[]): Rgba | undefined {
  const counts = new Map<string, [Rgba, number]>();
  for (const color of colors) {
    const entry = counts.get(css(color)) ?? [color, 0];
    counts.set(css(color), [entry[0], entry[1] + 1]);
  }
  return [...counts.values()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function themeColor(): Rgba | undefined {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute("media");
    if (!media || matchMedia(media).matches) return rgb(meta.content.trim());
  }
  return undefined;
}

/**
 * Takes the page's own accent, corners and, with `theme: "auto"`, background and text, where the
 * host set no --vf-* for them. Each guess that fails contrast falls back to the defaults.
 */
export function match(wrapper: HTMLElement, theme: string | undefined): void {
  const style = wrapper.style;
  // "initial" makes var() take its fallback, and stops a page's own --_* from leaking in.
  for (const name of ["--_pa", "--_pm", "--_pr", "--_ps", "--_pt"])
    style.setProperty(name, "initial");
  style.colorScheme = theme?.replace("auto", "") ?? "";
  // Styles of an element not on the page read as empty.
  if (!document.body || !wrapper.isConnected) return;
  // A guess that fails on an odd page leaves the defaults; it never breaks the widget.
  try {
    guess(wrapper, theme, document.body);
  } catch {}
}

function guess(wrapper: HTMLElement, theme: string | undefined, body: HTMLElement): void {
  const style = wrapper.style;
  const own = getComputedStyle(wrapper);
  const free = (variable: string) => !own.getPropertyValue(variable).trim();

  if ((theme ?? "auto") === "auto" && free("--vf-surface") && free("--vf-text")) {
    const background = [body, document.documentElement]
      .map((element) => rgb(getComputedStyle(element).backgroundColor))
      .find(opaque);
    const text = rgb(getComputedStyle(body).color);
    if (background && opaque(text) && contrast(background, text) >= 4.5) {
      style.setProperty("--_ps", css(background));
      style.setProperty("--_pt", css(text));
      // Hints are the text at 60%; on a page of mid-grey text they take more of it, to stay 4.5:1.
      const mixed = (share: number): Rgba => [
        share * text[0] + (1 - share) * background[0],
        share * text[1] + (1 - share) * background[1],
        share * text[2] + (1 - share) * background[2],
        1,
      ];
      let share = 0.6;
      while (share < 1 && contrast(background, mixed(share)) < 4.5) share += 0.05;
      if (share > 0.6) style.setProperty("--_pm", css(mixed(Math.min(1, share))));
      // Above this luminance black text contrasts more than white: the page is light.
      style.colorScheme = luminance(background) > 0.179 ? "light" : "dark";
    }
  }

  // A button the site never styled shows the browser's look, light or dark: a page that allows
  // both lets the browser pick, so either counts.
  const browser = new Map<string, string>();
  const plain = (scheme: string) => {
    if (!browser.has(scheme)) {
      const native = wrapper.appendChild(document.createElement("button"));
      native.style.all = "revert";
      native.style.colorScheme = scheme;
      const look = getComputedStyle(native);
      browser.set(scheme, `${look.backgroundColor} ${look.borderTopLeftRadius}`);
      native.remove();
    }
    return browser.get(scheme);
  };
  const filled = [...document.querySelectorAll(BUTTONS)]
    .slice(0, SAMPLE)
    .filter(visible)
    .map((button) => [button, getComputedStyle(button)] as const)
    .filter(([, look]) => {
      const face = `${look.backgroundColor} ${look.borderTopLeftRadius}`;
      return face !== plain("light") && face !== plain("dark");
    });

  if (free("--vf-radius")) {
    const shapes = filled
      .filter(([, look]) => opaque(rgb(look.backgroundColor)))
      .map(([button, look]) => {
        const radius = Number.parseFloat(look.borderTopLeftRadius) || 0;
        return { radius, pill: radius * 2 >= button.getBoundingClientRect().height - 1 };
      });
    const corners = shapes.filter((shape) => !shape.pill).map((shape) => shape.radius);
    corners.sort((a, b) => a - b);
    const middle = corners[Math.floor((corners.length - 1) / 2)];
    // A site of pills says nothing about corners: the widget keeps its own. Its buttons take
    // the radius divided by 1.6, so they end up with the page's.
    if (middle !== undefined && corners.length * 2 > shapes.length) {
      style.setProperty("--_pr", `${Math.min(24, middle * 1.6)}px`);
    }
  }

  if (free("--vf-accent")) {
    const links = () =>
      [...document.querySelectorAll("a[href]")]
        .slice(0, SAMPLE)
        .filter(visible)
        .map((link) => rgb(getComputedStyle(link).color))
        .filter(vivid);
    const accent = [
      themeColor(),
      commonest(filled.map(([, look]) => rgb(look.backgroundColor)).filter(vivid)),
      commonest(links()),
    ].find(vivid);
    const probe = wrapper.appendChild(document.createElement("i"));
    probe.style.background = "var(--_s)";
    const surface = rgb(getComputedStyle(probe).backgroundColor);
    probe.remove();
    // 3:1 is the contrast WCAG asks of a control against what surrounds it.
    if (accent && opaque(surface) && contrast(accent, surface) >= 3) {
      style.setProperty("--_pa", css(accent));
    }
  }
}
