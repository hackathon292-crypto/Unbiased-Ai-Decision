/**
 * api.ts — typed client for the Quantum backend.
 *
 * Base URL: VITE_API_BASE_URL env var (dev: http://localhost:8000).
 * Create frontend/.env.local with VITE_API_BASE_URL=http://localhost:8000
 * Set the same var in Netlify/Vercel for production pointing to Render URL.
 */

// Use relative URLs in development (proxied by Vite), full URL in production
const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

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
  if (!res.ok) {
    const payload = await res.json().catch(() => ({} as Record<string, unknown>));
    const typed = payload as {
      detail?: string;
      error?: string;
      reason?: string;
      code?: string;
      details?: Array<{ field?: string; message?: string }>;
    };

    const firstValidationError = typed.details?.find((d) => d?.message);
    const validationMessage = firstValidationError
      ? `${firstValidationError.field ? `${firstValidationError.field}: ` : ""}${firstValidationError.message}`
      : undefined;

    const message =
      typed.detail ||
      validationMessage ||
      typed.error ||
      typed.reason ||
      `POST ${path} → ${res.status}`;

    throw new Error(typed.code ? `${message} (${typed.code})` : message);
  }
  return res.json() as Promise<T>;
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface BiasRisk {
  score:                 number;
  band:                  "low" | "moderate" | "high";
  flag_for_review:       boolean;
  recommendation:        string;
  post_processing_applied: boolean;
}

export interface GroupMetrics {
  group:          string;
  n:              number;
  positive_rate:  number;
  avg_confidence: number;
  labelled_count: number;
  accuracy:       number | null;
}

export interface SummaryResponse {
  domain:                        string;
  n_records:                     number;
  labelled_count:                number;
  sensitive_attributes_detected: string[];
  demographic_parity_difference: number | null;
  equal_opportunity_difference:  number | null;
  per_group:                     GroupMetrics[];
  post_processing:               Record<string, unknown> | null;
  notes:                         string[];
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
  bias_risk:             BiasRisk | null;
}

export interface RecentResponse {
  domain:  string;
  count:   number;
  records: RecentPrediction[];
}

// ─── Request / Response types per domain ──────────────────────────────────────

export interface HiringRequest {
  years_experience:    number;   // 0–50
  education_level:     number;   // 0=HS 1=BSc 2=MSc 3=PhD
  technical_score:     number;   // 0–100
  communication_score: number;   // 0–100
  num_past_jobs:       number;   // 0–30
  certifications?:     number;   // 0–20, default 0
  gender?:             string;
  ethnicity?:          string;
}

export interface HiringResponse {
  prediction:       number;       // 0 or 1
  prediction_label: string;       // "Hired" | "Not Hired"
  confidence:       number;       // 0–1
  explanation:      string[];
  bias_risk:        BiasRisk;
  fairness:         Record<string, unknown>;
  correlation_id:   string;
  message:          string;
  model_version?:   string;
  model_variant?:   string;
  shap_available?:  boolean;
  shap_poll_url?:   string;
  shap_status?:     string;
}

export interface LoanRequest {
  credit_score:      number;   // 300–850
  annual_income:     number;   // USD
  loan_amount:       number;   // USD
  loan_term_months:  number;   // 6|12|18|24|30|36|48|60|84|120|180|240|360
  employment_years:  number;   // 0–50
  existing_debt?:    number;   // default 0
  num_credit_lines?: number;   // default 0
  gender?:           string;
  age_group?:        string;   // e.g. "26-40" or "65+"
  ethnicity?:        string;
}

export interface LoanResponse {
  prediction:       number;       // 0 or 1
  prediction_label: string;       // "Approved" | "Rejected"
  confidence:       number;
  explanation:      string[];
  bias_risk:        BiasRisk;
  fairness:         Record<string, unknown>;
  correlation_id:   string;
  message:          string;
  model_version?:   string;
  model_variant?:   string;
  shap_available?:  boolean;
  shap_poll_url?:   string;
  shap_status?:     string;
}

export interface SocialRequest {
  avg_session_minutes: number;   // 0–1440
  topics_interacted:   number;   // 0–50 (integer)
  like_rate:           number;   // 0–1
  posts_per_day?:      number;   // default 0
  share_rate?:         number;   // default 0
  comment_rate?:       number;   // default 0
  account_age_days?:   number;   // default 0
  gender?:             string;
  age_group?:          string;
  location?:           string;
  language?:           string;
}

