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
- Fonts: edited text keeps the original size, colour, bold and italic, and uses a real font file chosen by the
  PDF's font name (see below). The PDF's own fonts are usually subsets, so they can't be reused; for typefaces
  outside the list, or proprietary ones, the nearest open font is used and letter shapes can differ slightly.
  Only regular and bold weights exist (Light / Semibold show as regular / bold).

## Fonts

| PDF font (examples) | Used | Notes |
|---|---|---|
| Arial, Helvetica | Arimo | same letter widths as Arial |
| Times New Roman, Times | Tinos | same widths as Times New Roman |
| Courier New, Consolas, mono | Cousine | same widths as Courier New |
| Calibri / Cambria / Georgia | Carlito / Caladea / Gelasio | metric-compatible |
| Garamond, Open Sans, Roboto, Lato, Montserrat, Source Sans, Noto Sans / Serif | the same family | |
| Verdana, Segoe UI, Tahoma, Myriad... | Open Sans | closest humanist sans |
| anything else | Arimo / Tinos / Cousine by style | |

Each font ships as Latin, Latin Extended and Vietnamese subsets (covers Yoruba, Igbo, Hausa, French...).
Files are downloaded only when a document uses them, then cached; **More > Download fonts for offline use**
saves all of them. The font list is `CATALOG` in `src/fonts.js`; you can also pick any of them by hand in the
Font menu. Fonts are open-licensed (SIL OFL / Apache 2.0, see each `@fontsource/*` package).

## License

MIT. See [LICENSE](LICENSE).
