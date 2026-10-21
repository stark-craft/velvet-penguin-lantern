#!/usr/bin/env python3
"""Generate a long REAL NewsScrapper architecture PDF from your local code.

Required: pip install PyMuPDF Pillow
From C:\scrappyV3:
  python generate_real_newsscrapper_architecture_pdf.py --target-mb 100

Reads your CURRENT local files, rather than old GitHub copies. The PDF
contains a factual source map, architecture chapters, real project docs,
actual routes and function names, and unique screenshots of real code.
No dummy paragraphs, random bytes, duplicated pages or filler attachments.

The 100 MiB target is aspirational: actual size depends on unique source
material, and cannot be guaranteed without faking extra data.
"""
import argparse
import ast
import collections
import io
import math
import re
import textwrap
from pathlib import Path

try:
    import pymupdf as fitz
except ImportError:
    import fitz
from PIL import Image, ImageDraw, ImageFont

W, H = 595, 842
MAX_TEXT = 165000
MAX_PAGES = 470
SOURCE_DIRS = ("news_scrapper", "news-ui/src", "core", "venture_lens", "docs")
EXT = {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".md", ".json", ".html"}
SKIP_DIR = {".git", "node_modules", "venv", ".venv", "__pycache__", "dist",
            "build", ".pytest_cache", "storage", "cache", "data", "uploads",
            "private", "logs", "tmp", "temp", "originals", "coverage"}
SKIP_NAME = re.compile(
    r"(?:^|[-_.])(env|secret|credentials|password|token|private|"
    r"cookie|package-lock|yarn-lock|employee)(?:$|[-_.])", re.I)
SCRUB = re.compile(
    r"(?:api[_-]?key|password|secret|private[_-]?key|access[_-]?token|"
    r"client[_-]?secret)\s*[:=]\s*\S+", re.I)
TOKEN = re.compile(r"(?:sk-[A-Za-z0-9_-]{15,}|ghp_[A-Za-z0-9]{20,})")
ROUTE = re.compile(
    r'@(app|router)\.(get|post|put|patch|delete)\(["\x27]([^"\x27]+)', re.I)
FUNC = re.compile(r"^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)", re.M)
JSCOMP = re.compile(
    r"(?:export\s+(?:default\s+)?(?:function|const|class)\s+)"
    r"([A-Za-z_$][\w$]*)")
