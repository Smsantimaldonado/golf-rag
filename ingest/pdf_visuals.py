"""Find and render PDF pages that likely contain rule diagrams.

This is an ingestion-time step. It creates page images and a JSONL manifest so
the retrieval layer can include visual context without reprocessing PDFs during
each user query.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import re
import unicodedata
from typing import Dict, Iterable, List, Optional

try:
    import fitz
except Exception:
    fitz = None

try:
    from .parse_pdfs import list_pdfs
except ImportError:
    from parse_pdfs import list_pdfs


RULE_TEXT_RE = re.compile(r"\b(?:Regla\s+\d{1,2}|REGLA|\d{1,2}\.\d{1,2}[a-z]?)\b", re.IGNORECASE)
VISUAL_TEXT_RE = re.compile(r"\b(?:diagrama|figura|imagen|ilustra|grafico)\b", re.IGNORECASE)


@dataclass(frozen=True)
class VisualPage:
    source: str
    source_path: str
    page_number: int
    image_path: str
    image_count: int
    large_image_count: int
    drawing_count: int
    reasons: List[str]
    text_preview: str
    visual_description: Optional[str] = None


def build_visual_manifest(
    data_dir: str = "data",
    output_dir: str = "vectordb/page_images",
    manifest_path: str = "vectordb/pdf_visuals.jsonl",
    dpi: int = 160,
    min_image_area: int = 2000,
    max_full_page_ratio: float = 0.70,
    min_drawing_count: int = 250,
    force: bool = False,
) -> List[VisualPage]:
    """Render candidate visual pages and write a JSONL manifest."""
    _require_fitz()
    rendered = []
    for pdf_path in list_pdfs(data_dir):
        rendered.extend(
            render_pdf_visual_pages(
                pdf_path=pdf_path,
                output_dir=output_dir,
                dpi=dpi,
                min_image_area=min_image_area,
                max_full_page_ratio=max_full_page_ratio,
                min_drawing_count=min_drawing_count,
                force=force,
            )
        )
    write_visual_manifest(rendered, manifest_path)
    return rendered


def render_pdf_visual_pages(
    pdf_path: str,
    output_dir: str = "vectordb/page_images",
    dpi: int = 160,
    min_image_area: int = 2000,
    max_full_page_ratio: float = 0.70,
    min_drawing_count: int = 250,
    force: bool = False,
) -> List[VisualPage]:
    """Render pages that likely contain useful rule diagrams."""
    _require_fitz()
    path = Path(pdf_path)
    doc = fitz.open(pdf_path)
    visual_pages = []
    try:
        for page_index, page in enumerate(doc, start=1):
            page_text = page.get_text()
            if _is_navigation_page(page_text):
                continue
            if path.name == "Reglas_de_Golf.pdf" and page_index < 20:
                continue
            candidate = _visual_candidate(
                page=page,
                text=page_text,
                min_image_area=min_image_area,
                max_full_page_ratio=max_full_page_ratio,
                min_drawing_count=min_drawing_count,
            )
            if not candidate:
                continue

            image_path = _render_page(
                page=page,
                pdf_stem=path.stem,
                page_number=page_index,
                output_dir=Path(output_dir),
                dpi=dpi,
                force=force,
            )
            visual_pages.append(
                VisualPage(
                    source=path.name,
                    source_path=str(path),
                    page_number=page_index,
                    image_path=str(image_path),
                    image_count=len(page.get_images(full=True)),
                    large_image_count=candidate["large_image_count"],
                    drawing_count=len(page.get_drawings()),
                    reasons=candidate["reasons"],
                    text_preview=_preview_text(page_text),
                )
            )
    finally:
        doc.close()
    return visual_pages


def write_visual_manifest(visual_pages: Iterable[VisualPage], manifest_path: str) -> None:
    path = Path(manifest_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for page in visual_pages:
            f.write(json.dumps(asdict(page), ensure_ascii=False) + "\n")


def load_visual_manifest(manifest_path: str = "vectordb/pdf_visuals.jsonl") -> List[Dict[str, object]]:
    path = Path(manifest_path)
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def visual_pages_by_source(manifest_path: str = "vectordb/pdf_visuals.jsonl") -> Dict[str, Dict[int, Dict[str, object]]]:
    pages: Dict[str, Dict[int, Dict[str, object]]] = {}
    for item in load_visual_manifest(manifest_path):
        source = str(item["source"])
        page_number = int(item["page_number"])
        pages.setdefault(source, {})[page_number] = item
    return pages


def _visual_candidate(
    page,
    text: str,
    min_image_area: int,
    max_full_page_ratio: float,
    min_drawing_count: int,
) -> Optional[Dict[str, object]]:
    reasons = []
    page_area = page.rect.width * page.rect.height
    image_blocks = _image_blocks(page)
    large_image_count = 0
    for block in image_blocks:
        area = block["area"]
        ratio = area / page_area if page_area else 0
        if area >= min_image_area and ratio <= max_full_page_ratio:
            large_image_count += 1

    drawing_count = len(page.get_drawings())
    has_rule_text = bool(RULE_TEXT_RE.search(text))
    has_visual_text = bool(VISUAL_TEXT_RE.search(_strip_accents(text)))

    if large_image_count >= 2 or (large_image_count and has_visual_text):
        reasons.append("large_non_full_page_image")
    if drawing_count >= min_drawing_count and has_rule_text:
        reasons.append("many_vector_drawings_near_rule_text")
    if has_visual_text and has_rule_text:
        reasons.append("visual_reference_in_rule_text")

    if not reasons:
        return None

    return {"large_image_count": large_image_count, "reasons": reasons}


def _image_blocks(page) -> List[Dict[str, object]]:
    blocks = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 1:
            continue
        x0, y0, x1, y1 = block["bbox"]
        blocks.append({"bbox": block["bbox"], "area": max(0, x1 - x0) * max(0, y1 - y0)})
    return blocks


def _render_page(page, pdf_stem: str, page_number: int, output_dir: Path, dpi: int, force: bool) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    image_path = output_dir / f"{pdf_stem}_p{page_number:03d}.png"
    if image_path.exists() and not force:
        return image_path
    matrix = fitz.Matrix(dpi / 72, dpi / 72)
    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
    pixmap.save(image_path)
    return image_path


def _preview_text(text: str, limit: int = 600) -> str:
    return " ".join(text.split())[:limit]


def _strip_accents(text: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFKD", text) if not unicodedata.combining(char))


def _is_navigation_page(text: str) -> bool:
    first_lines = "\n".join(text.splitlines()[:6])
    normalized = _strip_accents(first_lines)
    return "Contenidos" in normalized or "Indice Alfabetico" in normalized or normalized.startswith("Indice")


def _require_fitz() -> None:
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is not installed. Install PyMuPDF to use this function.")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render candidate PDF pages that contain visual rule context.")
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--output-dir", default="vectordb/page_images")
    parser.add_argument("--manifest-path", default="vectordb/pdf_visuals.jsonl")
    parser.add_argument("--dpi", type=int, default=160)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    pages = build_visual_manifest(
        data_dir=args.data_dir,
        output_dir=args.output_dir,
        manifest_path=args.manifest_path,
        dpi=args.dpi,
        force=args.force,
    )
    print(f"Wrote {len(pages)} visual pages to {args.manifest_path}")
