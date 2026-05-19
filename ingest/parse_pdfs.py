"""PDF text extraction helpers for the golf-rules knowledge base."""
from dataclasses import dataclass
from pathlib import Path
from typing import List

try:
    import fitz
except Exception:
    fitz = None


@dataclass(frozen=True)
class PageText:
    source_path: str
    source_name: str
    page_number: int
    text: str


def list_pdfs(data_dir: str = "../data"):
    p = Path(data_dir)
    return sorted([str(f) for f in p.glob("*.pdf")])


def _require_fitz():
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is not installed. Install PyMuPDF to use this function.")


def extract_pages(pdf_path: str) -> List[PageText]:
    """Extract text page by page, preserving source and page metadata."""
    _require_fitz()
    pages = []
    path = Path(pdf_path)
    doc = fitz.open(pdf_path)
    try:
        for page_index, page in enumerate(doc, start=1):
            pages.append(
                PageText(
                    source_path=str(path),
                    source_name=path.name,
                    page_number=page_index,
                    text=page.get_text(),
                )
            )
    finally:
        doc.close()
    return pages


def extract_text(pdf_path: str) -> str:
    return "\n".join(page.text for page in extract_pages(pdf_path))


if __name__ == "__main__":
    for pdf in list_pdfs("../data"):
        try:
            pages = extract_pages(pdf)
            txt = "\n".join(page.text for page in pages)
            print(f"--- {pdf} ({len(pages)} pages) ---\n{txt[:500]}\n")
        except Exception as e:
            print(f"Failed to extract {pdf}: {e}")
