"""Load preprocessed golf-rule chunks into Supabase pgvector."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Iterable, List, Sequence

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from dotenv import load_dotenv
from openai import OpenAI
import psycopg
from psycopg.types.json import Jsonb

from ingest.build_vector_db import DEFAULT_CHUNKS_PATH, DEFAULT_EMBEDDING_MODEL, VectorChunk, embed_texts, load_chunks


UPSERT_SQL = """
insert into public.golf_rule_chunks (
  id,
  content,
  embedding,
  source,
  source_path,
  page_start,
  page_end,
  heading,
  rule_number,
  chunk_type,
  has_visual_context,
  visual_assets,
  metadata
) values (
  %s,
  %s,
  %s::vector,
  %s,
  %s,
  %s,
  %s,
  %s,
  %s,
  %s,
  %s,
  %s,
  %s
)
on conflict (id) do update set
  content = excluded.content,
  embedding = excluded.embedding,
  source = excluded.source,
  source_path = excluded.source_path,
  page_start = excluded.page_start,
  page_end = excluded.page_end,
  heading = excluded.heading,
  rule_number = excluded.rule_number,
  chunk_type = excluded.chunk_type,
  has_visual_context = excluded.has_visual_context,
  visual_assets = excluded.visual_assets,
  metadata = excluded.metadata
"""


def load_supabase(
    chunks_path: str = DEFAULT_CHUNKS_PATH,
    db_url: str | None = None,
    embedding_model: str | None = None,
    batch_size: int = 64,
    limit: int | None = None,
    reset: bool = False,
) -> int:
    load_dotenv()
    db_url = db_url or os.getenv("SUPABASE_DB_URL")
    if not db_url:
        raise RuntimeError("Set SUPABASE_DB_URL in .env or pass --db-url.")

    embedding_model = embedding_model or os.getenv("OPENAI_EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL
    chunks = load_chunks(chunks_path)
    if limit is not None:
        chunks = chunks[:limit]
    if not chunks:
        raise RuntimeError(f"No chunks found in {chunks_path}")

    openai_client = OpenAI()
    loaded = 0

    with psycopg.connect(db_url) as conn:
        if reset:
            conn.execute("truncate table public.golf_rule_chunks")

        for batch in _batched(chunks, batch_size):
            embeddings = embed_texts(client=openai_client, model=embedding_model, texts=[chunk.text for chunk in batch])
            with conn.cursor() as cur:
                for chunk, embedding in zip(batch, embeddings):
                    cur.execute(UPSERT_SQL, _row_values(chunk, embedding))
            loaded += len(batch)
            print(f"Loaded {loaded}/{len(chunks)} chunks into Supabase")

    return loaded


def _row_values(chunk: VectorChunk, embedding: Sequence[float]):
    metadata = dict(chunk.metadata)
    visual_assets = metadata.get("visual_assets") or []
    return (
        chunk.id,
        chunk.text,
        _vector_literal(embedding),
        _string_or_none(metadata.get("source")),
        _string_or_none(metadata.get("source_path")),
        _int_or_none(metadata.get("page_start")),
        _int_or_none(metadata.get("page_end")),
        _string_or_none(metadata.get("heading")),
        _string_or_none(metadata.get("rule_number")),
        _string_or_none(metadata.get("chunk_type")),
        bool(metadata.get("has_visual_context") or visual_assets),
        Jsonb(visual_assets if isinstance(visual_assets, list) else []),
        Jsonb(_json_safe(metadata)),
    )


def _vector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(f"{value:.10f}" for value in values) + "]"


def _json_safe(value):
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _string_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _int_or_none(value: object) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def _batched(items: Sequence[VectorChunk], batch_size: int) -> Iterable[List[VectorChunk]]:
    if batch_size <= 0:
        raise ValueError("batch_size must be > 0")
    for start in range(0, len(items), batch_size):
        yield list(items[start : start + batch_size])


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load vectordb/chunks.jsonl into Supabase pgvector.")
    parser.add_argument("--chunks-path", default=DEFAULT_CHUNKS_PATH)
    parser.add_argument("--db-url", default=None)
    parser.add_argument("--embedding-model", default=None)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--limit", type=int, default=None, help="Load only the first N chunks, useful for smoke tests.")
    parser.add_argument("--reset", action="store_true", help="Truncate golf_rule_chunks before loading.")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    count = load_supabase(
        chunks_path=args.chunks_path,
        db_url=args.db_url,
        embedding_model=args.embedding_model,
        batch_size=args.batch_size,
        limit=args.limit,
        reset=args.reset,
    )
    print(f"Loaded {count} chunks into Supabase")
