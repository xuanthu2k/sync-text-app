import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { Block, PartialBlock } from "@blocknote/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { ApiClientError, type Conflict, type DocumentData } from "../lib/types";
import { ErrorMessage } from "./ErrorMessage";
import { SaveStatus, type SaveState } from "./SaveStatus";

const emptyContent: PartialBlock[] = [{ type: "paragraph", content: [] }];

export function EditorPage({ initial, onLogout, onUnauthorized }: { initial: DocumentData; onLogout: () => Promise<void>; onUnauthorized: () => void }) {
  const [document, setDocument] = useState<DocumentData>(initial);
  const [editorKey, setEditorKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<Conflict>();
  const latest = useRef<unknown[]>(initial.content);
  const revision = useRef(initial.revision);
  const timer = useRef<number | undefined>(undefined); const saving = useRef(false); const pending = useRef(false);
  const saveNowRef = useRef<() => Promise<void>>(async () => {});

  const saveNow = useCallback(async () => {
    if (saving.current) { pending.current = true; return; }
    if (timer.current) window.clearTimeout(timer.current);
    saving.current = true; pending.current = false; setSaveState("saving");
    let hadConflict = false;
    try {
      const saved = await api.save(latest.current, revision.current);
      revision.current = saved.revision; setDocument((current) => ({ ...current, revision: saved.revision, updatedAt: saved.updatedAt }));
      setSaveState(pending.current ? "dirty" : "saved");
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 401) { onUnauthorized(); return; }
      if (cause instanceof ApiClientError && cause.status === 409 && cause.current) { hadConflict = true; setConflict(cause.current); }
      else setSaveState("error");
    } finally {
      saving.current = false;
      if (pending.current && !hadConflict) { pending.current = false; void saveNowRef.current(); }
    }
  }, [onUnauthorized]);
  saveNowRef.current = saveNow;

  const onChange = useCallback((blocks: Block[]) => {
    latest.current = blocks as unknown[]; pending.current = true; setSaveState("dirty");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveNowRef.current(), 1750);
  }, []);
  const editor = useCreateBlockNote({ initialContent: (document.content.length ? document.content : emptyContent) as PartialBlock[] });
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveNowRef.current(); } }; window.addEventListener("keydown", handler); return () => { window.removeEventListener("keydown", handler); if (timer.current) window.clearTimeout(timer.current); }; }, []);

  async function reloadServer() { const server = await api.document(); latest.current = server.content; revision.current = server.revision; setDocument(server); setConflict(undefined); setEditorKey((key) => key + 1); setSaveState("saved"); }
  function overwrite() { if (!conflict) return; revision.current = conflict.revision; setConflict(undefined); void saveNow(); }
  return <main className="editor-shell"><header><div><h1>Sync Text</h1><SaveStatus state={saveState} updatedAt={document.updatedAt} /></div><div className="header-actions"><button onClick={() => void saveNow()} disabled={saveState === "saving"}>Lưu ngay</button><button className="secondary" onClick={() => void onLogout()}>Đăng xuất</button></div></header>
    {saveState === "error" && <ErrorMessage>Không thể lưu. Kiểm tra kết nối rồi bấm “Lưu ngay” để thử lại.</ErrorMessage>}
    <section className="editor-card" key={editorKey}><BlockNoteView editor={editor} onChange={() => onChange(editor.document)} theme="light" /></section>
    {conflict && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title"><h2 id="conflict-title">Có thay đổi từ thiết bị khác</h2><p>Bản nháp hiện tại vẫn được giữ. Hãy chọn cách xử lý.</p><div className="header-actions"><button className="secondary" onClick={() => void reloadServer()}>Tải phiên bản trên server</button><button onClick={overwrite}>Ghi đè bằng nội dung hiện tại</button></div></section></div>}
  </main>;
}
