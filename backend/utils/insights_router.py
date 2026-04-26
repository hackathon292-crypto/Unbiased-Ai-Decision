"""
utils/insights_router.py

Read-only endpoints that power the frontend dashboard / fairness explorer.

Endpoints
---------
GET  /insights/{domain}/recent     Recent prediction records (paginated).
GET  /insights/{domain}/summary    Aggregated fairness metrics (DPD, EOD,
                                   ECE per sensitive attribute).
POST /fairness/batch               On-demand DPD + EOD run over the most
                                   recent N records for a domain.

All three endpoints are read-only and safe for public dashboards but still
go through the global security middleware (rate limits, body size, CORS).
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from utils.database import get_recent_predictions
from fairness.checker import (
    run_batch_fairness_check,
    run_post_processing_checks,
    demographic_parity_difference,
    equal_opportunity_difference,
)

router = APIRouter()
logger = logging.getLogger("insights.router")

_VALID_DOMAINS = frozenset({"hiring", "loan", "social"})
_MIN_METRICS_RECORDS = 10


def _normalize_group(value: Any) -> str:
    cleaned = str(value).strip().lower()
    return cleaned if cleaned else "unknown"


# ─── Response models ─────────────────────────────────────────────────────────

class RecentPrediction(BaseModel):
    correlation_id:        Optional[str] = None
    domain:                str
    prediction:            int
    prediction_label:      Optional[str] = None
    confidence:            float
    sensitive_value_group: Optional[str] = None
    ground_truth:          Optional[int] = None
    timestamp:             Optional[str] = None
    bias_risk:             Optional[Dict[str, Any]] = None


class RecentResponse(BaseModel):
    domain:  str
    count:   int
    records: List[RecentPrediction]


class GroupMetrics(BaseModel):
    group:              str
    n:                  int
    positive_rate:      float
    avg_confidence:     float
    labelled_count:     int
    accuracy:           Optional[float] = None


class SummaryResponse(BaseModel):
    domain:                           str
    n_records:                        int
    labelled_count:                   int
    sensitive_attributes_detected:    List[str]
    demographic_parity_difference:    Optional[float] = None
    equal_opportunity_difference:     Optional[float] = None
    per_group:                        List[GroupMetrics]
    post_processing:                  Optional[Dict[str, Any]] = None
    notes:                            List[str]


class BatchFairnessRequest(BaseModel):
    domain:         str = Field(..., pattern=r"^(hiring|loan|social)$")
    sensitive_attr: str = Field(..., min_length=1, max_length=32)
    limit:          int = Field(default=500, ge=_MIN_METRICS_RECORDS, le=2000)


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get(
    "/insights/{domain}/recent",
    response_model=RecentResponse,
    summary="Recent prediction records for a domain",
    tags=["Insights"],
)
async def recent(
    domain: str,
    limit:  int = Query(default=100, ge=1, le=500),
) -> RecentResponse:
    _validate_domain(domain)
    records = await get_recent_predictions(domain, limit=limit)
    out: List[RecentPrediction] = []
    for r in records:
        out.append(RecentPrediction(
            correlation_id        = r.get("correlation_id"),
            domain                = r.get("domain", domain),
            prediction            = int(r.get("prediction", 0)),
            prediction_label      = r.get("prediction_label"),
            confidence            = float(r.get("confidence", 0.0)),
            sensitive_value_group = r.get("sensitive_value_group"),
            ground_truth          = r.get("ground_truth"),
            timestamp             = r.get("timestamp"),
            bias_risk             = r.get("bias_risk"),
        ))
    return RecentResponse(domain=domain, count=len(out), records=out)


@router.get(
    "/insights/{domain}/summary",
    response_model=SummaryResponse,
    summary="Aggregated fairness summary for a domain",
    tags=["Insights"],
)
async def summary(
    domain: str,
    limit:  int = Query(default=500, ge=_MIN_METRICS_RECORDS, le=2000),
) -> SummaryResponse:
    _validate_domain(domain)
    records = await get_recent_predictions(domain, limit=limit)

    notes: List[str] = []
    if len(records) < _MIN_METRICS_RECORDS:
        notes.append(
            f"Only {len(records)} record(s) available (minimum {_MIN_METRICS_RECORDS} for stable metrics)."
        )

    social_reference_class: Optional[int] = None
    if domain == "social" and records:
        counts: Dict[int, int] = defaultdict(int)
        for r in records:
            counts[int(r.get("prediction", 0))] += 1
        social_reference_class = max(counts.items(), key=lambda kv: kv[1])[0]
        notes.append(
            f"Social metrics use one-vs-rest parity with reference class {social_reference_class}."
        )

    def to_binary_prediction(value: Any) -> int:
        pred = int(value)
        if domain in {"loan", "hiring"}:
            return int(pred == 1)
        if social_reference_class is None:
            return 0
        return int(pred == social_reference_class)

    # Group by sensitive_value_group
    buckets: Dict[str, List[dict]] = defaultdict(list)
    sensitive_attrs = set()
    for r in records:
        grp = _normalize_group(r.get("sensitive_value_group") or "unknown")
        buckets[grp].append(r)
        fa = (r.get("fairness") or {}).get("sensitive_attribute")
        if fa:
            sensitive_attrs.add(fa)

    per_group: List[GroupMetrics] = []
    y_pred_all:   List[int] = []
    y_true_all:   List[int] = []
    sens_all:     List[str] = []

    for grp, items in buckets.items():
        preds       = [to_binary_prediction(x.get("prediction", 0)) for x in items]
        confs       = [float(x.get("confidence", 0.0)) for x in items]
        labelled    = [x for x in items if x.get("ground_truth") is not None]
        accuracy    = None
        if labelled:
            correct = sum(
                1 for x in labelled
                if int(x.get("prediction", 0)) == int(x.get("ground_truth", -1))
            )
            accuracy = round(correct / len(labelled), 4)
        per_group.append(GroupMetrics(
            group           = grp,
            n               = len(items),
            positive_rate   = round(sum(preds) / len(preds), 4) if preds else 0.0,
            avg_confidence  = round(sum(confs) / len(confs), 4) if confs else 0.0,
            labelled_count  = len(labelled),
            accuracy        = accuracy,
        ))
        # Accumulate arrays for DPD / EOD (only labelled records for EOD)
        for x in items:
            y_pred_all.append(to_binary_prediction(x.get("prediction", 0)))
            sens_all.append(grp)
            gt = x.get("ground_truth")
            y_true_all.append(int(gt) if gt is not None else -1)

    # Overall metrics
    dpd: Optional[float] = None
    eod: Optional[float] = None
    if len(buckets) >= 2 and y_pred_all:
        dpd = demographic_parity_difference(y_pred_all, sens_all)

    # EOD needs real ground truth — compute only when we have enough labelled
    labelled_total = sum(1 for x in y_true_all if x != -1)
    if labelled_total >= _MIN_METRICS_RECORDS and len(buckets) >= 2:
        ypi, yti, sni = [], [], []
        for p, t, s in zip(y_pred_all, y_true_all, sens_all):
            if t == -1:
                continue
            ypi.append(p)
            yti.append(t)
            sni.append(s)
        eod = equal_opportunity_difference(ypi, yti, sni)
    else:
        notes.append(
            f"Equal Opportunity Difference requires >= {_MIN_METRICS_RECORDS} labelled records "
            f"(have {labelled_total}). Submit ground-truth via POST /feedback."
        )

    # Post-processing (calibration + equalized odds)
    post_proc: Optional[Dict[str, Any]] = None
    if labelled_total >= _MIN_METRICS_RECORDS and len(buckets) >= 2:
        y_prob_lab, y_pred_lab, y_true_lab, sens_lab = [], [], [], []
        for x in records:
            gt = x.get("ground_truth")
            if gt is None:
                continue
            y_pred_lab.append(to_binary_prediction(x.get("prediction", 0)))
            y_prob_lab.append(float(x.get("confidence", 0.5)))
            y_true_lab.append(int(gt))
            sens_lab.append(_normalize_group(x.get("sensitive_value_group", "unknown")))
        post_proc = run_post_processing_checks(
            y_pred=y_pred_lab,
            y_prob=y_prob_lab,
            y_true=y_true_lab,
            sensitive_values=sens_lab,
            sensitive_attr=next(iter(sensitive_attrs), "unknown"),
            domain=domain,
            task_type="multiclass" if domain == "social" else "binary",
        )

    return SummaryResponse(
        domain                          = domain,
        n_records                       = len(records),
        labelled_count                  = labelled_total,
        sensitive_attributes_detected   = sorted(sensitive_attrs),
        demographic_parity_difference   = dpd,
        equal_opportunity_difference    = eod,
        per_group                       = per_group,
        post_processing                 = post_proc,
        notes                           = notes,
    )


@router.post(
    "/fairness/batch",
    summary="On-demand DPD + EOD batch fairness check",
    tags=["Fairness"],
)
async def fairness_batch(body: BatchFairnessRequest) -> Dict[str, Any]:
    _validate_domain(body.domain)
    records = await get_recent_predictions(
        body.domain, limit=body.limit, sensitive_attr=body.sensitive_attr
    )

    labelled = [r for r in records if r.get("ground_truth") is not None]
    if len(labelled) < _MIN_METRICS_RECORDS:
        return {
            "domain":              body.domain,
            "sensitive_attribute": body.sensitive_attr,
            "n_records":           len(records),
            "labelled_count":      len(labelled),
            "is_fair":             None,
            "message": (
                f"Not enough labelled records ({len(labelled)}/{_MIN_METRICS_RECORDS}) to compute "
                "equal opportunity. Submit ground truths via POST /feedback."
            ),
        }

    y_pred = [int(r.get("prediction", 0)) for r in labelled]
    y_true = [int(r.get("ground_truth")) for r in labelled]
    sens   = [_normalize_group(r.get("sensitive_value_group", "unknown")) for r in labelled]

    return run_batch_fairness_check(
        y_pred              = y_pred,
        y_true              = y_true,
        sensitive_values    = sens,
        sensitive_attr_name = body.sensitive_attr,
        domain              = body.domain,
    )


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _validate_domain(domain: str) -> None:
    if domain not in _VALID_DOMAINS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown domain '{domain}'. Valid: {sorted(_VALID_DOMAINS)}.",
        )
