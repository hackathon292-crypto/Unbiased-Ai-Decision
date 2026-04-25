"""
dataset_analyzer.py - end-to-end scan pipeline for uploaded datasets/models.

Responsibilities:
  - Read uploaded tabular datasets (CSV, Excel, JSON, Parquet, ODS)
  - Detect the most likely domain (hiring / loan / social)
  - Load either an uploaded model (.pkl / .joblib) or the built-in domain model
  - Validate dataset quality (missing values, duplicates, outliers, schema issues)
  - Run batch predictions and persist them for dashboard/reporting updates
  - Evaluate model performance/fairness when labels and sensitive attributes exist
  - Generate a final audit report with Bias/Fairness/Performance/Risk scores
"""

from __future__ import annotations

import json
import logging
import pickle
from dataclasses import dataclass
from difflib import get_close_matches
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)

from fairness.checker import run_fairness_check
from .database import save_prediction

logger = logging.getLogger("dataset_analyzer")


DOMAIN_SIGNATURES: Dict[str, Dict[str, List[str]]] = {
    "hiring": {
        "required": [
            "years_experience",
            "education_level",
            "technical_score",
            "communication_score",
        ],
        "optional": ["num_past_jobs", "certifications"],
        "target_candidates": ["label", "target", "ground_truth", "hired", "decision", "outcome"],
    },
    "loan": {
        "required": [
            "credit_score",
            "annual_income",
            "loan_amount",
            "loan_term_months",
        ],
        "optional": ["employment_years", "existing_debt", "num_credit_lines"],
        "target_candidates": ["label", "target", "ground_truth", "approved", "loan_approved", "decision", "outcome"],
    },
    "social": {
        "required": [
            "avg_session_minutes",
            "topics_interacted",
            "like_rate",
            "share_rate",
        ],
        "optional": ["posts_per_day", "comment_rate", "account_age_days"],
        "target_candidates": [
            "label",
            "target",
            "ground_truth",
            "recommended_category_id",
            "recommended_category",
            "category",
            "engagement_label",
        ],
    },
}

DEFAULT_FEATURE_VALUES: Dict[str, Dict[str, float]] = {
    "hiring": {
        "years_experience": 0.0,
        "education_level": 1.0,
        "technical_score": 0.0,
        "communication_score": 0.0,
        "num_past_jobs": 0.0,
        "certifications": 0.0,
    },
    "loan": {
        "credit_score": 0.0,
        "annual_income": 0.0,
        "loan_amount": 0.0,
        "loan_term_months": 0.0,
        "employment_years": 0.0,
        "existing_debt": 0.0,
        "num_credit_lines": 0.0,
    },
    "social": {
        "avg_session_minutes": 0.0,
        "posts_per_day": 0.0,
        "topics_interacted": 0.0,
        "like_rate": 0.0,
        "share_rate": 0.0,
        "comment_rate": 0.0,
        "account_age_days": 0.0,
    },
}

MODEL_EXTENSIONS = {".pkl", ".joblib"}
DATA_EXTENSIONS = {".csv", ".xlsx", ".xls", ".json", ".parquet", ".ods"}
SENSITIVE_FIELDS = ["gender", "ethnicity", "religion", "age_group", "age", "location", "language", "region"]


@dataclass
class ModelSelection:
    model: Any
    variant: str
    version: str
    source: str
    path: Optional[str] = None
    filename: Optional[str] = None


def normalize_column_name(name: str) -> str:
    return str(name).strip().lower().replace("_", "").replace(" ", "").replace("-", "")


