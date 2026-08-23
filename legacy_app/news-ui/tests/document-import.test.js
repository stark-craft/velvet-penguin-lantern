import assert from "node:assert/strict";
import test from "node:test";
import { deriveDraftFields, fileKind, formatFileSize, normalizeExtractedText, validateEditorialFile } from "../src/news-scrapper/internal/documentImport.js";

test("editorial imports recognise portable image, PDF, Word and text formats", () => {
  assert.equal(fileKind({ name: "brief.pdf", type: "application/pdf" }), "pdf");
  assert.equal(fileKind({ name: "message.docx", type: "" }), "docx");
  assert.equal(fileKind({ name: "cover.webp", type: "image/webp" }), "image");
  assert.equal(fileKind({ name: "notes.md", type: "" }), "text");
  assert.equal(fileKind({ name: "legacy.doc", type: "" }), "legacy-word");
});

test("editorial imports reject unsupported and oversized files with useful guidance", () => {
  assert.match(validateEditorialFile({ name: "sheet.xlsx", type: "", size: 20 }).message, /not a supported/);
  assert.match(validateEditorialFile({ name: "legacy.doc", type: "", size: 20 }).message, /save it as \.docx/);
  assert.match(validateEditorialFile({ name: "huge.pdf", type: "application/pdf", size: 26 * 1024 * 1024 }).message, /25\.0 MB limit/);
  assert.equal(formatFileSize(1536), "2 KB");
});

test("extracted copy is cleaned and converted into safe editable draft fields", () => {
  const clean = normalizeExtractedText("Strategy up-\ndate\n\nThis is the executive context for every team.\n\nMore detail follows.");
  assert.equal(clean, "Strategy update\n\nThis is the executive context for every team.\n\nMore detail follows.");
  assert.deepEqual(deriveDraftFields(clean), {
    title: "Strategy update",
    summary: "This is the executive context for every team.",
    wordCount: 13,
  });
});
