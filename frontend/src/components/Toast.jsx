import { CircleAlert, CircleCheck } from "lucide-react";

export default function Toast({ toast }) {
  if (!toast) return null;
  const Icon = toast.kind === "error" ? CircleAlert : CircleCheck;
  return (
    <div className={`toast toast-${toast.kind}`} role="status">
      <Icon size={16} />
      <span>{toast.msg}</span>
    </div>
  );
}
