import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, type DatasetAnalysisResult, type FileInspectionResult, type HiringResponse, type LoanResponse, type SocialResponse } from '../lib/api';

type Domain = 'loan' | 'hiring' | 'social';

export interface LoanProfile {
  credit_score: number;
  annual_income: number;
  loan_amount: number;
  loan_term_months: number;
  employment_years: number;
  existing_debt: number;
  num_credit_lines: number;
  gender: string;
  age_group: string;
  ethnicity: string;
}

export interface HiringProfile {
  years_experience: number;
  education_level: number;
  technical_score: number;
  communication_score: number;
  num_past_jobs: number;
  certifications: number;
  gender: string;
  religion: string;
  ethnicity: string;
}

export interface SocialProfile {
  avg_session_minutes: number;
  posts_per_day: number;
  topics_interacted: number;
  like_rate: number;
  share_rate: number;
  comment_rate: number;
  account_age_days: number;
  gender: string;
  age_group: string;
  location: string;
  language: string;
}

export interface AutoPredictionSummary {
  domain: Domain;
  label: string;
  confidence: number;
  biasRisk?: number;
  recommendation?: string;
  timestamp: string;
}

interface ScanState {
  profiles: {
    loan: LoanProfile;
    hiring: HiringProfile;
    social: SocialProfile;
  };
  inferredDomains: Domain[];
  autoPredictions: Partial<Record<Domain, AutoPredictionSummary>>;
  insights: string[];
  lastUpdated: string | null;
}

interface IngestPayload {
  inspections: FileInspectionResult[];
  analyses: Array<{ result: DatasetAnalysisResult }>;
  insights?: string[];
}

interface ScanContextValue extends ScanState {
  ingestScanArtifacts: (payload: IngestPayload) => Promise<void>;
  resetProfiles: () => void;
}

const STORAGE_KEY = 'quantum.scan-state.v1';

const DEFAULT_LOAN: LoanProfile = {
  credit_score: 720,
  annual_income: 75000,
  loan_amount: 25000,
  loan_term_months: 36,
  employment_years: 5,
  existing_debt: 5000,
  num_credit_lines: 3,
  gender: '',
  age_group: '',
  ethnicity: '',
};

const DEFAULT_HIRING: HiringProfile = {
  years_experience: 5,
  education_level: 2,
  technical_score: 75,
  communication_score: 70,
  num_past_jobs: 3,
  certifications: 2,
  gender: '',
  religion: '',
  ethnicity: '',
};

const DEFAULT_SOCIAL: SocialProfile = {
  avg_session_minutes: 45,
  posts_per_day: 2,
  topics_interacted: 8,
  like_rate: 0.65,
  share_rate: 0.2,
  comment_rate: 0.1,
  account_age_days: 365,
  gender: '',
  age_group: '',
  location: '',
  language: '',
};

const DEFAULT_STATE: ScanState = {
  profiles: {
    loan: DEFAULT_LOAN,
    hiring: DEFAULT_HIRING,
    social: DEFAULT_SOCIAL,
  },
  inferredDomains: [],
  autoPredictions: {},
  insights: [],
  lastUpdated: null,
};

const ScanContext = createContext<ScanContextValue | null>(null);

