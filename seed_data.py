"""
seed_data.py — Sends 60 sample predictions to populate the dashboard.
Run: python seed_data.py
"""
import requests
import random

BASE = "https://unbiased-ai-decision.onrender.com"

GENDERS    = ["male", "female", "non-binary"]
ETHNICITIES = ["asian", "caucasian", "african", "hispanic"]
RELIGIONS  = ["christian", "muslim", "hindu", "none"]
AGE_GROUPS = ["18-25", "26-40", "41-55", "56-65", "65+"]
LOCATIONS  = ["urban", "rural", "suburban"]
LANGUAGES  = ["en", "es", "fr", "hi", "zh", "ar"]

def seed_hiring(n=25):
    print(f"\n--- Seeding {n} hiring predictions ---")
    for i in range(n):
        payload = {
            "years_experience":    round(random.uniform(0, 20), 1),
            "education_level":     random.randint(0, 3),
            "technical_score":     random.randint(40, 100),
            "communication_score": random.randint(40, 100),
            "num_past_jobs":       random.randint(0, 10),
            "certifications":      random.randint(0, 5),
            "gender":              random.choice(GENDERS),
            "ethnicity":           random.choice(ETHNICITIES),
        }
        try:
            r = requests.post(f"{BASE}/hiring/predict", json=payload, timeout=15)
            label = r.json().get("prediction_label", "?") if r.ok else f"ERR {r.status_code}"
            print(f"  [{i+1:02d}] gender={payload['gender']:<12} ethnicity={payload['ethnicity']:<12} → {label}")
        except Exception as e:
            print(f"  [{i+1:02d}] FAILED: {e}")

def seed_loan(n=25):
    print(f"\n--- Seeding {n} loan predictions ---")
    for i in range(n):
        payload = {
            "credit_score":     random.randint(300, 850),
            "annual_income":    random.randint(20000, 150000),
            "loan_amount":      random.randint(5000, 100000),
            "loan_term_months": random.choice([12, 24, 36, 60, 84, 120]),
            "employment_years": round(random.uniform(0, 30), 1),
            "existing_debt":    random.randint(0, 50000),
            "num_credit_lines": random.randint(0, 10),
            "gender":           random.choice(GENDERS),
            "age_group":        random.choice(AGE_GROUPS),
            "ethnicity":        random.choice(ETHNICITIES),
        }
        try:
            r = requests.post(f"{BASE}/loan/predict", json=payload, timeout=15)
            label = r.json().get("prediction_label", "?") if r.ok else f"ERR {r.status_code}"
            print(f"  [{i+1:02d}] gender={payload['gender']:<12} age={payload['age_group']:<8} → {label}")
        except Exception as e:
            print(f"  [{i+1:02d}] FAILED: {e}")

def seed_social(n=25):
    print(f"\n--- Seeding {n} social recommendations ---")
    for i in range(n):
        payload = {
            "avg_session_minutes": round(random.uniform(5, 120), 1),
            "topics_interacted":   random.randint(1, 20),
            "like_rate":           round(random.uniform(0.2, 1), 2),
            "posts_per_day":       round(random.uniform(0, 10), 1),
            "share_rate":          round(random.uniform(0, 0.2), 2),
            "comment_rate":        round(random.uniform(0, 0.5), 2),
            "account_age_days":    random.randint(1, 1000),
            "gender":              random.choice(GENDERS),
            "age_group":           random.choice(AGE_GROUPS),
            "location":            random.choice(LOCATIONS),
            "language":            random.choice(LANGUAGES),
        }
        try:
            r = requests.post(f"{BASE}/social/recommend", json=payload, timeout=15)
            label = r.json().get("recommended_category", "?") if r.ok else f"ERR {r.status_code}: {r.text[:200]}"
            print(f"  [{i+1:02d}] gender={payload['gender']:<12} location={payload['location']:<10} → {label}")
        except Exception as e:
            print(f"  [{i+1:02d}] FAILED: {e}")

if __name__ == "__main__":
    seed_social(25)
    print("\n✅ Done! Refresh the dashboard to see metrics.")
