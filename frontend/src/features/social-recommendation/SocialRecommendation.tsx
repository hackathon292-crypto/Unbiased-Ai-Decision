import { useEffect, useState } from 'react';
import { Share2, AlertTriangle, CheckCircle, XCircle, Loader2, Eye, ThumbsUp, MessageSquare, Repeat } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../lib/api';
import type { SocialResponse } from '../../lib/api';
import { useScanContext } from '../../components/ScanProvider';

interface SocialFormData {
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

const INITIAL_FORM: SocialFormData = {
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

const CONTENT_CATEGORIES = [
  'Technology', 'Sports', 'Entertainment', 'News', 'Education',
  'Health', 'Travel', 'Food', 'Fashion', 'Politics'
];

export function SocialRecommendation() {
  const { profiles, lastUpdated } = useScanContext();
  const [formData, setFormData] = useState<SocialFormData>(INITIAL_FORM);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SocialResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shapData, setShapData] = useState<Record<string, number> | null>(null);
  const [shapLoading, setShapLoading] = useState(false);

  useEffect(() => {
    setFormData({
      avg_session_minutes: profiles.social.avg_session_minutes,
      posts_per_day: profiles.social.posts_per_day,
      topics_interacted: profiles.social.topics_interacted,
      like_rate: profiles.social.like_rate,
      share_rate: profiles.social.share_rate,
      comment_rate: profiles.social.comment_rate,
      account_age_days: profiles.social.account_age_days,
      gender: profiles.social.gender,
      age_group: profiles.social.age_group,
      location: profiles.social.location,
      language: profiles.social.language,
    });
  }, [profiles.social, lastUpdated]);

  const handleInputChange = (field: keyof SocialFormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setResult(null);
    setShapData(null);
  };

  const handlePredict = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    setShapData(null);

    try {
      const payload = {
        avg_session_minutes: formData.avg_session_minutes,
        posts_per_day: formData.posts_per_day,
        topics_interacted: formData.topics_interacted,
        like_rate: formData.like_rate,
        share_rate: formData.share_rate,
        comment_rate: formData.comment_rate,
        account_age_days: formData.account_age_days,
        ...(formData.gender && { gender: formData.gender }),
        ...(formData.age_group && { age_group: formData.age_group }),
        ...(formData.location && { location: formData.location }),
        ...(formData.language && { language: formData.language }),
      };

      const response = await api.predictSocial(payload);
      setResult(response);

      // Fetch SHAP if available
      if (response.shap_available || response.shap_poll_url) {
        setShapLoading(true);
        try {
          const shapRes = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}${response.shap_poll_url}`);
          if (shapRes.ok) {
            const shapResult = await shapRes.json();
            if (shapResult.shap_values) {
              setShapData(shapResult.shap_values);
            }
          }
        } catch {
          // SHAP fetch is optional
        } finally {
          setShapLoading(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recommendation failed');
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData(INITIAL_FORM);
    setResult(null);
    setError(null);
    setShapData(null);
  };

  const shapChartData = shapData
    ? Object.entries(shapData).map(([feature, value]) => ({
        feature: feature.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        impact: Math.abs(value),
      })).sort((a, b) => b.impact - a.impact)
    : [];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-semibold dark:text-white flex items-center gap-3">
            <Share2 className="text-emerald-600" size={32} />
            Social Content Recommendation
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            Recommend content categories with fairness monitoring
          </p>
        </div>
        <button
          onClick={resetForm}
          className="px-6 py-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-2xl font-medium transition-all"
        >
          Reset Form
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Form Section */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-semibold mb-6 dark:text-white">User Engagement Profile</h2>

            <div className="space-y-5">
              {/* Session Time */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Avg. Session Minutes (Daily)
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="1440"
                    step="5"
                    value={formData.avg_session_minutes}
                    onChange={(e) => handleInputChange('avg_session_minutes', parseFloat(e.target.value))}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="w-20 text-right font-medium dark:text-white">
                    {formData.avg_session_minutes}m
                  </span>
                </div>
              </div>

              {/* Posts Per Day */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Posts Per Day
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.5"
                    value={formData.posts_per_day}
                    onChange={(e) => handleInputChange('posts_per_day', parseFloat(e.target.value))}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="w-16 text-right font-medium dark:text-white">
                    {formData.posts_per_day}
                  </span>
                </div>
              </div>

              {/* Topics Interacted */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Topics Interacted With
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="1"
                    value={formData.topics_interacted}
                    onChange={(e) => handleInputChange('topics_interacted', parseInt(e.target.value))}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="w-16 text-right font-medium dark:text-white">
                    {formData.topics_interacted}
                  </span>
                </div>
              </div>

              {/* Account Age */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  Account Age (Days)
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="10000"
                    step="30"
                    value={formData.account_age_days}
                    onChange={(e) => handleInputChange('account_age_days', parseInt(e.target.value))}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="w-20 text-right font-medium dark:text-white">
                    {Math.round(formData.account_age_days / 365)}y
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Engagement Rates */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-semibold mb-6 dark:text-white">Engagement Rates</h2>

            <div className="space-y-5">
              {/* Like Rate */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  <span className="flex items-center gap-2">
                    <ThumbsUp size={16} className="text-emerald-600" />
                    Like Rate
                  </span>
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={formData.like_rate}
                    onChange={(e) => handleInputChange('like_rate', parseFloat(e.target.value))}
                    className="flex-1 accent-emerald-600"
                  />
                  <span className="w-16 text-right font-medium dark:text-white">
                    {(formData.like_rate * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Share Rate */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  <span className="flex items-center gap-2">
                    <Repeat size={16} className="text-blue-600" />
                    Share Rate
                  </span>
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={formData.share_rate}
                    onChange={(e) => handleInputChange('share_rate', parseFloat(e.target.value))}
                    className="flex-1 accent-blue-600"
                  />
                  <span className="w-16 text-right font-medium dark:text-white">
                    {(formData.share_rate * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Comment Rate */}
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                  <span className="flex items-center gap-2">
                    <MessageSquare size={16} className="text-violet-600" />
                    Comment Rate
                  </span>
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={formData.comment_rate}
                    onChange={(e) => handleInputChange('comment_rate', parseFloat(e.target.value))}
                    className="flex-1 accent-violet-600"
                  />
                  <span className="w-16 text-right font-medium dark:text-white">
                    {(formData.comment_rate * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Protected Attributes */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3 mb-6">
              <AlertTriangle className="text-amber-500" size={24} />
              <h2 className="text-xl font-semibold dark:text-white">Protected Attributes (Optional)</h2>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
              Used for fairness monitoring only. Not used in recommendations.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Gender</label>
                <input
                  type="text"
                  value={formData.gender}
                  onChange={(e) => handleInputChange('gender', e.target.value)}
                  placeholder="e.g., male, female"
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Age Group</label>
                <input
                  type="text"
                  value={formData.age_group}
                  onChange={(e) => handleInputChange('age_group', e.target.value)}
                  placeholder="e.g., 18-25, 26-40, 65+"
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Location</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => handleInputChange('location', e.target.value)}
                  placeholder="e.g., USA, India, UK"
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Language</label>
                <input
                  type="text"
                  value={formData.language}
                  onChange={(e) => handleInputChange('language', e.target.value)}
                  placeholder="e.g., en, en-US, es"
                  className="w-full bg-zinc-100 dark:bg-zinc-800 border border-transparent focus:border-emerald-500 rounded-xl px-4 py-3 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Predict Button */}
          <button
            onClick={handlePredict}
            disabled={isLoading}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium rounded-2xl flex items-center justify-center gap-3 transition-all"
          >
            {isLoading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Generating Recommendation...
              </>
            ) : (
              <>
                <Share2 size={20} />
                Get Content Recommendation
              </>
            )}
          </button>

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
                    <h2 className="text-xl font-semibold dark:text-white">Recommended Content Category</h2>
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
                  <div className="text-5xl font-bold mb-4 text-emerald-600">
                    {result.recommended_category?.toUpperCase() || `CATEGORY ${result.recommended_category_id}`}
                  </div>
                  <div className="text-3xl font-semibold dark:text-white">
                    {(result.confidence * 100).toFixed(1)}%
                  </div>
                  <p className="text-zinc-500 dark:text-zinc-400 mt-2">Confidence</p>
                </div>

                {/* All Categories */}
                <div className="mt-6">
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">Available Categories:</p>
                  <div className="flex flex-wrap gap-2">
                    {CONTENT_CATEGORIES.map((cat, idx) => (
                      <span
                        key={cat}
                        className={`px-3 py-1 rounded-full text-sm ${
                          idx === result.recommended_category_id
                            ? 'bg-emerald-600 text-white'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
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
                      <Bar dataKey="impact" radius={[0, 4, 4, 0]} fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : result.shap_status && (
                <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <Eye className="text-zinc-400" size={24} />
                    <div>
                      <h2 className="font-semibold dark:text-white">SHAP Explanation</h2>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{result.shap_status}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Explanation */}
              {result.explanation && Array.isArray(result.explanation) && result.explanation.length > 0 && (
                <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
                  <h2 className="text-xl font-semibold mb-4 dark:text-white">Recommendation Factors</h2>
                  <ul className="space-y-2">
                    {result.explanation.map((item, idx) => (
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
              <Share2 className="mx-auto text-zinc-300 dark:text-zinc-700 mb-4" size={64} />
              <h3 className="text-xl font-semibold dark:text-white mb-2">No Recommendation Yet</h3>
              <p className="text-zinc-500 dark:text-zinc-400">
                Fill in user engagement data and click "Get Content Recommendation"
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
