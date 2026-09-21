#!/usr/bin/env node
/**
 * Verifies every foreground/background pair used by styles/theme.css against
 * WCAG 2.1 AA (4.5:1 for text, 3:1 for large text and UI components).
 *
 *   node tools/contrast-check.js
 */
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "styles", "theme.css"), "utf8");

function tokens(selector) {
  const block = css.split(selector)[1].split("}")[0];
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const base = tokens("html.sca11y {");
const hc = { ...base, ...tokens("html.sca11y.sca11y-hc {") };
const dark = { ...base, ...tokens("html.sca11y.sca11y-dark {") };
const darkHc = { ...dark, ...tokens("html.sca11y.sca11y-dark.sca11y-hc {") };

function hex(c) {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) throw new Error("not a hex colour: " + c);
  return [1, 3, 5].map((i) => parseInt(m[1].slice(i - 1, i + 1), 16));
}
const ch = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
const lum = ([r, g, b]) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
const ratio = (a, b) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// [label, fg token, bg token, minimum]
const PAIRS = [
  ["Body text on white", "sc-text", "sc-bg", 4.5],
  ["Body text on subtle", "sc-text", "sc-bg-subtle", 4.5],
  ["Body text on muted", "sc-text", "sc-bg-muted", 4.5],
  ["Muted text on white", "sc-text-muted", "sc-bg", 4.5],
  ["Muted text on subtle", "sc-text-muted", "sc-bg-subtle", 4.5],
  ["Muted text on muted", "sc-text-muted", "sc-bg-muted", 4.5],
  ["Link on white", "sc-link", "sc-bg", 4.5],
  ["Link on subtle", "sc-link", "sc-bg-subtle", 4.5],
  ["Link hover on white", "sc-link-hover", "sc-bg", 4.5],
  ["White on primary button", "#ffffff", "sc-primary", 4.5],
  ["White on primary hover", "#ffffff", "sc-primary-hover", 4.5],
  ["White on success", "#ffffff", "sc-success", 4.5],
  ["White on success hover", "#ffffff", "sc-success-hover", 4.5],
  ["White on danger", "#ffffff", "sc-danger", 4.5],
  ["White on danger hover", "#ffffff", "sc-danger-hover", 4.5],
  ["White on secondary", "#ffffff", "sc-secondary", 4.5],
  ["White on secondary hover", "#ffffff", "sc-secondary-hover", 4.5],
  ["White on dark", "sc-text-on-dark", "sc-bg-dark", 4.5],
  ["Gold role badge text", "sc-warning-text", "sc-warning", 4.5],
  ["Text on primary-subtle (selected row)", "sc-text", "sc-primary-subtle", 4.5],
  ["Text on primary-subtle-hover", "sc-text", "sc-primary-subtle-hover", 4.5],
  ["Warning alert text", "sc-alert-warn-text", "sc-alert-warn-bg", 4.5],
  ["Danger alert text", "sc-alert-danger-text", "sc-alert-danger-bg", 4.5],
  ["Success text (#buygames) on bg", "sc-success-text", "sc-bg", 4.5],
  ["Placeholder on bg", "sc-placeholder", "sc-bg", 4.5],
  ["Yellow replacement on bg", "sc-yellow-text", "sc-bg", 4.5],
  ["Input border on bg (UI 3:1)", "sc-border-strong", "sc-bg", 3.0],
  ["Focus ring on bg (UI 3:1)", "sc-focus", "sc-bg", 3.0],
  ["Focus ring on subtle (UI 3:1)", "sc-focus", "sc-bg-subtle", 3.0],
  ["Toggle off on bg (UI 3:1)", "sc-toggle-off", "sc-bg", 3.0],
  ["Scrollbar thumb on subtle (UI 3:1)", "sc-scroll-thumb", "sc-bg-subtle", 3.0],
  ["Primary button on bg (UI 3:1)", "sc-primary", "sc-bg", 3.0],
  ["Success button on bg (UI 3:1)", "sc-success", "sc-bg", 3.0],
  ["Danger button on bg (UI 3:1)", "sc-danger", "sc-bg", 3.0],
  ["Speaking ring on bg (UI 3:1)", "sc-speaking", "sc-bg", 3.0],
  ["Speaking ring on video tile (UI 3:1)", "sc-speaking", "sc-bg-dark", 3.0],
  ["White bars on speaking badge (UI 3:1)", "#ffffff", "sc-speaking", 3.0],
];

function run(name, t) {
  let failed = 0;
  console.log(`\n== ${name} ==`);
  for (const [label, fgTok, bgTok, min] of PAIRS) {
    const fg = fgTok.startsWith("#") ? fgTok : t[fgTok];
    const bg = bgTok.startsWith("#") ? bgTok : t[bgTok];
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${label}  ${fg} on ${bg}`);
  }
  return failed;
}

const failures =
  run("Light palette", base) +
  run("Light + high contrast", hc) +
  run("Dark palette", dark) +
  run("Dark + high contrast", darkHc);
console.log(failures ? `\n${failures} pair(s) failed` : "\nAll pairs pass WCAG AA");
process.exit(failures ? 1 : 0);
