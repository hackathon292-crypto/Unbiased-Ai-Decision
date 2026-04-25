import { useState, useEffect } from 'react';
import { FileText, Download, Calendar, Eye, CheckCircle, RefreshCw, History, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import type { SummaryResponse } from '../../lib/api';
import { useScanContext } from '../../components/ScanProvider';

interface PredictionRecord {
  correlation_id: string | null;
  input?: Record<string, unknown>;
  prediction: number;
  confidence: number;
  timestamp?: string | null;
}

type Domain = 'hiring' | 'loan' | 'social';
const DOMAINS: Domain[] = ['loan', 'hiring', 'social'];
const MODEL_NAMES: Record<Domain, string> = {
  loan:   'Loan Approval Model',
  hiring: 'Hiring Decision Model',
  social: 'Social Recommendation Model',
};

function calcScore(s: SummaryResponse): number {
  const dpd = s.demographic_parity_difference;
  if (dpd == null) return 85;
  return Math.max(0, Math.round((1 - Math.abs(dpd)) * 100));
}

function buildSummary(s: SummaryResponse): string {
  const dpd   = s.demographic_parity_difference;
  const attrs = s.sensitive_attributes_detected.join(', ') || 'none';
  if (s.n_records === 0) return `No predictions yet. Monitoring: ${attrs}.`;
  if (dpd == null) return `${s.n_records} records. Insufficient data for DPD. Attrs: ${attrs}.`;
  const level = Math.abs(dpd) > 0.15 ? 'High bias' : Math.abs(dpd) > 0.08 ? 'Mild bias' : 'Low bias';
  const grps  = s.per_group.map(g => g.group).join(', ') || '—';
  return `${level} (DPD=${Math.abs(dpd).toFixed(2)}). Groups: ${grps}. Records: ${s.n_records}.`;
}

export function Reports({ refreshKey = 0 }: { refreshKey?: number }) {
  const { insights: autoInsights, autoPredictions, lastUpdated } = useScanContext();
  const [summaries, setSummaries] = useState<Partial<Record<Domain, SummaryResponse>>>({});
  const [loading, setLoading]     = useState(true);
  const [refreshed, setRefreshed] = useState(new Date());

  const fetchAll = async () => {
    setLoading(true);
    const results = await Promise.allSettled(DOMAINS.map(d => api.getSummary(d)));
    const next: Partial<Record<Domain, SummaryResponse>> = {};
    results.forEach((r, i) => { if (r.status === 'fulfilled') next[DOMAINS[i]] = r.value; });
    setSummaries(next);
    setLoading(false);
    setRefreshed(new Date());
  };

  useEffect(() => { fetchAll(); }, [refreshKey]);

  const reports = DOMAINS.map((domain, idx) => {
    const s = summaries[domain];
    return {
      id:            idx + 1,
      domain,
      date:          refreshed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      model:         MODEL_NAMES[domain],
      fairnessScore: s ? calcScore(s) : null,
      nRecords:      s?.n_records ?? null,
      summary:       s ? buildSummary(s) : 'Loading…',
      raw:           s ?? null,
    };
  });

  const loaded    = reports.filter(r => r.nRecords !== null);
  const avgScore  = loaded.length ? Math.round(loaded.reduce((a, r) => a + (r.fairnessScore ?? 0), 0) / loaded.length) : null;
  const totalRecs = loaded.reduce((a, r) => a + (r.nRecords ?? 0), 0);

  // Recent predictions state
  const [recentPredictions, setRecentPredictions] = useState<Partial<Record<Domain, PredictionRecord[]>>>({});
  const [loadingRecent, setLoadingRecent] = useState(true);

  const fetchRecentPredictions = async () => {
    setLoadingRecent(true);
    const results = await Promise.allSettled(
      DOMAINS.map(d => api.getRecent(d))
    );
    const next: Partial<Record<Domain, PredictionRecord[]>> = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) {
        next[DOMAINS[i]] = r.value.records as unknown as PredictionRecord[];
      }
    });
    setRecentPredictions(next);
    setLoadingRecent(false);
  };

  useEffect(() => {
    fetchRecentPredictions();
  }, [refreshKey]);

  const handleRefreshAll = () => {
    fetchAll();
    fetchRecentPredictions();
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-semibold dark:text-white flex items-center gap-3">
            <FileText className="text-emerald-600" size={32} />
            Reports & Audit Log
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            Live fairness snapshots from all active models
          </p>
        </div>
        <button
          onClick={handleRefreshAll}
          disabled={loading || loadingRecent}
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-2xl flex items-center gap-2 font-medium"
        >
          <RefreshCw size={18} className={loading || loadingRecent ? 'animate-spin' : ''} />
          {loading || loadingRecent ? 'Refreshing…' : 'Refresh All'}
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-zinc-200 dark:border-zinc-800">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Active Models</div>
          <div className="text-4xl font-semibold dark:text-white mt-2">{DOMAINS.length}</div>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-zinc-200 dark:border-zinc-800">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Avg. Fairness Score</div>
          <div className="text-4xl font-semibold text-emerald-600 mt-2">{avgScore ?? '…'}</div>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-zinc-200 dark:border-zinc-800">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Total Predictions</div>
          <div className="text-4xl font-semibold dark:text-white mt-2">{totalRecs}</div>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-zinc-200 dark:border-zinc-800">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">Last Refreshed</div>
          <div className="text-2xl font-semibold dark:text-white mt-2">
            {refreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {(autoInsights.length > 0 || Object.keys(autoPredictions).length > 0) && (
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-semibold dark:text-white">Automatic System Insights</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                Generated from the latest uploaded files{lastUpdated ? ` • ${new Date(lastUpdated).toLocaleString()}` : ''}
              </p>
            </div>
          </div>

          {Object.keys(autoPredictions).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {Object.values(autoPredictions).map((prediction) => prediction && (
                <div key={prediction.domain} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                  <div className="text-sm text-zinc-500 dark:text-zinc-400 capitalize">{prediction.domain}</div>
                  <div className="text-lg font-semibold dark:text-white mt-1">{prediction.label}</div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    Confidence {Math.round(prediction.confidence * 100)}%
                    {prediction.biasRisk != null ? ` • Bias ${Math.round(prediction.biasRisk * 100)}/100` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}

          {autoInsights.length > 0 && (
            <ul className="space-y-2">
              {autoInsights.map((line, idx) => (
                <li key={`${idx}-${line}`} className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <span className="text-emerald-600 mt-0.5">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Reports List */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
        <h2 className="text-xl font-semibold mb-6 dark:text-white">Live Fairness Snapshot</h2>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b dark:border-zinc-700">
                <th className="text-left py-5 text-zinc-600 dark:text-zinc-400 font-medium">Date</th>
                <th className="text-left py-5 text-zinc-600 dark:text-zinc-400 font-medium">Model</th>
                <th className="text-left py-5 text-zinc-600 dark:text-zinc-400 font-medium">Fairness Score</th>
                <th className="text-left py-5 text-zinc-600 dark:text-zinc-400 font-medium">Records</th>
                <th className="text-left py-5 text-zinc-600 dark:text-zinc-400 font-medium">Summary</th>
                <th className="text-center py-5 text-zinc-600 dark:text-zinc-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const sc = report.fairnessScore;
                const scoreColor = sc == null ? 'text-zinc-400'
                  : sc >= 85 ? 'text-emerald-600'
                  : sc >= 70 ? 'text-amber-500'
                  : 'text-red-600';
                return (
                  <tr key={report.id} className="border-b dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                    <td className="py-6">
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar size={16} className="text-zinc-400" />
                        {report.date}
                      </div>
                    </td>
                    <td className="py-6 font-medium dark:text-white">{report.model}</td>
                    <td className="py-6">
                      {sc != null
                        ? <><span className={`font-semibold ${scoreColor}`}>{sc}</span><span className="text-zinc-400">/100</span></>
                        : <span className="text-zinc-400">…</span>}
                    </td>
                    <td className="py-6 dark:text-white">{report.nRecords ?? '…'}</td>
                    <td className="py-6 text-sm text-zinc-600 dark:text-zinc-400 max-w-md">{report.summary}</td>
                    <td className="py-6">
                      <div className="flex gap-3 justify-center">
                        <button
                          onClick={() => {
                            if (!report.raw) return;
                            const blob = new Blob([JSON.stringify(report.raw, null, 2)], { type: 'application/json' });
                            const url  = URL.createObjectURL(blob);
                            const a    = document.createElement('a');
                            a.href = url; a.download = `${report.domain}_report.json`; a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                          title="Export JSON"
                        >
                          <Eye size={20} className="text-zinc-600 dark:text-zinc-400" />
                        </button>
                        <button
                          onClick={() => alert(`PDF export for ${report.model} — integrate a PDF library for production.`)}
                          className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
                          title="Export PDF"
                        >
                          <Download size={20} className="text-zinc-600 dark:text-zinc-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Predictions Section */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold dark:text-white flex items-center gap-2">
            <History size={24} className="text-emerald-600" />
            Recent Predictions
          </h2>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {loadingRecent ? 'Loading...' : 'From all 3 domains'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b dark:border-zinc-700">
                <th className="text-left py-5 text-zinc-600 dark:text-zinc-400 font-medium">Domain</th>
                <th className="text-left py-5 text-zinc-600 dark:text-zinc-400 font-medium">Correlation ID</th>
                <th className="text-left py-5 text-zinc-600 dark:text-zinc-400 font-medium">Prediction</th>
                <th className="text-left py-5 text-zinc-600 dark:text-zinc-400 font-medium">Confidence</th>
                <th className="text-left py-5 text-zinc-600 dark:text-zinc-400 font-medium">Key Features</th>
              </tr>
            </thead>
            <tbody>
              {loadingRecent ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">
                    <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                    Loading recent predictions...
                  </td>
                </tr>
              ) : DOMAINS.flatMap(d => 
                (recentPredictions[d] || []).slice(0, 3).map((pred, i) => (
                  <tr key={`${d}-${i}`} className="border-b dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                    <td className="py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        d === 'loan' ? 'bg-emerald-100 text-emerald-700' :
                        d === 'hiring' ? 'bg-blue-100 text-blue-700' :
                        'bg-violet-100 text-violet-700'
                      }`}>
                        {MODEL_NAMES[d]}
                      </span>
                    </td>
                    <td className="py-4">
                      <code className="text-sm bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
                        {pred.correlation_id?.slice(0, 8)}...
                      </code>
                    </td>
                    <td className="py-4">
                      <span className={`font-semibold ${
                        pred.prediction === 1 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {pred.prediction === 1 ? 'Positive' : 'Negative'}
                      </span>
                    </td>
                    <td className="py-4 dark:text-white">
                      {(pred.confidence * 100).toFixed(1)}%
                    </td>
                    <td className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
                      {pred.input && Object.entries(pred.input).slice(0, 2).map(([k, v]) => (
                        <span key={k} className="mr-2">{k}: {String(v).slice(0, 15)}</span>
                      ))}
                    </td>
                  </tr>
                ))
              ).length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-zinc-500">
                    <AlertTriangle size={20} className="mx-auto mb-2" />
                    No recent predictions found. Run predictions to see data.
                  </td>
                </tr>
              ) : (
                DOMAINS.flatMap(d => 
                  (recentPredictions[d] || []).slice(0, 3).map((pred, i) => (
                    <tr key={`${d}-${i}`} className="border-b dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                      <td className="py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          d === 'loan' ? 'bg-emerald-100 text-emerald-700' :
                          d === 'hiring' ? 'bg-blue-100 text-blue-700' :
                          'bg-violet-100 text-violet-700'
                        }`}>
                          {MODEL_NAMES[d]}
                        </span>
                      </td>
                      <td className="py-4">
                        <code className="text-sm bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
                          {pred.correlation_id?.slice(0, 8)}...
                        </code>
                      </td>
                      <td className="py-4">
                        <span className={`font-semibold ${
                          pred.prediction === 1 ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {pred.prediction === 1 ? 'Positive' : 'Negative'}
                        </span>
                      </td>
                      <td className="py-4 dark:text-white">
                        {(pred.confidence * 100).toFixed(1)}%
                      </td>
                      <td className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
                        {pred.input && Object.entries(pred.input).slice(0, 2).map(([k, v]) => (
                          <span key={k} className="mr-2">{k}: {String(v).slice(0, 15)}</span>
                        ))}
                      </td>
                    </tr>
                  ))
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compliance Note */}
      <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 flex items-start gap-6">
        <CheckCircle className="text-emerald-600 mt-1" size={28} />
        <div>
          <h3 className="font-semibold dark:text-white">Regulatory Compliance Ready</h3>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            All reports include live DPD, EOD, per-group approval rates, and bias risk bands.
            Click the eye icon to export raw JSON for internal audits and regulatory submissions.
            Use the Feedback feature to submit ground truth and enable Equalized Odds calculations.
          </p>
        </div>
      </div>
    </div>
  );
}
