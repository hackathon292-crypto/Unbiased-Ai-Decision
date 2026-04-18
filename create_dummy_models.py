"""create_dummy_models.py — generates placeholder .pkl files for testing.

Writes into ``backend/models/`` so the pickles live next to the code that
loads them (see backend/<domain>/model_loader.py).  Safe to run from any
working directory.
"""
import numpy as np
import joblib
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier

ROOT       = Path(__file__).resolve().parent
MODELS_DIR = ROOT / "backend" / "models"
LOGS_DIR   = ROOT / "backend" / "logs"
MODELS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

np.random.seed(42)

# Hiring
X = np.random.rand(500, 6) * [20, 3, 100, 100, 10, 5]
y = (X[:, 2] + X[:, 3] > 100).astype(int)
m = RandomForestClassifier(n_estimators=50, random_state=42).fit(X, y)
joblib.dump(m, MODELS_DIR / "hiring_model.pkl")
print(f"[ok] {MODELS_DIR / 'hiring_model.pkl'}")

# Loan
X = np.column_stack([
    np.random.randint(300, 850, 500),
    np.random.randint(20000, 200000, 500),
    np.random.randint(1000, 100000, 500),
    np.random.choice([12, 24, 36, 60], 500),
    np.random.randint(0, 20, 500),
    np.random.randint(0, 50000, 500),
    np.random.randint(0, 10, 500),
])
dti = X[:, 5] / (X[:, 1] + 1)
y   = ((X[:, 0] > 620) & (dti < 0.5)).astype(int)
m   = RandomForestClassifier(n_estimators=50, random_state=42).fit(X, y)
joblib.dump(m, MODELS_DIR / "loan_model.pkl")
print(f"[ok] {MODELS_DIR / 'loan_model.pkl'}")

# Social
X = np.column_stack([
    np.random.rand(500) * 120,
    np.random.rand(500) * 10,
    np.random.randint(1, 30, 500),
    np.random.rand(500),
    np.random.rand(500) * 0.5,
    np.random.rand(500) * 0.3,
    np.random.randint(1, 2000, 500),
])
y = np.random.randint(0, 8, 500)
m = RandomForestClassifier(n_estimators=50, random_state=42).fit(X, y)
joblib.dump(m, "models/social_model.pkl")
print("[ok] social_model.pkl")
print("\nDone. Run: uvicorn main:app --reload")
