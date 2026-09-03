import { FormEvent, useState } from "react";
import { ErrorMessage } from "./ErrorMessage";

export function LoginForm({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("xuanthuphan2k");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFailed(false);
    try { await onLogin(username, password); } catch { setFailed(true); } finally { setBusy(false); }
  }
  return <main className="login-shell"><form className="login-card" onSubmit={submit}>
    <h1>Sync Text</h1><p>Đăng nhập để đọc và chỉnh sửa tài liệu chung.</p>
    <label htmlFor="username">Tên đăng nhập</label><input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} required />
    <label htmlFor="password">Mật khẩu</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required />
    {failed && <ErrorMessage>Tên đăng nhập hoặc mật khẩu không đúng.</ErrorMessage>}
    <button type="submit" disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
  </form></main>;
}