def read_tabular_file(file_path: Path, extension: str) -> pd.DataFrame:
    extension = extension.lower()

    if extension == ".csv":
        return pd.read_csv(file_path)
    if extension in (".xlsx", ".xls"):
        return pd.read_excel(file_path)
    if extension == ".json":
        try:
            raw = json.loads(file_path.read_text(encoding="utf-8", errors="replace"))
            if isinstance(raw, list):
                return pd.DataFrame(raw)
            if isinstance(raw, dict):
                for candidate in ("data", "records", "items", "rows"):
                    if isinstance(raw.get(candidate), list):
                        return pd.DataFrame(raw[candidate])
                return pd.json_normalize(raw)
        except Exception:
            pass
        try:
            return pd.read_json(file_path)
        except ValueError:
            return pd.read_json(file_path, lines=True)
    if extension == ".parquet":
        return pd.read_parquet(file_path)
    if extension == ".ods":
        return pd.read_excel(file_path, engine="odf")

    raise ValueError(f"Unsupported file extension: {extension}")


def detect_domain(df: pd.DataFrame) -> Tuple[Optional[str], float, Dict[str, str]]:
    if df.empty:
        raise ValueError("DataFrame is empty")

    normalized_cols = {normalize_column_name(col): str(col) for col in df.columns}
    normalized_set = set(normalized_cols.keys())

    best_domain: Optional[str] = None
    best_score = 0.0
    best_mapping: Dict[str, str] = {}

    for domain, schema in DOMAIN_SIGNATURES.items():
        required = list(schema["required"])
        optional = list(schema["optional"])
        all_fields = required + optional
        matches = 0
        mapping: Dict[str, str] = {}

        for canonical in all_fields:
            norm = normalize_column_name(canonical)
            if norm in normalized_set:
                mapping[canonical] = normalized_cols[norm]
                matches += 1
                continue

            close = get_close_matches(norm, list(normalized_set), n=1, cutoff=0.72)
            if close:
                mapping[canonical] = normalized_cols[close[0]]
                matches += 1

        score = matches / max(1, len(required))
        if score > best_score:
            best_score = score
            best_domain = domain
            best_mapping = mapping

    if best_score >= 0.75:
        return best_domain, best_score, best_mapping
    if best_score >= 0.4:
        return best_domain, best_score, best_mapping
    return None, 0.0, {}


def _find_matching_column(columns: List[str], candidates: List[str]) -> Optional[str]:
    normalized = {normalize_column_name(col): col for col in columns}
    for candidate in candidates:
        norm = normalize_column_name(candidate)
        if norm in normalized:
            return normalized[norm]
    return None


def detect_target_column(df: pd.DataFrame, domain: str) -> Optional[str]:
    if domain not in DOMAIN_SIGNATURES:
        return None

    target = _find_matching_column(list(df.columns), DOMAIN_SIGNATURES[domain]["target_candidates"])
    if target:
        return target

    generic_candidates = ["label", "target", "ground_truth", "y", "class", "prediction_label"]
    return _find_matching_column(list(df.columns), generic_candidates)


def detect_sensitive_columns(df: pd.DataFrame) -> Dict[str, str]:
    found: Dict[str, str] = {}
    normalized = {normalize_column_name(col): str(col) for col in df.columns}
    for candidate in SENSITIVE_FIELDS:
        norm = normalize_column_name(candidate)
        if norm in normalized:
            found[candidate] = normalized[norm]
    return found


def _coerce_labels(series: pd.Series, domain: str) -> Optional[List[int]]:
    clean = series.dropna()
    if clean.empty:
        return None

    if pd.api.types.is_numeric_dtype(clean):
        return pd.to_numeric(series, errors="coerce").fillna(-1).astype(int).tolist()

    text = clean.astype(str).str.strip().str.lower()
    if domain in {"hiring", "loan"}:
        mapper = {
            "1": 1, "0": 0, "true": 1, "false": 0, "yes": 1, "no": 0,
            "approved": 1, "rejected": 0, "hired": 1, "not hired": 0,
            "accept": 1, "reject": 0,
        }
        mapped = series.astype(str).str.strip().str.lower().map(mapper)
        if mapped.notna().sum() == 0:
            return None
        return mapped.fillna(-1).astype(int).tolist()

    categories = {value: idx for idx, value in enumerate(sorted(text.unique().tolist()))}
    return series.astype(str).str.strip().str.lower().map(categories).fillna(-1).astype(int).tolist()


