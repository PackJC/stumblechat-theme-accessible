/* Test harness: loads the extension's stylesheet and content script into a
 * fixture page the way Chrome would. Open any page in test/site/pages/ from
 * the filesystem. Add ?off to the URL to see the page without the extension.
 *
 * chrome.storage is not available here, so content.js falls back to defaults.
 * Add ?hc for high contrast or ?scale=130 for larger text.
 */
(function () {
  var params = new URLSearchParams(location.search);
  if (params.has("off")) return;
  var base = "../../../";
  // Chrome injects extension CSS before any page script runs; mirror that by
  // waiting for the stylesheet before loading the content script.
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = base + "styles/theme.css";
  link.onload = link.onerror = function () {
    var script = document.createElement("script");
    script.src = base + "scripts/content.js";
    document.head.appendChild(script);
  };
  document.head.appendChild(link);
  document.addEventListener("DOMContentLoaded", function () {
    if (params.has("hc")) document.documentElement.classList.add("sca11y-hc");
    if (params.has("scale")) document.documentElement.style.setProperty("--sc-scale", String(Number(params.get("scale")) / 100));
  });
})();
