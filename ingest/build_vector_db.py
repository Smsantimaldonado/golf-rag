"""Build a persistent Chroma vector DB from preprocessed golf-rule chunks."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

import chromadb
from dotenv import load_dotenv
from openai import OpenAI


DEFAULT_CHUNKS_PATH = "vectordb/chunks.jsonl"
DEFAULT_PERSIST_DIR = "vectordb/chroma"
DEFAULT_COLLECTION_NAME = "golf_rules"
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"


@dataclass(frozen=True)
class VectorChunk:
    id: str
    text: str
    metadata: Dict[str, object]


def build_vector_db(
    chunks_path: str = DEFAULT_CHUNKS_PATH,
    persist_dir: str | None = None,
    collection_name: str | None = None,
    embedding_model: str | None = None,
    batch_size: int = 64,
    reset: bool = True,
    limit: int | None = None,
) -> int:
    """Embed chunks and store them in a persistent Chroma collection."""
    load_dotenv()
    persist_dir = persist_dir or os.getenv("CHROMA_PERSIST_DIR") or DEFAULT_PERSIST_DIR
    collection_name = collection_name or os.getenv("CHROMA_COLLECTION_NAME") or DEFAULT_COLLECTION_NAME
    embedding_model = embedding_model or os.getenv("OPENAI_EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL

    chunks = load_chunks(chunks_path)
    if limit is not None:
        chunks = chunks[:limit]
    if not chunks:
        raise RuntimeError(f"No chunks found in {chunks_path}")

    client = OpenAI()
    chroma_client = chromadb.PersistentClient(path=persist_dir)
    collection = _get_or_create_collection(chroma_client, collection_name=collection_name, reset=reset)

    for batch in _batched(chunks, batch_size):
        texts = [chunk.text for chunk in batch]
        embeddings = embed_texts(client=client, model=embedding_model, texts=texts)
        collection.add(
            ids=[chunk.id for chunk in batch],
            documents=texts,
            embeddings=embeddings,
            metadatas=[sanitize_metadata(chunk.metadata) for chunk in batch],
        )

    return collection.count()


def load_chunks(chunks_path: str) -> List[VectorChunk]:
    path = Path(chunks_path)
    if not path.exists():
        raise FileNotFoundError(f"Chunks file not found: {chunks_path}")

    chunks = []
    with path.open("r", encoding="utf-8") as f:
        for line_number, line in enumerate(f, start=1):
            if not line.strip():
                continue
            raw = json.loads(line)
            chunks.append(
                VectorChunk(
                    id=str(raw["id"]),
                    text=str(raw["text"]),
                    metadata=dict(raw.get("metadata", {})) | {"chunk_id": str(raw["id"])},
                )
            )
    return chunks


def embed_texts(client: OpenAI, model: str, texts: Sequence[str]) -> List[List[float]]:
    response = client.embeddings.create(model=model, input=list(texts))
    return [item.embedding for item in response.data]


def sanitize_metadata(metadata: Dict[str, object]) -> Dict[str, object]:
    """Convert metadata to Chroma-supported scalar values."""
    sanitized: Dict[str, object] = {}
    for key, value in metadata.items():
        if value is None:
            sanitized[key] = ""
        elif isinstance(value, (str, int, float, bool)):
            sanitized[key] = value
        else:
            sanitized[f"{key}_json"] = json.dumps(value, ensure_ascii=False)

    visual_assets = metadata.get("visual_assets")
    if isinstance(visual_assets, list):
        sanitized["visual_page_numbers"] = ",".join(str(asset.get("page_number")) for asset in visual_assets if isinstance(asset, dict))
        sanitized["visual_image_paths"] = "|".join(str(asset.get("image_path")) for asset in visual_assets if isinstance(asset, dict))
    return sanitized


def _get_or_create_collection(chroma_client, collection_name: str, reset: bool):
    if reset:
        try:
            chroma_client.delete_collection(collection_name)
        except Exception:
            pass

    return chroma_client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )


def _batched(items: Sequence[VectorChunk], batch_size: int) -> Iterable[List[VectorChunk]]:
    if batch_size <= 0:
        raise ValueError("batch_size must be > 0")
    for start in range(0, len(items), batch_size):
        yield list(items[start : start + batch_size])


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a persistent Chroma DB from vectordb/chunks.jsonl.")
    parser.add_argument("--chunks-path", default=DEFAULT_CHUNKS_PATH)
    parser.add_argument("--persist-dir", default=None)
    parser.add_argument("--collection-name", default=None)
    parser.add_argument("--embedding-model", default=None)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--limit", type=int, default=None, help="Embed only the first N chunks, useful for smoke tests.")
    parser.add_argument("--no-reset", action="store_true", help="Do not delete the existing collection before adding chunks.")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    count = build_vector_db(
        chunks_path=args.chunks_path,
        persist_dir=args.persist_dir,
        collection_name=args.collection_name,
        embedding_model=args.embedding_model,
        batch_size=args.batch_size,
        reset=not args.no_reset,
        limit=args.limit,
    )
    print(f"Built Chroma collection with {count} chunks")