def _infer_domain_from_name(name: Optional[str]) -> Optional[str]:
    lowered = (name or "").lower()
    for domain in DOMAIN_SIGNATURES:
        if domain in lowered:
            return domain
    if "hire" in lowered:
        return "hiring"
    if "loan" in lowered or "credit" in lowered:
        return "loan"
    if "social" in lowered or "recommend" in lowered:
        return "social"
    return None


def _infer_domain_from_model(model: Any) -> Optional[str]:
    n_features = getattr(model, "n_features_in_", None)
    if n_features is None:
        return None
    matches = [domain for domain, defaults in DEFAULT_FEATURE_VALUES.items() if len(defaults) == int(n_features)]
    return matches[0] if len(matches) == 1 else None


def load_uploaded_model(model_path: Path) -> Any:
    if model_path.suffix.lower() == ".joblib":
        return joblib.load(model_path)
    if model_path.suffix.lower() == ".pkl":
        try:
            return joblib.load(model_path)
        except Exception:
            with open(model_path, "rb") as handle:
                return pickle.load(handle)
    raise ValueError(f"Unsupported model file: {model_path.name}")


def select_model_for_domain(
    domain: str,
    upload_dir: Path,
    preferred_model_file: Optional[Dict[str, Any]] = None,
) -> ModelSelection:
    if preferred_model_file:
        model_path = upload_dir / preferred_model_file["stored_name"]
        model = load_uploaded_model(model_path)
        if not hasattr(model, "predict"):
            raise ValueError(f"Uploaded model '{preferred_model_file['filename']}' does not expose predict().")
        version = f"uploaded:{preferred_model_file['id'][:12]}"
        return ModelSelection(
            model=model,
            variant="uploaded",
            version=version,
            source="uploaded",
            path=str(model_path),
            filename=preferred_model_file.get("filename"),
        )

    if domain == "hiring":
        from hiring.model_loader import MODEL_PATH, get_model_ab, get_metadata
    elif domain == "loan":
        from loan.model_loader import MODEL_PATH, get_model_ab, get_metadata
    elif domain == "social":
        from social.model_loader import MODEL_PATH, get_model_ab, get_metadata
    else:
        raise ValueError(f"Unknown domain: {domain}")

    try:
        model, variant = get_model_ab()
        metadata = get_metadata(variant)
    except KeyError:
        model = load_uploaded_model(MODEL_PATH)
        variant = "primary"
        metadata = {"version": f"disk:{MODEL_PATH.name}", "filename": MODEL_PATH.name}

    return ModelSelection(
        model=model,
        variant=variant,
        version=str(metadata.get("version", "unknown")),
        source="built_in",
        filename=metadata.get("filename"),
    )


def choose_best_model_file(
    model_files: List[Dict[str, Any]],
    domain: str,
    upload_dir: Path,
) -> Optional[Dict[str, Any]]:
    if not model_files:
        return None

    scored: List[Tuple[int, Dict[str, Any]]] = []
    for metadata in model_files:
        score = 0
        inferred_domain = (
            metadata.get("domain")
            or _infer_domain_from_name(metadata.get("filename"))
            or _infer_domain_from_name(metadata.get("description"))
        )
        if inferred_domain == domain:
            score += 100

        model_path = upload_dir / metadata["stored_name"]
        try:
            model = load_uploaded_model(model_path)
            inferred_from_model = _infer_domain_from_model(model)
            if inferred_from_model == domain:
                score += 50
        except Exception as exc:
            logger.warning("Uploaded model '%s' could not be loaded during selection: %s", metadata.get("filename"), exc)
            score -= 1000

        scored.append((score, metadata))

    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[0][1] if scored and scored[0][0] > -100 else None


def build_feature_row(row: pd.Series, mapping: Dict[str, str], domain: str) -> Dict[str, Any]:
    defaults = DEFAULT_FEATURE_VALUES[domain]
    feature_row: Dict[str, Any] = {}
    for feature, default in defaults.items():
        source_col = mapping.get(feature)
        value = row.get(source_col) if source_col else default
        if pd.isna(value):
            value = default
        feature_row[feature] = value

    for sensitive_name, source_col in detect_sensitive_columns(pd.DataFrame([row])).items():
        value = row.get(source_col)
        if pd.notna(value):
            feature_row[sensitive_name] = value

    return feature_row


