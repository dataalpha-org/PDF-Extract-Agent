"""FastAPI backend: upload -> Docling parse (background) -> Claude extraction. Disk storage for the PoC."""
import json
import os
import shutil
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv

# Load .env before importing modules that read env vars at import time (extract.py reads CLAUDE_MODEL).
load_dotenv(Path(__file__).parent / ".env")

import anthropic  # noqa: E402
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse, PlainTextResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from extract import run_extraction  # noqa: E402
from parser import extract_text_pages, parse_pdf  # noqa: E402

DATA = Path(__file__).parent / "data"
DATA.mkdir(exist_ok=True)
SAMPLES = Path(__file__).parent.parent / "samples"  # PDFs here are preloaded for every user

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB per file


def _dir(doc_id: str) -> Path:
    if not doc_id.isalnum():
        raise HTTPException(400, "bad id")
    return DATA / doc_id


def _meta(doc_id: str) -> dict:
    p = _dir(doc_id) / "meta.json"
    if not p.exists():
        raise HTTPException(404, "document not found")
    return json.loads(p.read_text(encoding="utf-8"))


def _write_text(path: Path, text: str):
    # Write then rename, so a reader (list, extract) never sees a half-written file.
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _write_meta(doc_id: str, meta: dict):
    _write_text(_dir(doc_id) / "meta.json", json.dumps(meta))


def _recover_interrupted() -> list[str]:
    # Parsing runs in-process, so anything mid-parse at startup was killed by the restart.
    # "processing" docs have nothing usable and become errors; "ready_text" docs keep their quick
    # text and are returned so Docling can resume on them.
    resume = []
    for p in DATA.glob("*/meta.json"):
        try:
            meta = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if meta.get("status") == "processing":
            meta.update(status="error", error="interrupted by restart")
            _write_text(p, json.dumps(meta))
        elif meta.get("status") == "ready_text" and not meta.get("error"):
            resume.append(meta["id"])
    return resume


def _seed_samples() -> list[str]:
    # Register every PDF in samples/ as a sample document. Each is parsed once and kept on disk,
    # so later restarts only re-queue samples that are not ready yet. Returns the ids to parse.
    if not SAMPLES.is_dir():
        return []
    existing = {}
    for p in DATA.glob("*/meta.json"):
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if m.get("sample"):
            existing[m["name"]] = m
    queue = []
    for pdf in sorted(SAMPLES.glob("*.pdf"), key=lambda p: p.stat().st_size):  # smallest first
        m = existing.get(pdf.name)
        if m and m["status"] == "ready":
            continue
        if m and m["status"] == "ready_text":
            queue.append(m["id"])  # keep it usable; only Docling still has to run
            continue
        if m:
            doc_id = m["id"]
        else:
            doc_id = uuid.uuid4().hex[:12]
            _dir(doc_id).mkdir()
            shutil.copyfile(pdf, _dir(doc_id) / "source.pdf")
        _write_meta(doc_id, {"id": doc_id, "name": pdf.name, "status": "processing", "sample": True})
        queue.append(doc_id)
    return queue


def _run_queue(doc_ids: list[str]):
    # Quick text for every document first (seconds), then Docling one PDF at a time (minutes).
    for i in doc_ids:
        _quick_text(i)
    for i in doc_ids:
        _process(i)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    queue = list(dict.fromkeys(_recover_interrupted() + _seed_samples()))  # dedupe, keep order
    if queue:
        threading.Thread(target=_run_queue, args=(queue,), daemon=True).start()
    yield


