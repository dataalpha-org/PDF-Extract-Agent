"""Docling parsing: convert a PDF once, return markdown / per-page markdown / tables / JSON."""
import os
import threading

import pypdfium2 as pdfium
from docling.datamodel.accelerator_options import AcceleratorOptions
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.utils.locks import pypdfium2_lock

# One converter per OCR setting, created lazily: model loading is expensive, do it once.
_converters: dict[bool, DocumentConverter] = {}
_converters_lock = threading.Lock()
# Docling already uses every core for one PDF; running two at once only makes both slower.
_convert_lock = threading.Lock()


def get_converter(ocr: bool) -> DocumentConverter:
    with _converters_lock:
        if ocr not in _converters:
            opts = PdfPipelineOptions()
            opts.do_ocr = ocr
            opts.accelerator_options = AcceleratorOptions(num_threads=os.cpu_count() or 4)
            # Pin the expensive extras off so a future Docling default change can't slow parsing.
            opts.generate_page_images = False
            opts.generate_picture_images = False
            opts.generate_table_images = False
            opts.do_picture_classification = False
            opts.do_picture_description = False
            opts.do_chart_extraction = False
            opts.do_code_enrichment = False
            opts.do_formula_enrichment = False
            _converters[ocr] = DocumentConverter(
                format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
            )
        return _converters[ocr]


def extract_text_pages(path: str) -> list[dict] | None:
    # Quick per-page text straight from the PDF's text layer (well under a second, no models).
    # Returns None if any page has no text (scanned), since those pages need Docling's OCR.
    with pypdfium2_lock:  # pdfium is not thread-safe; Docling uses this same lock
        pdf = pdfium.PdfDocument(path)
        try:
            pages = [
                # pdfium marks hyphens at line breaks ("pre-tax") as U+FFFE; restore them.
                {"page": i + 1,
                 "markdown": pdf[i].get_textpage().get_text_range().replace("\r\n", "\n").replace("￾", "-")}
                for i in range(len(pdf))
            ]
        finally:
            pdf.close()
    if not pages or not all(p["markdown"].strip() for p in pages):
        return None
    return pages


def parse_pdf(path: str) -> dict:
    # A PDF with a full text layer skips OCR: Docling reads that text directly, OCR would only re-read it.
    ocr = extract_text_pages(path) is None
    with _convert_lock:
        result = get_converter(ocr).convert(path)
    doc = result.document

    pages = []
    for page_no in sorted(doc.pages.keys()):
        try:
            md = doc.export_to_markdown(page_no=page_no)
        except Exception:
            md = ""
        pages.append({"page": page_no, "markdown": md})

    tables = []
    for i, t in enumerate(doc.tables):
        entry = {
            "index": i,
            "page": t.prov[0].page_no if t.prov else None,
            "markdown": "",
            "columns": [],
            "rows": [],
        }
        try:
            entry["markdown"] = t.export_to_markdown(doc)
            df = t.export_to_dataframe(doc)
            entry["columns"] = [str(c) for c in df.columns]
            # Lists, not dicts: SEC-style tables often repeat headers, and dict rows drop duplicate columns.
            entry["rows"] = df.astype(str).values.tolist()
        except Exception:
            pass
        tables.append(entry)

    return {
        "markdown": doc.export_to_markdown(),
        "pages": pages,
        "tables": tables,
        "json": doc.export_to_dict(),
    }