def _prepare_feature_frame(df: pd.DataFrame, mapping: Dict[str, str], domain: str) -> pd.DataFrame:
    prepared: Dict[str, pd.Series] = {}
    for feature, default in DEFAULT_FEATURE_VALUES[domain].items():
        source_col = mapping.get(feature)
        if source_col and source_col in df.columns:
            prepared[feature] = pd.to_numeric(df[source_col], errors="coerce").fillna(default)
        else:
            prepared[feature] = pd.Series([default] * len(df), index=df.index, dtype="float64")
    return pd.DataFrame(prepared)


def validate_dataset(
    df: pd.DataFrame,
    domain: str,
    column_mapping: Dict[str, str],
) -> Dict[str, Any]:
    rows = int(len(df))
    duplicate_rows = int(df.duplicated().sum())
    missing_by_column = {str(col): int(df[col].isna().sum()) for col in df.columns if int(df[col].isna().sum()) > 0}
    total_missing = int(sum(missing_by_column.values()))

    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    outlier_columns: Dict[str, int] = {}
    for col in numeric_cols:
        series = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(series) < 4:
            continue
        q1 = float(series.quantile(0.25))
        q3 = float(series.quantile(0.75))
        iqr = q3 - q1
        if iqr <= 0:
            continue
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        count = int(((series < lower) | (series > upper)).sum())
        if count > 0:
            outlier_columns[str(col)] = count

    required_fields = set(DOMAIN_SIGNATURES[domain]["required"])
    mapped_fields = set(column_mapping.keys())
    missing_required = sorted(required_fields - mapped_fields)

    normalized_columns = [normalize_column_name(col) for col in df.columns]
    duplicate_columns = sorted({
        str(df.columns[idx]) for idx, norm in enumerate(normalized_columns) if normalized_columns.count(norm) > 1
    })

    schema_issues: List[str] = []
    if missing_required:
        schema_issues.append(f"Missing required fields: {', '.join(missing_required)}")
    if duplicate_columns:
        schema_issues.append(f"Ambiguous / duplicate columns after normalization: {', '.join(duplicate_columns)}")

    return {
        "rows": rows,
        "columns": int(len(df.columns)),
        "missing_values": {
            "total": total_missing,
            "percent": round((total_missing / max(1, rows * max(1, len(df.columns)))) * 100, 2),
            "by_column": missing_by_column,
        },
        "duplicates": {
            "rows": duplicate_rows,
            "percent": round((duplicate_rows / max(1, rows)) * 100, 2),
        },
        "outliers": {
            "columns_flagged": len(outlier_columns),
            "total": int(sum(outlier_columns.values())),
            "by_column": outlier_columns,
        },
        "schema_issues": schema_issues,
    }


def _calculate_robustness(model: Any, feature_df: pd.DataFrame) -> Optional[float]:
    if feature_df.empty or len(feature_df) < 2 or not hasattr(model, "predict"):
        return None

    try:
        baseline = np.asarray(model.predict(feature_df.values))
        numeric = feature_df.astype(float).copy()
        scales = numeric.std(ddof=0).replace(0, 1.0).values
        noise = np.random.default_rng(7).normal(loc=0.0, scale=np.maximum(scales * 0.01, 0.01), size=numeric.shape)
        perturbed = numeric.values + noise
        perturbed_pred = np.asarray(model.predict(perturbed))
        stable_rate = float(np.mean(baseline == perturbed_pred))
        return round(stable_rate, 4)
    except Exception as exc:
        logger.warning("Robustness calculation failed: %s", exc)
        return None


