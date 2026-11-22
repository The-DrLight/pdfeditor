# PDF Editor

A browser-based PDF editor. Everything runs locally; files never leave your machine.

```powershell
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Deploy (Vercel)

Import the repo; Vercel detects Vite (build `npm run build`, output `dist`). `vercel.json` adds a strict
Content-Security-Policy and other security headers, and long-term caching for hashed assets.
To test the production build with those same headers locally: `npm run build && npm run preview`.

No backend or environment variables: PDFs are processed entirely in the visitor's browser.

## Install / offline (PWA)

After the first visit the whole app is cached by a service worker, so it works with no connection.
Chrome, Edge and Android show an **Install app** button; on iOS use Share > Add to Home Screen.
Installed desktop copies can also appear under "Open with" for `.pdf` files.

- New versions download in the background and a "Reload" banner appears; nothing swaps mid-edit.
- Icons are generated from `public/favicon.svg` with `npm run icons`.
- `sw.js` and the manifest are served with `no-cache` (see `vercel.json`) so updates reach installed copies.
- The service worker only exists in production builds (`npm run build && npm run preview`).

## Features

- **Edit existing text** (click a line, retype it; background and colour are sampled from the page)
- Add text, images, signatures (draw / type / upload, saved on your device), pen, highlight, shapes, arrows
- Whiteout and true **redaction** (the page is flattened so hidden text is really removed)
- Fill **form fields** (text, checkbox, radio, dropdown); values are baked into the saved PDF
- Page tools: rotate, delete, duplicate, insert blank, drag-reorder, merge another PDF, save a page range
- Find text, watermark, page numbers, date / check / cross stamps
- Undo / redo, zoom, keyboard shortcuts (Ctrl+S, Ctrl+Z/Y, Ctrl+D, Del, arrows, Esc)
- Unicode text (Yoruba, Igbo, Hausa, Vietnamese...) via an embedded Noto Sans fallback

## How it works

| File | Role |
|---|---|
| `src/pdfload.js` | pdf.js: open file, page sizes, text runs, form widgets |
| `src/view.js` | renders pages to `<canvas>`, HTML/SVG overlay for items, all tools and interactions |
| `src/export.js` | pdf-lib: copies original pages, draws items on top (with a coordinate transform), writes form values |
| `src/pages.js` | page operations + thumbnails |
| `src/signature.js`, `src/props.js`, `src/state.js` | signature dialog, properties panel, state + undo history |

Items are stored in "base space" (top-left origin, PDF points). On export a `cm` matrix maps that to the PDF's
bottom-left space, including page rotation, so edits stay aligned.

## Limits

- Edits to existing text are "cover and retype" (the original glyphs stay underneath, hidden); there is no re-flow.
- Redaction and password-protected PDFs flatten the affected pages to images.
- Not a cryptographic signer: signatures are images, not certificate-based digital signatures.
- Fonts: edited text keeps the original size, colour, bold and italic, and is matched to the closest of the
  PDF standard fonts (Helvetica / Times / Courier). The PDF's own fonts are usually subsets, so they can't be
  reused; letter shapes and widths can differ slightly. Noto Sans is used as the Unicode fallback.

## License

MIT. See [LICENSE](LICENSE).
