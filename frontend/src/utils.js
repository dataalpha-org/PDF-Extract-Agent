export const FORMATS = [
  ["table", "Table"],
  ["paragraph", "Paragraph"],
  ["bullets", "Bullets"],
  ["keyvalue", "Field: Value"],
  ["json", "JSON"],
  ["custom", "Custom"],
];

// Document lifecycle: processing -> ready_text (quick text, extract works) -> ready (Docling tables).
// Scanned PDFs skip ready_text. A Docling failure after ready_text keeps the quick text plus an error.
export const isUsable = (d) => d.status === "ready" || d.status === "ready_text";
export const isParsing = (d) => d.status === "processing" || (d.status === "ready_text" && !d.error);

export function statusText(d) {
  if (d.status === "processing") return "Reading PDF…";
  if (d.status === "ready_text") {
    return d.error
      ? `${d.pages} pages · quick text only. ${d.error}`
      : `${d.pages} pages · Docling parsing tables…`;
  }
  if (d.status === "ready") return `${d.pages} pages · ${d.tables} tables`;
  return d.error || "Failed";
}

// Status pill: [css modifier, label].
export function statusPill(d) {
  if (d.status === "processing") return ["info", "Reading"];
  if (d.status === "ready_text") return d.error ? ["warning", "Text only"] : ["warning", "Quick text"];
  if (d.status === "ready") return ["success", "Ready"];
  return ["danger", "Error"];
}

export const cellText = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));

// Claude is asked for rows as arrays, but sometimes returns objects keyed by column name.
export function toRow(columns, r) {
  if (Array.isArray(r)) return r;
  if (r !== null && typeof r === "object") return columns.map((c) => r[c]);
  return [r];
}

export function toCsv(columns, rows) {
  const esc = (v) => `"${cellText(v).replace(/"/g, '""')}"`;
  return [columns, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

export function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}
