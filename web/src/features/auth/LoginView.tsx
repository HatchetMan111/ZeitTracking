import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../../api/client";

export function LoginView({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post("/login", { password });
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login" data-testid="login-form" onSubmit={submit}>
      <h1>Timeblocks</h1>
      <p>Bitte anmelden, um die Zeiterfassung zu öffnen.</p>
      <input
        type="password"
        aria-label="Passwort"
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Anmelden …" : "Anmelden"}
      </button>
    </form>
  );
}
