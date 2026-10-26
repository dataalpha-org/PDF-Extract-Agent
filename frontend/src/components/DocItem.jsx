import { FileText, LoaderCircle, RotateCw, Trash2 } from "lucide-react";
import { exportUrl } from "../api.js";
import { statusPill, statusText } from "../utils.js";

export default function DocItem({ doc, onRetry, onRemove }) {
  const [kind, label] = statusPill(doc);
  return (
    <li className="doc">
      <div className="doc-icon">
        <FileText size={18} />
      </div>
      <div className="doc-body">
        <div className="doc-name" title={doc.name}>{doc.name}</div>
        <div className="doc-meta">
          <span className={`pill pill-${kind}`}>
            {kind === "info" && <LoaderCircle size={11} className="spin" />}
            {label}
          </span>
          <span className="doc-status" title={statusText(doc)}>{statusText(doc)}</span>
        </div>
        {doc.status === "ready" && (
          <div className="doc-exports">
            <a href={exportUrl(doc.id, "markdown")} target="_blank" rel="noreferrer">Markdown</a>
            <a href={exportUrl(doc.id, "json")} target="_blank" rel="noreferrer">JSON</a>
            <a href={exportUrl(doc.id, "tables")} target="_blank" rel="noreferrer">Tables</a>
          </div>
        )}
      </div>
      <div className="doc-actions">
        {doc.error && (
          <button className="icon-btn" onClick={() => onRetry(doc)} title="Retry parsing" aria-label="Retry parsing">
            <RotateCw size={15} />
          </button>
        )}
        {!doc.sample && (
          <button className="icon-btn danger" onClick={() => onRemove(doc)} title="Delete" aria-label="Delete">
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </li>
  );
}