def _compute_confidences(model: Any, features: np.ndarray, predictions: List[int]) -> List[float]:
    if hasattr(model, "predict_proba"):
        try:
            proba = model.predict_proba(features)
            if getattr(proba, "ndim", 0) == 2:
                if proba.shape[1] == 2:
                    return [round(float(row[1]), 4) for row in proba]
                return [round(float(np.max(row)), 4) for row in proba]
        except Exception as exc:
            logger.warning("predict_proba failed during batch scan: %s", exc)
    return [0.5 for _ in predictions]


def _performance_report(
    domain: str,
    y_true: Optional[List[int]],
    y_pred: List[int],
    y_prob: List[float],
    robustness: Optional[float],
) -> Dict[str, Any]:
    task_average = "binary" if domain in {"hiring", "loan"} else "weighted"
    report: Dict[str, Any] = {
        "accuracy": None,
        "precision": None,
        "recall": None,
        "f1": None,
        "confusion_matrix": None,
        "robustness": robustness,
        "labelled_rows": 0,
    }

    if not y_true:
        return report

    valid_pairs = [(truth, pred) for truth, pred in zip(y_true, y_pred) if truth != -1]
    if not valid_pairs:
        return report

    y_true_valid = [truth for truth, _ in valid_pairs]
    y_pred_valid = [pred for _, pred in valid_pairs]
    report["labelled_rows"] = len(y_true_valid)

    try:
        report["accuracy"] = round(float(accuracy_score(y_true_valid, y_pred_valid)), 4)
        report["precision"] = round(float(precision_score(y_true_valid, y_pred_valid, average=task_average, zero_division=0)), 4)
        report["recall"] = round(float(recall_score(y_true_valid, y_pred_valid, average=task_average, zero_division=0)), 4)
        report["f1"] = round(float(f1_score(y_true_valid, y_pred_valid, average=task_average, zero_division=0)), 4)
        labels = sorted(set(y_true_valid) | set(y_pred_valid))
        report["confusion_matrix"] = confusion_matrix(y_true_valid, y_pred_valid, labels=labels).tolist()
        report["labels"] = labels
    except Exception as exc:
        logger.warning("Performance metrics failed: %s", exc)

    return report


def _fairness_report(
    domain: str,
    df: pd.DataFrame,
    predictions: List[int],
    y_true: Optional[List[int]],
    sensitive_columns: Dict[str, str],
) -> Dict[str, Any]:
    class_balance_values = [value for value in (y_true or predictions) if value != -1]
    class_counts = pd.Series(class_balance_values).value_counts().to_dict() if class_balance_values else {}
    majority = max(class_counts.values()) if class_counts else 0
    minority = min(class_counts.values()) if class_counts else 0
    imbalance_ratio = round((minority / majority), 4) if majority else None

    attributes: List[Dict[str, Any]] = []
    max_bias_gap = 0.0
    min_disparate_impact = 1.0
    flagged_attributes = 0

    for attr_name, column_name in sensitive_columns.items():
        groups: Dict[str, Dict[str, Any]] = {}
        for pos, group_value in enumerate(df[column_name].fillna("unknown").astype(str).tolist()):
            groups.setdefault(group_value, {"n": 0, "positive": 0, "label_pairs": []})
            groups[group_value]["n"] += 1
            pred_value = int(predictions[pos]) if pos < len(predictions) else 0
            truth_value = int(y_true[pos]) if y_true and pos < len(y_true) else -1
            groups[group_value]["positive"] += int(pred_value == 1)
            if truth_value != -1:
                groups[group_value]["label_pairs"].append((truth_value, pred_value))

        positive_rates = {
            group: round(stats["positive"] / max(1, stats["n"]), 4)
            for group, stats in groups.items()
        }
        if positive_rates:
            rates = list(positive_rates.values())
            statistical_parity = round(max(rates) - min(rates), 4)
            disparate_impact = round((min(rates) / max(rates)), 4) if max(rates) > 0 else None
        else:
            statistical_parity = 0.0
            disparate_impact = None

        equal_opportunity = None
        valid_true_groups = {}
        if y_true and domain in {"hiring", "loan"}:
            for group, stats in groups.items():
                truths = [truth for truth, _ in stats["label_pairs"]]
                preds = [pred for _, pred in stats["label_pairs"]]
                positives = sum(1 for truth in truths if truth == 1)
                if positives:
                    tpr = sum(1 for truth, pred in zip(truths, preds) if truth == 1 and pred == 1) / positives
                    valid_true_groups[group] = round(tpr, 4)
            if len(valid_true_groups) >= 2:
                equal_opportunity = round(max(valid_true_groups.values()) - min(valid_true_groups.values()), 4)

        flagged = statistical_parity > 0.10 or (disparate_impact is not None and disparate_impact < 0.80)
        if flagged:
            flagged_attributes += 1
        max_bias_gap = max(max_bias_gap, statistical_parity)
        if disparate_impact is not None:
            min_disparate_impact = min(min_disparate_impact, disparate_impact)

        attributes.append({
            "attribute": attr_name,
            "column": column_name,
            "groups": [
                {
                    "group": group,
                    "n": stats["n"],
                    "positive_rate": positive_rates.get(group, 0.0),
                }
                for group, stats in groups.items()
            ],
            "statistical_parity_difference": statistical_parity,
            "disparate_impact": disparate_impact,
            "equal_opportunity_difference": equal_opportunity,
            "flagged": flagged,
        })

    if min_disparate_impact == 1.0 and not attributes:
        min_disparate_impact = None

    return {
        "attributes": attributes,
        "class_imbalance": {
            "counts": class_counts,
            "imbalance_ratio": imbalance_ratio,
            "flagged": imbalance_ratio is not None and imbalance_ratio < 0.80,
        },
        "overall": {
            "max_statistical_parity_difference": round(max_bias_gap, 4),
            "min_disparate_impact": min_disparate_impact,
            "flagged_attribute_count": flagged_attributes,
        },
    }


