# PLAN.md: PDF Extract Agent (Docling + Claude)

This file is the single source of truth for building this project with Claude Code. Read it fully before changing anything. Work phase by phase, tick the checkboxes as you go, and never skip a phase's **Verify** step.

Owner profile: full-stack AI developer (MERN + Python). Prefer simple, readable code over clever abstractions.

---

## 1. Goal

A web app where a user:
1. Uploads one or many PDFs.
2. Adds one or more **extraction requests**. Each request has:
   - a free-text comment describing the information or headers wanted,
   - the subset of uploaded PDFs to read from,
   - the output format (table, paragraph, bullets, Field: Value, JSON, or custom).
3. Can upload more PDFs later and add more requests; every request's PDF checklist shows all uploaded PDFs.
4. Gets answers that cite **document name + page**, and says `Not found` instead of guessing.
5. Can copy or download results (CSV for tables, JSON, Markdown).

Non-goals for the PoC: multi-user auth, billing, fine-grained permissions, mobile layout polish.

---

## 2. Architecture

```
React (Vite)  ──HTTP──▶  FastAPI (Python)  ──▶  Docling (parse, OCR)
   :5173                    :8000          └──▶  Claude API (extract)
                               │
                          backend/data/   (PoC: files on disk)
                          MongoDB         (Phase 3: metadata + requests)
```

Target (later phases): `React → Express gateway (auth, MongoDB) → FastAPI (Docling + Claude)`. Docling is Python-only, so the FastAPI service always stays.

### Key design decisions (do not change without a reason)
- **Parse once, store everything.** Docling conversion is slow. Never re-parse a PDF to answer a request.
- **Send per-page markdown to Claude, not Docling JSON.** The JSON is huge (bounding boxes, provenance). Markdown with `[Page N]` markers is compact and gives citations.
- **Docling JSON is stored for download only.**
- **Parsing is asynchronous.** Upload returns immediately with `status: processing`; the UI polls until `ready` or `error`.
- **One `DocumentConverter` instance per process** (model loading is expensive). It is lazily created in `parser.py`.
- **The model never guesses.** The system prompt requires `Not found` for missing data.

---

## 3. Current state (Phase 0 is DONE)

Project layout:

```
pdf-extract-poc/
├── PLAN.md                  ← this file
├── README.md                ← run instructions
├── backend/
│   ├── main.py              ← FastAPI app + endpoints, disk storage
│   ├── parser.py            ← Docling: markdown, per-page markdown, tables, JSON
│   ├── extract.py           ← context building + Claude call
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── package.json, vite.config.js, index.html
    └── src/ main.jsx, App.jsx, api.js, styles.css
```

Status:
- Backend passes `py_compile`; frontend passes `npm run build`.
- **Never run end to end.** Docling was not installed and no API key was available when this was written. Phase 1 exists to fix that.

### API contract (current)

| Method | Path | Body / query | Response |
|---|---|---|---|
| POST | `/documents` | multipart `files[]` (PDFs only) | `[{id, name, status:"processing"}]` |
| GET | `/documents` | none | list of meta |
| GET | `/documents/{id}` | none | meta |
| DELETE | `/documents/{id}` | none | `{ok:true}` |
| GET | `/documents/{id}/export` | `format=markdown\|json\|tables` | text / JSON |
| POST | `/extract` | `{doc_ids[], instruction, format, custom_format}` | `{format, text, truncated, data?}` |

Meta shape: `{id, name, status: "processing"|"ready"|"error", pages?, tables?, chars?, error?}`

Extract response: for `format` = `table`, `data` is `{columns: string[], rows: any[][]}`; for `json`, `data` is the parsed JSON (or `null` if Claude returned invalid JSON, in which case `text` still holds the raw answer).

### On-disk layout per document
```
backend/data/<doc_id>/
  source.pdf   meta.json   pages.json   tables.json   doc.md   doc.json
```

### Environment variables
| Name | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none (required) | Claude access |
| `CLAUDE_MODEL` | `claude-sonnet-5-5` | model used for extraction |
| `MAX_CONTEXT_CHARS` | `400000` | cap on characters sent per request |

---

## 4. Conventions for Claude Code

