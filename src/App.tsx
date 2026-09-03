import { useEffect, useState } from "react";
import { EditorPage } from "./components/EditorPage";
import { ErrorMessage } from "./components/ErrorMessage";
import { LoginForm } from "./components/LoginForm";
import { api } from "./lib/api";
import type { DocumentData } from "./lib/types";

export default function App() {
  const [loading, setLoading] = useState(true); const [authenticated, setAuthenticated] = useState(false); const [document, setDocument] = useState<DocumentData>(); const [loadError, setLoadError] = useState(false);
  useEffect(() => { void bootstrap(); }, []);
  async function bootstrap() { setLoading(true); setLoadError(false); try { await api.session(); setAuthenticated(true); setDocument(await api.document()); } catch { setAuthenticated(false); } finally { setLoading(false); } }
  async function login(username: string, password: string) { await api.login(username, password); setAuthenticated(true); try { setDocument(await api.document()); } catch (cause) { setLoadError(true); throw cause; } }
  async function logout() { await api.logout(); setAuthenticated(false); setDocument(undefined); }
  if (loading) return <main className="loading">Đang tải…</main>;
  if (!authenticated) return <LoginForm onLogin={login} />;
  if (loadError || !document) return <main className="loading"><ErrorMessage>Không thể tải tài liệu.</ErrorMessage><button onClick={() => void bootstrap()}>Thử lại</button></main>;
  return <EditorPage initial={document} onLogout={logout} onUnauthorized={() => { setAuthenticated(false); setDocument(undefined); }} />;
}