def _score_report(
    validation: Dict[str, Any],
    performance: Dict[str, Any],
    fairness: Dict[str, Any],
) -> Dict[str, Any]:
    max_spd = float(fairness["overall"].get("max_statistical_parity_difference") or 0.0)
    min_di = fairness["overall"].get("min_disparate_impact")
    imbalance_ratio = fairness["class_imbalance"].get("imbalance_ratio")

    bias_score = max(
        0.0,
        100.0
        - max_spd * 250.0
        - max(0.0, (0.8 - float(min_di)) * 100.0 if min_di is not None else 0.0),
    )
    if imbalance_ratio is not None and imbalance_ratio < 0.80:
        bias_score -= (0.80 - imbalance_ratio) * 40.0
    bias_score = round(max(0.0, min(100.0, bias_score)), 2)

    fairness_score = round(
        max(
            0.0,
            min(
                100.0,
                100.0
                - max_spd * 220.0
                - max(0.0, (0.8 - float(min_di)) * 120.0 if min_di is not None else 0.0)
                - (15.0 if fairness["overall"]["flagged_attribute_count"] else 0.0),
            ),
        ),
        2,
    )

    performance_components = [
        performance.get("accuracy"),
        performance.get("precision"),
        performance.get("recall"),
        performance.get("f1"),
        performance.get("robustness"),
    ]
    numeric_perf = [float(value) for value in performance_components if value is not None]
    performance_score = round((sum(numeric_perf) / len(numeric_perf) * 100.0), 2) if numeric_perf else 50.0

    risk_penalty = 0.0
    risk_penalty += min(25.0, validation["missing_values"]["percent"] * 0.7)
    risk_penalty += min(20.0, validation["duplicates"]["percent"] * 1.2)
    risk_penalty += min(20.0, len(validation["schema_issues"]) * 8.0)
    risk_penalty += min(20.0, max(0.0, 85.0 - fairness_score) * 0.25)
    risk_penalty += min(15.0, max(0.0, 80.0 - performance_score) * 0.2)
    risk_score = round(max(0.0, min(100.0, 20.0 + risk_penalty)), 2)

    if fairness_score >= 80 and performance_score >= 75 and risk_score <= 40:
        recommendation = "Accept"
    elif fairness_score < 60 or performance_score < 55 or risk_score >= 70:
        recommendation = "Reject"
    else:
        recommendation = "Retrain"

    return {
        "bias_score": bias_score,
        "fairness_score": fairness_score,
        "performance_score": round(performance_score, 2),
        "risk_score": risk_score,
        "final_recommendation": recommendation,
    }


