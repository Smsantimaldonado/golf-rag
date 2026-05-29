"use client";

import { FormEvent, useMemo, useState } from "react";

type Turn = {
  role: "user" | "assistant";
  content: string;
};

type AskResponse = {
  answer?: string;
  error?: string;
};

const maxUserMessages = 3;

export default function Home() {
  const [passcode, setPasscode] = useState("");
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const userMessages = useMemo(() => turns.filter((turn) => turn.role === "user").map((turn) => turn.content), [turns]);
  const remainingMessages = maxUserMessages - userMessages.length;
  const canAsk = draft.trim().length > 0 && remainingMessages > 0 && !loading;

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAsk) {
      return;
    }

    const nextUserMessages = [...userMessages, draft.trim()];
    const nextTurns: Turn[] = [...turns, { role: "user", content: draft.trim() }];
    setTurns(nextTurns);
    setDraft("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextUserMessages, passcode }),
      });
      const payload = (await response.json()) as AskResponse;
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "No se pudo obtener respuesta.");
      }
      setTurns([...nextTurns, { role: "assistant", content: payload.answer || "" }]);
    } catch (caughtError) {
      setTurns(nextTurns);
      setError(caughtError instanceof Error ? caughtError.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  function resetCase() {
    setTurns([]);
    setDraft("");
    setError("");
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Asistente de Reglas de Golf</h1>
          <p>Base documental: reglas e interpretaciones cargadas.</p>
        </div>

        <form onSubmit={submitQuestion}>
          <div className="field">
            <label htmlFor="passcode">Passcode</label>
            <input
              id="passcode"
              className="input"
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div className="field">
            <label htmlFor="question">Mensaje del usuario</label>
            <textarea
              id="question"
              className="textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={remainingMessages <= 0 || loading}
            />
          </div>

          <div className="actions">
            <button className="button" type="submit" disabled={!canAsk}>
              {loading ? "Consultando..." : "Consultar"}
            </button>
            <button className="button secondary" type="button" onClick={resetCase} disabled={loading || turns.length === 0}>
              Nuevo caso
            </button>
          </div>
        </form>

        <p className="limits">Mensajes restantes en este caso: {remainingMessages}</p>
        {error ? <p className="error">{error}</p> : null}
      </aside>

      <section className="main">
        <div className="conversation">
          {turns.length === 0 ? (
            <div className="empty">Nuevo caso.</div>
          ) : null}

          {turns.map((turn, index) => (
            <article className={`message ${turn.role}`} key={`${turn.role}-${index}`}>
              <span className="message-label">{turn.role === "user" ? `Usuario ${userTurnNumber(turns, index)}` : "Agente"}</span>
              {turn.content}
            </article>
          ))}

          {loading ? (
            <article className="message assistant">
              <span className="message-label">Agente</span>
              Buscando reglas y preparando respuesta...
            </article>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function userTurnNumber(turns: Turn[], index: number) {
  return turns.slice(0, index + 1).filter((turn) => turn.role === "user").length;
}
