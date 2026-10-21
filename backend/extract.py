"""Claude extraction over Docling markdown."""
import json
import os
import re

import anthropic

MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5")
MAX_CHARS = int(os.getenv("MAX_CONTEXT_CHARS", "400000"))
MAX_TOKENS = 8000

FORMAT_HINTS = {
    "table": (
        "Return ONLY a JSON object: {\"columns\": [..], \"rows\": [[..], ..]}. "
        "Add a final column named \"Source\" with 'document, p.N' for each row. No prose, no code fences."
    ),
    "paragraph": "Write clear prose paragraphs. Cite sources inline as (document, p.N).",
    "bullets": "Write a bulleted list. Cite sources inline as (document, p.N).",
    "keyvalue": "Write one 'Field: Value' per line. Cite sources as (document, p.N) after each value.",
    "json": "Return ONLY valid JSON (no code fences). Include a \"source\" field with document and page where relevant.",
}

SYSTEM = (
    "You extract information from documents. Use ONLY the provided documents. "
    "Never guess: if something is not in the documents, write 'Not found'. "
    "Page markers look like [Page N]. Always cite document name and page."
)


def build_context(docs: list[dict]) -> tuple[str, bool]:
    parts, used, truncated = [], 0, False
    for d in docs:
        parts.append(f"<document name=\"{d['name']}\">")
        for p in d["pages"]:
            chunk = f"\n[Page {p['page']}]\n{p['markdown']}\n"
            if used + len(chunk) > MAX_CHARS:
                truncated = True
                break
            parts.append(chunk)
            used += len(chunk)
        parts.append("</document>")
    return "".join(parts), truncated


def run_extraction(docs: list[dict], instruction: str, fmt: str, custom_format: str = "") -> dict:
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not set on the server.")
    context, truncated = build_context(docs)
    hint = FORMAT_HINTS.get(fmt) or f"Format the answer as: {custom_format or fmt}"
    prompt = (
        f"{context}\n\n"
        f"Extract the following information:\n{instruction}\n\n"
        f"Output format: {hint}"
    )
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in msg.content if b.type == "text").strip()
    cut_off = msg.stop_reason == "max_tokens"
    out = {"format": fmt, "text": text, "truncated": truncated, "output_truncated": cut_off}
    if cut_off:
        out["warning"] = f"The answer hit the {MAX_TOKENS}-token output limit and is incomplete."
    if fmt in ("table", "json"):
        if cut_off:
            # Cut-off JSON cannot parse; say so instead of silently returning data=None.
            out["data"] = None
            out["warning"] += " The JSON was cut off, so only the raw text is returned."
        else:
            cleaned = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
            try:
                out["data"] = json.loads(cleaned)
            except json.JSONDecodeError:
                out["data"] = None
    return out
