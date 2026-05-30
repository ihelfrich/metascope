/* MetaScope — client-side metadata reveal + scrub.
 * Every byte is read in the browser. Nothing is uploaded, ever.
 * exifr handles image metadata; pdf-lib reads/clears PDF document info. */
"use strict";

/* ---------- tiny DOM helpers ---------- */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const setStatus = (t) => ($("#engineStatus").textContent = t);

/* ---------- state ---------- */
let SEQ = 0;
const ITEMS = new Map(); // id -> { file, scrubbedBlob, scrubbedName }

/* ---------- tabs ---------- */
document.querySelectorAll(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("#" + btn.dataset.tab).classList.add("active");
  })
);

/* ---------- drag & drop ---------- */
const drop = $("#drop");
const fileInput = $("#fileInput");
["dragenter", "dragover"].forEach((e) =>
  drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("drag"); })
);
["dragleave", "drop"].forEach((e) =>
  drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove("drag"); })
);
drop.addEventListener("drop", (ev) => handleFiles(ev.dataTransfer.files));
fileInput.addEventListener("change", () => handleFiles(fileInput.files));

$("#clearAll").addEventListener("click", () => {
  ITEMS.clear();
  $("#cards").innerHTML = "";
  $("#controls").classList.add("hidden");
  fileInput.value = "";
});
$("#scrubAll").addEventListener("click", scrubAll);

/* ---------- entry point ---------- */
async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  $("#controls").classList.remove("hidden");
  for (const file of files) {
    const id = "m" + ++SEQ;
    ITEMS.set(id, { file });
    const card = buildSkeletonCard(id, file);
    $("#cards").prepend(card);
    inspect(id, file, card).catch((err) => {
      console.error(err);
      card.querySelector(".verdict").className = "verdict warn";
      card.querySelector(".verdict").innerHTML =
        `<span class="vdot"></span> Could not fully read this file (${esc(err.message || err)})`;
    });
  }
  updateSummary();
}

function isImage(file) {
  return /^image\//.test(file.type) || /\.(jpe?g|png|tiff?|heic|heif|webp|avif|bmp)$/i.test(file.name);
}
function isPDF(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}
function humanSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

/* ---------- card skeleton ---------- */
function buildSkeletonCard(id, file) {
  const card = el("div", "card");
  card.dataset.id = id;
  card.innerHTML = `
    <div class="card-head">
      <img class="thumb" alt="" />
      <div class="card-title">
        <div class="fname">${esc(file.name)}</div>
        <div class="fsub">${esc(file.type || "unknown type")} · ${humanSize(file.size)}</div>
      </div>
    </div>
    <div class="verdict warn"><span class="vdot"></span> Reading…</div>
    <div class="findings"></div>
    <div class="card-foot">
      <button class="scrub-one">Scrub &amp; download</button>
    </div>`;
  // visible preview (best effort; some HEIC won't render in Chrome)
  const img = card.querySelector(".thumb");
  const url = URL.createObjectURL(file);
  img.src = url;
  img.onload = () => URL.revokeObjectURL(url);
  img.onerror = () => { img.style.visibility = "hidden"; URL.revokeObjectURL(url); };
  card.querySelector(".scrub-one").addEventListener("click", () => scrubOne(id, card));
  return card;
}

/* ---------- inspection ---------- */
async function inspect(id, file, card) {
  if (isPDF(file)) return inspectPDF(id, file, card);
  if (isImage(file)) return inspectImage(id, file, card);
  // unknown: nothing to read
  setVerdict(card, "clean", "Not an image or PDF — no metadata layer to read.");
  card.querySelector(".scrub-one").disabled = true;
}