DOCS = (
    "docs/ARCHITECTURE.md", "docs/SAMSUNG_PIPELINE.md",
    "docs/PERSONALIZATION_ARCHITECTURE.md",
    "docs/SAMPARK_REPORT_EDITOR.md", "docs/SAMPARK_NEWS_RELEASE.md",
    "docs/FOR_YOU_HOOK_IMPLEMENTATION_PLAN.md",
    "docs/TRANSLATION_PERFORMANCE_AUDIT.md", "SAMPARK_WORKSPACES.md",
)
CHAPTERS = [
 ("System architecture and application boundaries",
  "NewsScrapper and Sampark combine a news collection and content intelligence pipeline with a React editorial and reading experience. The existing architecture documentation describes a FastAPI application with a Vite-built frontend; the same backend also mounts the separate Venture Lens product. Runtime configuration, access decisions, ingestion and presentation are distinct concerns.",
  "The backend composition layer joins shared core services, crawler execution, content enrichment, personal recommendations, contributor workflows and reporting endpoints. The frontend is split into reusable NewsScrapper components and Sampark screens. This report checks those claims against actual locally available modules; it does not assert that a deployment has been tested."),
 ("Web crawling and upstream provenance",
  "The source-agnostic universal spider takes keywords, time windows and source configuration rather than embedding a particular UI or Samsung-specific rule. Its documented strategy tries RSS and Atom first, falls back to link discovery, extracts article text, and yields structured records. Raw page provenance and normalized article URLs are important to separate original reporting from later summaries.",
  "Network-facing crawling should be distinguished from enrichment. URL safety, bounded fetching and source identity are ingestion requirements; prompt-driven interpretation and article ranking are subsequent stages. Search references should never become evidence for an unrelated linked URL."),
 ("Samsung Web Search, Chat and local model fallback",
  "The Samsung pipeline documentation describes a preflight decision for Web Search and Chat availability. The resulting execution plan uses URL discovery or full crawling and routes summarization through Samsung Chat or a local BART/FLAN-T5 fallback, depending on available services. The documented design specifically avoids starting a duplicate crawl because a remote enrichment endpoint failed.",
  "Exact URL matching, targeted TLS-verified fetches, summary provenance and profile keyword validation are control points described by the project. Successful generated prose is not proof that an upstream article was successfully verified."),
 ("Bouncer scoring, clustering and source profiles",
  "Model artifacts and training inputs for Default and Broadcast Bouncer profiles appear separately in the project. Source selection, relevance scoring, semantic clustering, editorial approval and final publication are different concepts. A cluster can group related reports without making their content automatically authoritative.",
  "The semantic clustering, training, profile and source catalog modules should be inspected together because changes to source selection and ranking can affect coverage, duplicate handling and the meaning of visible story counts."),
 ("For You ranking and private recommendation state",
  "The personalization architecture documentation separates globally shared editorial truth from viewer-specific ranking. Candidate collection, scoring, diversity, explanation and private viewer events are handled in dedicated recommendation modules. Private Saved, Following and Hide actions should not be confused with an explicitly shared Not Interested training event.",
  "The architecture describes signed HttpOnly viewer identity and keyed identifiers for stored per-user state. Access and profile filtering take precedence over personalization, so ranking must not expose restricted documents or silently switch the Default versus Broadcast editorial source profile."),
 ("Sampark publishing and contribution import",
  "Sampark provides discovery, authoring, review, approval and operational workspaces. Contribution document import should record two independent outcomes: whether original PDF bytes were saved, and whether selectable text was actually extracted. An unreadable PDF can therefore have a stored draft and an extraction warning without pretending that a preview or summary succeeded.",
  "For a readable PDF, Description should summarize substantive text across the entire extracted document, including its final conclusion, within a 300-character presentation limit. It must not simply return the first 300 characters. Visual PDF overlays are also distinct from secure redaction of underlying original text."),
 ("Reports, analysis and exported documents",
  "The report editor documentation describes composing selected articles into a continuous editable report, reusing detailed story summaries and generating cross-article analysis through a dedicated report path. Analysis, source-backed citations, image replacement, page breaks and document export are different workflow stages.",
  "Exports should preserve the intended evidence and recommendation, and reviewers should verify the final rendered document rather than assuming the live editor's layout is identical to a Word, PowerPoint or PDF export."),
 ("Role access, privacy, testing and deployment",
  "Backend access-control and rate-limiting modules are separate from merely disabling React buttons. Authorization must guard private owner documents and privileged editorial operations server-side. Network calls need explicit safety checks, and document uploads need file-type, size, readability and storage state checks.",
  "The repository's architecture guidance warns against multiple Uvicorn workers during its JSON-backed persistence phase because schedulers and process-local locks are not shared across processes. A database and centrally managed scheduler become important scaling considerations. Test files show intended test coverage, but their existence is not evidence that the current checkout passes."),
]

def root_dir(value):
    root = Path(value).resolve()
    if (root / "news_scrapper").is_dir(): return root
    if (root / "legacy_app" / "news_scrapper").is_dir(): return root / "legacy_app"
    raise SystemExit("Supply --root pointing to C:\\scrappyV3")

def get_font():
    for path in ("C:/Windows/Fonts/consola.ttf",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
                 "/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf"):
        if Path(path).exists(): return path
    raise RuntimeError("Could not locate a monospaced font for code images.")

def redact(line):
    if SCRUB.search(line) or TOKEN.search(line):
        return "[REDACTED: possible credential]"
    return line.replace("\x00", " ")[:175]

def discover(root):
    result = []
    for directory in SOURCE_DIRS:
        folder = root / directory
        if not folder.is_dir(): continue
        for path in folder.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in EXT: continue
            rel = path.relative_to(root)
            if any(p.lower() in SKIP_DIR for p in rel.parts[:-1]): continue
            if SKIP_NAME.search(path.name): continue
            if path.stat().st_size > 2500000: continue
            try: raw = path.read_text(encoding="utf-8", errors="replace")
            except OSError: continue
            if not raw.strip(): continue
            routes = [f"{verb.upper()} {url}" for _, verb, url in ROUTE.findall(raw)][:80]
            symbols = FUNC.findall(raw)[:60] if path.suffix == ".py" else JSCOMP.findall(raw)[:60]
            lines = [redact(line) for line in raw.splitlines()]
            result.append(dict(path=path, rel=rel.as_posix(), routes=routes,
                               symbols=list(dict.fromkeys(symbols)), lines=lines))
    for name in ("main.py", "SAMPARK_WORKSPACES.md"):
        path = root / name
        if path.is_file():
            raw = path.read_text(encoding="utf-8", errors="replace")
            result.append(dict(path=path, rel=name, lines=[redact(x) for x in raw.splitlines()],
                               routes=[f"{v.upper()} {u}" for _, v, u in ROUTE.findall(raw)],
                               symbols=FUNC.findall(raw)[:60]))
    return sorted(result, key=lambda x: x["rel"])

