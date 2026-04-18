/**
 * api.ts — typed client for the Quantum backend.
 *
 * Base URL is read from VITE_API_BASE_URL env var (falls back to localhost
 * in dev, and must be set to the Render service URL in production).
 */

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface GroupMetrics {
  group:           string;
  n:               number;
  positive_rate:   number;
  avg_confidence:  number;
  labelled_count:  number;
  accuracy:        number | null;
}

export interface SummaryResponse {
  domain:                         string;
  n_records:                      number;
  labelled_count:                 number;
  sensitive_attributes_detected:  string[];
  demographic_parity_difference:  number | null;
  equal_opportunity_difference:   number | null;
  per_group:                      GroupMetrics[];
  post_processing:                Record<string, unknown> | null;
  notes:                          string[];
}

export interface RecentPrediction {
  correlation_id:        string | null;
  domain:                string;
  prediction:            number;
  prediction_label:      string | null;
  confidence:            number;
  sensitive_value_group: string | null;
  ground_truth:          number | null;
  timestamp:             string | null;
  bias_risk:             Record<string, unknown> | null;
}

export interface RecentResponse {
  domain:  string;
  count:   number;
  records: RecentPrediction[];
}

export interface HiringRequest {
  years_experience:    number;
  education_level:     number;
  technical_score:     number;
  communication_score: number;
  num_past_jobs:       number;
  certifications?:     number;
  gender?:             string;
  ethnicity?:          string;
}

export interface LoanRequest {
  credit_score:     number;
  annual_income:    number;
  loan_amount:      number;
  loan_term_months: number;
  employment_years: number;
  existing_debt?:   number;
  num_credit_lines?: number;
  gender?:          string;
  age_group?:       string;
  ethnicity?:       string;
}

export interface PredictionResponse {
  prediction:       number;
  prediction_label: string;
  confidence:       number;
  correlation_id:   string;
  bias_risk:        Record<string, unknown>;
  preprocessing:    Record<string, unknown>;
  explanation:      string[];
}

export interface FeedbackRequest {
  correlation_id: string;
  ground_truth:   number;
}

export interface FeedbackResponse {
  success:        boolean;
  correlation_id: string;
  message:        string;
}

// ─── API functions ─────────────────────────────────────────────────────────────

export const api = {
  getSummary:  (domain: "hiring" | "loan" | "social") =>
    get<SummaryResponse>(`/insights/${domain}/summary`),

  getRecent:   (domain: "hiring" | "loan" | "social", limit = 100) =>
    get<RecentResponse>(`/insights/${domain}/recent?limit=${limit}`),

  predictHiring: (body: HiringRequest) =>
    post<PredictionResponse>("/hiring/predict", body),

  predictLoan:   (body: LoanRequest) =>
    post<PredictionResponse>("/loan/predict", body),

  feedback: (body: FeedbackRequest) =>
    post<FeedbackResponse>("/feedback", body),

  health: () => get<Record<string, unknown>>("/health"),
};
