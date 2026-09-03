export type SaveState = "loading" | "dirty" | "saving" | "saved" | "error";
export function SaveStatus({ state, updatedAt }: { state: SaveState; updatedAt?: string }) {
  if (state === "loading") return <span>Đang tải…</span>;
  if (state === "dirty") return <span>Chưa lưu</span>;
  if (state === "saving") return <span>Đang lưu…</span>;
  if (state === "error") return <span className="status-error">Không thể lưu — Thử lại</span>;
  return <span>Đã lưu{updatedAt ? ` lúc ${new Intl.DateTimeFormat("vi-VN", { timeStyle: "medium" }).format(new Date(updatedAt))}` : ""}</span>;
}
