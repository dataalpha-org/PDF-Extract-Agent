import { useRef, useState } from "react";
import { CloudUpload, FileSearch, LoaderCircle } from "lucide-react";
import DocItem from "./DocItem.jsx";

export default function Sidebar({ docs, uploading, error, onFiles, onRetry, onRemove }) {
  const fileRef = useRef();
  const [dragging, setDragging] = useState(false);
  const samples = docs.filter((d) => d.sample);
  const uploads = docs.filter((d) => !d.sample);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">
          <FileSearch size={20} />
        </div>
        <div>
          <h1>PDF Extract Agent</h1>
          <p>Docling parsing + Claude extraction</p>
        </div>
      </div>

      <div
        className={`drop${dragging ? " dragging" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          // Ignore leave events fired when the pointer moves onto a child element.
          if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
      >
        {uploading ? <LoaderCircle size={26} className="spin" /> : <CloudUpload size={26} />}
        <div className="drop-title">{uploading ? "Uploading…" : dragging ? "Drop to upload" : "Drop PDFs or browse"}</div>
        <div className="drop-hint">PDF up to 50 MB · several at once</div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <DocGroup title="Sample documents" docs={samples} onRetry={onRetry} onRemove={onRemove} />
      <DocGroup
        title="Your uploads"
        docs={uploads}
        empty="No uploads yet. Your PDFs appear here."
        onRetry={onRetry}
        onRemove={onRemove}
      />
    </aside>
  );
}

function DocGroup({ title, docs, empty, onRetry, onRemove }) {
  if (!docs.length && !empty) return null;
  return (
    <section className="doc-group">
      <div className="group-head">
        <span>{title}</span>
        <span className="count">{docs.length}</span>
      </div>
      {docs.length ? (
        <ul className="docs">
          {docs.map((d) => <DocItem key={d.id} doc={d} onRetry={onRetry} onRemove={onRemove} />)}
        </ul>
      ) : (
        <p className="empty">{empty}</p>
      )}
    </section>
  );
}