async def batch_predict(
    df: pd.DataFrame,
    domain: str,
    column_mapping: Dict[str, str],
    upload_dir: Path,
    model_file: Optional[Dict[str, Any]] = None,
    max_rows: int = 10000,
) -> Dict[str, Any]:
    from hiring.predictor import predict as hiring_predict
    from loan.predictor import predict as loan_predict
    from social.predictor import predict as social_predict

    predictors = {
        "hiring": hiring_predict,
        "loan": loan_predict,
        "social": social_predict,
    }
    prediction_labels = {
        "hiring": ("Hired", "Not Hired"),
        "loan": ("Approved", "Rejected"),
    }

    selection = select_model_for_domain(domain, upload_dir, preferred_model_file=model_file)
    predictor = predictors[domain]

    target_column = detect_target_column(df, domain)
    sensitive_columns = detect_sensitive_columns(df)
    validation = validate_dataset(df, domain, column_mapping)

    working_df = df.head(max_rows).copy()
    features_df = _prepare_feature_frame(working_df, column_mapping, domain)
    y_true = _coerce_labels(working_df[target_column], domain) if target_column and target_column in working_df.columns else None

    results: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    predictions: List[int] = []
    confidences: List[float] = []
    sensitive_groups_for_rows: List[str] = []

    for pos, (idx, row) in enumerate(working_df.iterrows()):
        try:
            features = build_feature_row(row, column_mapping, domain)

            sensitive_attr = next(iter(sensitive_columns.keys()), None)
            sensitive_value = None
            if sensitive_attr:
                source_col = sensitive_columns[sensitive_attr]
                raw_sensitive = row.get(source_col)
                sensitive_value = "unknown" if pd.isna(raw_sensitive) else str(raw_sensitive)

            result = predictor(selection.model, features, sensitive_attr=sensitive_attr, domain=domain)
            prediction = int(result["prediction"])
            confidence = float(result["confidence"])

            if domain == "social":
                prediction_label = str(result.get("category_label", f"Category {prediction}"))
            else:
                positive_label, negative_label = prediction_labels[domain]
                prediction_label = positive_label if prediction == 1 else negative_label

            fairness_record = run_fairness_check(
                prediction=prediction,
                sensitive_attr=sensitive_attr or "not_provided",
                sensitive_value=sensitive_value or "unknown",
                domain=domain,
            )

            ground_truth = None
            if y_true and pos < len(y_true) and y_true[pos] != -1:
                ground_truth = int(y_true[pos])

            log_record = {
                "domain": domain,
                "input": features,
                "prediction": prediction,
                "confidence": confidence,
                "prediction_label": prediction_label,
                "explanation": result.get("explanation", ""),
                "bias_risk": result.get("bias_risk", {}),
                "fairness": fairness_record,
                "sensitive_value_group": sensitive_value or "unknown",
                "model_version": selection.version,
                "model_variant": selection.variant,
                "model_source": selection.source,
                "correlation_id": f"batch_{domain}_{idx}",
                "ground_truth": ground_truth,
            }
            await save_prediction(log_record)

            results.append({
                "row": int(idx) if isinstance(idx, (int, np.integer)) else pos,
                "prediction": prediction,
                "confidence": round(confidence, 4),
                "prediction_label": prediction_label,
                "bias_risk_score": float(result.get("bias_risk", {}).get("score", 0.0)),
                "flagged": bool(result.get("bias_risk", {}).get("flag_for_review", False)),
                "ground_truth": ground_truth,
            })
            predictions.append(prediction)
            confidences.append(round(confidence, 4))
            sensitive_groups_for_rows.append(sensitive_value or "unknown")
        except Exception as exc:
            errors.append({
                "row": int(idx) if isinstance(idx, (int, np.integer)) else pos,
                "message": str(exc)[:200],
            })
            logger.warning("Row %s prediction failed: %s", idx, exc)

    if not confidences:
        confidences = _compute_confidences(selection.model, features_df.values, predictions)

    fairness = _fairness_report(domain, working_df, predictions, y_true, sensitive_columns)
    robustness = _calculate_robustness(selection.model, features_df)
    performance = _performance_report(domain, y_true, predictions, confidences, robustness)
    scores = _score_report(validation, performance, fairness)

    rows_total = int(len(working_df))
    rows_predicted = int(len(results))
    rows_failed = int(len(errors))
    approval_rate = round(sum(predictions) / len(predictions), 4) if predictions else 0.0
    avg_confidence = round(sum(confidences) / len(confidences), 4) if confidences else 0.0
    high_bias_count = sum(1 for item in results if item["bias_risk_score"] >= 0.5)
    flagged_count = sum(1 for item in results if item["flagged"])

    final_report = {
        "validation": validation,
        "model": {
            "source": selection.source,
            "variant": selection.variant,
            "version": selection.version,
            "filename": selection.filename,
            "path": selection.path,
        },
        "performance": performance,
        "fairness": fairness,
        "scores": scores,
    }

    return {
        "rows_total": rows_total,
        "rows_predicted": rows_predicted,
        "rows_failed": rows_failed,
        "approval_rate": approval_rate,
        "avg_confidence": avg_confidence,
        "high_bias_risk_count": high_bias_count,
        "flagged_for_review": flagged_count,
        "errors": errors[:50],
        "results_preview": results[:25],
        "target_column": target_column,
        "sensitive_columns": sensitive_columns,
        "unmapped_schema_fields": sorted(set(DEFAULT_FEATURE_VALUES[domain].keys()) - set(column_mapping.keys())),
        "final_report": final_report,
    }


