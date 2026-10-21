"""Phase 1 check: parse a PDF with parser.parse_pdf and print a short report.

Usage (from backend/): python scripts/try_parse.py path/to/file.pdf [more.pdf ...]
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252

from parser import parse_pdf  # noqa: E402


def report(path: str) -> None:
    start = time.perf_counter()
    parsed = parse_pdf(path)
    secs = time.perf_counter() - start

    pages, tables = parsed["pages"], parsed["tables"]
    empty = [p["page"] for p in pages if not p["markdown"].strip()]
    with_rows = sum(1 for t in tables if t["rows"])

    print(f"=== {Path(path).name}  ({secs:.1f}s)")
    print(f"pages: {len(pages)}  (keys {pages[0]['page'] if pages else '-'}..{pages[-1]['page'] if pages else '-'})")
    print(f"empty pages: {len(empty)} {empty[:20]}")
    print(f"tables: {len(tables)}  (with dataframe rows: {with_rows})")
    print(f"total markdown chars: {len(parsed['markdown'])}")
    print("--- page 1 markdown (first 500 chars) ---")
    print(pages[0]["markdown"][:500] if pages else "(no pages)")
    print()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for pdf in sys.argv[1:]:
        report(pdf)
