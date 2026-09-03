export function ErrorMessage({ children }: { children: React.ReactNode }) {
  return <p className="error-message" role="alert">{children}</p>;
}
