const status = document.getElementById("status");
const list = document.getElementById("reports");
const empty = document.getElementById("empty");
const panel = document.getElementById("reports-panel");
const toggle = document.getElementById("reports-toggle");
const count = document.getElementById("reports-count");

function open(shown) {
  panel.hidden = !shown;
  toggle.setAttribute("aria-expanded", String(shown));
}
toggle.addEventListener("click", () => open(panel.hidden));
document.getElementById("reports-close").addEventListener("click", () => open(false));

function show(report) {
  const item = document.createElement("li");
  item.className = "report";
  const title = document.createElement("h3");
  title.textContent = report.note || "(no note)";
  item.append(title);
  for (const [i, { image }] of report.screenshots.entries()) {
    const url = URL.createObjectURL(image);
    const img = document.createElement("img");
    img.src = url;
    img.alt = `Screenshot ${i + 1}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.id}-${i}.${image.type === "image/png" ? "png" : "webp"}`;
    link.textContent = `Download screenshot ${i + 1} (${image.type}, ${image.size} bytes)`;
    item.append(img, link);
  }
  const screenshots = report.screenshots.map((shot) => ({ ...shot, image: "Blob" }));
  const details = document.createElement("pre");
  details.textContent = JSON.stringify({ ...report, screenshots }, null, 2);
  item.append(details);
  list.prepend(item);
  empty.hidden = true;
  count.textContent = String(list.children.length);
  open(true);
}

window.playground = { show };

let pkg;
try {
  pkg = await import("../dist/index.mjs");
} catch (error) {
  status.textContent = `Could not load dist/index.mjs: ${error}. Run npm run build or npm run dev.`;
}
if (pkg && typeof pkg.createFeedback === "function") {
  try {
    const widget = pkg.createFeedback({ onSubmit: async (report) => show(report) });
    status.textContent = "Widget loaded. Use the feedback button.";
    const hint = document.getElementById("hint");
    const done = () => {
      hint.hidden = true;
    };
    // No element where the browser lacks what the widget needs: then it has no trigger to point at.
    const host = document.querySelector("visual-feedback");
    if (host) {
      hint.hidden = false;
      // Capture phase: the hint must be gone before the trigger's own click starts the screenshot.
      host.addEventListener("click", done, { capture: true });
      widget.on("open", done);
    }
  } catch (error) {
    status.textContent = `The package loaded, but createFeedback failed: ${error}`;
  }
} else if (pkg) {
  status.textContent = "The package loaded, but it has no createFeedback.";
}
