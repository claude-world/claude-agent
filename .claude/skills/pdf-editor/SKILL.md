---
name: pdf-editor
description: >
  Edit, annotate, extract, merge, and transform PDF files using nano-pdf with
  natural language instructions. Use when user needs to modify PDF content,
  extract text, merge documents, add annotations, or convert PDFs.
allowed-tools:
  - Bash
  - Read
  - Write
model: haiku
user-invocable: true
when_to_use: >
  When user needs to work with PDF files — editing, extracting text, merging,
  splitting, annotating, converting, or filling forms.
  Triggers: "edit PDF", "extract text from PDF", "merge PDFs", "split PDF",
  "add annotation", "fill PDF form", "convert PDF to...", "compress PDF".
argument-hint: "<action: extract|merge|split|annotate|fill|convert|compress> <file.pdf> <details>"
---

# PDF Editor

Edit and process PDF files using `nano-pdf`, a natural language PDF editing tool.

## Prerequisites

```bash
pip install nano-pdf
```

Or with pipx for isolated install:
```bash
pipx install nano-pdf
```

Verify:
```bash
nano-pdf --version
```

## Commands

| Command | Description |
|---------|-------------|
| `nano-pdf extract <file.pdf>` | Extract all text from a PDF |
| `nano-pdf extract <file.pdf> --pages 1-5` | Extract specific pages |
| `nano-pdf merge <a.pdf> <b.pdf> -o output.pdf` | Merge two or more PDFs |
| `nano-pdf split <file.pdf> --pages 1-3 -o part1.pdf` | Split out specific pages |
| `nano-pdf annotate <file.pdf> --page 2 --text "Review this"` | Add text annotation |
| `nano-pdf fill <form.pdf> --field "Name=Alice" --field "Date=2026-03-21"` | Fill form fields |
| `nano-pdf convert <file.pdf> --to txt -o output.txt` | Convert to text |
| `nano-pdf convert <file.pdf> --to html -o output.html` | Convert to HTML |
| `nano-pdf compress <file.pdf> -o compressed.pdf` | Compress/optimize PDF |
| `nano-pdf info <file.pdf>` | Show metadata (pages, author, title) |
| `nano-pdf rotate <file.pdf> --pages all --degrees 90 -o rotated.pdf` | Rotate pages |

## Usage Examples

**Extract text for reading:**
```bash
nano-pdf extract report.pdf > workspace/report-text.txt
```

**Merge multiple PDFs:**
```bash
nano-pdf merge cover.pdf chapter1.pdf chapter2.pdf -o final.pdf
```

**Split out pages 5–10:**
```bash
nano-pdf split document.pdf --pages 5-10 -o excerpt.pdf
```

**Fill a PDF form:**
```bash
nano-pdf fill application.pdf \
  --field "FirstName=Alice" \
  --field "LastName=Smith" \
  --field "Date=2026-03-21" \
  -o filled-application.pdf
```

**Get PDF metadata:**
```bash
nano-pdf info contract.pdf
```

## Rules

- Always check if CLI is installed first: `which nano-pdf` or `nano-pdf --version`
- If not installed, show `pip install nano-pdf` and stop
- Always verify the input file exists before running any command
- When extracting large PDFs (> 50 pages), save output to `workspace/` rather than displaying inline
- For merge operations, list the input files in order and confirm with the user before executing
- For fill operations, first use `nano-pdf info` to list available form fields before filling
- Output files default to the same directory as input unless user specifies otherwise — prefer saving to `workspace/` for intermediate results
- Keep responses concise: confirm action and output path in 1-2 lines
- For large files, note the page count and file size in the confirmation
