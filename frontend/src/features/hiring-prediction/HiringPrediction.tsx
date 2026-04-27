import { useCallback, useEffect, useRef, useState } from 'react';
import { Briefcase, AlertTriangle, CheckCircle, XCircle, Loader2, Eye } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../lib/api';
import type { HiringResponse } from '../../lib/api';
import { useScanContext } from '../../components/ScanProvider';

interface HiringFormData {
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

const INITIAL_FORM: HiringFormData = {
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

const EDUCATION_LEVELS = [
  { value: 0, label: 'High School' },
  { value: 1, label: "Bachelor's Degree" },
  { value: 2, label: "Master's Degree" },
  { value: 3, label: 'PhD' },
];

export function HiringPrediction() {
  const { profiles, inferredDomains, lastUpdated } = useScanContext();
  const [formData, setFormData] = useState<HiringFormData>(INITIAL_FORM);
  const lastAutoPredictionKeyRef = useRef<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<HiringResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shapData, setShapData] = useState<Record<string, number> | null>(null);
  const [shapExplanation, setShapExplanation] = useState<string | null>(null);
  const [shapLoading, setShapLoading] = useState(false);

  useEffect(() => {
    if (!inferredDomains.includes('hiring')) return;
    setFormData({
      years_experience: profiles.hiring.years_experience,
      education_level: profiles.hiring.education_level,
      technical_score: profiles.hiring.technical_score,
      communication_score: profiles.hiring.communication_score,
      num_past_jobs: profiles.hiring.num_past_jobs,
      certifications: profiles.hiring.certifications,
      gender: profiles.hiring.gender,
      religion: profiles.hiring.religion,
      ethnicity: profiles.hiring.ethnicity,
    });
  }, [profiles.hiring, inferredDomains, lastUpdated]);

  const formSyncedWithProfile = JSON.stringify(formData) === JSON.stringify(profiles.hiring);
  const hasHiringScanData = inferredDomains.includes('hiring') && Boolean(lastUpdated);

  const handlePredict = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    setShapData(null);
    setShapExplanation(null);

    try {
      const payload = {
        years_experience: formData.years_experience,
        education_level: formData.education_level,
        technical_score: formData.technical_score,
        communication_score: formData.communication_score,
        num_past_jobs: formData.num_past_jobs,
        certifications: formData.certifications,
        ...(formData.gender && { gender: formData.gender }),
        ...(formData.religion && { religion: formData.religion }),
        ...(formData.ethnicity && { ethnicity: formData.ethnicity }),
      };

      const response = await api.predictHiring(payload);
      setResult(response);
      if (typeof response.explanation === 'string') {
        setShapExplanation(response.explanation);
      }

      // Fetch SHAP if available
      if (response.shap_available || response.shap_poll_url) {
        setShapLoading(true);
        try {
          for (let attempt = 0; attempt < 10; attempt += 1) {
            const shapResult = await api.getShapReport(response.shap_poll_url ?? '');
            if (shapResult.shap_report?.shap_values) {
              setShapData(shapResult.shap_report.shap_values);
            }
            if (shapResult.shap_report?.explanation) {
              setShapExplanation(shapResult.shap_report.explanation);
            }
            if (shapResult.status === 'ready' || shapResult.status === 'error') {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
        } catch {
          // SHAP fetch is optional
        } finally {
          setShapLoading(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prediction failed');
    } finally {
      setIsLoading(false);
    }
  }, [formData]);

  useEffect(() => {
    if (!hasHiringScanData || !formSyncedWithProfile || isLoading || !lastUpdated) return;
    const token = lastUpdated;
    const autoKey = `${token}:${JSON.stringify(formData)}`;
    if (lastAutoPredictionKeyRef.current === autoKey) return;
    lastAutoPredictionKeyRef.current = autoKey;
    void handlePredict();
  }, [formData, formSyncedWithProfile, hasHiringScanData, isLoading, lastUpdated, handlePredict]);

  const shapChartData = shapData
    ? Object.entries(shapData).map(([feature, value]) => ({
        feature: feature.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        impact: Math.abs(value),
        direction: value > 0 ? 'positive' : 'negative',
      })).sort((a, b) => b.impact - a.impact)
    : [];
  const explanationItems = result?.explanation
    ? Array.isArray(result.explanation)
      ? result.explanation
      : [result.explanation]
    : [];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-semibold dark:text-white flex items-center gap-3">
            <Briefcase className="text-emerald-600" size={32} />
            Hiring Prediction
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            Predict candidate hiring decisions with fairness monitoring
          </p>
        </div>
        <div className="px-4 py-2 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-600 dark:text-zinc-300">
          Auto profile mode
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Form Section */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-semibold mb-6 dark:text-white">Candidate Information</h2>

            <fieldset disabled className="space-y-5 opacity-80 pointer-events-none">
              {/* Years Experience */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Years of Experience
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="0.5"
                    value={formData.years_experience}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="w-16 text-right font-medium dark:text-white">
                    {formData.years_experience}
                  </span>
                </div>
              </div>

              {/* Education Level */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Education Level
                </label>
                <select
                  value={formData.education_level}
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white"
                >
                  {EDUCATION_LEVELS.map(level => (
                    <option key={level.value} value={level.value}>{level.label}</option>
                  ))}
                </select>
              </div>

              {/* Technical Score */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Technical Assessment Score
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={formData.technical_score}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="w-16 text-right font-medium dark:text-white">
                    {formData.technical_score}
                  </span>
                </div>
              </div>

              {/* Communication Score */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Communication Score
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={formData.communication_score}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="w-16 text-right font-medium dark:text-white">
                    {formData.communication_score}
                  </span>
                </div>
              </div>

              {/* Number of Past Jobs */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Number of Past Jobs
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="1"
                    value={formData.num_past_jobs}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="w-16 text-right font-medium dark:text-white">
                    {formData.num_past_jobs}
                  </span>
                </div>
              </div>

              {/* Certifications */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Professional Certifications
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="1"
                    value={formData.certifications}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="w-16 text-right font-medium dark:text-white">
                    {formData.certifications}
                  </span>
                </div>
              </div>
            </fieldset>
          </div>

          {/* Protected Attributes */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3 mb-6">
              <AlertTriangle className="text-amber-500" size={24} />
              <h2 className="text-xl font-semibold dark:text-white">Protected Attributes (Optional)</h2>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
              Used for fairness monitoring only. Not used in prediction.
            </p>

            <fieldset disabled className="space-y-4 opacity-80 pointer-events-none">
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Gender</label>
                <input
                  type="text"
                  value={formData.gender}
                  placeholder="e.g., male, female, non-binary"
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Religion</label>
                <input
                  type="text"
                  value={formData.religion}
                  placeholder="e.g., christian, muslim, hindu"
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Ethnicity</label>
                <input
                  type="text"
                  value={formData.ethnicity}
                  placeholder="e.g., asian, caucasian, african"
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white"
                />
              </div>
            </fieldset>
          </div>

          <div className="w-full py-4 bg-emerald-600 text-white font-medium rounded-2xl flex items-center justify-center gap-3">
            {isLoading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Analyzing Candidate Automatically...
              </>
            ) : (
              <>
                <Briefcase size={20} />
                Insights Auto-Generated From Scan
              </>
            )}
          </div>

          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl text-red-700 dark:text-red-300">
              <div className="flex items-center gap-2">
                <XCircle size={18} />
                <span className="font-medium">{error}</span>
              </div>
            </div>
          )}
        </div>

        {/* Results Section */}
        <div className="lg:col-span-7 space-y-6">
          {result ? (
            <>
              {/* Main Result Card */}
              <div className={`rounded-3xl p-8 border-2 ${result.bias_risk?.flag_for_review ? 'border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800' : 'border-emerald-200 bg-white dark:bg-zinc-900 dark:border-emerald-800'}`}>
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold dark:text-white">Prediction Result</h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                      Correlation ID: <code className="bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">{result.correlation_id}</code>
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
                  <div className={`text-6xl font-bold mb-4 ${result.prediction === 1 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {result.prediction === 1 ? 'HIRED' : 'NOT HIRED'}
                  </div>
                  <div className="text-3xl font-semibold dark:text-white">
                    {(result.confidence * 100).toFixed(1)}%
                  </div>
                  <p className="text-zinc-500 dark:text-zinc-400 mt-2">Confidence</p>
                </div>

                {result.bias_risk && (
                  <div className="mt-6 p-4 bg-white dark:bg-zinc-800 rounded-2xl">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium dark:text-white">Bias Risk Score</span>
                      <span className={`font-bold ${result.bias_risk.score > 0.7 ? 'text-red-600' : result.bias_risk.score > 0.4 ? 'text-amber-500' : 'text-emerald-600'}`}>
                        {(result.bias_risk.score * 100).toFixed(0)}/100
                      </span>
                    </div>
                    <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${result.bias_risk.score > 0.7 ? 'bg-red-600' : result.bias_risk.score > 0.4 ? 'bg-amber-500' : 'bg-emerald-600'}`}
                        style={{ width: `${result.bias_risk.score * 100}%` }}
                      />
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
              ) : shapData && shapChartData.length > 0 ? (
                <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-3 mb-6">
                    <Eye className="text-emerald-600" size={24} />
                    <h2 className="text-xl font-semibold dark:text-white">Feature Importance (SHAP)</h2>
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={shapChartData} layout="vertical">
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="feature" width={150} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar
                        dataKey="impact"
                        radius={[0, 4, 4, 0]}
                        fill="#10b981"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-4">
                    Shows which features most influenced this prediction
                  </p>
                </div>
              ) : result.shap_status && (
                <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <Eye className="text-zinc-400" size={24} />
                    <div>
                      <h2 className="font-semibold dark:text-white">SHAP Explanation</h2>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{result.shap_status}</p>
                      {shapExplanation && (
                        <p className="text-sm text-zinc-600 dark:text-zinc-300 mt-2">{shapExplanation}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Explanation */}
              {explanationItems.length > 0 && (
                <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
                  <h2 className="text-xl font-semibold mb-4 dark:text-white">Decision Explanation</h2>
                  <ul className="space-y-2">
                    {explanationItems.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <CheckCircle size={18} className="text-emerald-600 mt-0.5" />
                        <span className="dark:text-white">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Model Info */}
              <div className="bg-zinc-50 dark:bg-zinc-900 rounded-3xl p-6 border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 dark:text-zinc-400">Model Version</span>
                  <span className="font-medium dark:text-white">{result.model_version}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-2">
                  <span className="text-zinc-500 dark:text-zinc-400">Variant</span>
                  <span className="font-medium dark:text-white">{result.model_variant}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-zinc-50 dark:bg-zinc-900 rounded-3xl p-12 border border-zinc-200 dark:border-zinc-800 text-center">
              <Briefcase className="mx-auto text-zinc-300 dark:text-zinc-700 mb-4" size={64} />
              <h3 className="text-xl font-semibold dark:text-white mb-2">No Prediction Yet</h3>
              <p className="text-zinc-500 dark:text-zinc-400">
                {hasHiringScanData
                  ? 'Waiting for analyzed hiring data to auto-generate insights.'
                  : 'Analyze a hiring-related file first to auto-fill values and generate a prediction.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
