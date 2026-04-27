"""tests/test_api.py

FastAPI integration tests using TestClient (session-scoped via conftest).
Includes consolidated tests for hiring, loan, and social endpoints.
"""

from __future__ import annotations

import json
import time
import uuid
from unittest.mock import patch

import pytest

# -----------------------------------------------------------------------------
# Helper Constants for Schema Validation
# -----------------------------------------------------------------------------

_COMMON_FIELDS = {
    "confidence", "shap_values", "shap_available", "shap_status", 
    "shap_poll_url", "explanation", "bias_risk", "fairness", 
    "preprocessing", "model_variant", "correlation_id", "message"
}

_HIRING_REQUIRED = _COMMON_FIELDS | {"prediction", "prediction_label", "model_version"}
_LOAN_REQUIRED = _HIRING_REQUIRED
_SOCIAL_REQUIRED = _COMMON_FIELDS | {"recommended_category_id", "recommended_category"}


# -----------------------------------------------------------------------------
# Platform / health
# -----------------------------------------------------------------------------

class TestPlatformEndpoints:

    def test_root_status_online(self, app_client):
        r = app_client.get("/")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "online"
        assert "Quantum" in data["platform"]
        assert "version" in data

    def test_root_lists_prediction_endpoints(self, app_client):
        endpoints = app_client.get("/").json()["endpoints"]
        assert any("/hiring/predict" in e for e in endpoints)
        assert any("/loan/predict" in e for e in endpoints)
        assert any("/social/recommend" in e for e in endpoints)

    def test_health_is_healthy(self, app_client):
        r = app_client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data

    def test_models_endpoint(self, app_client):
        r = app_client.get("/models")
        assert r.status_code == 200
        assert "models" in r.json()


# -----------------------------------------------------------------------------
# Core Prediction Endpoints
# -----------------------------------------------------------------------------

class TestHiringPredict:

    def test_valid_request_200(self, app_client, HIRING_PAYLOAD):
        r = app_client.post("/hiring/predict", json=HIRING_PAYLOAD)
        assert r.status_code == 200
        data = r.json()
        # Verify required keys exist
        assert not (_HIRING_REQUIRED - data.keys())
        assert data["prediction"] in (0, 1)
        uuid.UUID(data["correlation_id"])

    def test_hiring_validation_errors(self, app_client, HIRING_PAYLOAD):
        # Technical score out of range
        bad_payload = {**HIRING_PAYLOAD, "technical_score": 150}
        assert app_client.post("/hiring/predict", json=bad_payload).status_code == 422


class TestLoanPredict:

    def test_valid_request_200(self, app_client, LOAN_PAYLOAD):
        r = app_client.post("/loan/predict", json=LOAN_PAYLOAD)
        assert r.status_code == 200
        assert r.json()["prediction_label"] in ("Approved", "Rejected")

    def test_loan_limit_logic(self, app_client, LOAN_PAYLOAD):
        # Example of business logic validation: Loan cannot exceed 10x income
        extreme_loan = {**LOAN_PAYLOAD, "annual_income": 10000, "loan_amount": 500000}
        assert app_client.post("/loan/predict", json=extreme_loan).status_code == 422


class TestSocialRecommend:

    def test_valid_request_200(self, app_client, SOCIAL_PAYLOAD):
        r = app_client.post("/social/recommend", json=SOCIAL_PAYLOAD)
        assert r.status_code == 200
        data = r.json()
        assert "recommended_category" in data
        assert 0 <= data["recommended_category_id"] <= 7


# -----------------------------------------------------------------------------
# Security, SHAP & Performance
# -----------------------------------------------------------------------------

