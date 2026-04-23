"""
dataset_analyzer.py — Auto-detect domain, map columns, and batch predict from uploaded datasets.

Supports: CSV, Excel (XLSX/XLS), JSON (array of objects), Parquet
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from difflib import get_close_matches

import pandas as pd

from .database import save_prediction
from .logger import log_prediction

logger = logging.getLogger("dataset_analyzer")

# ─── Domain Signatures ───────────────────────────────────────────────────────────

DOMAIN_SIGNATURES = {
    "hiring": {
        "required": [
            "years_experience",
            "education_level",
            "technical_score",
            "communication_score",
        ],
        "optional": [
            "num_past_jobs",
            "certifications",
        ],
    },
    "loan": {
        "required": [
            "credit_score",
            "annual_income",
            "loan_amount",
            "loan_term_months",
        ],
        "optional": [
            "employment_years",
            "existing_debt",
            "num_credit_lines",
        ],
    },
    "social": {
        "required": [
            "avg_session_minutes",
            "topics_interacted",
            "like_rate",
            "share_rate",
        ],
        "optional": [
            "posts_per_day",
            "comment_rate",
            "account_age_days",
        ],
    },
}

# Sensitive attribute fields (for fairness monitoring)
SENSITIVE_FIELDS = ["gender", "ethnicity", "religion", "age_group"]

# ─── File Parser ─────────────────────────────────────────────────────────────────

def read_tabular_file(file_path: Path, extension: str) -> pd.DataFrame:
    """Read a tabular file based on its extension."""
    extension = extension.lower()
    
    if extension == ".csv":
        return pd.read_csv(file_path)
    elif extension in (".xlsx", ".xls"):
        return pd.read_excel(file_path, engine="openpyxl" if extension == ".xlsx" else "xlrd")
    elif extension == ".json":
        df = pd.read_json(file_path)
        if df.empty:
            # Try reading as JSON lines
            return pd.read_json(file_path, lines=True)
        return df
    elif extension == ".parquet":
        return pd.read_parquet(file_path)
    else:
        raise ValueError(f"Unsupported file extension: {extension}")


# ─── Domain Detection ───────────────────────────────────────────────────────────

def normalize_column_name(name: str) -> str:
    """Normalize a column name for fuzzy matching."""
    return str(name).strip().lower().replace("_", "").replace(" ", "").replace("-", "")


def detect_domain(df: pd.DataFrame) -> Tuple[Optional[str], float, Dict[str, str]]:
    """
    Detect the domain (hiring/loan/social) from DataFrame column names.
    Returns (domain, confidence, column_mapping).
    """
    if df.empty:
        raise ValueError("DataFrame is empty")
    
    # Normalize all column names
    normalized_cols = {normalize_column_name(col): col for col in df.columns}
    normalized_set = set(normalized_cols.keys())
    
    best_domain = None
    best_score = 0.0
    best_mapping = {}
    
    for domain, schema in DOMAIN_SIGNATURES.items():
        # Normalize schema field names
        required_normalized = [normalize_column_name(f) for f in schema["required"]]
        optional_normalized = [normalize_column_name(f) for f in schema["optional"]]
        all_schema = required_normalized + optional_normalized
        
        # Count matches
        matches = 0
        mapping = {}
        for schema_field in all_schema:
            if schema_field in normalized_set:
                matches += 1
                mapping[schema_field] = normalized_cols[schema_field]
            else:
                # Try fuzzy match
                close = get_close_matches(schema_field, normalized_set, n=1, cutoff=0.6)
                if close:
                    matches += 1
                    mapping[schema_field] = normalized_cols[close[0]]
        
        # Score: matches / total required fields (minimum threshold)
        score = matches / len(required_normalized) if required_normalized else 0
        
        if score > best_score:
            best_score = score
            best_domain = domain
            best_mapping = mapping
    
    # Threshold: need at least 40% of required fields
    if best_score >= 0.4:
        return best_domain, best_score, best_mapping
    
    return None, 0.0, {}


# ─── Row Prediction ─────────────────────────────────────────────────────────────

def build_prediction_row(
    row: pd.Series,
    mapping: Dict[str, str],
    domain: str,
) -> Dict[str, Any]:
    """Extract and map fields from a row for prediction."""
    mapped = {}
    
    # Map prediction fields
    for schema_field, df_col in mapping.items():
        value = row.get(df_col)
        if pd.isna(value):
            value = None
        mapped[schema_field] = value
    
    # Also capture sensitive attributes if present
    for sens_field in SENSITIVE_FIELDS:
        for df_col in row.index:
            if normalize_column_name(df_col) == normalize_column_name(sens_field):
                value = row.get(df_col)
                if not pd.isna(value):
                    mapped[sens_field] = value
                break
    
    return mapped


async def batch_predict(
    df: pd.DataFrame,
    domain: str,
    column_mapping: Dict[str, str],
    max_rows: int = 10000,
) -> Dict[str, Any]:
    """
    Run predictions on all rows of a DataFrame.
    Returns summary statistics and error details.
    """
    from hiring.predictor import predict as hiring_predict
    from loan.predictor import predict as loan_predict
    from social.predictor import predict as social_predict
    
    # Load model
    if domain == "hiring":
        from hiring.model_loader import get_model_ab, get_metadata
        model, variant = get_model_ab()
    elif domain == "loan":
        from loan.model_loader import get_model_ab, get_metadata
        model, variant = get_model_ab()
    elif domain == "social":
        from social.model_loader import get_model_ab, get_metadata
        model, variant = get_model_ab()
    else:
        raise ValueError(f"Unknown domain: {domain}")
    
    model_meta = get_metadata(variant)
    model_version = model_meta.get("version", "unknown")
    
    # Limit rows
    df = df.head(max_rows)
    
    results = []
    errors = []
    rows_total = len(df)
    rows_predicted = 0
    rows_failed = 0
    
    # Predict each row
    for idx, row in df.iterrows():
        try:
            features = build_prediction_row(row, column_mapping, domain)
            
            # Extract sensitive attribute
            sensitive_attr = None
            sensitive_value = None
            for sens in SENSITIVE_FIELDS:
                if sens in features:
                    sensitive_attr = sens
                    sensitive_value = str(features[sens])
                    break
            
            if domain == "hiring":
                result = hiring_predict(model, features, sensitive_attr=sensitive_attr, domain="hiring")
                prediction_label = "Hired" if result["prediction"] == 1 else "Not Hired"
            elif domain == "loan":
                result = loan_predict(model, features, sensitive_attr=sensitive_attr, domain="loan")
                prediction_label = "Approved" if result["prediction"] == 1 else "Rejected"
            else:  # social
                result = social_predict(model, features, sensitive_attr=sensitive_attr, domain="social")
                prediction_label = result.get("recommended_category", "Unknown")
            
            # Build record for storage
            log_record = {
                "domain": domain,
                "input": features,
                "prediction": result["prediction"],
                "confidence": result["confidence"],
                "prediction_label": prediction_label,
                "explanation": result.get("explanation", ""),
                "bias_risk": result.get("bias_risk", {}),
                "sensitive_value_group": sensitive_value or "unknown",
                "model_version": model_version,
                "model_variant": variant,
                "correlation_id": f"batch_{domain}_{idx}",
                "timestamp": pd.Timestamp.now().isoformat(),
            }
            
            # Save to database
            await save_prediction(log_record)
            
            results.append({
                "row": idx,
                "prediction": result["prediction"],
                "confidence": result["confidence"],
                "prediction_label": prediction_label,
                "bias_risk_score": result.get("bias_risk", {}).get("score", 0),
                "flagged": result.get("bias_risk", {}).get("flag_for_review", False),
            })
            
            rows_predicted += 1
            
        except Exception as e:
            errors.append({
                "row": idx,
                "message": str(e)[:200],
            })
            rows_failed += 1
            logger.warning(f"Row {idx} prediction failed: {e}")
    
    # Compute summary stats
    if results:
        predictions = [r["prediction"] for r in results]
        confidences = [r["confidence"] for r in results]
        flagged = [r["flagged"] for r in results]
        
        approval_rate = sum(predictions) / len(predictions) if predictions else 0
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0
        high_bias_count = sum(1 for r in results if r["bias_risk_score"] > 0.7)
        flagged_count = sum(flagged)
    else:
        approval_rate = 0
        avg_confidence = 0
        high_bias_count = 0
        flagged_count = 0
    
    # Find unmapped columns
    mapped_schema_fields = set(column_mapping.keys())
    all_schema_fields = set()
    for schema in DOMAIN_SIGNATURES[domain]["required"] + DOMAIN_SIGNATURES[domain]["optional"]:
        all_schema_fields.add(normalize_column_name(schema))
    unmapped_schema = all_schema_fields - mapped_schema_fields
    
    return {
        "rows_total": rows_total,
        "rows_predicted": rows_predicted,
        "rows_failed": rows_failed,
        "approval_rate": round(approval_rate, 4),
        "avg_confidence": round(avg_confidence, 4),
        "high_bias_risk_count": high_bias_count,
        "flagged_for_review": flagged_count,
        "errors": errors[:50],  # Limit to first 50 errors
        "unmapped_schema_fields": list(unmapped_schema),
    }


# ─── Main Analysis Entry Point ───────────────────────────────────────────────────

async def analyze_uploaded_file(
    file_id: str,
    upload_dir: Path,
    max_rows: int = 10000,
) -> Dict[str, Any]:
    """
    Analyze an uploaded file: detect domain, map columns, batch predict.
    
    Returns analysis result dict.
    """
    # Load metadata
    meta_path = upload_dir / f"{file_id}.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"File metadata not found: {file_id}")
    
    import json
    with open(meta_path) as f:
        metadata = json.load(f)
    
    stored_name = metadata.get("stored_name")
    if not stored_name:
        raise ValueError("Missing stored_name in metadata")
    
    file_path = upload_dir / stored_name
    if not file_path.exists():
        raise FileNotFoundError(f"File data not found: {stored_name}")
    
    extension = Path(stored_name).suffix.lower()
    
    # Parse file
    try:
        df = read_tabular_file(file_path, extension)
    except Exception as e:
        raise ValueError(f"Failed to parse file: {str(e)}")
    
    if df.empty:
        raise ValueError("File contains no data rows")
    
    # Detect domain
    domain, confidence, column_mapping = detect_domain(df)
    
    if not domain:
        return {
            "success": False,
            "file_id": file_id,
            "error": "Could not auto-detect domain. Ensure column names match hiring/loan/social schema.",
            "detected_domain": None,
            "confidence": 0,
            "rows_total": len(df),
        }
    
    # Batch predict
    summary = await batch_predict(df, domain, column_mapping, max_rows)
    
    return {
        "success": True,
        "file_id": file_id,
        "detected_domain": domain,
        "confidence": round(confidence, 4),
        "column_mapping": column_mapping,
        "rows_total": summary["rows_total"],
        "rows_predicted": summary["rows_predicted"],
        "rows_failed": summary["rows_failed"],
        "summary": {
            "approval_rate": summary["approval_rate"],
            "avg_confidence": summary["avg_confidence"],
            "high_bias_risk_count": summary["high_bias_risk_count"],
            "flagged_for_review": summary["flagged_for_review"],
        },
        "errors": summary["errors"],
        "unmapped_columns": summary["unmapped_schema_fields"],
    }
