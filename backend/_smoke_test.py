"""One-shot smoke test: upload -> inspect -> analyze -> batch predict.

Uses `with TestClient(app)` so the FastAPI lifespan runs — this loads the
hiring/loan/social models into the registry exactly like `uvicorn` would.
"""
import io
import csv as _csv
from fastapi.testclient import TestClient
from main import app


def main() -> None:
    # Context manager triggers startup (registry.load_all) and shutdown hooks.
    with TestClient(app) as client:

        # 1. Health
        r = client.get("/health")
        assert r.status_code == 200, r.text
        print("[1/5] /health                          OK")

        # 2. Upload a schema-matching hiring CSV (synthesized in-memory)
        buf = io.StringIO()
        w = _csv.writer(buf)
        w.writerow([
            "years_experience", "education_level", "technical_score",
            "communication_score", "num_past_jobs", "certifications", "gender",
        ])
        for row in [
            (5, 2, 85, 75, 2, 1, "female"),
            (1, 1, 55, 60, 1, 0, "male"),
            (10, 3, 92, 88, 4, 3, "female"),
            (3, 1, 70, 65, 2, 1, "male"),
            (8, 2, 80, 82, 3, 2, "female"),
        ]:
            w.writerow(row)
        csv_bytes = buf.getvalue().encode()

        r = client.post(
            "/files/upload",
            files={"file": ("hiring_sample.csv", csv_bytes, "text/csv")},
            data={"description": "smoke", "tags": "test"},
        )
        assert r.status_code == 200, r.text
        file_id = r.json()["file"]["id"]
        print(f"[2/5] /files/upload                    OK  file_id={file_id[:8]}")

        # 3. Inspect
        r = client.get(f"/files/inspect/{file_id}")
        assert r.status_code == 200, r.text
        ins = r.json()
        assert ins.get("kind") == "tabular", ins
        assert ins.get("rows", 0) > 0, ins
        assert len(ins.get("columns", [])) > 0, ins
        print(
            f"[3/5] /files/inspect/{file_id[:8]}            OK  "
            f"kind={ins['kind']} rows={ins['rows']} cols={ins['columns_count']}"
        )

        # 4. Analyze (domain detect + batch predict)
        r = client.post(f"/files/analyze/{file_id}")
        assert r.status_code == 200, r.text
        an = r.json()
        assert an.get("success") is True, an
        assert an.get("detected_domain") in ("hiring", "loan", "social"), an
        assert an.get("rows_predicted", 0) > 0, an
        print(
            f"[4/5] /files/analyze/{file_id[:8]}            OK  "
            f"domain={an['detected_domain']} "
            f"rows={an['rows_predicted']}/{an['rows_total']} "
            f"approval={an['summary']['approval_rate']*100:.0f}% "
            f"flagged={an['summary']['flagged_for_review']}"
        )

        # 5. Manual prediction via /hiring/predict
        r = client.post(
            "/hiring/predict",
            json={
                "years_experience": 5,
                "education_level": 2,
                "technical_score": 85,
                "communication_score": 75,
                "num_past_jobs": 2,
                "certifications": 1,
                "gender": "female",
            },
        )
        assert r.status_code == 200, r.text
        pred = r.json()
        assert "prediction" in pred and "confidence" in pred, pred
        print(
            f"[5/5] /hiring/predict                  OK  "
            f"prediction={pred['prediction_label']} conf={pred['confidence']:.2f}"
        )

        # Cleanup
        client.delete(f"/files/delete/{file_id}")

    print("\nALL PIPELINE CHECKS PASSED — user can upload files and run predictions end-to-end.")


if __name__ == "__main__":
    main()
