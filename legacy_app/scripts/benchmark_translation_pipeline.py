"""Deterministic benchmark for translation orchestration (no model download).

This isolates the duplicate/cache/single-flight layer from model and hardware
variance. Run from the repository root with:

    python scripts/benchmark_translation_pipeline.py
"""

from __future__ import annotations

import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from news_scrapper.translation import KoreanTranslator


def main() -> None:
    translator = KoreanTranslator()
    unique = [f"Technology headline number {index}" for index in range(40)]
    payload = unique * 10
    inferred_chunks: list[str] = []

    def deterministic_inference(chunks: list[str]) -> list[str]:
        inferred_chunks.extend(chunks)
        time.sleep(0.0005 * len(chunks))
        return [f"번역:{chunk}" for chunk in chunks]

    translator._translate_chunks_unlocked = deterministic_inference  # type: ignore[method-assign]

    started = time.perf_counter()
    _first, first_stats = translator.translate_many_with_stats(payload)
    first_ms = (time.perf_counter() - started) * 1000
    started = time.perf_counter()
    _second, second_stats = translator.translate_many_with_stats(payload)
    cached_ms = (time.perf_counter() - started) * 1000

    print("Translation orchestration benchmark (deterministic inference stub)")
    print(f"Input items:              {len(payload)}")
    print(f"Unique inferred items:    {len(inferred_chunks)}")
    print(f"Duplicate work avoided:   {len(payload) - len(inferred_chunks)}")
    print(f"Cold orchestration:       {first_ms:.2f} ms | {first_stats}")
    print(f"Warm-cache orchestration: {cached_ms:.2f} ms | {second_stats}")
    print(f"Warm/cold speedup:        {first_ms / max(cached_ms, 0.001):.1f}x")


if __name__ == "__main__":
    main()