- Python 3.10+, type hints on public functions, no global mutable state except the Docling converter.
- Keep each backend module single-purpose (`parser`, `extract`, `main`; add `db.py` in Phase 3).
- Errors: raise `HTTPException` with a clear message; the frontend shows `detail` verbatim.
- Frontend: plain React + CSS, no UI framework until needed. All HTTP goes through `src/api.js`.
- Never commit `.env`, `backend/data/`, `node_modules/`, `.venv/`.
- Never log full document text or the API key.
- After every phase: run the **Verify** steps, then update the checkboxes in this file.
- If something in this plan is wrong or impossible, fix the plan in this file and say so, rather than silently diverging.

---

## 5. Phases

### Phase 1: Make it actually run (do this first)

Goal: prove Docling parsing and Claude extraction work on real PDFs.

- [ ] 1.1 Create venv, `pip install -r backend/requirements.txt`. Note: Docling pulls in PyTorch, so install is large and slow.
- [ ] 1.2 Write `backend/scripts/try_parse.py`: takes a PDF path, calls `parse_pdf`, prints page count, table count, first 500 chars of page 1 markdown.
- [ ] 1.3 Run it on three PDFs: a text PDF, one with tables, one scanned/image-only (checks OCR).
- [ ] 1.4 Confirm `doc.export_to_markdown(page_no=n)` works for the installed Docling version. If the signature differs, fix `parser.py` (alternative: export per page by filtering items by `prov[0].page_no`).
- [ ] 1.5 Confirm `doc.pages` keys are ints starting at 1 and that `t.export_to_dataframe(doc)` works; fix `parser.py` if the API differs.
- [ ] 1.6 Start the API (`uvicorn main:app --reload --port 8000`) and test with curl:
  - `curl -F "files=@sample.pdf" localhost:8000/documents`
  - poll `GET /documents` until `status` is `ready`
  - `curl -X POST localhost:8000/extract -H "Content-Type: application/json" -d '{"doc_ids":["<id>"],"instruction":"Total amount and due date","format":"table"}'`
- [ ] 1.7 Start the frontend and run the whole flow in the browser with two PDFs and two request cards.

**Verify:** all three PDFs parse; the scanned one returns non-empty markdown; a table extraction renders as an HTML table with a Source column; asking for something absent returns `Not found`.

**Known risks:**
- Docling's first run downloads models (slow, needs internet).
- Very large PDFs can take minutes; the UI must keep polling without freezing.
- `BackgroundTasks` runs in the same process; a server restart mid-parse leaves a document stuck at `processing`. Handle in Phase 2.

### Phase 2: Robustness

- [ ] 2.1 On startup, mark any document still `processing` as `error` ("interrupted by restart") or re-queue it.
- [ ] 2.2 Limit upload size (for example 50 MB per file) and reject non-PDF content types and bad magic bytes (`%PDF`).
- [ ] 2.3 Run parsing in a thread pool (`run_in_threadpool` or a `ThreadPoolExecutor(max_workers=1)`) so it never blocks the event loop; Docling is CPU-heavy.
- [ ] 2.4 Return a useful error when Claude fails (rate limit, auth, context too long) with an HTTP status the UI can display.
- [ ] 2.5 Frontend: show a spinner per file, disable Extract while a selected file is still parsing, add a "Retry" for `error` documents.
- [ ] 2.6 Add `backend/tests/` with pytest: upload validation, list/delete, `build_context` truncation, format-hint selection. Mock the Anthropic client.

**Verify:** `pytest` passes; killing the server during a parse and restarting leaves no stuck `processing` documents.

### Phase 3: MongoDB persistence

- [ ] 3.1 Add `pymongo` to requirements; create `backend/db.py` with a single `MongoClient` and helpers.
- [ ] 3.2 Collections:
  - `documents`: `{_id, name, status, pages, tables, chars, error, created_at, source_path, markdown_path}`
  - `document_pages`: `{doc_id, page, markdown}` (one row per page; avoids the 16 MB document limit)
  - `requests`: `{_id, doc_ids[], instruction, format, result, created_at, model, truncated}`
- [ ] 3.3 Keep `source.pdf` and `doc.json` on disk (or GridFS/S3 later); store paths in Mongo.
- [ ] 3.4 Replace file-based `meta.json` reads and writes in `main.py` with `db.py` calls. Keep endpoint contracts unchanged.
- [ ] 3.5 Save every extraction as a `requests` record; add `GET /requests` so the UI can show history.
- [ ] 3.6 Add `MONGO_URI` and `MONGO_DB` env vars; document them in README and `.env.example`.

