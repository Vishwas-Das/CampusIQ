"""Text extraction from uploaded documents.

Supported formats:
    PDF       (PyMuPDF)
    DOCX      (python-docx)
    PPTX      (python-pptx) — slides + tables + speaker notes
    XLSX      (openpyxl)    — every sheet, rows joined
    HTML/HTM  (BeautifulSoup + lxml)
    RTF       (striprtf)
    TXT, MD   (raw read)

Legacy binary formats (.ppt, .doc) are NOT supported — they require LibreOffice
or pywin32 (Office automation), neither of which fits this stack. The upload
endpoint rejects those extensions outright so users get an immediate clear
error instead of a "FAILED" status after processing.
"""
from __future__ import annotations

import logging
from pathlib import Path

import fitz  # PyMuPDF
import openpyxl
from bs4 import BeautifulSoup
from docx import Document as DocxDocument
from pptx import Presentation
from striprtf.striprtf import rtf_to_text

logger = logging.getLogger(__name__)


class UnsupportedFormat(Exception):
    """Raised when the file type isn't supported by the extractor."""


def extract_text(file_path: str | Path) -> str:
    """Dispatch to the right extractor based on file extension.

    Returns the full text content as a single string. Paragraph breaks are
    preserved as `\n\n` so the chunker can normalize them.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File does not exist: {path}")

    ext = path.suffix.lower()
    if ext == ".pdf":
        return _extract_pdf(path)
    if ext == ".docx":
        return _extract_docx(path)
    if ext == ".pptx":
        return _extract_pptx(path)
    if ext == ".xlsx":
        return _extract_xlsx(path)
    if ext in {".html", ".htm"}:
        return _extract_html(path)
    if ext == ".rtf":
        return _extract_rtf(path)
    if ext in {".txt", ".md"}:
        return _extract_text_file(path)
    raise UnsupportedFormat(f"Cannot extract text from '{ext}' files yet")


def _extract_pdf(path: Path) -> str:
    """Extract text from a PDF using PyMuPDF."""
    parts: list[str] = []
    try:
        with fitz.open(str(path)) as doc:
            for page_num, page in enumerate(doc, start=1):
                page_text = page.get_text("text")
                if page_text.strip():
                    parts.append(page_text.strip())
    except Exception as e:
        logger.exception("Failed to extract PDF text: %s", path)
        raise RuntimeError(f"PDF extraction failed: {e}") from e

    return "\n\n".join(parts)


def _extract_docx(path: Path) -> str:
    """Extract text from a .docx using python-docx."""
    try:
        doc = DocxDocument(str(path))
    except Exception as e:
        logger.exception("Failed to open DOCX: %s", path)
        raise RuntimeError(f"DOCX extraction failed: {e}") from e

    parts: list[str] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            parts.append(text)

    # Also pull text from tables (simple flatten)
    for table in doc.tables:
        for row in table.rows:
            row_parts = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if row_parts:
                parts.append(" | ".join(row_parts))

    return "\n\n".join(parts)


def _extract_text_file(path: Path) -> str:
    """Read a plain text or markdown file."""
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="latin-1", errors="replace")


def _extract_pptx(path: Path) -> str:
    """Extract text from a .pptx using python-pptx.

    Pulls slide titles, bullet text, table cells, and speaker notes. Speaker
    notes matter — many academic decks keep the real explanation there while
    the slides themselves only carry headlines.
    """
    try:
        prs = Presentation(str(path))
    except Exception as e:
        logger.exception("Failed to open PPTX: %s", path)
        raise RuntimeError(f"PPTX extraction failed: {e}") from e

    parts: list[str] = []
    for slide_idx, slide in enumerate(prs.slides, start=1):
        slide_parts: list[str] = []

        for shape in slide.shapes:
            if shape.has_text_frame:
                text = "\n".join(
                    para.text.strip()
                    for para in shape.text_frame.paragraphs
                    if para.text.strip()
                )
                if text:
                    slide_parts.append(text)
            if shape.has_table:
                for row in shape.table.rows:
                    cells = [
                        cell.text.strip() for cell in row.cells if cell.text.strip()
                    ]
                    if cells:
                        slide_parts.append(" | ".join(cells))

        # Speaker notes — often where the real content sits
        if slide.has_notes_slide:
            notes_frame = slide.notes_slide.notes_text_frame
            if notes_frame is not None:
                notes_text = notes_frame.text.strip()
                if notes_text:
                    slide_parts.append(f"[Notes]\n{notes_text}")

        if slide_parts:
            parts.append(f"[Slide {slide_idx}]\n" + "\n\n".join(slide_parts))

    return "\n\n".join(parts)


def _extract_xlsx(path: Path) -> str:
    """Extract text from an .xlsx using openpyxl (read-only mode for memory)."""
    try:
        wb = openpyxl.load_workbook(str(path), data_only=True, read_only=True)
    except Exception as e:
        logger.exception("Failed to open XLSX: %s", path)
        raise RuntimeError(f"XLSX extraction failed: {e}") from e

    parts: list[str] = []
    for sheet in wb.worksheets:
        sheet_lines = [f"[Sheet: {sheet.title}]"]
        for row in sheet.iter_rows(values_only=True):
            cells = [
                str(v).strip() for v in row if v is not None and str(v).strip()
            ]
            if cells:
                sheet_lines.append(" | ".join(cells))
        if len(sheet_lines) > 1:  # had at least one non-empty row
            parts.append("\n".join(sheet_lines))

    try:
        wb.close()
    except Exception:
        pass
    return "\n\n".join(parts)


def _extract_html(path: Path) -> str:
    """Extract text from an HTML file via BeautifulSoup + lxml parser."""
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        raise RuntimeError(f"HTML read failed: {e}") from e

    soup = BeautifulSoup(raw, "lxml")
    # Strip executable/style noise so they don't leak into RAG context
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return soup.get_text(separator="\n\n", strip=True)


def _extract_rtf(path: Path) -> str:
    """Extract text from an RTF file using striprtf."""
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        # RTF is usually ASCII/Windows-1252 — fall back to latin-1 byte read
        raw = path.read_bytes().decode("latin-1", errors="replace")
    try:
        return rtf_to_text(raw)
    except Exception as e:
        raise RuntimeError(f"RTF extraction failed: {e}") from e
