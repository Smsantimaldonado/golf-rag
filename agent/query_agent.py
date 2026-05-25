"""Text-query MVP for the golf rules RAG agent."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
import re
import unicodedata
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
PENALTY_AREA_RE = re.compile(
    r"\b(?:area de penalizacion|area penalizacion|penalizacion roja|penalizacion amarilla|estaca roja|estacas rojas|estaca amarilla|estacas amarillas|agua|lago|arroyo|zanja)\b",
    re.IGNORECASE,
)
STROKE_DISTANCE_RE = re.compile(r"\b(?:golpe y distancia|perdida|perdido|fuera de limites|repetir|golpe anterior|provisional)\b", re.IGNORECASE)
INSPECTION_RE = re.compile(r"\b(?:verificar|comprobar|identificar|levantar|no estoy seguro|duda|revisar)\b", re.IGNORECASE)
REPLACE_RE = re.compile(r"\b(?:reponer|repuesta|reponerla|colocar|colocarla|marcar|marcada|movida|se movio|se movió)\b", re.IGNORECASE)
INTERRUPTION_RE = re.compile(r"\b(?:interrump|suspend|reanudar|suspension|suspensión)\b", re.IGNORECASE)
NATURAL_FORCES_RE = re.compile(r"\b(?:viento|gravedad|fuerzas naturales|se movio sola|se movió sola)\b", re.IGNORECASE)
BUNKER_RE = re.compile(r"\b(?:bunker|búnker|arena)\b", re.IGNORECASE)
WORSENED_CONDITIONS_RE = re.compile(r"\b(?:empeorad|despues|después|otra persona|animal|alguien|dañad|danad|huella|pisada)\b", re.IGNORECASE)
QUERY_EXPANSIONS = [
    (
        re.compile(r"\baspersor(?:es)?\b", re.IGNORECASE),
        "obstrucción inamovible condición anormal del campo Regla 16.1 punto más cercano de alivio total alivio sin penalización",
    ),
    (
        re.compile(r"\b(?:rastrillo|rastrillos|manguera|mangueras|botella|botellas|toalla|toallas)\b", re.IGNORECASE),
        "obstrucción movible Regla 15.2 alivio sin penalización quitar obstrucción movible",
    ),
    (
        re.compile(r"\b(?:arbol|arboles|arbusto|arbustos|planta|plantas|rama|ramas)\b", re.IGNORECASE),
        "objeto natural fijo en crecimiento condición normal del campo jugar como reposa Regla 8.1a bola injugable Regla 19.1 Regla 19.2 Regla 19.2a Regla 19.2b Regla 19.2c alivio con penalización",
    ),
    (
        re.compile(r"\b(?:hueco|pozo|depresion|depresiones|lie malo|mal lie|enterrada|enterrado|injugable)\b", re.IGNORECASE),
        "jugar como reposa Regla 8.1a bola injugable Regla 19.1 Regla 19.2 Regla 19.2a Regla 19.2b Regla 19.2c golpe y distancia línea hacia atrás alivio lateral dos palos un golpe de penalización",
    ),
    (
        re.compile(r"\b(?:hueco|pozo|depresion|depresiones|lie malo|mal lie|enterrada|enterrado|injugable)\b", re.IGNORECASE),
        "bola injugable Regla 19.1 Regla 19.2 Regla 19.2a Regla 19.2b Regla 19.2c golpe y distancia línea hacia atrás alivio lateral dos palos un golpe de penalización",
    ),
    (
        re.compile(r"\bbola equivocada\b", re.IGNORECASE),
        "Regla 6.3c bola equivocada juego por golpes penalización general dos golpes corregir error",
    ),
]


SYSTEM_PROMPT = """Sos un asistente experto en Reglas de Golf.

Restricciones obligatorias:
- Responde solo con la evidencia documental provista en CONTEXTO.
- No uses conocimiento externo ni memoria general del modelo.
- Si el contexto no alcanza para decidir, decí que no se puede responder claramente e intente reformular la consulta.
- Citá siempre número de regla cuando exista.
- Si hay incertidumbre factual, indicala explícitamente.
- No inventes reglas, penalizaciones, procedimientos ni excepciones.
- Da primero la regla general aplicable. Mencioná excepciones o modificaciones especiales solo si el usuario las pregunta o si son necesarias para evitar una respuesta engañosa.
- No menciones modificaciones para jugadores con discapacidades o dispositivos de movilidad salvo que el usuario lo indique o pregunte por eso.
- Si recuperás reglas tangenciales, no las cites salvo que sostengan directamente la decisión.
- No le pidas al usuario que facilite texto de reglas o documentos. Tu única fuente documental es el CONTEXTO recuperado.
- No hagas remisiones vacías como "tome alivio según la Regla 19" sin explicar qué debe hacer el jugador. Si mencionás una regla de alivio, resumí las opciones operativas disponibles en el CONTEXTO: dónde dropear/jugar, cuántas longitudes de palo corresponden y cuántos golpes de penalización tiene cada opción.
- En la sección "Decisión", respondé como indicación práctica para reanudar el juego. Si hay alternativas de alivio, enumeralas con regla, penalidad y medida básica. Ejemplo: golpe y distancia; línea hacia atrás; alivio lateral de dos palos.
<<<<<<< HEAD
- En consultas de lie malo, hueco, árbol o bola injugable, mencioná primero la opción de jugar la bola como reposa sin penalidad cuando el CONTEXTO la sostenga, y luego las alternativas de alivio con penalidad.
=======
>>>>>>> 1319a48d9b4f6521c1c43966f7dd668a7eabec15
- En la sección "Explicación", justificá esas opciones con la regla citada, sin repetir toda la mecánica si ya quedó clara en "Decisión".
- No cites reglas de marcar, levantar, reponer o colocar la bola salvo que el usuario pregunte por ese procedimiento o que sean necesarias para la decisión principal. Para una consulta de alivio/injugable, enfocá la respuesta en opciones de alivio, penalidad y área de alivio.
- En "Incertidumbre", mencioná solo datos faltantes necesarios para decidir la consulta. Si la decisión está suficientemente cubierta, escribí "No se advierte incertidumbre relevante con la información provista."
- Si escribís "No se advierte incertidumbre relevante con la información provista.", no agregues ninguna otra frase en ese apartado.
- No uses "Incertidumbre" para sugerir nuevas consultas, pedir más datos no necesarios o listar escenarios especiales no mencionados.

