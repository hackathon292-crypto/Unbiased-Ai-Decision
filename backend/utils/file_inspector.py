"""
file_inspector.py — Content-aware inspection for any uploaded file.

Returns a structured summary that describes what is inside the file so the
frontend can display it in a clear, human-readable format without requiring
manual setup from the user.

Supported:
  - Tabular (CSV, XLS, XLSX, Parquet)         → schema, dtypes, null counts, preview rows, stats
  - Structured data (JSON, YAML, XML)          → type, key count, preview
  - Text / code (TXT, MD, LOG, PY, JS, TS, …) → line/word/char counts, preview snippet
  - Images (JPG, PNG, GIF, WEBP, BMP, TIFF)   → dimensions, mode (best-effort with Pillow)
  - PDFs                                       → page count, first-page text (best-effort with pypdf)
  - Everything else                            → size + extension only

All optional dependencies (pypdf, PIL, openpyxl, pyarrow) are imported lazily
and failures degrade gracefully.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("file_inspector")

TEXT_EXTENSIONS = {
    ".txt", ".md", ".log", ".py", ".js", ".ts", ".tsx", ".jsx",
    ".html", ".css", ".xml", ".yaml", ".yml", ".rtf",
}
TABULAR_EXTENSIONS = {".csv", ".xls", ".xlsx", ".parquet", ".ods"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".ico"}
MODEL_EXTENSIONS = {".pkl", ".joblib"}

MAX_PREVIEW_CHARS = 2000
MAX_PREVIEW_ROWS = 10


# ─── Tabular ────────────────────────────────────────────────────────────────

def _inspect_tabular(path: Path, ext: str) -> Dict[str, Any]:
    import pandas as pd

    if ext == ".csv":
        df = pd.read_csv(path, nrows=5000)
    elif ext in (".xlsx", ".xls"):
        df = pd.read_excel(path, nrows=5000)
    elif ext == ".parquet":
        df = pd.read_parquet(path)
        df = df.head(5000)
    elif ext == ".ods":
        df = pd.read_excel(path, engine="odf", nrows=5000)
    else:
        raise ValueError(f"Unsupported tabular extension: {ext}")

    columns: List[Dict[str, Any]] = []
    for col in df.columns:
        series = df[col]
        dtype = str(series.dtype)
        null_count = int(series.isna().sum())
        sample_values: List[str] = []
        for v in series.dropna().head(3).tolist():
            sample_values.append(str(v)[:60])
        columns.append({
            "name": str(col),
            "dtype": dtype,
            "null_count": null_count,
            "unique_count": int(series.nunique(dropna=True)),
            "sample_values": sample_values,
        })

    # Preview rows as plain dict list (stringify for JSON safety)
    preview_rows: List[Dict[str, Any]] = []
    for _, row in df.head(MAX_PREVIEW_ROWS).iterrows():
        preview_rows.append({str(k): (None if _is_na(v) else _json_safe(v)) for k, v in row.items()})

    # Numeric summary
    numeric_df = df.select_dtypes(include="number")
    stats: Dict[str, Dict[str, float]] = {}
    if not numeric_df.empty:
        desc = numeric_df.describe().round(4)
        for col in desc.columns:
            stats[str(col)] = {k: _json_safe(v) for k, v in desc[col].to_dict().items()}

    return {
        "kind": "tabular",
        "rows": int(len(df)),
        "columns_count": int(len(df.columns)),
        "columns": columns,
        "preview_rows": preview_rows,
        "numeric_stats": stats,
    }


def _is_na(v: Any) -> bool:
    try:
        import pandas as pd
        return bool(pd.isna(v))
    except Exception:
        return v is None


def _json_safe(v: Any) -> Any:
    try:
        json.dumps(v)
        return v
    except (TypeError, ValueError):
        return str(v)


# ─── Structured (JSON/YAML/XML) ─────────────────────────────────────────────

def _inspect_json(path: Path) -> Dict[str, Any]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Try JSON Lines
        lines = [ln for ln in raw.splitlines() if ln.strip()]
        try:
            data = [json.loads(ln) for ln in lines[:100]]
        except json.JSONDecodeError:
            return {
                "kind": "text",
                "line_count": raw.count("\n") + 1,
                "char_count": len(raw),
                "preview": raw[:MAX_PREVIEW_CHARS],
                "note": "Could not parse as JSON",
            }

    if isinstance(data, list):
        first = data[0] if data else None
        keys = list(first.keys()) if isinstance(first, dict) else []
        return {
            "kind": "json",
            "root_type": "array",
            "length": len(data),
            "item_keys": keys[:30],
            "preview": json.dumps(data[:3], indent=2, default=str)[:MAX_PREVIEW_CHARS],
        }
    if isinstance(data, dict):
        return {
            "kind": "json",
            "root_type": "object",
            "key_count": len(data),
            "keys": list(data.keys())[:30],
            "preview": json.dumps(data, indent=2, default=str)[:MAX_PREVIEW_CHARS],
        }
    return {
        "kind": "json",
        "root_type": type(data).__name__,
        "preview": json.dumps(data, default=str)[:MAX_PREVIEW_CHARS],
    }


def _inspect_yaml(path: Path) -> Dict[str, Any]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    try:
        import yaml  # type: ignore
        data = yaml.safe_load(raw)
    except Exception:
        return _inspect_text_bytes(raw)
    summary: Dict[str, Any] = {"kind": "yaml", "preview": raw[:MAX_PREVIEW_CHARS]}
    if isinstance(data, dict):
        summary["root_type"] = "object"
        summary["key_count"] = len(data)
        summary["keys"] = list(data.keys())[:30]
    elif isinstance(data, list):
        summary["root_type"] = "array"
        summary["length"] = len(data)
    else:
        summary["root_type"] = type(data).__name__
    return summary


def _inspect_xml(path: Path) -> Dict[str, Any]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    root_tag: Optional[str] = None
    child_count = 0
    try:
        import xml.etree.ElementTree as ET
        root = ET.fromstring(raw)
        root_tag = root.tag
        child_count = len(list(root))
    except Exception:
        pass
    return {
        "kind": "xml",
        "root_tag": root_tag,
        "child_count": child_count,
        "preview": raw[:MAX_PREVIEW_CHARS],
    }


# ─── Text / Code ────────────────────────────────────────────────────────────

def _inspect_text_bytes(raw: str) -> Dict[str, Any]:
    lines = raw.splitlines()
    return {
        "kind": "text",
        "line_count": len(lines),
        "word_count": sum(len(ln.split()) for ln in lines),
        "char_count": len(raw),
        "preview": raw[:MAX_PREVIEW_CHARS],
    }


def _inspect_text(path: Path) -> Dict[str, Any]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    return _inspect_text_bytes(raw)


# ─── Images ─────────────────────────────────────────────────────────────────

def _inspect_image(path: Path) -> Dict[str, Any]:
    summary: Dict[str, Any] = {"kind": "image"}
    try:
        from PIL import Image  # type: ignore
        with Image.open(path) as img:
            summary["width"] = img.width
            summary["height"] = img.height
            summary["mode"] = img.mode
            summary["format"] = img.format
    except Exception as e:
        summary["note"] = f"Pillow not available or failed: {e}"
    return summary


# ─── PDF ────────────────────────────────────────────────────────────────────

def _inspect_pdf(path: Path) -> Dict[str, Any]:
    summary: Dict[str, Any] = {"kind": "pdf"}
    try:
        from pypdf import PdfReader  # type: ignore
        reader = PdfReader(str(path))
        summary["page_count"] = len(reader.pages)
        try:
            first_text = reader.pages[0].extract_text() or ""
        except Exception:
            first_text = ""
        summary["preview"] = first_text[:MAX_PREVIEW_CHARS]
        meta = reader.metadata or {}
        summary["metadata"] = {
            "title": str(meta.get("/Title", "") or ""),
            "author": str(meta.get("/Author", "") or ""),
        }
    except Exception as e:
        summary["note"] = f"pypdf not available or failed: {e}"
    return summary


def _inspect_docx(path: Path) -> Dict[str, Any]:
    summary: Dict[str, Any] = {"kind": "text"}
    try:
        from docx import Document  # type: ignore

        document = Document(str(path))
        paragraphs = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
        text = "\n".join(paragraphs)
        summary.update(_inspect_text_bytes(text))
        summary["note"] = "Extracted from DOCX document"
    except Exception as e:
        summary["note"] = f"DOCX extraction unavailable: {e}"
    return summary


def _inspect_model(path: Path) -> Dict[str, Any]:
    summary: Dict[str, Any] = {"kind": "model"}
    try:
        import joblib

        model = joblib.load(path)
        summary["model_type"] = type(model).__name__
        summary["module"] = type(model).__module__
        if hasattr(model, "n_features_in_"):
            summary["n_features_in"] = int(getattr(model, "n_features_in_"))
        if hasattr(model, "classes_"):
            summary["classes"] = [str(value) for value in list(getattr(model, "classes_"))[:20]]
        summary["has_predict_proba"] = bool(hasattr(model, "predict_proba"))
    except Exception as e:
        summary["note"] = f"Model inspection failed: {e}"
    return summary


# ─── Entry point ────────────────────────────────────────────────────────────

def inspect_file(file_path: Path, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Inspect *any* file and return a JSON-safe summary dict."""
    ext = (metadata.get("extension") or file_path.suffix or "").lower()
    category = metadata.get("category", "other")

    base = {
        "file_id": metadata.get("id"),
        "filename": metadata.get("filename"),
        "extension": ext,
        "category": category,
        "size_bytes": metadata.get("size_bytes"),
        "size_human": metadata.get("size_human"),
    }

    try:
        if ext in TABULAR_EXTENSIONS:
            return {**base, **_inspect_tabular(file_path, ext)}
        if ext == ".json":
            return {**base, **_inspect_json(file_path)}
        if ext in {".yaml", ".yml"}:
            return {**base, **_inspect_yaml(file_path)}
        if ext == ".xml":
            return {**base, **_inspect_xml(file_path)}
        if ext in TEXT_EXTENSIONS:
            return {**base, **_inspect_text(file_path)}
        if ext in IMAGE_EXTENSIONS:
            return {**base, **_inspect_image(file_path)}
        if ext == ".pdf":
            return {**base, **_inspect_pdf(file_path)}
        if ext == ".docx":
            return {**base, **_inspect_docx(file_path)}
        if ext in MODEL_EXTENSIONS:
            return {**base, **_inspect_model(file_path)}
    except Exception as e:
        logger.warning(f"Inspection failed for {file_path}: {e}")
        return {**base, "kind": "unknown", "error": str(e)[:200]}

    return {**base, "kind": "binary", "note": "No content inspector for this extension."}
