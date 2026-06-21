#!/usr/bin/env python3
"""Extract text from a PDF for the gemini-review MCP server.

Usage: extract_pdf.py <path-to-pdf>

Writes UTF-8 text to stdout with per-page markers so downstream reviewers can
cite slide/page numbers. Exit codes:

  0 — success
  2 — PyMuPDF (fitz) not importable in this interpreter; caller may try another
  1 — any other failure (corrupt file, encrypted, IO error)
"""
import sys


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write("usage: extract_pdf.py <pdf-path>\n")
        return 1

    try:
        import fitz  # PyMuPDF
    except ImportError:
        sys.stderr.write("PyMuPDF (fitz) not available in this interpreter\n")
        return 2

    pdf_path = sys.argv[1]

    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        sys.stderr.write(f"Failed to open PDF: {exc}\n")
        return 1

    try:
        pages = []
        for page_num, page in enumerate(doc, start=1):
            text = page.get_text()
            if text.strip():
                pages.append(f"--- Page {page_num} ---\n{text}")
        output = "\n\n".join(pages)
        sys.stdout.buffer.write(output.encode("utf-8"))
    except Exception as exc:
        sys.stderr.write(f"Extraction failed: {exc}\n")
        return 1
    finally:
        doc.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