async def analyze_uploaded_file(
    file_id: str,
    upload_dir: Path,
    max_rows: int = 10000,
    model_file: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    meta_path = upload_dir / f"{file_id}.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"File metadata not found: {file_id}")

    with open(meta_path, "r", encoding="utf-8") as handle:
        metadata = json.load(handle)

    stored_name = metadata.get("stored_name")
    if not stored_name:
        raise ValueError("Missing stored_name in metadata")

    file_path = upload_dir / stored_name
    if not file_path.exists():
        raise FileNotFoundError(f"File data not found: {stored_name}")

    extension = Path(stored_name).suffix.lower()
    try:
        df = read_tabular_file(file_path, extension)
    except Exception as exc:
        raise ValueError(f"Failed to parse file: {exc}") from exc

    if df.empty:
        raise ValueError("File contains no data rows")

    domain, confidence, column_mapping = detect_domain(df)
    if not domain:
        return {
            "success": False,
            "file_id": file_id,
            "error": "Could not auto-detect domain. Ensure column names match hiring / loan / social schema.",
            "detected_domain": None,
            "confidence": 0.0,
            "rows_total": int(len(df)),
            "rows_predicted": 0,
            "rows_failed": 0,
            "errors": [],
        }

    summary = await batch_predict(
        df=df,
        domain=domain,
        column_mapping=column_mapping,
        upload_dir=upload_dir,
        model_file=model_file,
        max_rows=max_rows,
    )

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
        "validation": summary["final_report"]["validation"],
        "performance": summary["final_report"]["performance"],
        "fairness": summary["final_report"]["fairness"],
        "scores": summary["final_report"]["scores"],
        "report": summary["final_report"],
        "target_column": summary["target_column"],
        "sensitive_columns": summary["sensitive_columns"],
        "model": summary["final_report"]["model"],
        "errors": summary["errors"],
        "unmapped_columns": summary["unmapped_schema_fields"],
        "results_preview": summary["results_preview"],
    }