async function inspectImage(id, file, card) {
  let meta = {};
  try {
    meta = (await exifr.parse(file, {
      tiff: true, ifd0: true, exif: true, gps: true, interop: true, ifd1: true,
      xmp: true, iptc: true, jfif: true, ihdr: true,
      mergeOutput: true, translateKeys: true, translateValues: true, reviveValues: true,
    })) || {};
  } catch (_) { meta = {}; }

  const findings = card.querySelector(".findings");
  let hotCount = 0;
  let hasGPS = false;

  // --- GPS (the big one) ---
  const lat = num(meta.latitude), lon = num(meta.longitude);
  if (lat != null && lon != null) {
    hasGPS = true; hotCount++;
    const f = el("div", "finding");
    const alt = meta.GPSAltitude != null ? ` · ${Math.round(meta.GPSAltitude)} m` : "";
    f.innerHTML = `
      <div class="fi-ico">📍</div>
      <div class="fi-body">
        <div class="fi-label">Location it reveals</div>
        <div class="fi-val hot">${lat.toFixed(6)}, ${lon.toFixed(6)}${alt}</div>
        <div class="geo-actions">
          <button class="copy-coords">Copy coordinates</button>
          <button class="open-map ghost">Open map (sends to OSM)</button>
        </div>
      </div>`;
    f.querySelector(".copy-coords").addEventListener("click", (e) => {
      navigator.clipboard?.writeText(`${lat},${lon}`);
      e.target.textContent = "Copied";
      setTimeout(() => (e.target.textContent = "Copy coordinates"), 1200);
    });
    f.querySelector(".open-map").addEventListener("click", () => {
      if (confirm("This opens OpenStreetMap and sends these coordinates to their servers. Continue?")) {
        window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`, "_blank", "noopener");
      }
    });
    findings.appendChild(f);
  }

  // --- device ---
  const device = [meta.Make, meta.Model].filter(Boolean).join(" ").trim();
  if (device) { hotCount++; addFinding(findings, "📷", "Device", device); }
  const lens = meta.LensModel || meta.Lens;
  if (lens) addFinding(findings, "🔭", "Lens", lens);

  // --- serial numbers (sticky identifier across all your photos) ---
  const serial = meta.SerialNumber || meta.BodySerialNumber || meta.InternalSerialNumber || meta.CameraSerialNumber;
  if (serial) { hotCount++; addFinding(findings, "🔑", "Serial number", serial, true); }

  // --- timestamp + timezone ---
  const when = meta.DateTimeOriginal || meta.CreateDate || meta.ModifyDate;
  if (when) {
    const tz = meta.OffsetTimeOriginal || meta.OffsetTime ? ` (UTC${meta.OffsetTimeOriginal || meta.OffsetTime})` : "";
    addFinding(findings, "🕔", "Taken", fmtDate(when) + tz);
  }

  // --- software / editing trail ---
  const sw = meta.Software || meta.HostComputer || meta.CreatorTool || meta.ProcessingSoftware;
  if (sw) addFinding(findings, "🛠️", "Software", sw);

  // --- owner / author ---
  const owner = meta.OwnerName || meta.Artist || meta.XPAuthor || meta.Creator || meta.byline;
  if (owner) { hotCount++; addFinding(findings, "👤", "Owner / author", owner, true); }
  if (meta.Copyright) addFinding(findings, "©", "Copyright", meta.Copyright);

  // --- embedded thumbnail (can show the uncropped original) ---
  try {
    const turl = await exifr.thumbnailUrl(file);
    if (turl) {
      const wrap = el("div", "finding");
      wrap.innerHTML = `
        <div class="fi-ico">🫥</div>
        <div class="fi-body">
          <div class="fi-label">Hidden embedded thumbnail</div>
          <div class="ghost-thumb"><img src="${turl}" alt="embedded preview"></div>
          <div class="ghost-note">This preview is stored inside the file. If the photo was cropped, this can still show the original framing. Scrubbing removes it.</div>
        </div>`;
      findings.appendChild(wrap);
    }
  } catch (_) {}

  // --- raw dump ---
  const keys = Object.keys(meta);
  if (keys.length) {
    const det = el("details", "raw");
    det.innerHTML =
      `<summary>Show all ${keys.length} raw fields</summary><pre>${esc(prettyMeta(meta))}</pre>`;
    card.querySelector(".findings").after(det);
  }

  // --- verdict ---
  if (hasGPS) {
    setVerdict(card, "leak", "This photo reveals where you were.");
  } else if (hotCount > 0 || keys.length > 3) {
    setVerdict(card, "warn", "Carries identifying metadata.");
  } else {
    setVerdict(card, "clean", "No revealing metadata found.");
    card.querySelector(".scrub-one").textContent = "Re-save clean copy";
  }
}

async function inspectPDF(id, file, card) {
  const findings = card.querySelector(".findings");
  card.querySelector(".thumb").style.visibility = "hidden";
  let hot = 0;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    const pairs = [
      ["Title", doc.getTitle()], ["Author", doc.getAuthor()],
      ["Subject", doc.getSubject()], ["Keywords", doc.getKeywords()],
      ["Producer", doc.getProducer()], ["Creator (software)", doc.getCreator()],
    ];
    for (const [label, val] of pairs) {
      if (val) { hot++; addFinding(findings, "📄", label, val); }
    }
    const cd = safe(() => doc.getCreationDate());
    const md = safe(() => doc.getModificationDate());
    if (cd) addFinding(findings, "🕔", "Created", cd.toLocaleString());
    if (md) addFinding(findings, "🕔", "Modified", md.toLocaleString());
    addFinding(findings, "📐", "Pages", String(doc.getPageCount()));

    if (hot > 0) setVerdict(card, "warn", "PDF carries author / software metadata.");
    else setVerdict(card, "clean", "No document metadata found.");
  } catch (err) {
    setVerdict(card, "warn", "Could not parse PDF metadata (" + esc(err.message || err) + ").");
    card.querySelector(".scrub-one").disabled = true;
  }
}

/* ---------- finding helpers ---------- */
function addFinding(container, ico, label, value, hot) {
  const f = el("div", "finding");
  f.innerHTML = `
    <div class="fi-ico">${ico}</div>
    <div class="fi-body">
      <div class="fi-label">${esc(label)}</div>
      <div class="fi-val ${hot ? "hot" : ""}">${esc(value)}</div>
    </div>`;
  container.appendChild(f);
}
function setVerdict(card, kind, text) {
  const v = card.querySelector(".verdict");
  v.className = "verdict " + kind;
  v.innerHTML = `<span class="vdot"></span> ${esc(text)}`;
}

/* ---------- scrubbing ---------- */
async function scrubOne(id, card) {
  const item = ITEMS.get(id);
  if (!item) return;
  const btn = card.querySelector(".scrub-one");
  btn.disabled = true; btn.textContent = "Scrubbing…";
  try {
    const { blob, name } = await scrubFile(item.file);
    item.scrubbedBlob = blob; item.scrubbedName = name;
    downloadBlob(blob, name);
    btn.textContent = "Downloaded ✓";
    setTimeout(() => { btn.textContent = "Scrub again"; btn.disabled = false; }, 1400);
  } catch (err) {
    console.error(err);
    btn.textContent = "Scrub failed";
    btn.disabled = false;
    alert("Could not scrub this file: " + (err.message || err) +
      "\n\n(Some HEIC/AVIF files can't be decoded by this browser. Try Safari, or convert to JPEG first.)");
  }
}

async function scrubAll() {
  const btn = $("#scrubAll");
  btn.disabled = true; btn.textContent = "Scrubbing…";
  const zip = new JSZip();
  let n = 0;
  for (const [id, item] of ITEMS) {
    try {
      const { blob, name } = await scrubFile(item.file);
      zip.file(name, blob);
      n++;
    } catch (err) { console.warn("skip", item.file.name, err); }
  }
  if (!n) { btn.textContent = "Nothing scrubbable"; setTimeout(reset, 1600); return; }
  const out = await zip.generateAsync({ type: "blob" });
  downloadBlob(out, "metascope_clean.zip");
  btn.textContent = `Downloaded ${n} ✓`;
  setTimeout(reset, 1600);
  function reset() { btn.textContent = "Scrub & download all (.zip)"; btn.disabled = false; }
}

async function scrubFile(file) {
  if (isPDF(file)) return scrubPDF(file);
  return scrubImage(file);
}

// re-encode from raw pixels: discards every metadata block incl. embedded thumbnail.
async function scrubImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const png = /\.png$/i.test(file.name) || file.type === "image/png";
  const mime = png ? "image/png" : "image/jpeg";
  const ext = png ? ".png" : ".jpg";
  const blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), mime, png ? undefined : 0.92)
  );
  return { blob, name: cleanName(file.name, ext) };
}

async function scrubPDF(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await PDFLib.PDFDocument.load(bytes);
  doc.setTitle(""); doc.setAuthor(""); doc.setSubject("");
  doc.setKeywords([]); doc.setProducer(""); doc.setCreator("");
  try { doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0)); } catch (_) {}
  const out = await doc.save();
  return { blob: new Blob([out], { type: "application/pdf" }), name: cleanName(file.name, ".pdf") };
}

function cleanName(name, forceExt) {
  const base = name.replace(/\.[^.]+$/, "");
  return base + ".clean" + (forceExt || "");
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- misc ---------- */
function updateSummary() {
  const total = ITEMS.size;
  $("#summary").textContent = total ? `${total} file${total > 1 ? "s" : ""} read locally` : "";
  $("#scrubAll").disabled = total === 0;
}
function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
function safe(fn) { try { return fn(); } catch (_) { return null; } }
function fmtDate(d) {
  if (d instanceof Date) return d.toLocaleString();
  return String(d);
}
function prettyMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v instanceof Uint8Array) out[k] = `<${v.length} bytes>`;
    else if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return JSON.stringify(out, null, 2);
}

setStatus("ready");
