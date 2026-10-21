"""Generate a readable synthetic PDF for Sampark upload and description tests.

Requirements: pip install PyMuPDF
Run from C:\scrappyV3:
    python sampark_generate_pdf_100mb.py

This PDF contains long synthetic narrative text and a binary PDF attachment
to stress-test transfer and storage size. The text is selectable, not scanned.
The binary attachment is a legitimate PDF embedded file, not invalid padding.
"""
from pathlib import Path
import os
import textwrap

try:
    import pymupdf as fitz
except ImportError:
    import fitz

TARGET_MIB = 100
PAGE_COUNT = 41
OUTPUT = Path(f"sampark_{TARGET_MIB}MB_long_text_test.pdf")

SENTENCES = (
    "During the quarterly operating review, representatives from engineering, "
    "quality assurance, governance, customer experience, and infrastructure "
    "examined the same recurring process weakness from different perspectives, "
    "carefully documenting all competing explanations before selecting a next step.",
    "The provisional notes described how delays accumulated across several "
    "independent teams, how small differences in documentation amplified those "
    "delays, and how a reliable resolution would require coordinated ownership "
    "rather than a short-lived workaround or an attractive dashboard metric.",
    "A detailed walkthrough compared the first response to the final outcome, "
    "including the assumptions made at intake, the evidence considered by each "
    "reviewer, and the controls that would need to remain in place after the "
    "immediate incident had been resolved and the report was archived.",
    "Participants repeatedly emphasized that the preliminary observations in "
    "the opening pages are background material, not the document's ultimate "
    "recommendation, and that the definitive conclusion appears only in the "
    "last section after all supporting checks have been described in full.",
)


def build_text_pdf() -> "fitz.Document":
    document = fitz.open()
    for index in range(PAGE_COUNT):
        page = document.new_page(width=595, height=842)
        heading = f"SAMPARK {TARGET_MIB} MB TEXT EXTRACTION STRESS TEST - PAGE {index + 1}/{PAGE_COUNT}"
        page.insert_text((40, 48), heading, fontsize=12, fontname="helv")
        page.insert_text(
            (40, 66),
            "SYNTHETIC DOCUMENT - DESCRIPTION SHOULD BEGIN WITH THIS INTRO, NOT THE FINAL DECISION",
            fontsize=7.0,
            fontname="helv",
        )
        y = 90.0
        for section in range(9):
            sentence = SENTENCES[(index + section) % len(SENTENCES)]
            paragraph = (
                f"Observation {index + 1}.{section + 1}: {sentence} "
                "The purpose of this extended narrative is to test large uploads "
                "and long-document text extraction without disclosing real company information."
            )
            for line in textwrap.wrap(paragraph, width=108, break_long_words=False):
                if y > 770:
                    break
                page.insert_text((40, y), line, fontsize=8.1, fontname="helv")
                y += 12
            y += 3
        if index == PAGE_COUNT - 1:
            page.insert_text((40, 787), "FINAL RECOMMENDATION: PRIORITIZE ACCESSIBLE DOCUMENTATION", fontsize=9)
            page.insert_text((40, 801), "AND VERIFIED IMPORT VALIDATION; THIS IS NOT IN THE OPENING DESCRIPTION.", fontsize=8)
        else:
            page.insert_text((40, 799), f"CONTINUED ANALYSIS - {index + 1}", fontsize=7)
    return document


def main() -> None:
    document = build_text_pdf()
    text_only_size = len(document.tobytes(garbage=4, deflate=False))
    target_bytes = TARGET_MIB * 1024 * 1024
    # Synthetic, incompressible attachment tests transfer/storage limits while
    # leaving real, selectable text on every page.
    payload_size = target_bytes - text_only_size - 8192
    if payload_size < 1:
        raise RuntimeError("The readable PDF already exceeds the requested size.")
    print(f"Creating {TARGET_MIB} MiB PDF with {PAGE_COUNT} readable pages...")
    payload = os.urandom(payload_size)
    document.embfile_add(
        "synthetic_stress_payload.bin",
        payload,
        filename="synthetic_stress_payload.bin",
        desc="Synthetic high-entropy bytes for file-size stress testing; no personal data",
    )
    del payload
    document.save(OUTPUT, garbage=4, deflate=False)
    document.close()

    check = fitz.open(OUTPUT)
    extracted = "".join(page.get_text() for page in check)
    print(f"OUTPUT: {OUTPUT.resolve()}")
    print(f"SIZE_BYTES: {OUTPUT.stat().st_size:,}")
    print(f"SIZE_MIB: {OUTPUT.stat().st_size / 1024 ** 2:.2f}")
    print(f"PAGES: {len(check)}")
    print(f"EXTRACTED_CHARACTERS: {len(extracted):,}")
    print(f"FINAL_MARKER_FOUND: {'FINAL RECOMMENDATION:' in extracted}")
    check.close()
    if not extracted.startswith(f"SAMPARK {TARGET_MIB} MB TEXT EXTRACTION STRESS TEST"):
        raise RuntimeError("Generated PDF did not extract as expected.")
    if "FINAL RECOMMENDATION:" not in extracted:
        raise RuntimeError("The ending conclusion was missing.")


if __name__ == "__main__":
    main()