function mergeRecord<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown> | undefined): T {
  if (!patch) return base;
  const next = { ...base };
  for (const key of Object.keys(base)) {
    const value = patch[key];
    if (value !== undefined && value !== null && value !== '') {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

function normalizeSuggestedValue(key: string, value: string | number): string | number {
  if (typeof value === 'number') return value;
  if (['like_rate', 'share_rate', 'comment_rate'].includes(key)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > 1 ? numeric / 100 : numeric;
    }
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && String(value).trim() !== '' ? numeric : value;
}

function loadInitialState(): ScanState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as ScanState;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      profiles: {
        loan: { ...DEFAULT_LOAN, ...(parsed.profiles?.loan ?? {}) },
        hiring: { ...DEFAULT_HIRING, ...(parsed.profiles?.hiring ?? {}) },
        social: { ...DEFAULT_SOCIAL, ...(parsed.profiles?.social ?? {}) },
      },
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ScanState>(loadInitialState);
  const predictionSignatureRef = useRef<Record<string, string>>({});

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const runAutoPredictions = useCallback(async (profiles: ScanState['profiles'], inferredDomains: Domain[]) => {
    const nextPredictions: Partial<Record<Domain, AutoPredictionSummary>> = {};

    for (const domain of inferredDomains) {
      const signature = JSON.stringify(profiles[domain]);
      if (predictionSignatureRef.current[domain] === signature) {
        continue;
      }

      try {
        if (domain === 'loan') {
          const response: LoanResponse = await api.predictLoan({
            credit_score: profiles.loan.credit_score,
            annual_income: profiles.loan.annual_income,
            loan_amount: profiles.loan.loan_amount,
            loan_term_months: profiles.loan.loan_term_months,
            employment_years: profiles.loan.employment_years,
            existing_debt: profiles.loan.existing_debt,
            num_credit_lines: profiles.loan.num_credit_lines,
            ...(profiles.loan.gender && { gender: profiles.loan.gender }),
            ...(profiles.loan.age_group && { age_group: profiles.loan.age_group }),
            ...(profiles.loan.ethnicity && { ethnicity: profiles.loan.ethnicity }),
          });
          nextPredictions.loan = {
            domain,
            label: response.prediction_label,
            confidence: response.confidence,
            biasRisk: response.bias_risk?.score,
            recommendation: response.bias_risk?.recommendation,
            timestamp: new Date().toISOString(),
          };
        } else if (domain === 'hiring') {
          const response: HiringResponse = await api.predictHiring({
            years_experience: profiles.hiring.years_experience,
            education_level: profiles.hiring.education_level,
            technical_score: profiles.hiring.technical_score,
            communication_score: profiles.hiring.communication_score,
            num_past_jobs: profiles.hiring.num_past_jobs,
            certifications: profiles.hiring.certifications,
            ...(profiles.hiring.gender && { gender: profiles.hiring.gender }),
            ...(profiles.hiring.religion && { religion: profiles.hiring.religion }),
            ...(profiles.hiring.ethnicity && { ethnicity: profiles.hiring.ethnicity }),
          });
          nextPredictions.hiring = {
            domain,
            label: response.prediction_label,
            confidence: response.confidence,
            biasRisk: response.bias_risk?.score,
            recommendation: response.bias_risk?.recommendation,
            timestamp: new Date().toISOString(),
          };
        } else {
          const response: SocialResponse = await api.predictSocial({
            avg_session_minutes: profiles.social.avg_session_minutes,
            posts_per_day: profiles.social.posts_per_day,
            topics_interacted: profiles.social.topics_interacted,
            like_rate: profiles.social.like_rate,
            share_rate: profiles.social.share_rate,
            comment_rate: profiles.social.comment_rate,
            account_age_days: profiles.social.account_age_days,
            ...(profiles.social.gender && { gender: profiles.social.gender }),
            ...(profiles.social.age_group && { age_group: profiles.social.age_group }),
            ...(profiles.social.location && { location: profiles.social.location }),
            ...(profiles.social.language && { language: profiles.social.language }),
          });
          nextPredictions.social = {
            domain,
            label: response.recommended_category,
            confidence: response.confidence,
            biasRisk: response.bias_risk?.score,
            recommendation: response.bias_risk?.recommendation,
            timestamp: new Date().toISOString(),
          };
        }
        predictionSignatureRef.current[domain] = signature;
      } catch {
        // Auto-prediction is best-effort; the UI still benefits from auto-filled forms.
      }
    }

    if (Object.keys(nextPredictions).length > 0) {
      setState((prev) => ({
        ...prev,
        autoPredictions: {
          ...prev.autoPredictions,
          ...nextPredictions,
        },
      }));
    }
  }, []);

  const ingestScanArtifacts = useCallback(async ({ inspections, analyses, insights = [] }: IngestPayload) => {
    const inferredDomains = new Set<Domain>();
    let nextProfiles = {
      ...state.profiles,
      loan: { ...state.profiles.loan },
      hiring: { ...state.profiles.hiring },
      social: { ...state.profiles.social },
    };

    for (const inspection of inspections) {
      const domain = inspection.inferred_domain;
      if (!domain) continue;
      inferredDomains.add(domain);
      const normalizedPatch = Object.fromEntries(
        Object.entries(inspection.suggested_parameters ?? {}).map(([key, value]) => [key, normalizeSuggestedValue(key, value)])
      );
      nextProfiles = {
        ...nextProfiles,
        [domain]: mergeRecord(nextProfiles[domain], normalizedPatch),
      };
    }

    for (const { result } of analyses) {
      const domain = result.detected_domain as Domain | null;
      if (!domain) continue;
      inferredDomains.add(domain);
      const normalizedPatch = Object.fromEntries(
        Object.entries(result.suggested_profile ?? {}).map(([key, value]) => [key, normalizeSuggestedValue(key, value)])
      );
      nextProfiles = {
        ...nextProfiles,
        [domain]: mergeRecord(nextProfiles[domain], normalizedPatch),
      };
    }

    const inferredList = Array.from(inferredDomains);
    const nextState: ScanState = {
      profiles: nextProfiles,
      inferredDomains: inferredList.length ? inferredList : state.inferredDomains,
      autoPredictions: state.autoPredictions,
      insights: insights.length ? insights : state.insights,
      lastUpdated: new Date().toISOString(),
    };
    setState((prev) => ({
      ...prev,
      ...nextState,
      autoPredictions: prev.autoPredictions,
    }));

    await runAutoPredictions(nextProfiles, inferredList);
  }, [runAutoPredictions, state.autoPredictions, state.insights, state.inferredDomains, state.profiles]);

  const resetProfiles = useCallback(() => {
    predictionSignatureRef.current = {};
    setState(DEFAULT_STATE);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo<ScanContextValue>(() => ({
    ...state,
    ingestScanArtifacts,
    resetProfiles,
  }), [state, ingestScanArtifacts, resetProfiles]);

  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

export function useScanContext() {
  const ctx = useContext(ScanContext);
  if (!ctx) {
    throw new Error('useScanContext must be used within ScanProvider');
  }
  return ctx;
}
