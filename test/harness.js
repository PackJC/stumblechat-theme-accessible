/* Test harness: loads the extension into a fixture page the way Chrome
 * would. It reads manifest.json and injects every content-script stylesheet
 * and script in order, so the fixtures always match what ships.
 *
 * Serve the repo root (python3 -m http.server 8765) and open a page in
 * test/site/pages/. chrome.storage is not available here, so settings come
 * from the URL:
 *   ?off                 the site as shipped (no extension)
 *   ?dark ?hc ?noglass   appearance
 *   ?scale=130           text size
 *   ?set=key:value,...   any setting from content.js DEFAULTS, e.g.
 *                        ?set=stageMode:always,fillGrid:false,chatAnnounce:mentions
 */
(function () {
  var params = new URLSearchParams(location.search);
  if (params.has("off")) return;
  var base = "../../../";

  // Settings overrides for content.js (it falls back to these without chrome.storage).
  var overrides = {};
  if (params.has("dark")) overrides.theme = "dark";
  if (params.has("hc")) overrides.highContrast = true;
  if (params.has("noglass")) overrides.glass = false;
  if (params.has("scale")) overrides.fontScale = Number(params.get("scale"));
  (params.get("set") || "")
    .split(",")
    .filter(Boolean)
    .forEach(function (pair) {
      var i = pair.indexOf(":");
      if (i < 0) return;
      var k = pair.slice(0, i);
      var v = decodeURIComponent(pair.slice(i + 1));
      overrides[k] = v === "true" ? true : v === "false" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    });
  window.__SCA11Y_FIXTURE_SETTINGS__ = overrides;
  // Always load the current files, never a cached copy.
  var bust = "?t=" + Date.now();

  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = base + src + bust;
      s.onload = s.onerror = resolve;
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    return new Promise(function (resolve) {
      var l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = base + href + bust;
      l.onload = l.onerror = resolve;
      document.head.appendChild(l);
    });
  }

  fetch(base + "manifest.json" + bust)
    .then(function (r) {
      return r.json();
    })
    .then(function (manifest) {
      var cs = manifest.content_scripts[0];
      // Chrome injects extension CSS before any page script runs; mirror that
      // by waiting for the stylesheets before loading the scripts.
      return Promise.all(cs.css.map(loadCss)).then(function () {
        // The bundled display font: content.js registers it with the
        // extension URL, which does not exist here.
        var face = document.createElement("style");
        face.textContent = '@font-face{font-family:"SCA11y Outfit";font-style:normal;font-weight:600 800;font-display:swap;src:url("' + base + 'fonts/Outfit.woff2") format("woff2")}';
        document.head.appendChild(face);
        return cs.js.reduce(function (p, src) {
          return p.then(function () {
            return loadScript(src);
          });
        }, Promise.resolve());
      });
    })
    .then(function () {
      document.documentElement.dataset.harnessReady = "1";
    });
})();
