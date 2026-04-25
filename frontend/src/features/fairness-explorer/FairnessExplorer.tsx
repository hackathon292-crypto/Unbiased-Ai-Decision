import { useState, useCallback, useEffect } from 'react';
import { Zap, RefreshCw, AlertTriangle, Loader2, Briefcase, DollarSign, Share2, Eye } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../lib/api';
import type { HiringResponse, LoanResponse, SocialResponse } from '../../lib/api';
import { FeedbackForm } from '../../components/FeedbackForm';
import { useScanContext } from '../../components/ScanProvider';

type Domain = 'loan' | 'hiring' | 'social';

interface DomainConfig {
  id: Domain;
  label: string;
  icon: typeof DollarSign;
  color: string;
}

const DOMAINS: DomainConfig[] = [
  { id: 'loan', label: 'Loan Approval', icon: DollarSign, color: 'emerald' },
  { id: 'hiring', label: 'Hiring Decision', icon: Briefcase, color: 'blue' },
  { id: 'social', label: 'Social Recommend', icon: Share2, color: 'violet' },
];

// Loan form state
interface LoanForm {
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

// Hiring form state
interface HiringForm {
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

// Social form state
interface SocialForm {
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

const DEFAULT_LOAN_FORM: LoanForm = {
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

const DEFAULT_HIRING_FORM: HiringForm = {
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

const DEFAULT_SOCIAL_FORM: SocialForm = {
  avg_session_minutes: 45,
  posts_per_day: 2,
  topics_interacted: 8,
  like_rate: 0.65,
  share_rate: 0.20,
  comment_rate: 0.10,
  account_age_days: 365,
  gender: '',
  age_group: '',
  location: '',
  language: '',
};

const EDUCATION_LEVELS = [
  { value: 0, label: 'High School' },
  { value: 1, label: "Bachelor's Degree" },
  { value: 2, label: "Master's Degree" },
  { value: 3, label: 'PhD' },
];

const LOAN_TERMS = [6, 12, 18, 24, 30, 36, 48, 60, 84, 120, 180, 240, 360];

export function FairnessExplorer() {
  const { profiles, inferredDomains, lastUpdated } = useScanContext();
  const [activeDomain, setActiveDomain] = useState<Domain>('loan');
  
  // Form states
  const [loanForm, setLoanForm] = useState<LoanForm>(DEFAULT_LOAN_FORM);
  const [hiringForm, setHiringForm] = useState<HiringForm>(DEFAULT_HIRING_FORM);
  const [socialForm, setSocialForm] = useState<SocialForm>(DEFAULT_SOCIAL_FORM);
  
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<LoanResponse | HiringResponse | SocialResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shapData, setShapData] = useState<Record<string, number> | null>(null);
  const [shapLoading, setShapLoading] = useState(false);

  useEffect(() => {
    setLoanForm(profiles.loan);
    setHiringForm(profiles.hiring);
    setSocialForm(profiles.social);
    if (inferredDomains.length === 1) {
      setActiveDomain(inferredDomains[0]);
    }
  }, [profiles, inferredDomains, lastUpdated]);

  // Fetch SHAP when result changes
  useEffect(() => {
    if (!result?.shap_poll_url) return;
    
    const fetchShap = async () => {
      setShapLoading(true);
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}${result.shap_poll_url}`);
        if (res.ok) {
          const data = await res.json();
          if (data.shap_values) {
            setShapData(data.shap_values);
          }
        }
      } catch {
        // SHAP fetch is optional
      } finally {
        setShapLoading(false);
      }
    };
    
    fetchShap();
  }, [result?.shap_poll_url]);

  const handlePredict = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    setShapData(null);

    try {
      let response;
      
      switch (activeDomain) {
        case 'loan': {
          const payload = {
            credit_score: loanForm.credit_score,
            annual_income: loanForm.annual_income,
            loan_amount: loanForm.loan_amount,
            loan_term_months: loanForm.loan_term_months,
            employment_years: loanForm.employment_years,
            existing_debt: loanForm.existing_debt,
            num_credit_lines: loanForm.num_credit_lines,
            ...(loanForm.gender && { gender: loanForm.gender }),
            ...(loanForm.age_group && { age_group: loanForm.age_group }),
            ...(loanForm.ethnicity && { ethnicity: loanForm.ethnicity }),
          };
          response = await api.predictLoan(payload);
          break;
        }
        case 'hiring': {
          const payload = {
            years_experience: hiringForm.years_experience,
            education_level: hiringForm.education_level,
            technical_score: hiringForm.technical_score,
            communication_score: hiringForm.communication_score,
            num_past_jobs: hiringForm.num_past_jobs,
            certifications: hiringForm.certifications,
            ...(hiringForm.gender && { gender: hiringForm.gender }),
            ...(hiringForm.religion && { religion: hiringForm.religion }),
            ...(hiringForm.ethnicity && { ethnicity: hiringForm.ethnicity }),
          };
          response = await api.predictHiring(payload);
          break;
        }
        case 'social': {
          const payload = {
            avg_session_minutes: socialForm.avg_session_minutes,
            posts_per_day: socialForm.posts_per_day,
            topics_interacted: socialForm.topics_interacted,
            like_rate: socialForm.like_rate,
            share_rate: socialForm.share_rate,
            comment_rate: socialForm.comment_rate,
            account_age_days: socialForm.account_age_days,
            ...(socialForm.gender && { gender: socialForm.gender }),
            ...(socialForm.age_group && { age_group: socialForm.age_group }),
            ...(socialForm.location && { location: socialForm.location }),
            ...(socialForm.language && { language: socialForm.language }),
          };
          response = await api.predictSocial(payload);
          break;
        }
      }
      
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prediction failed');
    } finally {
      setIsLoading(false);
    }
  }, [activeDomain, loanForm, hiringForm, socialForm]);

  const resetForm = () => {
    switch (activeDomain) {
      case 'loan':
        setLoanForm(DEFAULT_LOAN_FORM);
        break;
      case 'hiring':
        setHiringForm(DEFAULT_HIRING_FORM);
        break;
      case 'social':
        setSocialForm(DEFAULT_SOCIAL_FORM);
        break;
    }
    setResult(null);
    setError(null);
    setShapData(null);
  };

  const getResultLabel = () => {
    if (!result) return '';
    switch (activeDomain) {
      case 'loan':
        return (result as LoanResponse).prediction === 1 ? 'APPROVED' : 'REJECTED';
      case 'hiring':
        return (result as HiringResponse).prediction === 1 ? 'HIRED' : 'NOT HIRED';
      case 'social':
        return (result as SocialResponse).recommended_category?.toUpperCase() || `CATEGORY ${(result as SocialResponse).recommended_category_id}`;
    }
  };

  const shapChartData = shapData
    ? Object.entries(shapData).map(([feature, value]) => ({
        feature: feature.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        impact: Math.abs(value),
      })).sort((a, b) => b.impact - a.impact).slice(0, 10)
    : [];

  const renderLoanForm = () => (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Credit Score</label>
        <div className="flex items-center gap-4">
          <input type="range" min="300" max="850" value={loanForm.credit_score}
            onChange={(e) => setLoanForm({ ...loanForm, credit_score: parseInt(e.target.value) })}
            className="flex-1 accent-emerald-600" />
          <span className="w-16 text-right font-medium dark:text-white">{loanForm.credit_score}</span>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Annual Income ($)</label>
        <div className="flex items-center gap-4">
          <input type="range" min="0" max="500000" step="5000" value={loanForm.annual_income}
            onChange={(e) => setLoanForm({ ...loanForm, annual_income: parseInt(e.target.value) })}
            className="flex-1 accent-emerald-600" />
          <span className="w-20 text-right font-medium dark:text-white">${loanForm.annual_income.toLocaleString()}</span>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Loan Amount ($)</label>
        <div className="flex items-center gap-4">
          <input type="range" min="1000" max="500000" step="1000" value={loanForm.loan_amount}
            onChange={(e) => setLoanForm({ ...loanForm, loan_amount: parseInt(e.target.value) })}
            className="flex-1 accent-emerald-600" />
          <span className="w-20 text-right font-medium dark:text-white">${loanForm.loan_amount.toLocaleString()}</span>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Loan Term (Months)</label>
        <select value={loanForm.loan_term_months}
          onChange={(e) => setLoanForm({ ...loanForm, loan_term_months: parseInt(e.target.value) })}
          className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white">
          {LOAN_TERMS.map(term => <option key={term} value={term}>{term} months</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Employment Years</label>
        <div className="flex items-center gap-4">
          <input type="range" min="0" max="50" step="0.5" value={loanForm.employment_years}
            onChange={(e) => setLoanForm({ ...loanForm, employment_years: parseFloat(e.target.value) })}
            className="flex-1 accent-emerald-600" />
          <span className="w-16 text-right font-medium dark:text-white">{loanForm.employment_years}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Gender</label>
          <input type="text" value={loanForm.gender} placeholder="e.g., male, female"
            onChange={(e) => setLoanForm({ ...loanForm, gender: e.target.value })}
            className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white" />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Age Group</label>
          <input type="text" value={loanForm.age_group} placeholder="e.g., 26-40"
            onChange={(e) => setLoanForm({ ...loanForm, age_group: e.target.value })}
            className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white" />
        </div>
      </div>
    </div>
  );

  const renderHiringForm = () => (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Years of Experience</label>
        <div className="flex items-center gap-4">
          <input type="range" min="0" max="50" step="0.5" value={hiringForm.years_experience}
            onChange={(e) => setHiringForm({ ...hiringForm, years_experience: parseFloat(e.target.value) })}
            className="flex-1 accent-blue-600" />
          <span className="w-16 text-right font-medium dark:text-white">{hiringForm.years_experience}</span>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Education Level</label>
        <select value={hiringForm.education_level}
          onChange={(e) => setHiringForm({ ...hiringForm, education_level: parseInt(e.target.value) })}
          className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-blue-500 rounded-xl px-4 py-3 dark:text-white">
          {EDUCATION_LEVELS.map(level => <option key={level.value} value={level.value}>{level.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Technical Score</label>
          <input type="range" min="0" max="100" value={hiringForm.technical_score}
            onChange={(e) => setHiringForm({ ...hiringForm, technical_score: parseInt(e.target.value) })}
            className="w-full accent-blue-600" />
          <span className="text-sm dark:text-white">{hiringForm.technical_score}/100</span>
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Communication Score</label>
          <input type="range" min="0" max="100" value={hiringForm.communication_score}
            onChange={(e) => setHiringForm({ ...hiringForm, communication_score: parseInt(e.target.value) })}
            className="w-full accent-blue-600" />
          <span className="text-sm dark:text-white">{hiringForm.communication_score}/100</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Gender</label>
          <input type="text" value={hiringForm.gender} placeholder="e.g., male, female"
            onChange={(e) => setHiringForm({ ...hiringForm, gender: e.target.value })}
            className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-blue-500 rounded-xl px-4 py-3 dark:text-white" />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Ethnicity</label>
          <input type="text" value={hiringForm.ethnicity} placeholder="e.g., asian, caucasian"
            onChange={(e) => setHiringForm({ ...hiringForm, ethnicity: e.target.value })}
            className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-blue-500 rounded-xl px-4 py-3 dark:text-white" />
        </div>
      </div>
    </div>
  );

  const renderSocialForm = () => (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Avg Session Minutes</label>
        <div className="flex items-center gap-4">
          <input type="range" min="0" max="1440" step="5" value={socialForm.avg_session_minutes}
            onChange={(e) => setSocialForm({ ...socialForm, avg_session_minutes: parseInt(e.target.value) })}
            className="flex-1 accent-violet-600" />
          <span className="w-20 text-right font-medium dark:text-white">{socialForm.avg_session_minutes}m</span>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Like Rate</label>
        <div className="flex items-center gap-4">
          <input type="range" min="0" max="1" step="0.01" value={socialForm.like_rate}
            onChange={(e) => setSocialForm({ ...socialForm, like_rate: parseFloat(e.target.value) })}
            className="flex-1 accent-violet-600" />
          <span className="w-16 text-right font-medium dark:text-white">{(socialForm.like_rate * 100).toFixed(0)}%</span>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Topics Interacted</label>
        <div className="flex items-center gap-4">
          <input type="range" min="0" max="50" value={socialForm.topics_interacted}
            onChange={(e) => setSocialForm({ ...socialForm, topics_interacted: parseInt(e.target.value) })}
            className="flex-1 accent-violet-600" />
          <span className="w-16 text-right font-medium dark:text-white">{socialForm.topics_interacted}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Gender</label>
          <input type="text" value={socialForm.gender} placeholder="e.g., male, female"
            onChange={(e) => setSocialForm({ ...socialForm, gender: e.target.value })}
            className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-violet-500 rounded-xl px-4 py-3 dark:text-white" />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Age Group</label>
          <input type="text" value={socialForm.age_group} placeholder="e.g., 18-25"
            onChange={(e) => setSocialForm({ ...socialForm, age_group: e.target.value })}
            className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-violet-500 rounded-xl px-4 py-3 dark:text-white" />
        </div>
      </div>
    </div>
  );

  const activeColor = DOMAINS.find(d => d.id === activeDomain)?.color || 'emerald';

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-semibold dark:text-white flex items-center gap-3">
            <Zap className="text-emerald-600" size={32} />
            Fairness Explorer
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            What-If Analysis • Test predictions across all domains
          </p>
        </div>
        <button onClick={resetForm}
          className="flex items-center gap-2 px-6 py-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-2xl font-medium">
          <RefreshCw size={18} />
          Reset
        </button>
      </div>

      {/* Domain Selector */}
      <div className="flex gap-3">
        {DOMAINS.map(domain => {
          const Icon = domain.icon;
          const isActive = activeDomain === domain.id;
          return (
            <button
              key={domain.id}
              onClick={() => {
                setActiveDomain(domain.id);
                setResult(null);
                setError(null);
                setShapData(null);
              }}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-medium transition-all ${
                isActive
                  ? `bg-${domain.color}-600 text-white`
                  : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50'
              }`}
            >
              <Icon size={20} />
              {domain.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Form Section */}
        <div className="lg:col-span-5">
          <div className={`bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800`}>
            <h2 className="text-xl font-semibold mb-6 dark:text-white">
              {DOMAINS.find(d => d.id === activeDomain)?.label} Parameters
            </h2>
            
            {activeDomain === 'loan' && renderLoanForm()}
            {activeDomain === 'hiring' && renderHiringForm()}
            {activeDomain === 'social' && renderSocialForm()}

            <button
              onClick={handlePredict}
              disabled={isLoading}
              className={`w-full mt-8 py-4 bg-${activeColor}-600 hover:bg-${activeColor}-700 disabled:bg-zinc-400 text-white font-medium rounded-2xl flex items-center justify-center gap-3 transition-all`}
            >
              {isLoading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Predicting...
                </>
              ) : (
                <>
                  <Zap size={20} />
                  Get Prediction
                </>
              )}
            </button>

            {error && (
              <div className="mt-4 p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl text-red-700 dark:text-red-300">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={18} />
                  <span className="font-medium">{error}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Results Section */}
        <div className="lg:col-span-7 space-y-6">
          {result ? (
            <>
              {/* Main Result */}
              <div className={`rounded-3xl p-8 border-2 ${
                result.bias_risk?.flag_for_review 
                  ? 'border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800' 
                  : `border-${activeColor}-200 bg-white dark:bg-zinc-900 dark:border-${activeColor}-800`
              }`}>
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold dark:text-white">Prediction Result</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                      ID: <code className="bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">{result.correlation_id}</code>
                    </p>
                  </div>
                  {result.bias_risk?.flag_for_review && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-full text-sm font-medium">
                      <AlertTriangle size={16} />
                      Flagged for Review
                    </div>
                  )}
                </div>

                <div className="text-center py-8">
                  <div className={`text-5xl font-bold mb-4 text-${activeColor}-600`}>
                    {getResultLabel()}
                  </div>
                  <div className="text-3xl font-semibold dark:text-white">
                    {(result.confidence * 100).toFixed(1)}%
                  </div>
                  <p className="text-zinc-500 dark:text-zinc-400 mt-2">Confidence</p>
                </div>

                {/* Bias Risk */}
                {result.bias_risk && (
                  <div className="mt-6 p-4 bg-white dark:bg-zinc-800 rounded-2xl">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium dark:text-white">Bias Risk Score</span>
                      <span className={`font-bold ${
                        result.bias_risk.score > 0.7 ? 'text-red-600' : 
                        result.bias_risk.score > 0.4 ? 'text-amber-500' : 'text-emerald-600'
                      }`}>
                        {(result.bias_risk.score * 100).toFixed(0)}/100
                      </span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
                      <div className={`h-2 rounded-full ${
                        result.bias_risk.score > 0.7 ? 'bg-red-600' : 
                        result.bias_risk.score > 0.4 ? 'bg-amber-500' : 'bg-emerald-600'
                      }`} style={{ width: `${result.bias_risk.score * 100}%` }} />
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
                      {result.bias_risk.recommendation}
                    </p>
                  </div>
                )}
              </div>

              {/* SHAP Explanation */}
              {shapLoading ? (
                <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center justify-center gap-3 text-zinc-500">
                    <Loader2 size={20} className="animate-spin" />
                    Loading SHAP explanation...
                  </div>
                </div>
              ) : shapChartData.length > 0 ? (
                <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-3 mb-6">
                    <Eye className={`text-${activeColor}-600`} size={24} />
                    <h2 className="text-xl font-semibold dark:text-white">Feature Importance (SHAP)</h2>
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={shapChartData} layout="vertical">
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="feature" width={150} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="impact" radius={[0, 4, 4, 0]} fill={`#10b981`} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : null}

              {/* Feedback Form */}
              <FeedbackForm
                correlationId={result.correlation_id}
                predictionLabel={getResultLabel()}
                domain={activeDomain}
              />
            </>
          ) : (
            <div className="bg-zinc-50 dark:bg-zinc-900 rounded-3xl p-12 border border-zinc-200 dark:border-zinc-800 text-center">
              <Zap className="mx-auto text-zinc-300 dark:text-zinc-700 mb-4" size={64} />
              <h3 className="text-xl font-semibold dark:text-white mb-2">No Prediction Yet</h3>
              <p className="text-zinc-500 dark:text-zinc-400">
                Adjust the parameters and click "Get Prediction" to see results
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