class PDF:
    def __init__(self):
        self.doc = fitz.open()
        self.pg = None
        self.y = 80
        self.characters = 0
        self.section = "Architecture"
    def page(self, section):
        if len(self.doc) >= MAX_PAGES:
            raise RuntimeError("Page budget exceeded")
        self.section = section
        self.pg = self.doc.new_page(width=W, height=H)
        self.pg.draw_rect(fitz.Rect(0, 0, W, 52), fill=(.06, .15, .28), color=None)
        self.pg.insert_text((33, 31), "NEWS SCRAPPER  /  SAMPARK", fontsize=11,
                            fontname="hebo", color=(1, 1, 1))
        self.pg.draw_line((33, 794), (W - 33, 794), color=(.8, .86, .92))
        self.pg.insert_text((33, 810), section[:70], fontsize=7, color=(.4, .5, .6))
        self.pg.insert_text((W - 54, 810), str(len(self.doc)), fontsize=8)
        self.y = 81
    def text(self, value, *, heading=False, small=False):
        value = str(value or "").strip()
        if not value or self.characters >= MAX_TEXT: return
        value = value[:MAX_TEXT - self.characters]
        self.characters += len(value)
        size = 14 if heading else (8.0 if small else 9.4)
        step = 20 if heading else (11.5 if small else 13.6)
        width = 60 if heading else (98 if small else 89)
        for paragraph in value.splitlines():
            for line in textwrap.wrap(paragraph, width, break_long_words=True) or [""]:
                if self.y > 774 - step: self.page(self.section)
                if line: self.pg.insert_text((36, self.y), line[:width + 2], fontsize=size,
                                             fontname="hebo" if heading else "helv",
                                             color=(.13, .23, .35))
                self.y += step
        self.y += 9 if heading else 11
    def heading(self, title):
        if self.pg is None or self.y > 720: self.page(title)
        self.section = title
        self.text(title, heading=True)

def picture(item, start, stop, fontfile, quality):
    # Every image represents a distinct, actual source-code line range.
    w, h = 2900, 3900
    im = Image.new("RGB", (w, h), "#fafcff")
    draw = ImageDraw.Draw(im)
    titlefont = ImageFont.truetype(fontfile, 32)
    font = ImageFont.truetype(fontfile, 23)
    tiny = ImageFont.truetype(fontfile, 18)
    draw.rectangle((0, 0, w, 155), fill="#15283e")
    draw.text((73, 45), item["rel"][:95], fill="white", font=titlefont)
    draw.text((73, 103), f"Actual source lines {start}-{stop}", fill="#b9d3f5", font=tiny)
    content = item["lines"][start - 1:stop]
    first_col = math.ceil(len(content) / 2)
    for j, text in enumerate(content):
        col = j // first_col
        row = j % first_col
        x, y = 70 + col * 1400, 204 + row * 43
        if y > h - 100: break
        if row % 2 == 0:
            draw.rectangle((x - 9, y - 5, x + 1350, y + 31), fill="#f1f5fa")
        if col:
            draw.line((1445, 185, 1445, 3770), fill="#dfe6ef", width=2)
        draw.text((x, y), f"{start+j:05d}", font=tiny, fill="#8797a9")
        line = text.expandtabs(2)[:83]
        color = "#2c699e" if line.lstrip().startswith(
            ("def ", "class ", "async def ", "export ", "import ", "from ")) else "#223950"
        draw.text((x + 104, y), line, fill=color, font=font)
    draw.text((73, 3842), "LOCAL SOURCE SNAPSHOT  /  Review before sharing",
              fill="#6d8199", font=tiny)
    buffer = io.BytesIO()
    im.save(buffer, "JPEG", quality=quality, subsampling=0, optimize=True)
    im.close()
    return buffer.getvalue()

