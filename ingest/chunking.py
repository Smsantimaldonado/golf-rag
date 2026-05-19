"""Domain-aware chunking for golf-rules PDFs.

The goal is to preserve citable rule units instead of slicing text every N
characters. Chunks keep source, page range, and detected rule metadata so later
retrieval can answer with grounded citations.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import json
import re
from pathlib import Path
import unicodedata
from typing import Dict, Iterable, List, Optional

try:
    from .parse_pdfs import PageText, extract_pages, list_pdfs
    from .pdf_visuals import visual_pages_by_source
except ImportError:
    from parse_pdfs import PageText, extract_pages, list_pdfs
    from pdf_visuals import visual_pages_by_source


MAIN_RULE_RE = re.compile(r"(?im)^Regla\s+(\d{1,2})\s*[\u2013-]\s*(.+)$")
SECTION_RE = re.compile(r"(?im)^\s*((?:\d{1,2})\.(?:\d{1,2})(?:[a-z])?)\s+(.+)$")
GUIDE_SECTION_RE = re.compile(r"(?m)^(?:[IVXLCDM]+\.\s+.+|[A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1][A-Z\u00c1\u00c9\u00cd\u00d3\u00da\u00d1\s,;:()/-]{8,})$")
WHITESPACE_RE = re.compile(r"[ \t]+")
CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


@dataclass(frozen=True)
class Chunk:
    id: str
    text: str
    metadata: Dict[str, object]


@dataclass(frozen=True)
class _Block:
    source_name: str
    source_path: str
    start_page: int
    end_page: int
    text: str
    heading: Optional[str]
    rule_number: Optional[str]
    chunk_type: str


def normalize_text(text: str) -> str:
    """Clean PDF extraction artifacts without changing the wording."""
    text = CONTROL_CHARS_RE.sub("", text)
    text = text.replace("\u00ad", "")
    text = text.replace("\ufeff", "")
    text = text.replace("\ufffd", "")
    text = WHITESPACE_RE.sub(" ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
    """Generic fallback chunker kept for simple experiments."""
    if chunk_size <= 0:
        raise ValueError("chunk_size must be > 0")
    if overlap >= chunk_size:
        raise ValueError("overlap must be smaller than chunk_size")
    chunks = []
    start = 0
    text_len = len(text)
    while start < text_len:
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks


def chunk_pages(pages: Iterable[PageText], max_chars: int = 2800, overlap_chars: int = 350) -> List[Chunk]:
    """Create chunks from extracted PDF pages with rule-aware metadata."""
    blocks = _split_pages_into_blocks(pages)
    chunks = []
    for index, block in enumerate(_merge_blocks(blocks, max_chars=max_chars, overlap_chars=overlap_chars), start=1):
        chunks.append(_to_chunk(index, block))
    return chunks


def chunk_pdf(pdf_path: str, max_chars: int = 2800, overlap_chars: int = 350) -> List[Chunk]:
    return chunk_pages(extract_pages(pdf_path), max_chars=max_chars, overlap_chars=overlap_chars)


def chunk_data_dir(
    data_dir: str = "data",
    max_chars: int = 2800,
    overlap_chars: int = 350,
    visual_manifest_path: str = "vectordb/pdf_visuals.jsonl",
) -> List[Chunk]:
    chunks = []
    for pdf_path in list_pdfs(data_dir):
        chunks.extend(chunk_pdf(pdf_path, max_chars=max_chars, overlap_chars=overlap_chars))
    return attach_visual_metadata(chunks, visual_manifest_path)


def attach_visual_metadata(chunks: Iterable[Chunk], manifest_path: str = "vectordb/pdf_visuals.jsonl") -> List[Chunk]:
    visual_pages = visual_pages_by_source(manifest_path)
    enriched = []
    for chunk in chunks:
        metadata = dict(chunk.metadata)
        source = str(metadata.get("source"))
        page_start = int(metadata.get("page_start", 0))
        page_end = int(metadata.get("page_end", page_start))
        assets = [
            _compact_visual_asset(asset)
            for page_number, asset in sorted(visual_pages.get(source, {}).items())
            if page_start <= page_number <= page_end
        ]
        metadata["has_visual_context"] = bool(assets)
        if assets:
            metadata["visual_assets"] = assets
        enriched.append(Chunk(id=chunk.id, text=_text_with_visual_context(chunk.text, assets), metadata=metadata))
    return enriched


def write_jsonl(chunks: Iterable[Chunk], output_path: str) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for chunk in chunks:
            f.write(json.dumps(asdict(chunk), ensure_ascii=False) + "\n")


def _split_pages_into_blocks(pages: Iterable[PageText]) -> List[_Block]:
    blocks = []
    active_main_rule = None
    active_heading = None

    for page in pages:
        clean_page = normalize_text(page.text)
        if not clean_page:
            continue
        if _is_navigation_page(clean_page):
            continue

        starts = _find_block_starts(clean_page)
        if not starts:
            blocks.append(
                _Block(
                    source_name=page.source_name,
                    source_path=page.source_path,
                    start_page=page.page_number,
                    end_page=page.page_number,
                    text=clean_page,
                    heading=active_heading,
                    rule_number=active_main_rule,
                    chunk_type="page",
                )
            )
            continue

        starts.append((len(clean_page), "end", None, None))
        if starts[0][0] > 0:
            prefix = clean_page[: starts[0][0]].strip()
            if prefix:
                blocks.append(
                    _Block(page.source_name, page.source_path, page.page_number, page.page_number, prefix, active_heading, active_main_rule, "continuation")
                )

        for current, nxt in zip(starts, starts[1:]):
            start, marker_type, rule_number, heading = current
            end = nxt[0]
            text = clean_page[start:end].strip()
            if not text:
                continue

            if marker_type == "main_rule":
                active_main_rule = rule_number
                active_heading = heading or f"Regla {rule_number}"
                chunk_type = "main_rule"
            elif marker_type == "rule_section":
                active_main_rule = rule_number or active_main_rule
                active_heading = heading or rule_number
                chunk_type = "rule_section"
            else:
                active_heading = heading or active_heading
                chunk_type = "guide_section"

            blocks.append(
                _Block(
                    source_name=page.source_name,
                    source_path=page.source_path,
                    start_page=page.page_number,
                    end_page=page.page_number,
                    text=text,
                    heading=active_heading,
                    rule_number=rule_number or active_main_rule,
                    chunk_type=chunk_type,
                )
            )

    return blocks


def _find_block_starts(text: str) -> List[tuple[int, str, Optional[str], Optional[str]]]:
    starts = []
    for match in MAIN_RULE_RE.finditer(text):
        rule_number = match.group(1)
        title = match.group(2)
        heading = f"Regla {rule_number}" + (f" - {title.strip()}" if title else "")
        starts.append((match.start(), "main_rule", rule_number, heading))

    for match in SECTION_RE.finditer(text):
        rule_number = match.group(1)
        heading = f"{rule_number} {match.group(2).strip()}"
        starts.append((match.start(), "rule_section", rule_number, heading))

    for match in GUIDE_SECTION_RE.finditer(text):
        heading = match.group(0).strip()
        starts.append((match.start(), "guide_section", None, heading))

    deduped = {}
    for start, marker_type, rule_number, heading in starts:
        current = deduped.get(start)
        if current is None or _marker_priority(marker_type) > _marker_priority(current[0]):
            deduped[start] = (marker_type, rule_number, heading)

    return [(start, *values) for start, values in sorted(deduped.items())]


def _is_navigation_page(text: str) -> bool:
    first_lines = "\n".join(text.splitlines()[:6])
    normalized = _strip_accents(first_lines)
    return "Contenidos" in normalized or "Indice Alfabetico" in normalized or normalized.startswith("Indice")


def _marker_priority(marker_type: str) -> int:
    return {"main_rule": 3, "rule_section": 2, "guide_section": 1}.get(marker_type, 0)


def _merge_blocks(blocks: Iterable[_Block], max_chars: int, overlap_chars: int) -> List[_Block]:
    merged = []
    current_parts: List[str] = []
    current_meta: Optional[Dict[str, object]] = None

    for block in blocks:
        if len(block.text) > max_chars:
            merged.extend(_split_large_block(block, max_chars=max_chars, overlap_chars=overlap_chars))
            current_parts = []
            current_meta = None
            continue

        same_unit = current_meta and current_meta["source_name"] == block.source_name and current_meta["rule_number"] == block.rule_number
        would_fit = sum(len(part) for part in current_parts) + len(block.text) + 2 <= max_chars

        if current_parts and (not same_unit or not would_fit):
            merged.append(_block_from_parts(current_parts, current_meta))
            current_parts = []
            current_meta = None

        if not current_parts:
            current_meta = {
                "source_name": block.source_name,
                "source_path": block.source_path,
                "start_page": block.start_page,
                "end_page": block.end_page,
                "heading": block.heading,
                "rule_number": block.rule_number,
                "chunk_type": block.chunk_type,
            }

        current_parts.append(block.text)
        current_meta["end_page"] = block.end_page
        current_meta["heading"] = block.heading or current_meta["heading"]

    if current_parts:
        merged.append(_block_from_parts(current_parts, current_meta))

    return merged


def _split_large_block(block: _Block, max_chars: int, overlap_chars: int) -> List[_Block]:
    parts = chunk_text(block.text, chunk_size=max_chars, overlap=overlap_chars)
    return [
        _Block(
            source_name=block.source_name,
            source_path=block.source_path,
            start_page=block.start_page,
            end_page=block.end_page,
            text=part,
            heading=block.heading,
            rule_number=block.rule_number,
            chunk_type=f"{block.chunk_type}_part",
        )
        for part in parts
    ]


def _block_from_parts(parts: List[str], meta: Dict[str, object]) -> _Block:
    return _Block(
        source_name=str(meta["source_name"]),
        source_path=str(meta["source_path"]),
        start_page=int(meta["start_page"]),
        end_page=int(meta["end_page"]),
        text="\n\n".join(parts),
        heading=meta["heading"] if isinstance(meta["heading"], str) else None,
        rule_number=meta["rule_number"] if isinstance(meta["rule_number"], str) else None,
        chunk_type=str(meta["chunk_type"]),
    )


def _to_chunk(index: int, block: _Block) -> Chunk:
    source_stem = Path(block.source_name).stem
    rule_slug = re.sub(r"[^0-9a-zA-Z.]+", "-", block.rule_number or "no-rule").strip("-")
    page_slug = f"p{block.start_page}" if block.start_page == block.end_page else f"p{block.start_page}-{block.end_page}"
    chunk_id = f"{source_stem}:{rule_slug}:{page_slug}:{index}"
    return Chunk(
        id=chunk_id,
        text=block.text,
        metadata={
            "source": block.source_name,
            "source_path": block.source_path,
            "page_start": block.start_page,
            "page_end": block.end_page,
            "heading": block.heading,
            "rule_number": block.rule_number,
            "chunk_type": block.chunk_type,
        },
    )


def _compact_visual_asset(asset: Dict[str, object]) -> Dict[str, object]:
    compact = {
        "page_number": asset.get("page_number"),
        "image_path": asset.get("image_path"),
        "reasons": asset.get("reasons", []),
    }
    if asset.get("visual_description"):
        compact["visual_description"] = asset["visual_description"]
    return compact


def _text_with_visual_context(text: str, assets: List[Dict[str, object]]) -> str:
    descriptions = [str(asset["visual_description"]).strip() for asset in assets if asset.get("visual_description")]
    if not descriptions:
        return text
    return text + "\n\nContexto visual preprocesado:\n" + "\n".join(f"- {description}" for description in descriptions)


def _strip_accents(text: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFKD", text) if not unicodedata.combining(char))


if __name__ == "__main__":
    output = "vectordb/chunks.jsonl"
    chunks = chunk_data_dir("data")
    write_jsonl(chunks, output)
    print(f"Wrote {len(chunks)} chunks to {output}")
