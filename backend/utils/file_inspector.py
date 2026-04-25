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
import re
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

DOMAIN_FIELDS: Dict[str, List[str]] = {
    "hiring": [
        "years_experience", "education_level", "technical_score",
        "communication_score", "num_past_jobs", "certifications",
        "gender", "religion", "ethnicity",
    ],
    "loan": [
        "credit_score", "annual_income", "loan_amount", "loan_term_months",
        "employment_years", "existing_debt", "num_credit_lines",
        "gender", "age_group", "ethnicity",
    ],
    "social": [
        "avg_session_minutes", "posts_per_day", "topics_interacted",
        "like_rate", "share_rate", "comment_rate", "account_age_days",
        "gender", "age_group", "location", "language",
    ],
}


def _normalize(name: str) -> str:
    return str(name).strip().lower().replace("_", "").replace("-", "").replace(" ", "")


def _coerce_numeric(value: Any) -> Any:
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        cleaned = value.strip().replace("%", "")
        try:
            if "." in cleaned:
                return float(cleaned)
            return int(cleaned)
        except ValueError:
            return value.strip()
    return value


def _detect_domain_from_keys(keys: List[str]) -> Optional[str]:
    normalized_keys = {_normalize(key) for key in keys}
    best_domain = None
    best_score = 0
    for domain, fields in DOMAIN_FIELDS.items():
        score = sum(1 for field in fields if _normalize(field) in normalized_keys)
        if score > best_score:
            best_score = score
            best_domain = domain
    return best_domain if best_score >= 2 else None


def _extract_text_parameters(text: str) -> tuple[Optional[str], Dict[str, Any]]:
    lowered = text.lower()
    explicit_domain = None
    if "loan" in lowered or "credit score" in lowered:
        explicit_domain = "loan"
    elif "hiring" in lowered or "candidate" in lowered or "technical score" in lowered:
        explicit_domain = "hiring"
    elif "recommend" in lowered or "session" in lowered or "engagement" in lowered:
        explicit_domain = "social"

    extracted: Dict[str, Any] = {}
    for domain, fields in DOMAIN_FIELDS.items():
        for field in fields:
            pattern = rf"{field.replace('_', '[ _-]?')}\s*[:=]\s*([^\n,;]+)"
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                extracted[field] = _coerce_numeric(match.group(1))

    inferred_domain = explicit_domain or _detect_domain_from_keys(list(extracted.keys()))
    if inferred_domain:
        allowed = set(DOMAIN_FIELDS[inferred_domain])
        extracted = {key: value for key, value in extracted.items() if key in allowed}
    return inferred_domain, extracted


def _attach_inference(payload: Dict[str, Any]) -> Dict[str, Any]:
    inferred_domain: Optional[str] = None
    suggested_parameters: Dict[str, Any] = {}

    if payload.get("kind") == "tabular":
        columns = [column["name"] for column in payload.get("columns", [])]
        inferred_domain = _detect_domain_from_keys(columns)
        preview_rows = payload.get("preview_rows") or []
        if inferred_domain and preview_rows:
            first_row = preview_rows[0]
            for field in DOMAIN_FIELDS[inferred_domain]:
                if field in first_row and first_row[field] not in (None, ""):
                    suggested_parameters[field] = _coerce_numeric(first_row[field])
    elif payload.get("kind") in {"json", "yaml", "xml"}:
        keys = (payload.get("keys") or payload.get("item_keys") or [])
        inferred_domain = _detect_domain_from_keys([str(key) for key in keys])
        preview = payload.get("preview") or ""
        text_domain, text_params = _extract_text_parameters(preview)
        inferred_domain = inferred_domain or text_domain
        if inferred_domain:
            allowed = set(DOMAIN_FIELDS[inferred_domain])
            suggested_parameters = {key: value for key, value in text_params.items() if key in allowed}
    elif payload.get("kind") in {"text", "pdf"}:
        inferred_domain, suggested_parameters = _extract_text_parameters(payload.get("preview") or "")

    if inferred_domain:
        payload["inferred_domain"] = inferred_domain
    if suggested_parameters:
        payload["suggested_parameters"] = suggested_parameters
    return payload


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

    return _attach_inference({
        "kind": "tabular",
        "rows": int(len(df)),
        "columns_count": int(len(df.columns)),
        "columns": columns,
        "preview_rows": preview_rows,
        "numeric_stats": stats,
    })


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
            return _attach_inference({
                "kind": "text",
                "line_count": raw.count("\n") + 1,
                "char_count": len(raw),
                "preview": raw[:MAX_PREVIEW_CHARS],
                "note": "Could not parse as JSON",
            })

    if isinstance(data, list):
        first = data[0] if data else None
        keys = list(first.keys()) if isinstance(first, dict) else []
        return _attach_inference({
            "kind": "json",
            "root_type": "array",
            "length": len(data),
            "item_keys": keys[:30],
            "preview": json.dumps(data[:3], indent=2, default=str)[:MAX_PREVIEW_CHARS],
        })
    if isinstance(data, dict):
        return _attach_inference({
            "kind": "json",
            "root_type": "object",
            "key_count": len(data),
            "keys": list(data.keys())[:30],
            "preview": json.dumps(data, indent=2, default=str)[:MAX_PREVIEW_CHARS],
        })
    return _attach_inference({
        "kind": "json",
        "root_type": type(data).__name__,
        "preview": json.dumps(data, default=str)[:MAX_PREVIEW_CHARS],
    })


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
    return _attach_inference(summary)


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
    return _attach_inference({
        "kind": "xml",
        "root_tag": root_tag,
        "child_count": child_count,
        "preview": raw[:MAX_PREVIEW_CHARS],
    })


# ─── Text / Code ────────────────────────────────────────────────────────────

def _inspect_text_bytes(raw: str) -> Dict[str, Any]:
    lines = raw.splitlines()
    return _attach_inference({
        "kind": "text",
        "line_count": len(lines),
        "word_count": sum(len(ln.split()) for ln in lines),
        "char_count": len(raw),
        "preview": raw[:MAX_PREVIEW_CHARS],
    })


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
    return _attach_inference(summary)


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
    return _attach_inference(summary)


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
    return _attach_inference(summary)


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
    return _attach_inference(summary)


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