app = FastAPI(title="PDF Extract PoC", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _quick_text(doc_id: str):
    # Stage 1 (fast path): plain per-page text from the PDF's text layer -> status "ready_text",
    # so /extract works within seconds. Scanned PDFs have no text layer and wait for Docling's OCR.
    d = _dir(doc_id)
    try:
        if _meta(doc_id)["status"] != "processing":
            return
        pages = extract_text_pages(str(d / "source.pdf"))
        if not pages:
            return
        _write_text(d / "pages.json", json.dumps(pages))
        meta = _meta(doc_id)
        if meta["status"] == "processing":  # Docling did not finish first
            meta.update(status="ready_text", pages=len(pages), chars=sum(len(p["markdown"]) for p in pages))
            _write_meta(doc_id, meta)
    except Exception:  # noqa: BLE001
        return  # deleted meanwhile, or unreadable: Docling (stage 2) decides the final status


def _process(doc_id: str):
    # Stage 2: full Docling parse -> layout-aware markdown and real tables, status "ready".
    d = _dir(doc_id)
    if not (d / "meta.json").exists():
        return  # deleted before parsing started
    meta = _meta(doc_id)
    try:
        parsed = parse_pdf(str(d / "source.pdf"))
        _write_text(d / "pages.json", json.dumps(parsed["pages"]))
        _write_text(d / "tables.json", json.dumps(parsed["tables"]))
        _write_text(d / "doc.md", parsed["markdown"])
        _write_text(d / "doc.json", json.dumps(parsed["json"]))
        meta.pop("error", None)
        meta.update(status="ready", pages=len(parsed["pages"]), tables=len(parsed["tables"]),
                    chars=len(parsed["markdown"]))
    except Exception as e:  # noqa: BLE001
        if not d.exists():
            return  # deleted while parsing; nothing to record
        meta = _meta(doc_id)  # pick up a "ready_text" status written by stage 1
        if meta["status"] == "ready_text":
            meta["error"] = f"Docling parsing failed, quick text still usable: {e}"
        else:
            meta.update(status="error", error=str(e))
    if not d.exists():
        return
    _write_meta(doc_id, meta)


def _validate_pdf(f: UploadFile) -> None:
    name = f.filename or "file"
    if not name.lower().endswith(".pdf"):
        raise HTTPException(400, f"{name} is not a PDF")
    f.file.seek(0, 2)
    size = f.file.tell()
    f.file.seek(0)
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"{name} is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    if f.file.read(4) != b"%PDF":
        raise HTTPException(400, f"{name} is not a valid PDF (missing %PDF header)")
    f.file.seek(0)


@app.post("/documents")
async def upload(bg: BackgroundTasks, files: list[UploadFile] = File(...)):
    # Validate every file before saving any, so one bad file can't leave others stuck at "processing".
    for f in files:
        _validate_pdf(f)
    out = []
    for f in files:
        doc_id = uuid.uuid4().hex[:12]
        d = _dir(doc_id)
        d.mkdir()
        with open(d / "source.pdf", "wb") as fh:  # binary mode: encoding does not apply
            shutil.copyfileobj(f.file, fh)
        meta = {"id": doc_id, "name": f.filename, "status": "processing"}
        _write_meta(doc_id, meta)
        out.append(meta)
    # Background tasks run in order: quick text for every file first, then Docling per file.
    bg.add_task(_run_queue, [m["id"] for m in out])
    return out


@app.get("/documents")
def list_docs():
    metas = [json.loads(p.read_text(encoding="utf-8")) for p in DATA.glob("*/meta.json")]
    return sorted(metas, key=lambda m: (not m.get("sample"), m["name"].lower()))  # samples first


@app.get("/documents/{doc_id}")
def get_doc(doc_id: str):
    return _meta(doc_id)


@app.post("/documents/{doc_id}/retry")
def retry_doc(doc_id: str, bg: BackgroundTasks):
    meta = _meta(doc_id)
    failed = meta["status"] == "error" or (meta["status"] == "ready_text" and meta.get("error"))
    if not failed:
        raise HTTPException(409, f"document is {meta['status']}, only failed documents can be retried")
    if not (_dir(doc_id) / "source.pdf").exists():
        raise HTTPException(404, "original PDF is missing; upload it again")
    meta = {k: v for k, v in meta.items() if k in ("id", "name", "sample")}
    meta["status"] = "processing"
    _write_meta(doc_id, meta)
    bg.add_task(_run_queue, [doc_id])
    return meta


@app.delete("/documents/{doc_id}")
def delete_doc(doc_id: str):
    if _meta(doc_id).get("sample"):
        raise HTTPException(403, "sample documents cannot be deleted")
    shutil.rmtree(_dir(doc_id))
    return {"ok": True}


@app.get("/documents/{doc_id}/export")
def export(doc_id: str, format: str = "markdown"):
    meta = _meta(doc_id)
    if meta["status"] != "ready":
        raise HTTPException(409, f"document is {meta['status']}")
    d = _dir(doc_id)
    if format == "markdown":
        return PlainTextResponse((d / "doc.md").read_text(encoding="utf-8"))
    if format == "json":
        return JSONResponse(json.loads((d / "doc.json").read_text(encoding="utf-8")))
    if format == "tables":
        return JSONResponse(json.loads((d / "tables.json").read_text(encoding="utf-8")))
    raise HTTPException(400, "format must be markdown | json | tables")


class ExtractRequest(BaseModel):
    doc_ids: list[str]
    instruction: str
    format: Literal["table", "paragraph", "bullets", "keyvalue", "json", "custom"] = "table"
    custom_format: str = ""


@app.post("/extract")
def extract(req: ExtractRequest):
    if not req.doc_ids:
        raise HTTPException(400, "select at least one document")
    docs, quick = [], []
    for i in req.doc_ids:
        meta = _meta(i)
        if meta["status"] not in ("ready", "ready_text"):
            raise HTTPException(409, f"{meta['name']} is {meta['status']}")
        if meta["status"] == "ready_text":
            quick.append(meta["name"])
        pages = json.loads((_dir(i) / "pages.json").read_text(encoding="utf-8"))
        docs.append({"name": meta["name"], "pages": pages})
    try:
        out = run_extraction(docs, req.instruction, req.format, req.custom_format)
        if quick:
            note = (f"Used quick text for {', '.join(quick)} (Docling still parsing). "
                    "Table values may be less reliable; run again once it shows as fully parsed.")
            out["warning"] = f"{out['warning']} {note}" if out.get("warning") else note
        return out
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except anthropic.RateLimitError:
        raise HTTPException(429, "Claude API rate limit reached. Wait a moment and try again.")
    except anthropic.AuthenticationError:
        raise HTTPException(401, "Claude API rejected the API key. Check ANTHROPIC_API_KEY on the server.")
    except anthropic.APIError as e:
        raise HTTPException(502, f"Claude API error: {e.message}")
