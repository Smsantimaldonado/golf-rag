"use client";

import { FormEvent, RefObject, useEffect, useMemo, useRef, useState } from "react";

type Turn = {
  role: "user" | "assistant";
  content: string;
};

type AskResponse = {
  answer?: string;
  error?: string;
};

const maxUserMessages = 3;

const suggestions = [
  "Alivio por obstáculo inamovible",
  "Pelota no encontrada",
  "Penalidades en bunker",
  "Bola en zona de penalidad",
];

export default function Home() {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const userMessages = useMemo(() => turns.filter((turn) => turn.role === "user").map((turn) => turn.content), [turns]);
  const remainingMessages = maxUserMessages - userMessages.length;
  const canAsk = draft.trim().length > 0 && remainingMessages > 0 && !loading;
  const isChatActive = turns.length > 0 || loading;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [draft, isChatActive]);

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAsk) {
      return;
    }

    const message = draft.trim();
    const nextUserMessages = [...userMessages, message];
    const nextTurns: Turn[] = [...turns, { role: "user", content: message }];
    setTurns(nextTurns);
    setDraft("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextUserMessages }),
      });
      const responseText = await response.text();
      const payload = parseAskResponse(responseText);
      if (!response.ok || payload.error) {
        throw new Error(payload.error || responseText || "No se pudo obtener respuesta.");
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

  function fillSuggestion(suggestion: string) {
    setDraft(suggestion);
    setError("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <main className="app-shell">
      <div className="app-wrapper">
        <aside className="sidebar" aria-label="Información del asistente">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 4a8 8 0 0 1 6 2.7" />
                <path d="M4.5 9h15" />
                <path d="M4.5 15h15" />
              </svg>
            </div>
            <div>
              <h1>Asistente de Reglas de Golf</h1>
            </div>
          </div>

          <section className="usage" aria-label="Instrucciones de uso">
            <h2>Cómo usarlo</h2>
            <ol>
              <li>Describí una situación concreta de juego.</li>
              <li>Podés agregar hasta 2 mensajes más del mismo caso.</li>
              <li>Usá Nuevo caso para empezar otra situación.</li>
            </ol>
            <p>Por ahora acepta solo texto. Si falta un dato importante, el asistente te lo va a pedir.</p>
          </section>

          {error ? <p className="error">{error}</p> : null}
        </aside>

        <section className="main-panel">
          {!isChatActive ? (
            <section className="welcome-panel" aria-label="Nueva consulta">
              <div className="welcome-content">
                <div className="welcome-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="img">
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 4a8 8 0 0 1 6 2.7" />
                    <path d="M4.5 9h15" />
                    <path d="M4.5 15h15" />
                  </svg>
                </div>
                <h2>Asistente de Reglas de Golf</h2>
                <p>
                  Describí una situación de juego y obtené una respuesta fundamentada en el reglamento oficial y la guía de interpretaciones.
                </p>

                <div className="suggestions" aria-label="Sugerencias de consulta">
                  {suggestions.map((suggestion) => (
                    <button className="suggestion-chip" key={suggestion} type="button" onClick={() => fillSuggestion(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              <QuestionForm
                canAsk={canAsk}
                disabled={remainingMessages <= 0 || loading}
                draft={draft}
                loading={loading}
                onChange={setDraft}
                onSubmit={submitQuestion}
                placeholder="Ej: Mi bola quedó sobre una boca de riego fija en el fairway y me molesta el stance..."
                textareaRef={textareaRef}
              />
            </section>
          ) : (
            <section className="chat-panel" aria-label="Conversacion del caso">
              <header className="chat-header">
                <div>
                  <h2>Caso activo</h2>
                  <p>Consulta documental sobre reglas de golf</p>
                </div>
                <span className="case-badge">
                  {remainingMessages} mensaje{remainingMessages === 1 ? "" : "s"} restante{remainingMessages === 1 ? "" : "s"}
                </span>
              </header>

              <div className="chat-messages" aria-live="polite">
                {turns.map((turn, index) => (
                  <article className={`message ${turn.role}`} key={`${turn.role}-${index}`}>
                    <div className="avatar" aria-hidden="true">
                      {turn.role === "user" ? (
                        "S"
                      ) : (
                        <svg viewBox="0 0 24 24" role="img">
                          <circle cx="12" cy="12" r="8" />
                          <path d="M12 4a8 8 0 0 1 6 2.7" />
                          <path d="M4.5 9h15" />
                          <path d="M4.5 15h15" />
                        </svg>
                      )}
                    </div>
                    <div className="message-card">
                      <span className="message-label">{turn.role === "user" ? `Usuario ${userTurnNumber(turns, index)}` : "Agente"}</span>
                      <p>{turn.content}</p>
                    </div>
                  </article>
                ))}

                {loading ? (
                  <article className="message assistant">
                    <div className="avatar" aria-hidden="true">
                      <svg viewBox="0 0 24 24" role="img">
                        <circle cx="12" cy="12" r="8" />
                        <path d="M12 4a8 8 0 0 1 6 2.7" />
                        <path d="M4.5 9h15" />
                        <path d="M4.5 15h15" />
                      </svg>
                    </div>
                    <div className="message-card typing-card">
                      <span className="message-label">Agente</span>
                      <span className="typing-dots" aria-label="Buscando reglas y preparando respuesta">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  </article>
                ) : null}
              </div>

              <div className="chat-footer">
                <div className="conversation-toolbar">
                  <button className="new-case-button" type="button" onClick={resetCase} disabled={loading}>
                    Nuevo caso
                  </button>
                  <QuestionForm
                    canAsk={canAsk}
                    disabled={remainingMessages <= 0 || loading}
                    draft={draft}
                    loading={loading}
                    onChange={setDraft}
                    onSubmit={submitQuestion}
                    placeholder="Seguí con el mismo caso..."
                    textareaRef={textareaRef}
                  />
                </div>
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

function QuestionForm({
  canAsk,
  disabled,
  draft,
  loading,
  onChange,
  onSubmit,
  placeholder,
  textareaRef,
}: {
  canAsk: boolean;
  disabled: boolean;
  draft: string;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <form className="input-bar" onSubmit={onSubmit}>
      <label className="sr-only" htmlFor="question">
        Mensaje del usuario
      </label>
      <textarea
        id="question"
        ref={textareaRef}
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
      />
      <button className="send-button" type="submit" disabled={!canAsk}>
        {loading ? "..." : "Enviar"}
      </button>
    </form>
  );
}

function userTurnNumber(turns: Turn[], index: number) {
  return turns.slice(0, index + 1).filter((turn) => turn.role === "user").length;
}

function parseAskResponse(responseText: string): AskResponse {
  try {
    return JSON.parse(responseText) as AskResponse;
  } catch {
    return { error: responseText };
  }
}
