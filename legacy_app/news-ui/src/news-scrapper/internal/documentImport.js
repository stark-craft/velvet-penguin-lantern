const DOCUMENT_LIMIT = 25 * 1024 * 1024;
const IMAGE_LIMIT = 8 * 1024 * 1024;
const COVER_LIMIT = 1400000;

const extensionOf = (name = "") => name.split(".").pop()?.toLowerCase() || "";

export function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileKind(file) {
  const extension = extensionOf(file?.name);
  if (file?.type?.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(extension)) return "image";
  if (file?.type === "application/pdf" || extension === "pdf") return "pdf";
  if (extension === "docx" || file?.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (file?.type === "text/plain" || ["txt", "md"].includes(extension)) return "text";
  if (extension === "doc") return "legacy-word";
  return "unsupported";
}

export function validateEditorialFile(file) {
  const kind = fileKind(file);
  if (kind === "unsupported") return { ok: false, kind, message: `${file.name} is not a supported image, PDF, Word (.docx), or text file.` };
  if (kind === "legacy-word") return { ok: false, kind, message: `${file.name} uses the older .doc format. Open it in Word and save it as .docx, then try again.` };
  const limit = kind === "image" ? IMAGE_LIMIT : DOCUMENT_LIMIT;
  if (Number(file.size) > limit) return { ok: false, kind, message: `${file.name} is larger than the ${formatFileSize(limit)} limit.` };
  return { ok: true, kind, message: "" };
}

export function normalizeExtractedText(value = "") {
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/([A-Za-z])-[ \t]*\n[ \t]*([a-z])/g, "$1$2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function deriveDraftFields(text = "") {
  const clean = normalizeExtractedText(text);
  const blocks = clean.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const lines = clean.split("\n").map((part) => part.trim()).filter(Boolean);
  const firstLine = lines[0] || "";
  const title = firstLine.length <= 120 ? firstLine : "";
  const summarySource = blocks.find((block) => block !== title && block.length >= 45) || blocks[1] || blocks[0] || "";
  const summary = summarySource.length > 320 ? `${summarySource.slice(0, 317).trimEnd()}…` : summarySource;
  return { title, summary, wordCount: clean ? clean.split(/\s+/).length : 0 };
}

async function extractPdf(file, onProgress) {
  const pdfjs = await import("pdfjs-dist");
  if (typeof window !== "undefined") {
    const workerModule = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  }
  const task = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
  const document = await task.promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = "";
      content.items.forEach((item) => { pageText += `${item.str || ""}${item.hasEOL ? "\n" : " "}`; });
      pages.push(normalizeExtractedText(pageText));
      onProgress?.(Math.round((pageNumber / document.numPages) * 100), `Reading page ${pageNumber} of ${document.numPages}`);
    }
  } finally {
    await document.destroy();
  }
  return { text: normalizeExtractedText(pages.join("\n\n")), pageCount: pages.length };
}

async function extractDocx(file, onProgress) {
  onProgress?.(35, "Opening Word document");
  const imported = await import("mammoth/mammoth.browser.js");
  const mammoth = imported.default || imported;
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  onProgress?.(100, "Word document ready");
  return { text: normalizeExtractedText(result.value), warnings: result.messages || [] };
}

export async function extractEditorialDocument(file, onProgress) {
  const validation = validateEditorialFile(file);
  if (!validation.ok) throw new Error(validation.message);
  let result;
  if (validation.kind === "pdf") result = await extractPdf(file, onProgress);
  else if (validation.kind === "docx") result = await extractDocx(file, onProgress);
  else if (validation.kind === "text") {
    onProgress?.(60, "Reading text file");
    result = { text: normalizeExtractedText(await file.text()) };
    onProgress?.(100, "Text file ready");
  } else throw new Error("Choose a PDF, Word (.docx), or text document to extract copy.");
  if (!result.text) throw new Error(`No readable text was found in ${file.name}. A scanned PDF may require OCR before importing.`);
  return { ...result, ...deriveDraftFields(result.text), kind: validation.kind, name: file.name, size: file.size };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The image preview could not be created."));
    reader.readAsDataURL(blob);
  });
}

export async function prepareCoverImage(file, onProgress) {
  const validation = validateEditorialFile(file);
  if (!validation.ok) throw new Error(validation.message);
  if (validation.kind !== "image") throw new Error("Choose a PNG, JPEG, or WebP image.");
  onProgress?.(25, "Preparing image");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", .82));
  if (!blob) throw new Error("The image could not be processed by this browser.");
  const dataUrl = await blobToDataUrl(blob);
  if (dataUrl.length > COVER_LIMIT) throw new Error("The processed image is still too large. Choose a smaller image or crop it before importing.");
  onProgress?.(100, "Cover image ready");
  return { dataUrl, name: file.name, width: canvas.width, height: canvas.height, size: blob.size };
}
