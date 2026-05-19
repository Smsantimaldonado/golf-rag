"""Describe rendered PDF visual pages with a vision model.

Run this after `ingest/pdf_visuals.py` and before building the final vector DB.
It updates the visual manifest in place, adding retrieval-friendly descriptions
for rendered page images.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
from typing import Dict, List

from dotenv import load_dotenv
from openai import OpenAI

try:
    from .pdf_visuals import load_visual_manifest
except ImportError:
    from pdf_visuals import load_visual_manifest


def describe_visual_manifest(
    manifest_path: str = "vectordb/pdf_visuals.jsonl",
    model: str | None = None,
    force: bool = False,
    limit: int | None = None,
) -> List[Dict[str, object]]:
    """Add visual descriptions to each manifest row that has a rendered image."""
    load_dotenv()
    model = model or os.getenv("OPENAI_VISION_MODEL")
    if not model:
        raise RuntimeError("Set OPENAI_VISION_MODEL in .env or pass --model.")
    client = OpenAI()

    rows = load_visual_manifest(manifest_path)
    updated = []
    described_count = 0
    for row in rows:
        if limit is not None and described_count >= limit:
            updated.append(row)
            continue
        if row.get("visual_description") and not force:
            updated.append(row)
            continue

        image_path = Path(str(row["image_path"]))
        if not image_path.exists():
            row["description_status"] = "image_missing"
            updated.append(row)
            continue

        row["visual_description"] = describe_page_image(client=client, model=model, row=row, image_path=image_path)
        row["description_model"] = model
        row["description_status"] = "described"
        updated.append(row)
        described_count += 1

    _write_manifest(updated, manifest_path)
    return updated


def describe_page_image(client: OpenAI, model: str, row: Dict[str, object], image_path: Path) -> str:
    prompt = (
        "Describe this rendered page from a Spanish golf rules PDF for retrieval. "
        "Focus only on visual/diagram information that may affect rule interpretation: "
        "areas of the course, relief areas, reference points, balls, holes, boundary lines, "
        "penalty areas, bunkers, greens, arrows, labels, measurements, and any uncertainty. "
        "Do not decide a ruling. Do not add knowledge outside the page. "
        "Return concise Spanish text.\n\n"
        f"Source: {row.get('source')} page {row.get('page_number')}\n"
        f"Nearby extracted text: {row.get('text_preview', '')}"
    )
    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {
                        "type": "input_image",
                        "image_url": _image_data_url(image_path),
                        "detail": "high",
                    },
                ],
            }
        ],
    )
    return response.output_text.strip()


def _image_data_url(path: Path) -> str:
    suffix = path.suffix.lower()
    mime_type = "image/png" if suffix == ".png" else "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def _write_manifest(rows: List[Dict[str, object]], manifest_path: str) -> None:
    path = Path(manifest_path)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    tmp_path.replace(path)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Describe rendered PDF visual pages with OpenAI vision.")
    parser.add_argument("--manifest-path", default="vectordb/pdf_visuals.jsonl")
    parser.add_argument("--model", default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    rows = describe_visual_manifest(
        manifest_path=args.manifest_path,
        model=args.model,
        force=args.force,
        limit=args.limit,
    )
    described = sum(1 for row in rows if row.get("description_status") == "described")
    print(f"Manifest rows: {len(rows)}; described rows: {described}")
