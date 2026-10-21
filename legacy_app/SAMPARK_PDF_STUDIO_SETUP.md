# Sampark PDF Studio — complete replacement of Edit PDF UI

Branch: `test/sampark-pdf-diagnostics-20261021`

## Copy exactly two frontend files

1. `legacy_app/news-ui/src/sampark/create-news/PdfDocumentEditor.jsx`
   to `C:\scrappyV3\news-ui\src\sampark\create-news\PdfDocumentEditor.jsx`
2. `legacy_app/news-ui/src/sampark/create-news/PdfDocumentEditor.css`
   to `C:\scrappyV3\news-ui\src\sampark\create-news\PdfDocumentEditor.css`

Use GitHub Raw to copy the entire source of each file. Back up the existing JSX first.
The new JSX imports its own CSS. No edits to `SamparkCreate.jsx`,
`CreateNewsStoryEditor.jsx`, `api.js`, or the backend are required.

## Dependencies

The current PC code was already set up for PDF.js and pdf-lib. If Vite
cannot resolve the new editor's dependencies, run:

    cd C:\scrappyV3\news-ui
    npm install pdf-lib pdfjs-dist lucide-react

The test branch declares pdf-lib in package.json; **do not copy the older
GitHub package.json over your newer Windows copy**.

## Features

- PDF.js full-page canvas with navigable thumbnails and zoom controls
- Select and drag inserted elements; inspect/edit their text, color,
  dimensions and size in the right sidebar
- Click an existing selectable line using **Replace text** to create a
  visual replacement; white background covers the rendered line
- Add text, JPG/PNG images, whiteout boxes, highlights, rectangles,
  and freehand strokes
- Rearrange, rotate, duplicate, delete pages, insert blank pages,
  and append pages from another PDF
- Undo/redo with toolbar or Ctrl+Z/Ctrl+Y, export a PDF
- **Save to Sampark** uses the existing replaceContributionDocument API
  and triggers the existing onSaved(updatedRecord) callback

## Limitations, important

- This is **visual editing**, not destructive editing of original
  embedded PDF text objects. Replaced/whiteout text may still exist
  and may remain discoverable using search/copy. Do not treat
  whiteout as secure redaction.
- PDF.js needs a valid/viewable PDF; if a document was stored with
  unreadable or protected bytes, the editor shows a readable error.
- Form fields, signatures, bookmarks or embedded non-page attachments
  may not survive rebuilding a PDF with pdf-lib. Always verify exports.
- Large 100MB PDFs can take more memory and time to rebuild on save.
- For accurate replacement alignment, edit before rotating pages;
  visually inspect the exported result.
- Current embedded Helvetica overlay font supports common Latin text;
  unsupported characters are replaced with `?` on export.
- Narrow/mobile layouts hide the right inspector; desktop editing
  is the fully supported workflow for this version.

## Smoke-test on your Windows checkout

1. Open Sampark > Create New > upload a valid PDF > Edit PDF.
2. Change the appearance of an existing text line; adjust the text in
   the right inspector and drag it to correct positioning.
3. Add text, a highlight, and an image; click Undo then Redo.
4. Duplicate a page, rotate another, insert a blank page, and merge another PDF.
5. Export and view the PDF separately. Check text placement and page order.
6. Save to Sampark and verify View original PDF displays the edited document.

Work is on test branch only. The JSX is a new drop-in replacement because
GitHub did not contain the much newer local PC PdfDocumentEditor.jsx.
Build and browser behavior have not yet been verified on the user's PC.