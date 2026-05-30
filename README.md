# MetaScope

See what your files secretly reveal, then scrub it clean. Drag in a photo and MetaScope shows you the hidden data your camera wrote into it: the exact GPS coordinates of where it was taken, your device's make, model, and serial number, the timestamp, the editing software, and the embedded thumbnail that can still contain the original uncropped image. One click strips all of it. Everything runs in your browser. No file, coordinate, or thumbnail is ever uploaded.

**Live:** https://ihelfrich.github.io/metascope

Sibling project to [DocScope](https://ihelfrich.github.io/docscope).

## The problem it solves

People share photos constantly without knowing the file carries a second, invisible layer. A picture taken at home carries your home address to within a few meters. A picture you "cropped" can still ship the original framing inside an embedded thumbnail. Your camera's serial number ties every photo you have ever posted back to the same device. None of this is visible in the image, so nobody thinks to remove it.

MetaScope makes the invisible layer visible, then removes it.

## What it reads

| Source | Fields surfaced |
|---|---|
| EXIF / TIFF | GPS latitude/longitude/altitude, camera make + model, lens, **serial number**, capture timestamp + timezone offset, software, artist/owner, copyright |
| XMP | creator tool, author, rights |
| IPTC | byline, creator |
| Embedded thumbnail (IFD1) | the small preview stored inside the file, rendered so you can see whether it differs from the visible image |
| PDF | title, author, subject, keywords, producer, creator (software), creation + modification dates, page count |

A traffic-light verdict per file: **red** when it leaks your location, **amber** when it carries identifying metadata, **green** when it is clean.

## The privacy design (why this tool can be trusted)

A tool that warns "your photo leaks your location" must not itself leak that location. So MetaScope **never auto-loads a map**. Fetching a map tile would send your coordinates to a tile server, which is the exact leak the tool exists to stop. It shows coordinates locally and only opens a map after you click and confirm. Everything else (parsing, the embedded thumbnail, scrubbing, the batch zip) happens entirely in the page with no network calls.

## How scrubbing works

For images, MetaScope re-encodes the picture from its raw decoded pixels through a canvas. That discards every metadata block at once, including GPS, serial numbers, and the embedded thumbnail, while baking the orientation tag into the pixels so the image stays upright. What remains is the standard sRGB color profile and the image dimensions, which are identical for everyone and identify nothing. For PDFs it clears the document-info dictionary (author, title, producer, creation tool, dates).

Verified on a GPS-tagged sample: 58 metadata fields before, GPS and a 6.7 KB embedded thumbnail among them; 0 GPS fields and 0 embedded thumbnail after.

## Stack

All client-side, loaded from CDN as UMD globals: [exifr](https://github.com/MikeKovarik/exifr) (metadata reading), [pdf-lib](https://github.com/Hopding/pdf-lib) (PDF read + scrub), [JSZip](https://github.com/Stuk/jszip) (batch download). No build step. Open `index.html` locally or serve the folder.

```
metascope/
├── index.html        UI
├── css/style.css
├── js/app.js         metadata reader + scrubber
├── .nojekyll
└── README.md
```

## Honest limits

- **HEIC / AVIF scrubbing depends on the browser.** Safari decodes HEIC natively, so the canvas re-encode works there. Chrome and Firefox often cannot decode HEIC, so those files can be read but not scrubbed in those browsers. Convert to JPEG first, or use Safari.
- **Reading is best-effort across vendors.** Some manufacturers store data in proprietary MakerNote blocks that exifr does not fully decode. The raw-field dump shows everything that parsed.
- **Scrub re-compresses.** The image is re-encoded (JPEG at quality 0.92, PNG losslessly). For archival originals, keep your untouched copy; share the scrubbed one.

## License

MIT.
