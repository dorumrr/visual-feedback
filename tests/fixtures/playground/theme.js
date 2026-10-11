// Loaded before the stylesheet applies, so a page kept dark by the button never shows light first.
const KEY = "playground-theme";
const system = matchMedia("(prefers-color-scheme: dark)");

let forced = null;
try {
  forced = sessionStorage.getItem(KEY);
} catch {}

function apply() {
  const dark = forced ? forced === "dark" : system.matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.getElementById("theme-toggle")?.setAttribute("aria-pressed", String(dark));
}

apply();
system.addEventListener("change", apply);
document.addEventListener("DOMContentLoaded", () => {
  apply();
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    // Picking what the system shows already goes back to following the system.
    forced = dark === system.matches ? null : dark ? "dark" : "light";
    try {
      if (forced) sessionStorage.setItem(KEY, forced);
      else sessionStorage.removeItem(KEY);
    } catch {}
    apply();
  });
});
