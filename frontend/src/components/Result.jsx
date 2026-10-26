import { Component, useState } from "react";
import { Check, CircleAlert, Copy, Download, TriangleAlert } from "lucide-react";
import { FORMATS, cellText, download, toCsv, toRow } from "../utils.js";

// Keeps a malformed result from blanking the whole page; resets when a new result arrives.
export class ResultBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev) {
    if (prev.result !== this.props.result && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="result">
        <Alert kind="warning">This result could not be displayed. Raw answer:</Alert>
        <pre className="text">{this.props.result?.text}</pre>
      </div>
    );
  }
}

export function Alert({ kind, children }) {
  const Icon = kind === "danger" ? CircleAlert : TriangleAlert;
  return (
    <div className={`alert alert-${kind}`}>
      <Icon size={15} />
      <span>{children}</span>
    </div>
  );
}

export function ResultSkeleton() {
  return (
    <div className="result" aria-busy="true">
      <div className="skeleton" style={{ width: "40%" }} />
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" style={{ width: "75%" }} />
    </div>
  );
}

export default function Result({ result, onCopied }) {
  const [copied, setCopied] = useState(false);
  const d = result.data;
  const isTable = result.format === "table" && d && Array.isArray(d.columns) && Array.isArray(d.rows);
  const rows = isTable ? d.rows.map((r) => toRow(d.columns, r)) : [];
  const copyText = isTable ? toCsv(d.columns, rows) : result.text;
  const formatLabel = (FORMATS.find(([v]) => v === result.format) || [, result.format])[1];
  const sourceCol = isTable ? d.columns.findIndex((c) => String(c).toLowerCase() === "source") : -1;

  const copy = async () => {
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 1500);
  };

  const save = () => {
    if (isTable) download("extract.csv", toCsv(d.columns, rows), "text/csv");
    else if (result.format === "json") download("extract.json", result.text, "application/json");
    else download("extract.md", result.text, "text/markdown");
  };
  const saveLabel = isTable ? "CSV" : result.format === "json" ? "JSON" : ".md";

  return (
    <div className="result">
      {result.truncated && <Alert kind="warning">Documents were too long and were truncated before extraction.</Alert>}
      {result.warning && <Alert kind="warning">{result.warning}</Alert>}

      <div className="result-head">
        <div className="result-title">
          <span className="pill pill-accent">{formatLabel}</span>
          {isTable && <span className="muted">{rows.length} rows</span>}
        </div>
        <div className="result-actions">
          <button className="btn btn-ghost" onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="btn btn-ghost" onClick={save}>
            <Download size={15} />
            {saveLabel}
          </button>
        </div>
      </div>

      {isTable ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>{d.columns.map((c, i) => <th key={i}>{cellText(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={j === sourceCol ? "source" : undefined}>{cellText(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="text">{result.text}</pre>
      )}
    </div>
  );
}
