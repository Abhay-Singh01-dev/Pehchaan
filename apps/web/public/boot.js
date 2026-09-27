// Flash-free first paint: apply the last display preferences before CSS paints. A file rather than an inline
// script, so the Content-Security-Policy can forbid inline scripts entirely (spec 16.5).
(() => {
  try {
    const d = JSON.parse(localStorage.getItem("pehchaan:display:last") || "null");
    const r = document.documentElement;
    const pref = (d && d.theme) || "system";
    const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    r.dataset.theme = dark ? "dark" : "light";
    if (d) {
      r.dataset.textSize = d.textSize || "normal";
      r.lang = d.lang || "en";
    }
  } catch {
    // Storage unavailable (private mode, cleared): the defaults in index.html apply.
  }
})();
