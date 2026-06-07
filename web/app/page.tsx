"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

type Turn = {
  role: "user" | "assistant";
  content: string;
  imageName?: string;
};

type AskResponse = {
  answer?: string;
  error?: string;
};

const maxUserMessages = 3;
const maxImageBytes = 5 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export default function Home() {
  const [passcode, setPasscode] = useState("");
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const userMessages = useMemo(() => turns.filter((turn) => turn.role === "user").map((turn) => turn.content), [turns]);
  const remainingMessages = maxUserMessages - userMessages.length;
  const canAsk = (draft.trim().length > 0 || Boolean(image)) && remainingMessages > 0 && !loading;

  useEffect(() => {
    if (!image) {
      setImagePreviewUrl("");
      return;
    }
    const nextPreviewUrl = URL.createObjectURL(image);
    setImagePreviewUrl(nextPreviewUrl);
    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [image]);

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAsk) {
      return;
    }

    const messageText = draft.trim() || "Consulta con imagen adjunta.";
    const nextUserMessages = [...userMessages, messageText];
    const nextTurns: Turn[] = [...turns, { role: "user", content: messageText, imageName: image?.name }];
    setTurns(nextTurns);
    setDraft("");
    setImage(null);
    setError("");
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("passcode", passcode);
      formData.append("messages", JSON.stringify(nextUserMessages));
      if (image) {
        formData.append("image", image);
      }

      const response = await fetch("/api/ask", {
        method: "POST",
        body: formData,
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
    setImage(null);
    setError("");
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const nextImage = event.target.files?.[0] || null;
    event.target.value = "";
    setError("");
    if (!nextImage) {
      return;
    }
    if (!allowedImageTypes.has(nextImage.type)) {
      setError("La imagen debe ser JPG, PNG o WEBP.");
      return;
    }
    if (nextImage.size > maxImageBytes) {
      setError("La imagen no puede superar 5 MB.");
      return;
    }
    setImage(nextImage);
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Asistente de Reglas de Golf</h1>
          <p>Base documental: reglas e interpretaciones cargadas.</p>
        </div>

        <section className="usage" aria-label="Instrucciones de uso">
          <h2>Cómo usarlo</h2>
          <ol>
            <li>Ingresá el passcode.</li>
            <li>Describí una situación concreta de juego o adjuntá una imagen.</li>
            <li>Podés agregar hasta 2 mensajes más del mismo caso.</li>
            <li>Usá "Nuevo caso" para empezar otra situación.</li>
          </ol>
          <p>Si la imagen no alcanza para decidir, el asistente va a admitir incertidumbre o pedir una aclaración.</p>
        </section>

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
              placeholder="Ej: Mi bola quedó sobre una boca de riego fija en el fairway y me molesta el stance. ¿Qué hago?"
            />
          </div>

          <div className="field">
            <label htmlFor="image">Imagen opcional</label>
            <input id="image" className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={selectImage} disabled={remainingMessages <= 0 || loading} />
            {image ? (
              <div className="image-preview">
                {imagePreviewUrl ? <img src={imagePreviewUrl} alt="Vista previa de la imagen adjunta" /> : null}
                <div className="image-details">
                  <span>{image.name}</span>
                  <button className="link-button" type="button" onClick={() => setImage(null)} disabled={loading}>
                    Quitar imagen
                  </button>
                </div>
              </div>
            ) : (
              <p className="hint">JPG, PNG o WEBP. Máximo 5 MB.</p>
            )}
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
              {turn.imageName ? <span className="attachment">Imagen adjunta: {turn.imageName}</span> : null}
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