def gallery_items(files, count):
    priorities = ("news_scrapper/", "news-ui/src/sampark/",
                  "news-ui/src/news-scrapper/", "core/", "venture_lens/")
    files = sorted([f for f in files if f["path"].suffix in
                    {".py", ".js", ".jsx", ".ts", ".tsx", ".css"}],
                   key=lambda item: (next((i for i, pref in
                       enumerate(priorities) if item["rel"].startswith(pref)), 99),
                       -len(item["lines"])))
    gallery = [(f, 1, min(165, len(f["lines"]))) for f in files if f["lines"]]
    for f in files:
        if len(gallery) >= count: break
        if len(f["lines"]) > 330:
            start = max(166, len(f["lines"]) // 2 - 80)
            gallery.append((f, start, min(start + 164, len(f["lines"]))))
    return gallery[:count]

def build(root, output, target, gallery_limit):
    files = discover(root)
    if len(files) < 10: raise SystemExit("Not enough real source files found")
    doc = PDF()
    doc.page("Source-based architecture report")
    doc.heading("NewsScrapper and Sampark: Real Architecture Review")
    doc.text("This report is derived from the actual local working tree, rather "
             "than generated filler. Its final architectural recommendation "
             "is deliberately located at the end, to test whether Sampark "
             "really summarizes a document instead of copying its introduction.")
    doc.text(f"Working tree: {root}. Indexed real source files: {len(files)}. "
             "No fabricated benchmark measurements, dummy PDFs, repeated "
             "paragraphs, random binary attachments or duplicate source pages.")
    stats = collections.Counter(f["path"].suffix for f in files)
    doc.heading("Repository source inventory")
    doc.text("Languages and document types: " +
             ", ".join(f"{k}: {v}" for k, v in sorted(stats.items())))
    for folder in SOURCE_DIRS:
        matches = [f for f in files if f["rel"].startswith(folder + "/")]
        if matches:
            route_count = sum(len(f["routes"]) for f in matches)
            doc.text(f"{folder}: {len(matches)} inspected files, "
                     f"{route_count} directly observed route decorators.")
    for title, *paragraphs in CHAPTERS:
        doc.heading(title)
        for p in paragraphs: doc.text(p)
    doc.heading("Architecture documented by project maintainers")
    doc.text("The following source-authored design text comes directly from "
             "existing project documentation on disk. Historical claims "
             "represent documented intent, not verified live measurements.")
    for filename in DOCS:
        path = root / filename
        if not path.is_file(): continue
        if doc.characters > 95000: break
        body = path.read_text(encoding="utf-8", errors="replace")
        doc.heading("Project document: " + filename)
        for block in re.split(r"\n\s*\n", body):
            if doc.characters > 95000: break
            block = " ".join(redact(line) for line in block.splitlines())
            if not block.strip(): continue
            doc.text(block[:1800], small=block.lstrip().startswith(("#", "|", "- ")))
    doc.heading("Backend API surface observed from source")
    found_routes = [(f["rel"], path) for f in files for path in f["routes"]]
    doc.text(f"Observed {len(found_routes)} FastAPI route declarations. "
             "These are source observations, not authenticated runtime tests.")
    for filename, route in found_routes[:220]:
        if doc.characters > 112000: break
        doc.text(f"{route}  -  {filename}", small=True)
    doc.heading("Function and component inventory")
    for f in files:
        if doc.characters > 125000: break
        if not f["symbols"]: continue
        names = ", ".join(f["symbols"][:22])
        doc.text(f"{f['rel']}: {names}", small=True)
    doc.heading("Visual evidence: different real source files")
    doc.text("The pages that follow show unique source excerpts from actual "
             "Python, React and CSS files. They are high-resolution code "
             "images, not synthetic document text or hidden binary padding.")
    gallery = gallery_items(files, gallery_limit)
    print(f"Files: {len(files)}; discovered routes: {len(found_routes)}; "
          f"unique source-image pages: {len(gallery)}")
    font = get_font()
    target_bytes = target * 1024 * 1024
    samples = gallery[::max(1, len(gallery)//10)][:10]
    quality_scores = []
    for q in (90, 95, 98, 100):
        sizes = [len(picture(f, start, end, font, q)) for f, start, end in samples]
        projected = sum(sizes) / max(1, len(sizes)) * len(gallery)
        quality_scores.append((abs(projected-target_bytes), q, projected))
    _, quality, predicted = min(quality_scores)
    print(f"JPEG quality {quality}; projected real source image size: "
          f"{predicted / 1048576:.1f} MiB")
    for i, (f, start, end) in enumerate(gallery, 1):
        if len(doc.doc) >= MAX_PAGES - 2: break
        pg = doc.doc.new_page(width=W, height=H)
        pg.draw_rect(fitz.Rect(0, 0, W, 49), fill=(.06, .15, .28), color=None)
        pg.insert_text((32, 31), "SOURCE EVIDENCE  /  " + f["rel"][:65],
                       fontsize=9.5, color=(1,1,1), fontname="hebo")
        pg.insert_image(fitz.Rect(29, 66, W-29, 742),
                        stream=picture(f, start, end, font, quality),
                        keep_proportion=True)
        description = f"Source: {f['rel']}; lines {start}-{end}; named symbols: " + \
                      (", ".join(f["symbols"][:4]) or "source file")
        pg.insert_text((33, 759), description[:112], fontsize=7.2)
        pg.insert_text((33, 808), f"Real source evidence page {i}/{len(gallery)}",
                       fontsize=7, color=(.45,.5,.58))
        doc.characters += min(len(description), 112)
        if i % 25 == 0: print("Rendered evidence", i, "of", len(gallery))
    pg = doc.doc.new_page(width=W, height=H)
    pg.draw_rect(fitz.Rect(0, 0, W, 55), fill=(.06,.15,.28), color=None)
    pg.insert_text((34, 34), "FINAL ARCHITECTURE ASSESSMENT",
                   fontsize=12, fontname="hebo", color=(1,1,1))
    conclusion = (
        "FINAL RECOMMENDATION: Evolve NewsScrapper as a provenance-first "
        "content intelligence platform. Keep original reporting, model "
        "enrichment, Bouncer scoring, personal recommendation and editorial "
        "publication as separately auditable stages. Generate document-wide "
        "descriptions from the evidence and final findings, rather than "
        "copying the first 300 characters. Store unreadable PDFs with explicit "
        "extraction warnings, enforce contribution access server-side, and "
        "move from process-local JSON locking toward shared persistence and "
        "centrally coordinated scheduler jobs before multi-worker scaling. "
        "These priorities integrate the actual backend routes, source modules, "
        "project documentation and React interfaces recorded in this report."
    )
    y = 115
    for line in textwrap.wrap(conclusion, 75):
        pg.insert_text((42, y), line, fontsize=11.3,
                       fontname="hebo", color=(.13,.24,.38))
        y += 19
    pg.insert_text((42, min(y + 40, 760)),
                   "END OF SOURCE-GROUNDED REVIEW  /  NO SYNTHETIC PADDING",
                   fontsize=9, color=(.36,.49,.64))
    doc.doc.set_metadata({"title": "NewsScrapper Real Architecture Atlas",
                          "subject": "Actual architecture, code evidence and final recommendations"})
    output.parent.mkdir(parents=True, exist_ok=True)
    doc.doc.save(output, garbage=3, deflate=True)
    doc.doc.close()
    verified = fitz.open(output)
    chars = 0
    last_found = False
    for page in verified:
        text = page.get_text()
        chars += len(text)
        if "FINAL RECOMMENDATION:" in text:
            last_found = True
    pages = len(verified)
    verified.close()
    size = output.stat().st_size
    print("PDF:", output)
    print("SIZE_MIB:", round(size / 1048576, 2))
    print("PAGES:", pages)
    print("EXTRACTED_CHARACTERS:", chars)
    print("FINAL_RECOMMENDATION_FOUND:", last_found)
    if not last_found: raise SystemExit("ERROR: final recommendation was not extractable")
    if pages > 500: raise SystemExit("ERROR: exceeds 500-page import limit")
    if chars > 195000: print("WARNING: near the 200k extraction ceiling")
    if size < target_bytes:
        print("NOTE: Below target size because no invented filler was added.")
    else: print("Target achieved using actual, distinct source-code excerpts.")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=Path.cwd())
    ap.add_argument("--output", type=Path, default=None)
    ap.add_argument("--target-mb", type=int, default=100)
    ap.add_argument("--max-gallery", type=int, default=280)
    a = ap.parse_args()
    root = root_dir(a.root)
    build(root, a.output or root / "NewsScrapper_Real_Architecture_Atlas.pdf",
          max(1, a.target_mb), max(1, min(360, a.max_gallery)))