export interface SocialResponse {
  recommended_category_id: number;
  recommended_category:    string;
  confidence:              number;
  explanation:             string[];
  bias_risk:               BiasRisk;
  fairness:                Record<string, unknown>;
  correlation_id:          string;
  message:                 string;
  model_version?:          string;
  model_variant?:          string;
  shap_available?:         boolean;
  shap_poll_url?:          string;
  shap_status?:            string;
}

export interface FeedbackRequest {
  correlation_id: string;
  ground_truth:   number;
}

export interface FeedbackResponse {
  correlation_id: string;
  updated:        boolean;   // backend field is "updated", not "success"
  message:        string;
}

// ─── File Upload Types ────────────────────────────────────────────────────────

export interface FileMetadata {
  id: string;
  filename: string;
  stored_name: string;
  size_bytes: number;
  size_human: string;
  mime_type: string;
  category: 'image' | 'document' | 'data' | 'archive' | 'other';
  extension: string;
  uploaded_at: string;
  description?: string;
  tags: string[];
  domain?: 'hiring' | 'loan' | 'social' | null;
  role?: 'dataset' | 'model' | 'document' | 'other' | null;
}

export interface FileUploadResponse {
  success: boolean;
  message: string;
  file: FileMetadata;
}

export interface FileListResponse {
  files: FileMetadata[];
  total: number;
  categories: Record<string, number>;
}

export interface FileStats {
  total_files: number;
  total_size_bytes: number;
  total_size_human: string;
  by_category: Record<string, number>;
  by_extension: Record<string, number>;
  upload_dir: string;
  max_file_size_mb: number;
}

// ─── Mitigation Types ─────────────────────────────────────────────────────────

export interface GroupThreshold {
  group: string;
  original_threshold: number;
  new_threshold: number;
  expected_approval_rate: number;
}

export interface MitigationResult {
  success: boolean;
  message: string;
  method: string;
  original_dpd?: number;
  mitigated_dpd?: number;
  original_eod?: number;
  mitigated_eod?: number;
  improvement_pct: number;
  new_thresholds: GroupThreshold[];
  affected_records: number;
  total_records: number;
  calibration_adjustments: Record<string, number>;
}

export interface MitigationMethodInfo {
  id: string;
  name: string;
  description: string;
  best_for: string[];
}

// ─── File Inspection types ───────────────────────────────────────────────────

export interface FileInspectionColumn {
  name: string;
  dtype: string;
  null_count: number;
  unique_count: number;
  sample_values: string[];
}

export interface FileInspectionResult {
  file_id: string;
  filename: string;
  extension: string;
  category: string;
  size_bytes: number;
  size_human: string;
  kind: 'tabular' | 'json' | 'yaml' | 'xml' | 'text' | 'image' | 'pdf' | 'model' | 'binary' | 'unknown';
  // tabular
  rows?: number;
  columns_count?: number;
  columns?: FileInspectionColumn[];
  preview_rows?: Record<string, unknown>[];
  numeric_stats?: Record<string, Record<string, number>>;
  // json / yaml
  root_type?: string;
  length?: number;
  key_count?: number;
  keys?: string[];
  item_keys?: string[];
  // text
  line_count?: number;
  word_count?: number;
  char_count?: number;
  preview?: string;
  // image
  width?: number;
  height?: number;
  mode?: string;
  format?: string;
  // pdf
  page_count?: number;
  metadata?: Record<string, string>;
  // misc
  note?: string;
  error?: string;
  root_tag?: string;
  child_count?: number;
  // model
  model_type?: string;
  module?: string;
  n_features_in?: number;
  classes?: string[];
  has_predict_proba?: boolean;
  inferred_domain?: 'hiring' | 'loan' | 'social';
  suggested_parameters?: Record<string, string | number>;
}

// ─── Dataset Analysis types ─────────────────────────────────────────────────────

