"""Text-query MVP for the golf rules RAG agent."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
import re
from typing import Dict, List, Sequence

import chromadb
from dotenv import load_dotenv
from openai import OpenAI


DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_ANSWER_MODEL = "gpt-5-mini"
DEFAULT_CHROMA_DIR = "vectordb/chroma"
DEFAULT_COLLECTION = "golf_rules"
DEFAULT_TOP_K = 8
RULE_REFERENCE_RE = re.compile(r"\b(?:Regla\s+)?(\d{1,2}\.\d{1,2}[a-z]?)\b", re.IGNORECASE)
SPECIAL_MODIFICATION_RE = re.compile(r"\b(?:discapacidad|discapacidades|movilidad|ruedas|silla)\b", re.IGNORECASE)


SYSTEM_PROMPT = """Sos un asistente experto en Reglas de Golf.

Restricciones obligatorias:
- Respondé solo con la evidencia documental provista en CONTEXTO.
- No uses conocimiento externo ni memoria general del modelo.
- Si el contexto no alcanza para decidir, decí que no se puede determinar con los documentos recuperados.
- Citá siempre número de regla cuando exista.
- Si hay incertidumbre factual, indicala explícitamente.
- No inventes reglas, penalizaciones, procedimientos ni excepciones.
- Da primero la regla general aplicable. Mencioná excepciones o modificaciones especiales solo si el usuario las pregunta o si son necesarias para evitar una respuesta engañosa.
- No menciones modificaciones para jugadores con discapacidades o dispositivos de movilidad salvo que el usuario lo indique o pregunte por eso.
- Si recuperás reglas tangenciales, no las cites salvo que sostengan directamente la decisión.
- No le pidas al usuario que facilite texto de reglas o documentos. Tu unica fuente documental es el CONTEXTO recuperado.
- En "Incertidumbre", mencioná solo datos faltantes necesarios para decidir la consulta. Si la decisión está suficientemente cubierta, escribí "No se advierte incertidumbre relevante con la información provista."

Formato obligatorio:
Regla citada:
Decisión:
Explicación:
Incertidumbre:
"""


@dataclass(frozen=True)
class RetrievedChunk:
    id: str
    text: str
    metadata: Dict[str, object]
    distance: float


def answer_question(question: str, top_k: int = DEFAULT_TOP_K, show_context: bool = False) -> str:
    load_dotenv()
    client = OpenAI()
    chunks = retrieve(question=question, client=client, top_k=top_k)
    context = format_context(chunks)
    answer = generate_answer(client=client, question=question, context=context)
    if not show_context:
        return answer
    return answer + "\n\n--- Contexto recuperado ---\n" + context


def retrieve(question: str, client: OpenAI, top_k: int = DEFAULT_TOP_K) -> List[RetrievedChunk]:
    embedding_model = os.getenv("OPENAI_EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL
    persist_dir = os.getenv("CHROMA_PERSIST_DIR") or DEFAULT_CHROMA_DIR
    collection_name = os.getenv("CHROMA_COLLECTION_NAME") or DEFAULT_COLLECTION

    query_embedding = client.embeddings.create(model=embedding_model, input=question).data[0].embedding
    collection = chromadb.PersistentClient(path=persist_dir).get_collection(collection_name)
    result = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
        include=["documents", "metadatas", "distances"],
    )

    chunks = [
        RetrievedChunk(id=chunk_id, text=document, metadata=metadata, distance=distance)
        for chunk_id, document, metadata, distance in zip(
            result["ids"][0],
            result["documents"][0],
            result["metadatas"][0],
            result["distances"][0],
        )
    ]
    if not SPECIAL_MODIFICATION_RE.search(question):
        chunks = [chunk for chunk in chunks if not str(chunk.metadata.get("rule_number", "")).startswith("25.")]
    return expand_rule_references(collection=collection, question=question, chunks=chunks)


def expand_rule_references(collection, question: str, chunks: Sequence[RetrievedChunk], max_extra: int = 4) -> List[RetrievedChunk]:
    seen_ids = {chunk.id for chunk in chunks}
    references = _extract_rule_references(question + "\n" + "\n".join(chunk.text for chunk in chunks))
    expanded = list(chunks)
    for rule_number in references:
        if len(expanded) >= len(chunks) + max_extra:
            break
        if rule_number.startswith("25.") and not SPECIAL_MODIFICATION_RE.search(question):
            continue
        result = collection.get(where={"rule_number": rule_number}, include=["documents", "metadatas"])
        for chunk_id, document, metadata in zip(result.get("ids", []), result.get("documents", []), result.get("metadatas", [])):
            if chunk_id in seen_ids:
                continue
            expanded.append(RetrievedChunk(id=chunk_id, text=document, metadata=metadata, distance=1.0))
            seen_ids.add(chunk_id)
            break
    return expanded


def _extract_rule_references(text: str) -> List[str]:
    references = []
    seen = set()
    for match in RULE_REFERENCE_RE.finditer(text):
        rule_number = match.group(1)
        if rule_number not in seen:
            references.append(rule_number)
            seen.add(rule_number)
    return references


def generate_answer(client: OpenAI, question: str, context: str) -> str:
    answer_model = os.getenv("OPENAI_ANSWER_MODEL") or os.getenv("OPENAI_VISION_MODEL") or DEFAULT_ANSWER_MODEL
    response = client.responses.create(
        model=answer_model,
        input=[
            {"role": "system", "content": [{"type": "input_text", "text": SYSTEM_PROMPT}]},
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": f"CONSULTA:\n{question}\n\nCONTEXTO:\n{context}",
                    }
                ],
            },
        ],
    )
    return response.output_text.strip()


def format_context(chunks: Sequence[RetrievedChunk]) -> str:
    sections = []
    for index, chunk in enumerate(chunks, start=1):
        metadata = chunk.metadata
        citation = format_citation(metadata)
        sections.append(
            "\n".join(
                [
                    f"[{index}] {citation}",
                    f"chunk_id: {chunk.id}",
                    f"distancia: {chunk.distance:.4f}",
                    "texto:",
                    chunk.text,
                ]
            )
        )
    return "\n\n".join(sections)


def format_citation(metadata: Dict[str, object]) -> str:
    rule = metadata.get("rule_number") or "sin regla detectada"
    heading = metadata.get("heading") or ""
    source = metadata.get("source") or ""
    page_start = metadata.get("page_start")
    page_end = metadata.get("page_end")
    if page_start and page_end and page_start != page_end:
        pages = f"pags. {page_start}-{page_end}"
    elif page_start:
        pages = f"pag. {page_start}"
    else:
        pages = "pagina no disponible"
    return f"Regla {rule} | {heading} | {source} | {pages}"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ask a text question to the golf rules RAG agent.")
    parser.add_argument("question", nargs="*", help="Question to answer. If omitted, --question is used.")
    parser.add_argument("--question", dest="question_option", default=None)
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    parser.add_argument("--show-context", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    question = args.question_option or " ".join(args.question).strip()
    if not question:
        raise SystemExit("Provide a question as an argument or with --question.")
    print(answer_question(question=question, top_k=args.top_k, show_context=args.show_context))