Presunciones operativas para evitar sobre-incertidumbre:
- No conviertas excepciones no mencionadas en incertidumbre. Si el usuario no menciona agua, agua temporal, bola moviéndose en agua, bunker, área de penalización, fuera de límites, green, condición anormal, regla local o modalidad especial, no agregues esas posibilidades en "Incertidumbre".
- Tampoco menciones esas excepciones como "aclaración" o "salvedad" si no fueron mencionadas por el usuario y no son necesarias para contestar la pregunta.
- Si el usuario no dice que la bola está en bunker, área de penalización, green u otra área especial, asumí que está en el área general.
- Si el usuario no dice que existe una condición anormal del campo, interferencia, obstrucción, agua temporal, terreno en reparación o animal peligroso, asumí una condición normal del juego.
- Tratá objetos comunes con sentido golfístico: un rastrillo, botella, toalla o manguera suelta suelen ser obstrucciones movibles; un aspersor, camino artificial, drenaje o tapa fija suelen ser obstrucciones inamovibles; árboles, arbustos, plantas y ramas que crecen forman parte natural del campo y no son obstrucciones.
- Si una palabra común tiene una categoría evidente en golf, usala. Por ejemplo, "aspersor" implica obstrucción inamovible salvo que el usuario diga que está suelto o movible; "árbol" implica objeto natural/condición normal del campo salvo que el usuario diga que es una estaca, tutor artificial u objeto artificial.
- Si el usuario dice que la bola "queda en", "está en", "reposa en", "queda sobre", "está sobre", "reposa sobre", "queda pegada a" o "está pegada a" un objeto, asumí que ese objeto interfiere con el lie/reposo de la bola. No trates ese caso como mera interferencia con la línea de juego salvo que el usuario lo diga.
- Solo declarás incertidumbre cuando un dato cambia materialmente la decisión principal, no cuando solo existe una excepción remota no mencionada.
- No uses "Incertidumbre" para repetir las presunciones operativas aplicadas. Si aplicaste una presunción normal y la decisión queda cubierta, escribí simplemente que no hay incertidumbre relevante.

Formato obligatorio:
Decisión:
Explicación:
Regla citada:
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

    retrieval_query = build_retrieval_query(question)
    normalized_question = strip_accents(question)
    query_embedding = client.embeddings.create(model=embedding_model, input=retrieval_query).data[0].embedding
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
    chunks = filter_tangential_chunks(chunks, normalized_question)
    chunks = expand_rule_references(collection=collection, question=retrieval_query, chunks=chunks)
    return filter_tangential_chunks(chunks, normalized_question)


def filter_tangential_chunks(chunks: Sequence[RetrievedChunk], normalized_question: str) -> List[RetrievedChunk]:
    filtered = list(chunks)
    if not SPECIAL_MODIFICATION_RE.search(normalized_question):
        filtered = [chunk for chunk in filtered if not str(chunk.metadata.get("rule_number", "")).startswith("25.")]
    if not PENALTY_AREA_RE.search(normalized_question):
        filtered = [chunk for chunk in filtered if not str(chunk.metadata.get("rule_number", "")).startswith("17.")]
    if not STROKE_DISTANCE_RE.search(normalized_question):
        filtered = [chunk for chunk in filtered if str(chunk.metadata.get("rule_number", "")) != "18.1"]
    if not INSPECTION_RE.search(normalized_question):
        filtered = [chunk for chunk in filtered if str(chunk.metadata.get("rule_number", "")) != "16.4"]
    if not REPLACE_RE.search(normalized_question):
        filtered = [chunk for chunk in filtered if not str(chunk.metadata.get("rule_number", "")).startswith(("14.1", "14.2"))]
    if not INTERRUPTION_RE.search(normalized_question):
        filtered = [chunk for chunk in filtered if not str(chunk.metadata.get("rule_number", "")).startswith("5.7")]
    if not NATURAL_FORCES_RE.search(normalized_question):
        filtered = [chunk for chunk in filtered if str(chunk.metadata.get("rule_number", "")) != "9.3"]
    if not BUNKER_RE.search(normalized_question):
        filtered = [chunk for chunk in filtered if not str(chunk.metadata.get("rule_number", "")).startswith(("12.", "19.3"))]
    if not WORSENED_CONDITIONS_RE.search(normalized_question):
        filtered = [chunk for chunk in filtered if str(chunk.metadata.get("rule_number", "")) != "8.1d"]
    return filtered


def expand_rule_references(collection, question: str, chunks: Sequence[RetrievedChunk], max_extra: int = 8) -> List[RetrievedChunk]:
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


def build_retrieval_query(question: str) -> str:
    normalized_question = strip_accents(question)
    additions = [expansion for pattern, expansion in QUERY_EXPANSIONS if pattern.search(normalized_question)]
    if not additions:
        return question
    return question + "\n\nTerminos de recuperacion: " + " ".join(additions)


def strip_accents(text: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFKD", text) if not unicodedata.combining(char))


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
        pages = "página no disponible"
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