export interface DatasetAnalysisResult {
  success: boolean;
  file_id: string;
  detected_domain: string | null;
  confidence: number;
  column_mapping?: Record<string, string>;
  rows_total: number;
  rows_predicted: number;
  rows_failed: number;
  summary?: {
    approval_rate: number;
    avg_confidence: number;
    high_bias_risk_count: number;
    flagged_for_review: number;
  };
  validation?: Record<string, unknown>;
  performance?: Record<string, unknown>;
  fairness?: Record<string, unknown>;
  scores?: {
    bias_score: number;
    fairness_score: number;
    performance_score: number;
    risk_score: number;
    final_recommendation: 'Accept' | 'Reject' | 'Retrain';
  };
  report?: Record<string, unknown>;
  target_column?: string | null;
  sensitive_columns?: Record<string, string>;
  model?: Record<string, unknown>;
  results_preview?: Array<Record<string, unknown>>;
  suggested_profile?: Record<string, string | number>;
  errors: Array<{ row: number; message: string }>;
  unmapped_columns?: string[];
  error?: string;
}

export interface FullScanResponse {
  success: boolean;
  dataset: {
    id: string;
    filename: string;
    domain: string | null;
  };
  model?: Record<string, unknown>;
  report?: Record<string, unknown>;
  scores?: DatasetAnalysisResult['scores'];
  summary?: DatasetAnalysisResult['summary'];
  validation?: Record<string, unknown>;
  performance?: Record<string, unknown>;
  fairness?: Record<string, unknown>;
  analysis: DatasetAnalysisResult;
  documents_scanned: number;
  message: string;
}

// ─── API client ───────────────────────────────────────────────────────────────

export const api = {
  // Health
  health: () =>
    get<Record<string, unknown>>("/health"),

  // Insights (read-only, powers Dashboard + BiasDetection)
  getSummary: (domain: "hiring" | "loan" | "social") =>
    get<SummaryResponse>(`/insights/${domain}/summary`),

  getRecent: (domain: "hiring" | "loan" | "social", limit = 100) =>
    get<RecentResponse>(`/insights/${domain}/recent?limit=${limit}`),

  // Predictions (powers FairnessExplorer)
  predictHiring: (body: HiringRequest) =>
    post<HiringResponse>("/hiring/predict", body),

  predictLoan: (body: LoanRequest) =>
    post<LoanResponse>("/loan/predict", body),

  predictSocial: (body: SocialRequest) =>
    post<SocialResponse>("/social/recommend", body),

  // Feedback (attach ground-truth to a previous prediction)
  feedback: (body: FeedbackRequest) =>
    post<FeedbackResponse>("/feedback", body),

  // File Upload (images, PDFs, docs, data files)
  uploadFile: (formData: FormData) => {
    return fetch(`${BASE}/files/upload`, {
      method: "POST",
      body: formData,
    }).then(async (res) => {
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Upload failed: ${res.status}`);
      }
      return res.json() as Promise<FileUploadResponse>;
    });
  },

  listFiles: (params?: { category?: string; domain?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.category) query.append("category", params.category);
    if (params?.domain) query.append("domain", params.domain);
    if (params?.limit) query.append("limit", String(params.limit));
    if (params?.offset) query.append("offset", String(params.offset));
    return get<FileListResponse>(`/files/list?${query.toString()}`);
  },

  getFileStats: () =>
    get<FileStats>("/files/stats"),

  downloadFile: (fileId: string) =>
    `${BASE}/files/download/${fileId}`,

  previewFile: (fileId: string) =>
    `${BASE}/files/preview/${fileId}`,

  deleteFile: (fileId: string) =>
    fetch(`${BASE}/files/delete/${fileId}`, { method: "DELETE" }).then(async (res) => {
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Delete failed: ${res.status}`);
      }
      return res.json();
    }),

  analyzeDataset: (fileId: string) =>
    post<DatasetAnalysisResult>(`/files/analyze/${fileId}`, {}),

  scanFiles: (body: { domain?: 'hiring' | 'loan' | 'social'; file_id?: string; max_rows?: number }) =>
    post<FullScanResponse>("/files/scan", body),

  inspectFile: (fileId: string) =>
    get<FileInspectionResult>(`/files/inspect/${fileId}`),

  // Mitigation (bias reduction algorithms)
  listMitigationMethods: () =>
    get<{ methods: MitigationMethodInfo[] }>("/mitigation/methods"),

  applyMitigation: (body: {
    domain: "hiring" | "loan" | "social";
    method: "threshold" | "calibration" | "impact_removal";
    target_metric?: "demographic_parity" | "equal_opportunity" | "calibration";
    strength?: number;
    protected_attribute?: string;
  }) =>
    post<MitigationResult>("/mitigation/apply", body),

  previewMitigation: (domain: string, method: string = "threshold") =>
    get<MitigationResult>(`/mitigation/preview/${domain}?method=${method}`),
};
