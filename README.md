<div align="center">

```
██╗   ██╗███╗   ██╗██████╗ ██╗ █████╗ ███████╗███████╗██████╗      █████╗ ██╗
██║   ██║████╗  ██║██╔══██╗██║██╔══██╗██╔════╝██╔════╝██╔══██╗    ██╔══██╗██║
██║   ██║██╔██╗ ██║██████╔╝██║███████║███████╗█████╗  ██║  ██║    ███████║██║
██║   ██║██║╚██╗██║██╔══██╗██║██╔══██║╚════██║██╔══╝  ██║  ██║    ██╔══██║██║
╚██████╔╝██║ ╚████║██████╔╝██║██║  ██║███████║███████╗██████╔╝    ██║  ██║██║
 ╚═════╝ ╚═╝  ╚═══╝╚═════╝ ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝╚═════╝     ╚═╝  ╚═╝╚═╝
```

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=22&duration=3000&pause=1000&color=10B981&center=true&vCenter=true&multiline=true&width=700&height=80&lines=Detect.+Analyze.+Mitigate.;Building+Fairer+AI+%E2%80%94+One+Model+at+a+Time." alt="Typing SVG" />

<br/>

[![Live Demo](https://img.shields.io/badge/⚡_LIVE_DEMO-Netlify-00C7B7?style=for-the-badge&logo=netlify&logoColor=white)](https://your-demo.netlify.app)
[![Backend](https://img.shields.io/badge/🚀_API-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://your-backend.onrender.com)
[![License](https://img.shields.io/badge/📄_License-MIT-emerald?style=for-the-badge)](#)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)

<br/>

> **AI shouldn't discriminate.**  
> Unbiased AI gives you the tools to detect, visualize, and eliminate bias in automated decisions — across hiring, lending, and content recommendation.

<br/>

---

</div>

## ✦ What Is This?

**Unbiased AI** is a full-stack fairness monitoring platform that plugs into your ML models and answers one critical question:

> *"Is my AI treating everyone equally?"*

It combines a **FastAPI backend** with trained scikit-learn models, a **React + TypeScript frontend**, and a suite of bias detection and mitigation algorithms — all wrapped in a clean, dark-mode-ready dashboard.

<br/>

---

## ✦ Feature Showcase

<table>
<tr>
<td width="50%">

### 🎯 Bias Detection Engine
```
Protected Groups:  Gender · Age · Ethnicity
Fairness Metrics:  DPD · EOD · Disparate Impact
Threshold Config:  Fully adjustable per domain
Live Scanning:     Real-time model evaluation
```

Runs across **3 domains simultaneously** — Loan Approval, Hiring Decisions, and Social Recommendations.

</td>
<td width="50%">

### ⚡ What-If Fairness Explorer
```
Interactive sliders for every model feature
SHAP feature importance visualization
Instant bias risk scoring (0–100)
Per-prediction correlation tracking
```

Test hypothetical candidates, applicants, or users and see *exactly* how the model would judge them.

</td>
</tr>
<tr>
<td width="50%">

### 🛡️ Mitigation Lab
```
Threshold Optimization   → -60% bias
Calibration Adjustment   → Fix confidence drift
Disparate Impact Removal → 80% rule compliance
```

Side-by-side **Before / After** bar charts. Apply mitigations and watch the parity gaps close in real time.

</td>
<td width="50%">

### 📊 Live Audit Reports
```
Fairness Score  /100 per domain
Demographic Parity Difference
Equal Opportunity Difference
Recent Predictions Log + Export
```

One-click **JSON export** for regulatory submissions. Full ground-truth feedback loop via the `/feedback` API.

</td>
</tr>
</table>

<br/>

---

## ✦ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│  React 19  ·  TypeScript 6  ·  Tailwind v4  ·  Recharts    │
│                                                             │
│  Dashboard  →  Bias Detection  →  Fairness Explorer         │
│  Mitigation Lab  →  Reports  →  File Manager               │
└────────────────────────┬────────────────────────────────────┘
                         │  REST API  (VITE_API_BASE_URL)
┌────────────────────────▼────────────────────────────────────┐
│                        BACKEND                              │
│  FastAPI  ·  Python 3.11  ·  scikit-learn  ·  joblib       │
│                                                             │
│  /hiring/predict     →  RandomForest (6 features)           │
│  /loan/predict       →  RandomForest (7 features)           │
│  /social/recommend   →  RandomForest (7 features)           │
│  /insights/:domain   →  DPD · EOD · Per-group rates         │
│  /mitigation/apply   →  Threshold · Calibration · DI-Remove │
│  /files/*            →  Upload · Preview · Download         │
│  /feedback           →  Ground-truth annotation loop        │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                       STORAGE                               │
│  MongoDB Atlas (predictions + feedback)                     │
│  ↳ Fallback: predictions.json (no-config local dev)         │
└─────────────────────────────────────────────────────────────┘
```

<br/>

---

## ✦ Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Python | ≥ 3.11 |
| Node.js | ≥ 20 |
| npm | ≥ 10 |

### 1 · Clone & Bootstrap

```bash
git clone https://github.com/your-username/unbiased-ai.git
cd unbiased-ai

# Generate placeholder ML models (required before first run)
python create_dummy_models.py
```

### 2 · Backend

```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp ../.env.example .env
# Edit .env — MONGO_URL is optional; leave blank for JSON fallback

# Start the API server
uvicorn main:app --reload --port 8000
```

> API docs available at **http://localhost:8000/docs**

### 3 · Frontend

```bash
cd frontend

# Install dependencies
npm install

# Configure API endpoint
cp .env.example .env.local
# VITE_API_BASE_URL=http://localhost:8000

# Start dev server
npm run dev
```

> App available at **http://localhost:5173**

<br/>

---

## ✦ Environment Variables

### Backend (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URL` | *(empty)* | MongoDB Atlas connection string. Leave blank to use JSON fallback. |
| `ENVIRONMENT` | `development` | `development` or `production` |
| `LOG_LEVEL` | `INFO` | `DEBUG` · `INFO` · `WARNING` · `ERROR` |
| `FRONTEND_ORIGINS` | `http://localhost:5173` | Comma-separated allowed CORS origins |
| `HIRING_POSITIVE_THRESHOLD` | `0.55` | Approve if confidence ≥ this value |
| `HIRING_NEGATIVE_THRESHOLD` | `0.45` | Reject if confidence ≤ this value |
| `LOAN_POSITIVE_THRESHOLD` | `0.55` | Same logic for loan domain |
| `LOAN_NEGATIVE_THRESHOLD` | `0.45` | Same logic for loan domain |

### Frontend (`.env.local`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend API base URL |

<br/>

---

## ✦ API Reference

<details>
<summary><strong>🏢 Hiring · /hiring/predict</strong></summary>

```json
POST /hiring/predict
{
  "years_experience": 5,
  "education_level": 2,
  "technical_score": 80,
  "communication_score": 75,
  "num_past_jobs": 3,
  "certifications": 2,
  "gender": "female",
  "ethnicity": "asian"
}
```

```json
{
  "prediction": 1,
  "prediction_label": "Hired",
  "confidence": 0.847,
  "bias_risk": { "score": 0.12, "band": "low", "flag_for_review": false },
  "correlation_id": "hire_abc123",
  "shap_poll_url": "/shap/hire_abc123"
}
```
</details>

<details>
<summary><strong>💰 Loan · /loan/predict</strong></summary>

```json
POST /loan/predict
{
  "credit_score": 720,
  "annual_income": 75000,
  "loan_amount": 25000,
  "loan_term_months": 36,
  "employment_years": 5,
  "gender": "male",
  "age_group": "26-40"
}
```

```json
{
  "prediction": 1,
  "prediction_label": "Approved",
  "confidence": 0.913,
  "bias_risk": { "score": 0.08, "band": "low", "flag_for_review": false },
  "correlation_id": "loan_xyz789"
}
```
</details>

<details>
<summary><strong>📈 Fairness Summary · /insights/:domain/summary</strong></summary>

```json
GET /insights/hiring/summary

{
  "domain": "hiring",
  "n_records": 342,
  "demographic_parity_difference": 0.14,
  "equal_opportunity_difference": 0.09,
  "per_group": [
    { "group": "male",   "positive_rate": 0.76, "n": 180 },
    { "group": "female", "positive_rate": 0.62, "n": 162 }
  ]
}
```
</details>

<details>
<summary><strong>🛡️ Mitigation · /mitigation/apply</strong></summary>

```json
POST /mitigation/apply
{
  "domain": "hiring",
  "method": "threshold",
  "strength": 0.7
}
```

```json
{
  "success": true,
  "original_dpd": 0.14,
  "mitigated_dpd": 0.05,
  "improvement_pct": 64.3,
  "affected_records": 28,
  "new_thresholds": [
    { "group": "female", "original_threshold": 0.5, "new_threshold": 0.42 }
  ]
}
```
</details>

<br/>

---

## ✦ Fairness Metrics Explained

| Metric | Formula | Threshold | Meaning |
|--------|---------|-----------|---------|
| **Demographic Parity Difference** | P(Ŷ=1\|A=a) − P(Ŷ=1\|A=b) | < 0.10 ideal | Equal positive rates across groups |
| **Equal Opportunity Difference** | TPR_a − TPR_b | < 0.10 ideal | Equal true-positive rates for qualified candidates |
| **Disparate Impact Ratio** | P(Ŷ=1\|minority) / P(Ŷ=1\|majority) | ≥ 0.80 (80% rule) | Legal compliance threshold |
| **Bias Risk Score** | Composite 0–100 | < 40 = low risk | Internal risk band for flagging |

<br/>

---

## ✦ Project Structure

```
unbiased-ai/
│
├── 🐍 backend/
│   ├── main.py                    # FastAPI app + router wiring
│   ├── models/                    # Trained .pkl model files
│   ├── hiring/                    # Hiring domain (router + model loader)
│   ├── loan/                      # Loan domain
│   ├── social/                    # Social recommendation domain
│   ├── fairness/                  # DPD, EOD, disparate impact logic
│   └── utils/
│       ├── database.py            # MongoDB + JSON fallback
│       ├── insights_router.py     # /insights/* endpoints
│       ├── mitigation_router.py   # /mitigation/* endpoints
│       ├── feedback_router.py     # /feedback endpoint
│       └── file_upload_router.py  # /files/* endpoints
│
├── ⚛️  frontend/
│   └── src/
│       ├── features/
│       │   ├── dashboard/         # Live fairness overview
│       │   ├── bias-detection/    # Scan & metrics table
│       │   ├── fairness-explorer/ # What-If analysis
│       │   ├── mitigation-lab/    # Before/After comparison
│       │   ├── reports/           # Audit log + export
│       │   ├── datasets/          # File manager
│       │   ├── hiring-prediction/ # Domain-specific UI
│       │   └── social-recommendation/
│       ├── components/            # Sidebar, TopNavbar, FeedbackForm
│       └── lib/api.ts             # Typed API client
│
├── 📊 data/
│   ├── hiring_test_data.csv
│   ├── loan_test_data.csv
│   └── social_test_data.csv
│
├── create_dummy_models.py         # Bootstrap ML models for testing
├── render.yaml                    # One-click Render deployment
└── netlify.toml                   # One-click Netlify deployment
```

<br/>

---

## ✦ Deploy in 5 Minutes

### Backend → Render

1. Push repo to GitHub
2. [New Web Service](https://render.com) → connect repo
3. Render auto-detects `render.yaml` — no config needed
4. Add env var: `MONGO_URL` (from MongoDB Atlas)
5. Copy the deployed URL

### Frontend → Netlify

1. [New Site](https://netlify.com) → Import from Git
2. Netlify auto-detects `netlify.toml`
3. Add env var: `VITE_API_BASE_URL=https://your-render-url.onrender.com`
4. Deploy 🚀

<br/>

---

## ✦ Running Tests

```bash
# Backend unit tests
cd backend
python -m pytest -q

# Generate models (required before tests)
python create_dummy_models.py

# Full system verification
python test_system.py
```

CI runs automatically on every push via GitHub Actions (`.github/workflows/backend-ci.yml`).

<br/>

---

## ✦ Roadmap

- [x] Multi-domain bias detection (Hiring · Loan · Social)
- [x] SHAP feature importance explanations
- [x] Real-time mitigation with Before/After comparison
- [x] Ground-truth feedback loop
- [x] File manager (CSV, PDF, images, JSON)
- [x] MongoDB + JSON fallback storage
- [ ] Custom dataset upload → auto-train pipeline
- [ ] PDF audit report generation
- [ ] Slack / webhook alerts on bias threshold breach
- [ ] Multi-model comparison view
- [ ] Role-based access control (auditor vs analyst vs admin)

<br/>

---

<div align="center">

**Built with care for Fair AI**

[![Python](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev)
[![Tailwind](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![scikit-learn](https://img.shields.io/badge/scikit--learn-F7931E?style=flat-square&logo=scikit-learn&logoColor=white)](https://scikit-learn.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=flat-square&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)

<br/>

*"Fairness is not a feature — it's a requirement."*

</div>
