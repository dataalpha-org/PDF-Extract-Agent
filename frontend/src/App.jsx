import { useEffect, useRef, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { deleteDoc, extract, listDocs, retryDoc, uploadDocs } from "./api.js";
import { isParsing, isUsable } from "./utils.js";
import ExtractionCard from "./components/ExtractionCard.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Toast from "./components/Toast.jsx";

let nextId = 1;
const newCard = () => ({
  id: nextId++,
  instruction: "",
  docIds: [],
  format: "table",
  custom: "",
  loading: false,
  result: null,
  error: "",
});

export default function App() {
  const [docs, setDocs] = useState([]);
  const [cards, setCards] = useState([newCard()]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  const notify = (msg, kind = "success") => {
    clearTimeout(toastTimer.current);
    setToast({ msg, kind });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const refresh = async () => {
    try {
      setDocs(await listDocs());
      setError("");
    } catch (e) {
      setError(`Cannot reach backend: ${e.message}`);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Poll while any document is still being parsed (quick text or Docling).
  useEffect(() => {
    if (!docs.some(isParsing)) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [docs]);

  const onFiles = async (fileList) => {
    const files = [...fileList].filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (!files.length) return notify("Only PDF files can be uploaded.", "error");
    setUploading(true);
    try {
      const added = (await uploadDocs(files)).map((d) => d.id);
      // Newly uploaded PDFs are selected in every request card right away.
      setCards((cs) => cs.map((c) => ({ ...c, docIds: [...c.docIds, ...added] })));
      await refresh();
      notify(`Uploaded ${files.length} PDF${files.length > 1 ? "s" : ""}. Ready for questions in a moment.`);
    } catch (e) {
      notify(e.message, "error");
    }
    setUploading(false);
  };

  const patch = (id, p) => setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const run = async (card) => {
    if (!card.instruction.trim()) return patch(card.id, { error: "Describe what to extract." });
    const selected = docs.filter((d) => card.docIds.includes(d.id));
    if (!selected.length) return patch(card.id, { error: "Select at least one PDF." });
    const notUsable = selected.filter((d) => !isUsable(d));
    if (notUsable.length) {
      const names = notUsable.map((d) => d.name).join(", ");
      return patch(card.id, { error: `Wait until ${names} finishes reading, or untick it.` });
    }
    patch(card.id, { loading: true, error: "", result: null });
    try {
      const result = await extract({
        doc_ids: selected.map((d) => d.id),
        instruction: card.instruction,
        format: card.format === "custom" ? "custom" : card.format,
        custom_format: card.custom,
      });
      patch(card.id, { loading: false, result });
    } catch (e) {
      patch(card.id, { loading: false, error: e.message });
    }
  };

  const runAll = async () => {
    for (const c of cards) await run(c);
  };

  const remove = async (doc) => {
    if (!window.confirm(`Delete "${doc.name}"? This removes the PDF and its parsed data.`)) return;
    try {
      await deleteDoc(doc.id);
      setCards((cs) => cs.map((c) => ({ ...c, docIds: c.docIds.filter((x) => x !== doc.id) })));
      notify(`Deleted ${doc.name}`);
    } catch (e) {
      notify(`Could not delete: ${e.message}`, "error");
    }
    refresh();
  };

  const retry = async (doc) => {
    try {
      await retryDoc(doc.id);
      notify(`Retrying ${doc.name}`);
    } catch (e) {
      notify(`Could not retry: ${e.message}`, "error");
    }
    refresh();
  };

  // Parsing PDFs are listed too, so a fresh upload shows up (and is selected) immediately.
  const choosable = docs.filter((d) => d.status !== "error");

  return (
    <div className="app">
      <Sidebar
        docs={docs}
        uploading={uploading}
        error={error}
        onFiles={onFiles}
        onRetry={retry}
        onRemove={remove}
      />

      <main className="main">
        <header className="page-head">
          <h1>Extractions</h1>
          <p>Describe what you need, pick PDFs and a format. Answers cite document and page.</p>
        </header>

        {cards.map((c, idx) => (
          <ExtractionCard
            key={c.id}
            card={c}
            index={idx}
            docs={choosable}
            canRemove={cards.length > 1}
            onPatch={(p) => patch(c.id, p)}
            onRun={() => run(c)}
            onRemove={() => setCards((cs) => cs.filter((x) => x.id !== c.id))}
            onCopied={() => notify("Copied to clipboard")}
          />
        ))}

        <div className="footer">
          <button className="btn btn-dashed" onClick={() => setCards((cs) => [...cs, newCard()])}>
            <Plus size={16} />
            Add extraction
          </button>
          {cards.length > 1 && (
            <button className="btn btn-primary" onClick={runAll}>
              <Sparkles size={16} />
              Extract all
            </button>
          )}
        </div>
      </main>

      <Toast toast={toast} />
    </div>
  );
}