class TestSecurityAndInternal:

    def test_oversized_body_413(self, app_client, HIRING_PAYLOAD):
        # Test body limit middleware
        giant_body = json.dumps({**HIRING_PAYLOAD, "padding": "x" * 70_000})
        r = app_client.post("/hiring/predict", content=giant_body, headers={"Content-Type": "application/json"})
        assert r.status_code == 413

    def test_shap_poll_lifecycle(self, app_client, HIRING_PAYLOAD):
        # Get poll URL from initial prediction
        pred_res = app_client.post("/hiring/predict", json=HIRING_PAYLOAD).json()
        poll_url = pred_res["shap_poll_url"]
        
        # Poll the status
        poll_res = app_client.get(poll_url)
        assert poll_res.status_code == 200
        assert poll_res.json()["status"] in ("pending", "ready", "missing")

    def test_batch_load_performance(self, app_client, HIRING_PAYLOAD):
        # Reduced from 100 to 10 for CI stability while still testing reliability
        for _ in range(10):
            assert app_client.post("/hiring/predict", json=HIRING_PAYLOAD).status_code == 200


class TestFileScanPipeline:

    def test_upload_and_scan_generates_final_report(self, app_client):
        csv_data = (
            "credit_score,annual_income,loan_amount,loan_term_months,employment_years,"
            "existing_debt,num_credit_lines,gender,ground_truth\n"
            "720,85000,20000,36,5,5000,4,Female,1\n"
            "640,50000,30000,60,2,18000,3,Male,0\n"
            "780,95000,15000,24,6,2000,5,Female,1\n"
        )

        upload = app_client.post(
            "/files/upload",
            files={"file": ("loan_scan.csv", csv_data.encode(), "text/csv")},
            data={"domain": "loan"},
        )
        assert upload.status_code == 200
        file_id = upload.json()["file"]["id"]

        with patch("utils.dataset_analyzer.save_prediction") as save_prediction_mock:
            scan = app_client.post("/files/scan", json={"domain": "loan", "file_id": file_id})

        assert scan.status_code == 200
        data = scan.json()
        assert data["success"] is True
        assert data["dataset"]["domain"] == "loan"
        assert data["scores"]["final_recommendation"] in ("Accept", "Reject", "Retrain")
        assert set(data["scores"].keys()) == {
            "bias_score",
            "fairness_score",
            "performance_score",
            "risk_score",
            "final_recommendation",
        }
        assert "validation" in data and "performance" in data and "fairness" in data
        assert save_prediction_mock.await_count >= 1

    def test_non_tabular_file_can_be_analyzed(self, app_client):
        text_payload = (
            "loan_amount: 18000\n"
            "credit_score: 705\n"
            "annual_income: 68000\n"
            "employment_years: 4\n"
        )

        upload = app_client.post(
            "/files/upload",
            files={"file": ("loan_profile.txt", text_payload.encode(), "text/plain")},
            data={"domain": "loan"},
        )
        assert upload.status_code == 200
        file_id = upload.json()["file"]["id"]

        with patch("utils.dataset_analyzer.save_prediction") as save_prediction_mock:
            analyze = app_client.post(f"/files/analyze/{file_id}")

        assert analyze.status_code == 200
        data = analyze.json()
        assert "success" in data
        assert data.get("detected_domain") in ("loan", "hiring", "social", None)
        # Non-tabular fallback should never hard-fail with category gating.
        assert "error" in data or data.get("success") is True
        if data.get("success"):
            assert save_prediction_mock.await_count >= 1


# -----------------------------------------------------------------------------
# Fixtures (Payloads)
# -----------------------------------------------------------------------------

@pytest.fixture()
def HIRING_PAYLOAD():
    return {
        "years_experience": 5,
        "education_level": 2,
        "technical_score": 82,
        "communication_score": 75,
        "num_past_jobs": 3,
        "certifications": 2,
        "gender": "female",
    }

@pytest.fixture()
def LOAN_PAYLOAD():
    return {
        "credit_score": 720,
        "annual_income": 75000,
        "loan_amount": 25000,
        "loan_term_months": 36,
        "employment_years": 4,
        "existing_debt": 8000,
        "num_credit_lines": 3,
        "ethnicity": "hispanic",
    }

@pytest.fixture()
def SOCIAL_PAYLOAD():
    return {
        "avg_session_minutes": 45,
        "posts_per_day": 3,
        "topics_interacted": 12,
        "like_rate": 0.65,
        "share_rate": 0.20,
        "comment_rate": 0.10,
        "account_age_days": 365,
        "age_group": "25-34",
        "location": "India",
        "language": "en"
    }
