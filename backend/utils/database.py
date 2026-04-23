"""
utils/database.py

Database integration (MongoDB / JSON fallback) + pre-processing pipeline.

─────────────────────────────────────────────────────────────────────────────
PRE-PROCESSING PIPELINE  (Phase 2)
─────────────────────────────────────────────────────────────────────────────

preprocess_features(features, sensitive_attr, sensitive_value, domain)
    Detects and neutralises correlations between the submitted sensitive
    attribute and every numeric objective feature before the feature dict is
    passed to the prediction model.

Algorithm
---------

1.  History retrieval
    Pulls up to 500 stored prediction records for this domain.  Records are
    expected to include an anonymised "sensitive_value_group" field (stored
    at write time alongside the fairness sub-dict, never containing raw PII).

2.  Correlation detection
    For each numeric feature, compute Pearson r between the population of
    historical feature values and the binary group indicator
    (1 if record.sensitive_value_group == current_value, else 0).
    Features with |r| > CORRELATION_THRESHOLD (default 0.15) are flagged.

3.  Orthogonal projection / residualisation
    For flagged features, subtract the component linearly predictable from
    the sensitive group indicator using OLS residualisation.  At inference
    time (a single incoming sample) the correction applied is:

        x_clean = x_raw − r × (σ_x / σ_g) × (g_indicator − ḡ)

    where r, σ_x, σ_g, ḡ are all estimated from historical data.
    The correction is capped at ±5 % of the raw value to prevent
    over-correction on sparse or noisy histories.

4.  Cold-start fallback
    When fewer than MIN_HISTORY (10) qualifying records exist, the function
    returns raw features unchanged with a clear explanatory message.

Return value (always safe to use — never raises)
-------------------------------------------------
{
    "features":             dict,    # cleaned feature dict (same keys)
    "correlation_report":   {
        feature_name: {
            "original_value": float,
            "cleaned_value":  float,
            "pearson_r":      float,
            "was_adjusted":   bool,
        }, ...
    },
    "sensitive_attr":       str | None,
    "sensitive_value":      str | None,
    "sufficient_history":   bool,
    "records_used":         int,
    "message":              str,
}

─────────────────────────────────────────────────────────────────────────────
ETHICAL NOTE
─────────────────────────────────────────────────────────────────────────────
The sensitive attribute is used ONLY to estimate and remove spurious
correlations.  It is never forwarded to the prediction model and is stored
only as an anonymised group label (not linked to an individual record).
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("database")

# ─── Pre-processing configuration ────────────────────────────────────────────

# Minimum qualifying records before correlation estimation is attempted.
MIN_HISTORY: int = 10

# |Pearson r| threshold above which a feature is adjusted.
CORRELATION_THRESHOLD: float = 0.15

# Maximum fractional correction applied to any single feature value.
MAX_CORRECTION_FRACTION: float = 0.05

# ─── Storage configuration ────────────────────────────────────────────────────

JSON_LOG_PATH = Path("predictions.json")

try:
    from motor.motor_asyncio import AsyncIOMotorClient
    MOTOR_AVAILABLE = True
except ImportError:
    MOTOR_AVAILABLE = False
    logger.warning("Motor not installed — using JSON fallback for storage.")

_client: Any = None
_db: Any = None

# ═════════════════════════════════════════════════════════════════════════════
# PUBLIC: PRE-PROCESSING PIPELINE
# ═════════════════════════════════════════════════════════════════════════════

async def preprocess_features(
    features:        Dict[str, Any],
    sensitive_attr:  Optional[str],
    sensitive_value: Optional[str],
    domain:          str,
) -> Dict[str, Any]:
    """
    Detect and neutralise correlations between *sensitive_value* and every
    numeric feature in *features* using historical predictions as the reference
    population.

    Parameters
    ----------
    features        : Raw prediction feature dict — no sensitive attributes.
    sensitive_attr  : Name of the sensitive attribute (e.g. "gender").
    sensitive_value : Value for this request  (e.g. "female").
    domain          : Domain name used to query the historical record store.

    Returns
    -------
    Preprocessing report dict.  The ``"features"`` key always contains a safe
    feature dict to pass to the model — callers must use it instead of the
    original *features* argument.
    """
    if not sensitive_attr or not sensitive_value:
        return _no_op_report(
            features, sensitive_attr, sensitive_value,
            reason="No sensitive attribute provided — features passed through unchanged.",
        )

    history: List[dict] = await get_recent_predictions(domain, limit=500)

    if len(history) < MIN_HISTORY:
        return _no_op_report(
            features, sensitive_attr, sensitive_value,
            reason=(
                f"Insufficient history ({len(history)} records, "
                f"minimum {MIN_HISTORY}) — cold-start passthrough."
            ),
            records_used=len(history),
        )

    # Build aligned population arrays
    g_vec, feature_matrix, feat_names, feature_stds = _build_population_arrays(
        history, sensitive_attr, sensitive_value, features
    )

    if g_vec is None or feature_matrix is None or feature_stds is None or len(g_vec) < MIN_HISTORY:
        return _no_op_report(
            features, sensitive_attr, sensitive_value,
            reason="Insufficient records for this sensitive-attribute dimension — passthrough.",
            records_used=len(history),
        )

    # Estimate per-feature Pearson correlations with the group indicator
    correlations = _pearson_correlations(g_vec, feature_matrix, feat_names)

    # Per-feature std-dev map (for the correct residualisation formula)
    std_map: Dict[str, float] = {
        name: float(feature_stds[i]) for i, name in enumerate(feat_names)
    }

    # Apply residualisation to correlated features
    cleaned_features, correlation_report = _neutralise(
        features, correlations, g_vec, std_map,
    )

    n_adjusted = sum(1 for r in correlation_report.values() if r["was_adjusted"])
    logger.info(
        f"[preprocess/{domain}] {n_adjusted}/{len(feat_names)} features adjusted  "
        f"sensitive_attr={sensitive_attr}  records_used={len(g_vec)}"
    )

    return {
        "features":           cleaned_features,
        "correlation_report": correlation_report,
        "sensitive_attr":     sensitive_attr,
        "sensitive_value":    sensitive_value,
        "sufficient_history": True,
        "records_used":       len(g_vec),
        "message": (
            f"{n_adjusted} feature(s) adjusted to remove linear correlation "
            f"with '{sensitive_attr}' (threshold |r| > {CORRELATION_THRESHOLD})."
        ),
    }


# ═════════════════════════════════════════════════════════════════════════════
# PUBLIC: DATABASE OPERATIONS
# ═════════════════════════════════════════════════════════════════════════════

def get_database() -> Any:
    """
    Return the MongoDB Motor database instance, or None for JSON fallback.
    Lazy-initialised — the Motor client is created at most once per process.
    """
    global _client, _db

    mongo_url = os.getenv("MONGO_URL", "")
    if not mongo_url or not MOTOR_AVAILABLE:
        return None

    if _client is None:
        _client = AsyncIOMotorClient(
            mongo_url,
            # Connection-pool tuning for concurrent async workloads
            maxPoolSize          = 20,
            minPoolSize          = 2,
            maxIdleTimeMS        = 30_000,
            serverSelectionTimeoutMS = 5_000,
            connectTimeoutMS     = 3_000,
            socketTimeoutMS      = 10_000,
        )
        _db = _client["unbiased_ai"]

    return _db


async def init_mongo() -> bool:
    """Initialize Mongo connection and verify connectivity. Returns True if OK."""
    db = get_database()
    if db is None:
        return False
    try:
        await db.client.admin.command("ping")
        logger.info("MongoDB connected successfully")
        return True
    except Exception as exc:
        logger.warning(f"MongoDB ping failed: {exc}. Falling back to JSON.")
        return False


async def ensure_indexes() -> None:
    """
    Create all required MongoDB indexes if they don't already exist.

    Called once at application startup (from main.py lifespan hook).
    All indexes are created with background=True so the collection remains
    queryable during a potentially-slow index build on large datasets.

    Index strategy
    --------------
    predictions collection
    ┌────────────────────────────────────────────────────────────────────┐
    │ Index                           │ Supports                        │
    ├────────────────────────────────────────────────────────────────────┤
    │ {domain: 1, timestamp: -1}      │ get_recent_predictions()        │
    │   — primary query pattern: filter by domain, sort newest first    │
    │   — compound so Mongo can satisfy the sort without a scan          │
    │                                                                    │
    │ {correlation_id: 1}  (unique)   │ look-up by correlation ID       │
    │   — used by audit trail queries and SHAP report backfill           │
    │                                                                    │
    │ {domain: 1,                     │ fairness batch queries           │
    │  fairness.sensitive_attribute:1,│   filter by domain + attr +     │
    │  timestamp: -1}                 │   sort newest first             │
    │   — supports Phase-2 post-processing history retrieval             │
    │                                                                    │
    │ {timestamp: 1}  (TTL, 90 days)  │ automatic data retention        │
    │   — MongoDB TTL index deletes documents older than 90 days         │
    │   — keeps the collection bounded without manual pruning            │
    └────────────────────────────────────────────────────────────────────┘

    shap_reports collection  (optional — used when SHAP results are stored in DB)
    ┌─────────────────────────────────────────────────────────────────────┐
    │ {correlation_id: 1}  (unique)   │ instant look-up by ID           │
    │ {computed_at: 1}  (TTL, 2h)    │ auto-expiry of SHAP reports      │
    └─────────────────────────────────────────────────────────────────────┘
    """
    ok = await init_mongo()
    db = get_database() if ok else None
    if db is None:
        logger.info("ensure_indexes: MongoDB not available — skipping index creation.")
        return

    try:
        from pymongo import ASCENDING, DESCENDING, IndexModel

        pred = db["predictions"]

        # ── Index 1: primary read path ───────────────────────────────────────
        await pred.create_index(
            [("domain", ASCENDING), ("timestamp", DESCENDING)],
            name       = "domain_timestamp_desc",
            background = True,
        )

        # ── Index 2: correlation ID look-up ──────────────────────────────────
        await pred.create_index(
            [("correlation_id", ASCENDING)],
            name       = "correlation_id_unique",
            unique     = True,
            sparse     = True,       # sparse so documents without the field are ignored
            background = True,
        )

        # ── Index 3: fairness batch queries ──────────────────────────────────
        await pred.create_index(
            [
                ("domain",                         ASCENDING),
                ("fairness.sensitive_attribute",   ASCENDING),
                ("timestamp",                      DESCENDING),
            ],
            name       = "domain_sensitive_attr_timestamp",
            background = True,
        )

        # ── Index 4: TTL — auto-delete records older than 90 days ────────────
        await pred.create_index(
            [("timestamp", ASCENDING)],
            name             = "timestamp_ttl_90d",
            expireAfterSeconds = 90 * 24 * 3600,  # 90 days in seconds
            background       = True,
        )

        # ── shap_reports collection ───────────────────────────────────────────
        shap = db["shap_reports"]

        await shap.create_index(
            [("correlation_id", ASCENDING)],
            name       = "shap_correlation_id_unique",
            unique     = True,
            background = True,
        )

        await shap.create_index(
            [("computed_at", ASCENDING)],
            name             = "shap_ttl_2h",
            expireAfterSeconds = 2 * 3600,   # 2 hours
            background       = True,
        )

        logger.info("MongoDB indexes verified / created successfully.")

    except Exception as exc:
        # Index creation failure is non-fatal — the app continues without
        # optimal indexes.  Log at ERROR so ops teams are alerted.
        logger.error(f"ensure_indexes failed: {exc}")


async def save_prediction(record: dict) -> None:
    """
    Persist a prediction record to MongoDB or the JSON fallback file.

    The record includes ``preprocessing`` (correlation report) and
    ``sensitive_value_group`` (anonymised group label) for audit purposes.
    """
    record["timestamp"] = datetime.now(timezone.utc).isoformat()
    db = get_database()

    if db is not None:
        try:
            await db["predictions"].insert_one(record)
            logger.debug(f"Saved to MongoDB [{record.get('domain')}]")
        except Exception as exc:
            logger.error(f"MongoDB write failed: {exc}. Falling back to JSON.")
            _append_to_json(record)
    else:
        _append_to_json(record)


async def update_ground_truth(correlation_id: str, ground_truth: int) -> bool:
    """
    Attach a real ``ground_truth`` label to an existing prediction record.

    Used by the ``POST /feedback`` endpoint so post-processing fairness
    metrics (Equalized Odds, Calibration) can be computed against real
    outcomes rather than the model's own predictions.

    Returns True when a record was updated, False when the record is not
    found or the database is not reachable.
    """
    db = get_database()
    if db is not None:
        try:
            res = await db["predictions"].update_one(
                {"correlation_id": correlation_id},
                {"$set": {"ground_truth": int(ground_truth)}},
            )
            return res.matched_count > 0
        except Exception as exc:
            logger.error(f"MongoDB ground-truth update failed: {exc}")
            return False

    # JSON fallback
    if not JSON_LOG_PATH.exists():
        return False
    try:
        with open(JSON_LOG_PATH, "r") as fh:
            records = json.load(fh)
        updated = False
        for r in records:
            if r.get("correlation_id") == correlation_id:
                r["ground_truth"] = int(ground_truth)
                updated = True
                break
        if updated:
            with open(JSON_LOG_PATH, "w") as fh:
                json.dump(records, fh, indent=2)
        return updated
    except Exception as exc:
        logger.error(f"JSON ground-truth update failed: {exc}")
        return False


async def save_shap_report(correlation_id: str, report: dict) -> None:
    """
    Persist a completed SHAP report to MongoDB (shap_reports collection).
    Used when Redis is unavailable and you want DB-backed SHAP persistence.
    The TTL index on computed_at auto-expires reports after 2 hours.
    """
    db = get_database()
    if db is None:
        return   # ShapCache in-memory store is the only backend in this case

    try:
        doc = {
            "correlation_id": correlation_id,
            "computed_at":    datetime.now(timezone.utc).isoformat(),
            **report,
        }
        await db["shap_reports"].replace_one(
            {"correlation_id": correlation_id},
            doc,
            upsert=True,
        )
        logger.debug(f"Saved SHAP report to MongoDB [{correlation_id[:8]}…]")
    except Exception as exc:
        logger.error(f"SHAP report MongoDB write failed: {exc}")


async def get_recent_predictions(
    domain:          str,
    limit:           int = 100,
    sensitive_attr:  Optional[str] = None,
    projection:      Optional[Dict[str, Any]] = None,
) -> list:
    """
    Retrieve the most recent *limit* prediction records for *domain*.

    Parameters
    ----------
    domain          : Filter by this domain string.
    limit           : Maximum records to return.
    sensitive_attr  : Optional — further filter by fairness.sensitive_attribute.
                      Uses the compound index for maximum efficiency.
    projection      : Optional MongoDB projection dict.  Defaults to a
                      lean projection that excludes large fields not needed
                      for fairness/preprocessing calculations.

    Index used
    ----------
    With sensitive_attr:  domain_sensitive_attr_timestamp  (compound)
    Without:              domain_timestamp_desc             (compound)
    Both cases: Mongo uses an index-covered sort — no in-memory sort.
    """
    db = get_database()

    # ── Default lean projection — exclude large fields ────────────────────────
    # The preprocessing pipeline only needs: input, fairness, sensitive_value_group.
    # Excluding explanation, raw_input, and preprocessing saves ~60% data transfer.
    if projection is None:
        projection = {
            "input":                 1,
            "prediction":            1,
            "prediction_label":      1,
            "confidence":            1,
            "domain":                1,
            "fairness":              1,
            "bias_risk":             1,
            "sensitive_value_group": 1,
            "timestamp":             1,
            "ground_truth":          1,
            "correlation_id":        1,
            "_id":                   0,
        }

    if db is not None:
        try:
            query: Dict[str, Any] = {"domain": domain}
            if sensitive_attr:
                query["fairness.sensitive_attribute"] = sensitive_attr

            cursor = (
                db["predictions"]
                .find(query, projection)
                .sort("timestamp", -1)
                .limit(limit)
                .allow_disk_use(False)   # prevent spill-to-disk on large sorts
            )
            return await cursor.to_list(length=limit)
        except Exception as exc:
            logger.error(f"MongoDB read failed: {exc}")
            return []

    # ── JSON fallback ─────────────────────────────────────────────────────────
    if not JSON_LOG_PATH.exists():
        return []
    try:
        with open(JSON_LOG_PATH, "r") as fh:
            all_records = json.load(fh)

        filtered = [r for r in all_records if r.get("domain") == domain]
        if sensitive_attr:
            filtered = [
                r for r in filtered
                if r.get("fairness", {}).get("sensitive_attribute") == sensitive_attr
            ]

        # Apply lean projection to JSON records too (keeps parity with MongoDB)
        keep = set(projection.keys()) - {"_id"}
        projected = [
            {k: v for k, v in r.items() if k in keep}
            for r in filtered[-limit:]
        ]
        return projected
    except Exception as exc:
        logger.error(f"JSON read failed: {exc}")
        return []


# ═════════════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS — PRE-PROCESSING
# ═════════════════════════════════════════════════════════════════════════════

def _build_population_arrays(
    history:          List[dict],
    sensitive_attr:   str,
    sensitive_value:  str,
    current_features: Dict[str, Any],
) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], List[str], Optional[np.ndarray]]:
    """
    Extract aligned (g_vec, feature_matrix, feat_names) from history.

    g_vec[i] = 1.0 if history[i] belongs to the same sensitive group
               as the current request, else 0.0.
    Only records whose ``fairness.sensitive_attribute`` matches the current
    *sensitive_attr* are included (different protected dimensions are kept
    separate).
    """
    feat_names = [
        k for k, v in current_features.items()
        if isinstance(v, (int, float))
    ]
    if not feat_names:
        return None, None, [], None

    g_list:   List[float]       = []
    row_list: List[List[float]] = []

    for rec in history:
        fairness_info = rec.get("fairness", {})
        rec_attr      = fairness_info.get("sensitive_attribute", "")
        # Anonymised group label stored at save time (see router save_prediction calls)
        rec_group     = rec.get("sensitive_value_group", "")

        if rec_attr != sensitive_attr:
            continue   # different protected dimension — skip

        g_list.append(1.0 if rec_group == sensitive_value else 0.0)

        rec_input = rec.get("input", {})
        row_list.append([float(rec_input.get(f, 0.0)) for f in feat_names])

    if len(g_list) < MIN_HISTORY:
        return None, None, feat_names, None

    feature_matrix = np.array(row_list, dtype=np.float64)
    # Per-feature population std dev — needed for the correct residualisation
    # formula x_clean = x_raw - r * (sigma_x / sigma_g) * (g_i - g_mean).
    feature_stds = np.std(feature_matrix, axis=0)

    return (
        np.array(g_list, dtype=np.float64),
        feature_matrix,
        feat_names,
        feature_stds,
    )


def _pearson_correlations(
    g_vec:          np.ndarray,
    feature_matrix: np.ndarray,
    feat_names:     List[str],
) -> Dict[str, float]:
    """
    Compute Pearson r between g_vec and each column of feature_matrix.
    Returns {feature_name: pearson_r}.  Undefined correlations → 0.0.
    """
    g_std        = float(np.std(g_vec))
    correlations: Dict[str, float] = {}

    for i, name in enumerate(feat_names):
        col   = feature_matrix[:, i]
        c_std = float(np.std(col))

        if g_std < 1e-9 or c_std < 1e-9:
            correlations[name] = 0.0
            continue

        r = float(np.corrcoef(g_vec, col)[0, 1])
        correlations[name] = round(r if np.isfinite(r) else 0.0, 6)

    return correlations


def _neutralise(
    features:     Dict[str, Any],
    correlations: Dict[str, float],
    g_vec:        np.ndarray,
    feature_stds: Dict[str, float],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Residualise each flagged feature against the sensitive group indicator.

    OLS correction for a single sample::

        x_clean = x_raw - r * (sigma_x / sigma_g) * (g_i - g_mean)

    This is the closed-form residual that removes the linear component of
    ``x`` attributable to group membership, estimated from historical data.
    ``g_i = 1.0`` because by construction the current request belongs to
    the sensitive group whose correlations we are neutralising.

    The correction is capped at ±MAX_CORRECTION_FRACTION * |x_raw| to
    prevent over-correction on noisy / small samples.
    """
    g_mean = float(np.mean(g_vec))
    g_std  = float(np.std(g_vec)) or 1e-9
    g_i    = 1.0   # current request is always in its own group

    cleaned: Dict[str, Any] = dict(features)
    report:  Dict[str, Any] = {}

    for feat, r in correlations.items():
        raw_val = features.get(feat)
        if not isinstance(raw_val, (int, float)):
            continue

        raw_f        = float(raw_val)
        was_adjusted = abs(r) > CORRELATION_THRESHOLD

        if was_adjusted:
            x_std      = max(feature_stds.get(feat, 0.0), 1e-9)
            # Correct OLS formula (units of x)
            correction = r * (x_std / g_std) * (g_i - g_mean)
            # Safety cap at ±MAX_CORRECTION_FRACTION * |raw_f|
            max_abs    = MAX_CORRECTION_FRACTION * abs(raw_f) if raw_f != 0 else x_std * MAX_CORRECTION_FRACTION
            correction = float(np.clip(correction, -max_abs, max_abs))
            # Subtract the group-explained component
            cleaned_val = raw_f - correction
        else:
            cleaned_val = raw_f

        report[feat] = {
            "original_value": round(raw_f, 6),
            "cleaned_value":  round(cleaned_val, 6),
            "pearson_r":      round(r, 6),
            "was_adjusted":   was_adjusted,
        }
        cleaned[feat] = cleaned_val

    return cleaned, report


def _no_op_report(
    features:        Dict[str, Any],
    sensitive_attr:  Optional[str],
    sensitive_value: Optional[str],
    reason:          str,
    records_used:    int = 0,
) -> Dict[str, Any]:
    """Return a passthrough report when debiasing is skipped."""
    return {
        "features":           features,
        "correlation_report": {},
        "sensitive_attr":     sensitive_attr,
        "sensitive_value":    sensitive_value,
        "sufficient_history": False,
        "records_used":       records_used,
        "message":            reason,
    }


# ═════════════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS — STORAGE
# ═════════════════════════════════════════════════════════════════════════════

def _append_to_json(record: dict) -> None:
    """Append *record* to the local JSON log.  Creates the file if absent."""
    records: list = []
    try:
        JSON_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    if JSON_LOG_PATH.exists():
        try:
            with open(JSON_LOG_PATH, "r") as fh:
                records = json.load(fh)
        except json.JSONDecodeError:
            records = []

    records.append(record)

    with open(JSON_LOG_PATH, "w") as fh:
        json.dump(records, fh, indent=2)

    logger.debug(f"Appended record to {JSON_LOG_PATH}")


# Alias for compatibility with mitigation_router
get_prediction_history = get_recent_predictions
