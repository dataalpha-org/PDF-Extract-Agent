# PDF Extract Agent (PoC)

React (Vite) -> FastAPI -> Docling (parse once) -> Claude (extract). Storage is plain files in `backend/data/` (swap for MongoDB later).

## Run

Backend (Python 3.10+):
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your_key                    # Windows: set ANTHROPIC_API_KEY=your_key
uvicorn main:app --reload --port 8000
```
First upload is slow: Docling downloads its models on first use.

Frontend (Node 18+):
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173

## API
- `POST /documents` upload PDFs (parsing runs in background, status: processing -> ready)
- `GET /documents` list, `DELETE /documents/{id}`
- `GET /documents/{id}/export?format=markdown|json|tables`
- `POST /extract` `{doc_ids, instruction, format: table|paragraph|bullets|keyvalue|json|custom, custom_format}`

## Next steps
MongoDB for metadata, SSE streaming, retrieval for very long documents, Express gateway for auth.
