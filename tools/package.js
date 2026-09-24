#!/usr/bin/env node
/**
 * Builds the store packages from an allowlist of shipping files:
 *
 *   dist/stumblechat-accessible-<version>-chrome.zip   Chrome, Edge, Brave, Opera
 *   dist/stumblechat-accessible-<version>-firefox.zip  Firefox desktop and Android
 *
 *   node tools/package.js      (or: npm run package)
 *
 * Firefox gets its own manifest: an add-on id, minimum versions, and a
 * background script instead of a service worker. Nothing else differs;
 * the code uses the chrome.* namespace, which Firefox also provides.
 * No dependencies: the zip writer below is plain Node (zlib + CRC-32).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// Everything that ships. Tests, fixtures, docs, tools and the icon
// generator stay out of the package.
const ALLOW = [
  "background.js",
  "fonts/Outfit.woff2",
  "fonts/OFL.txt",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "popup/popup.html",
  "popup/popup.css",
  "popup/popup.js",
  "scripts/content.js",
  "scripts/room-features.js",
  "scripts/chat-features.js",
  "scripts/directory-tools.js",
  "scripts/quick-settings.js",
  "styles/theme.css",
  "styles/room-features.css",
  "styles/chat-features.css",
  "styles/directory-tools.css",
];

const FIREFOX_ID = "stumblechat-accessible@packjc";

/* ------------------------------------------------------------------ */
/* Minimal zip writer (deflate, no zip64; plenty for an extension)     */
/* ------------------------------------------------------------------ */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  // Fixed timestamp (2026-01-01 00:00) so builds are reproducible.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

/* ------------------------------------------------------------------ */
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

// Every file the manifest references must be in the allowlist, and exist.
const referenced = new Set([
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((c) => [...c.css, ...c.js]),
]);
for (const f of referenced) {
  if (!ALLOW.includes(f)) throw new Error("manifest references " + f + " but it is not in the package allowlist");
}
for (const f of ALLOW) {
  if (!fs.existsSync(path.join(ROOT, f))) throw new Error("missing file: " + f);
}

function firefoxManifest(m) {
  const ff = JSON.parse(JSON.stringify(m));
  ff.background = { scripts: [m.background.service_worker] };
  ff.browser_specific_settings = {
    gecko: { id: FIREFOX_ID, strict_min_version: "121.0" }, // :has() needs 121
    gecko_android: { strict_min_version: "121.0" },
  };
  return ff;
}

fs.mkdirSync(DIST, { recursive: true });
const files = ALLOW.map((name) => ({ name, data: fs.readFileSync(path.join(ROOT, name)) }));
const builds = [
  ["chrome", manifest],
  ["firefox", firefoxManifest(manifest)],
];
for (const [target, m] of builds) {
  const entries = [{ name: "manifest.json", data: Buffer.from(JSON.stringify(m, null, 2) + "\n") }, ...files];
  const out = path.join(DIST, `stumblechat-accessible-${manifest.version}-${target}.zip`);
  fs.writeFileSync(out, zip(entries));
  const kb = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`${path.relative(ROOT, out)}  ${entries.length} files, ${kb} KB`);
}
