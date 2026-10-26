import {
  AlignLeft, Braces, Check, KeyRound, List, LoaderCircle, Sparkles, Table, WandSparkles, X,
} from "lucide-react";
import Result, { Alert, ResultBoundary, ResultSkeleton } from "./Result.jsx";
import { FORMATS, isUsable } from "../utils.js";

const FORMAT_ICONS = {
  table: Table, paragraph: AlignLeft, bullets: List, keyvalue: KeyRound, json: Braces, custom: WandSparkles,
};

const EXAMPLES = [
  "Revenue, net income, EBITDA and free cash flow",
  "Revenue by segment for each period",
  "Top 5 risks with a one-line summary each",
];

export default function ExtractionCard({ card, index, docs, canRemove, onPatch, onRun, onRemove, onCopied }) {
  const usable = docs.filter(isUsable);

  const toggle = (id) =>
    onPatch({ docIds: card.docIds.includes(id) ? card.docIds.filter((x) => x !== id) : [...card.docIds, id] });

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <span className="step">{index + 1}</span>
          <h2>Extraction {index + 1}</h2>
        </div>
        {canRemove && (
          <button className="icon-btn" onClick={onRemove} title="Remove extraction" aria-label="Remove extraction">
            <X size={16} />
          </button>
        )}
      </div>

      <label className="field-label" htmlFor={`ins-${card.id}`}>What information do you want?</label>
      <textarea
        id={`ins-${card.id}`}
        rows={3}
        placeholder="e.g. Invoice number, total amount, due date, vendor name"
        value={card.instruction}
        onChange={(e) => onPatch({ instruction: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onRun();
          }
        }}
      />
      <div className="examples">
        <span className="muted">Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip chip-example" onClick={() => onPatch({ instruction: ex })}>{ex}</button>
        ))}
      </div>

      <div className="field-row">
        <span className="field-label">From which PDFs?</span>
        {docs.length > 0 && (
          <span className="links">
            <button className="link" onClick={() => onPatch({ docIds: usable.map((d) => d.id) })}>Select all ready</button>
            <button className="link" onClick={() => onPatch({ docIds: [] })}>Clear</button>
          </span>
        )}
      </div>
      <div className="chips">
        {docs.length === 0 && <span className="muted">Upload a PDF to get started.</span>}
        {docs.map((d) => {
          const on = card.docIds.includes(d.id);
          return (
            <button
              key={d.id}
              className={`chip chip-doc${on ? " selected" : ""}`}
              onClick={() => toggle(d.id)}
              aria-pressed={on}
              title={d.name}
            >
              {on ? <Check size={14} /> : <span className="chip-box" />}
              <span className="chip-name">{d.name}</span>
              {d.sample && <span className="pill pill-accent">Sample</span>}
              {d.status === "processing" && <span className="pill pill-info">reading</span>}
              {d.status === "ready_text" && <span className="pill pill-warning">quick text</span>}
            </button>
          );
        })}
      </div>

      <span className="field-label">Output format</span>
      <div className="segmented" role="radiogroup">
        {FORMATS.map(([v, label]) => {
          const Icon = FORMAT_ICONS[v];
          return (
            <button
              key={v}
              role="radio"
              aria-checked={card.format === v}
              className={card.format === v ? "active" : undefined}
              onClick={() => onPatch({ format: v })}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>
      {card.format === "custom" && (
        <input
          className="custom-input"
          placeholder="Describe the format, e.g. a markdown table grouped by year"
          value={card.custom}
          onChange={(e) => onPatch({ custom: e.target.value })}
        />
      )}

      <div className="run-row">
        <span className="muted kbd-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to extract</span>
        <button className="btn btn-primary" disabled={card.loading} onClick={onRun}>
          {card.loading ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
          {card.loading ? "Extracting…" : "Extract"}
        </button>
      </div>

      {card.error && <Alert kind="danger">{card.error}</Alert>}
      {card.loading && <ResultSkeleton />}
      {card.result && !card.loading && (
        <ResultBoundary result={card.result}>
          <Result result={card.result} onCopied={onCopied} />
        </ResultBoundary>
      )}
    </section>
  );
}
