const status = document.getElementById("status");
const list = document.getElementById("reports");
const empty = document.getElementById("empty");

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
}

window.playground = { show };

let pkg;
try {
  pkg = await import("/dist/index.mjs");
} catch (error) {
  status.textContent = `Could not load /dist/index.mjs: ${error}. Run npm run build or npm run dev.`;
}
if (pkg && typeof pkg.createFeedback === "function") {
  try {
    pkg.createFeedback({ onSubmit: async (report) => show(report) });
    status.textContent = "Widget loaded. Use the feedback button.";
  } catch (error) {
    status.textContent = `The package loaded, but createFeedback failed: ${error}`;
  }
} else if (pkg) {
  status.textContent = "The package loaded, but it has no createFeedback.";
}