**Verify:** restart the backend and Mongo; documents and history survive; no endpoint contract changed.

### Phase 4: Streaming and long documents

- [ ] 4.1 Add `POST /extract/stream` returning Server-Sent Events using `client.messages.stream(...)`. Frontend reads with `fetch` + `ReadableStream` and appends text live.
- [ ] 4.2 For `table` and `json` formats, stream raw text but parse and render only at the end.
- [ ] 4.3 Long-document strategy, in this order of effort:
  1. Page-relevance filter: ask Claude (cheap model) which pages are relevant, then send only those.
  2. Chunk + embed pages, retrieve top-k per request (keep it simple: one vector store, for example Chroma or Mongo Atlas Vector Search).
- [ ] 4.4 Surface "Used N of M pages" in the result UI so truncation is never silent.
- [ ] 4.5 Add prompt caching on the document context so multiple request cards over the same PDFs are cheaper.

**Verify:** a 300+ page PDF extracts a specific fact correctly with the right page cited; streaming text appears within about 2 seconds.

### Phase 5: Express gateway (full MERN)

Only start this when auth or multi-user is actually required.

- [ ] 5.1 Create `gateway/` (Node + Express). Routes mirror the FastAPI contract and proxy to it.
- [ ] 5.2 Auth: JWT (or session) with `users` collection; every document and request carries `owner_id`.
- [ ] 5.3 Express handles file upload (multer) and storage, then calls FastAPI over HTTP for parse and extract. FastAPI is not exposed publicly.
- [ ] 5.4 Frontend: login/signup screens; `api.js` base URL points to the gateway; attach the token.
- [ ] 5.5 Enforce ownership checks on every document and request route.

**Verify:** user A cannot read or extract from user B's documents.

### Phase 6: Quality and polish

- [ ] 6.1 Table output: when the user asks for "table N from the PDF", return Docling's real table rows (`tables.json`) instead of an LLM re-typing it.
- [ ] 6.2 Clickable citations: page numbers open a PDF viewer at that page.
- [ ] 6.3 Save and reuse request templates (for example "Invoice fields").
- [ ] 6.4 Export all results as one Excel workbook (one sheet per request).
- [ ] 6.5 Cancel button for in-flight extractions (`AbortController` + server-side disconnect handling).
- [ ] 6.6 Basic eval set: 10 PDFs with known answers; a script that reports accuracy so prompt changes are measurable.

### Phase 7: Deployment

- [ ] 7.1 `backend/Dockerfile` (python:3.11-slim plus system libs Docling needs; pre-download models at build time so the first request isn't slow).
- [ ] 7.2 `frontend/Dockerfile` (build, then serve with nginx).
- [ ] 7.3 `docker-compose.yml`: frontend, (gateway), backend, mongo, with a volume for `data/`.
- [ ] 7.4 Production CORS (replace the `localhost:5173` allow-list), HTTPS, secrets via env, request size limits.

---

## 6. Prompt contract (extract.py)

System prompt rules (keep these):
1. Use ONLY the provided documents.
2. Never guess; write `Not found` for anything absent.
3. Cite document name and page, using the `[Page N]` markers.

Format hints:
- `table`: return ONLY JSON `{"columns": [...], "rows": [[...]]}` with a final `Source` column (`document, p.N`). No prose, no code fences.
- `paragraph`: prose, inline citations `(document, p.N)`.
- `bullets`: bulleted list, inline citations.
- `keyvalue`: one `Field: Value` per line, citation after each value.
- `json`: ONLY valid JSON, include a `source` field.
- `custom`: follow the user's description.

Context layout:
```
<document name="a.pdf">
[Page 1]
...markdown...
[Page 2]
...
</document>
<document name="b.pdf"> ... </document>

Extract the following information:
<user instruction>

Output format: <hint>
```

---

## 7. Definition of done for the PoC

- [ ] Upload 2+ PDFs, including one scanned.
- [ ] Two request cards with different PDFs and different formats both return correct results.
- [ ] A table result downloads as CSV; a JSON result downloads as `.json`.
- [ ] Missing information is reported as `Not found`.
- [ ] README commands work from a clean clone.

## 8. Quick reference commands

```bash
# backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...
uvicorn main:app --reload --port 8000

# frontend
cd frontend && npm install && npm run dev

# tests (after Phase 2)
cd backend && pytest -q
```
