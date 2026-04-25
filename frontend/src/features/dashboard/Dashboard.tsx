import { useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, Target, Zap, Briefcase, DollarSign, Share2, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { api } from '../../lib/api';
import type { SummaryResponse } from '../../lib/api';

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

function useDomainSummary(domain: Domain, refreshKey: number) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  
  useEffect(() => {
    setLoading(true);
    setError(false);
    api.getSummary(domain)
      .then(setData)
      .catch(() => {
        setData(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [domain, refreshKey]);
  
  return { data, loading, error };
}

export function Dashboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [activeDomain, setActiveDomain] = useState<Domain>('loan');
  const { data, loading, error } = useDomainSummary(activeDomain, refreshKey);

  const dpd   = data?.demographic_parity_difference ?? null;
  const eod   = data?.equal_opportunity_difference  ?? null;

  const hasRecords = (data?.n_records ?? 0) > 0;
  const fairnessScore = dpd != null ? Math.max(0, Math.round((1 - Math.abs(dpd)) * 100)) : null;
  const biasedPct     = fairnessScore != null ? 100 - fairnessScore : null;

  const metrics = [
    {
      label:  "Overall Fairness Score",
      value:  loading ? "…" : (fairnessScore != null ? String(fairnessScore) : (error ? "—" : "N/A")),
      unit:   "/100",
      status: (fairnessScore != null && fairnessScore < 80 ? "warning" : "fair") as "warning" | "fair",
    },
    {
      label:  "Demographic Parity Gap",
      value:  loading ? "…" : (dpd != null ? Math.abs(dpd).toFixed(2) : (error ? "—" : "N/A")),
      unit:   "",
      status: (dpd != null && Math.abs(dpd) > 0.15 ? "warning" : "fair") as "warning" | "fair",
    },
    {
      label:  "Equal Opportunity Diff",
      value:  loading ? "…" : (eod != null ? Math.abs(eod).toFixed(2) : (error ? "—" : "N/A")),
      unit:   "",
      status: (eod != null && Math.abs(eod) > 0.15 ? "warning" : "fair") as "warning" | "fair",
    },
    {
      label:  "Records Analysed",
      value:  loading ? "…" : (data ? String(data.n_records) : (error ? "—" : "N/A")),
      unit:   "",
      status: "fair" as "warning" | "fair",
    },
  ];

  const groupData = data && data.per_group.length > 0
    ? data.per_group.map(g => ({
        group:    g.group,
        approval: Math.round(g.positive_rate * 100),
      }))
    : [];

  const pieData = fairnessScore != null && biasedPct != null
    ? [
        { name: "Fair",         value: fairnessScore, color: "#10b981" },
        { name: "Biased Areas", value: biasedPct,     color: "#ef4444" },
      ]
    : [
        { name: "No Data", value: 100, color: "#e4e4e7" },
      ];

  const activeDomainConfig = DOMAINS.find(d => d.id === activeDomain);
  const ActiveIcon = activeDomainConfig?.icon || DollarSign;
  const activeColor = activeDomainConfig?.color || 'emerald';

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Domain Selector */}
      <div className="flex gap-3">
        {DOMAINS.map(domain => {
          const Icon = domain.icon;
          const isActive = activeDomain === domain.id;
          return (
            <button
              key={domain.id}
              onClick={() => setActiveDomain(domain.id)}
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

      {/* Hero Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 shadow-sm border border-zinc-100 dark:border-zinc-800">
        <div className="flex flex-col lg:flex-row justify-between items-start gap-8">
          <div>
            <div className="flex items-center gap-4 mb-3">
              <ActiveIcon className={`text-${activeColor}-600`} size={40} />
              <h1 className="text-4xl font-semibold tracking-tight dark:text-white">
                {activeDomainConfig?.label} Model
              </h1>
              {loading && <Loader2 className="animate-spin text-zinc-400" size={24} />}
            </div>
            <p className="text-zinc-600 dark:text-zinc-400 text-lg">Overall Fairness Score</p>
            <p className={`text-6xl font-bold text-${activeColor}-600 mt-2`}>
              {loading ? "…" : (fairnessScore ?? "N/A")}
              <span className="text-3xl text-zinc-400 dark:text-zinc-500">/100</span>
            </p>
            <div className="mt-4 flex items-center gap-3 text-amber-600 dark:text-amber-400">
              <AlertTriangle size={24} />
              <span className="font-medium">
                {loading ? "Loading fairness metrics..." : 
                  data ? (dpd != null && Math.abs(dpd) > 0.15
                      ? `Bias detected — DPD ${Math.abs(dpd).toFixed(2)}`
                      : "Fairness metrics within acceptable range")
                  : error ? "Failed to load fairness data" : "No prediction data yet. Run a few predictions first."}
              </span>
            </div>
          </div>

          <div className="w-64 h-64 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={85}
                  outerRadius={110}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metrics.map((metric, i) => (
          <div key={i} className="bg-white dark:bg-zinc-900 rounded-3xl p-7 shadow-sm border border-zinc-100 dark:border-zinc-800">
            <div className="flex justify-between items-start">
              <p className="text-zinc-600 dark:text-zinc-400">{metric.label}</p>
              {metric.status === "warning" && !loading && <AlertTriangle className="text-amber-500" size={22} />}
            </div>
            <p className="text-5xl font-semibold mt-6 dark:text-white">{metric.value}{metric.unit}</p>
            <div className="mt-6 flex items-center gap-2 text-emerald-600 text-sm">
              <TrendingUp size={16} />
              <span>Live metrics from {activeDomainConfig?.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Group Comparison Chart */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 shadow-sm border border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-semibold dark:text-white">
            {activeDomain === 'loan' ? 'Approval' : activeDomain === 'hiring' ? 'Hiring' : 'Engagement'} Rate by Protected Group
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {loading ? 'Loading data...' : error ? 'Failed to load data' : `Showing ${data?.n_records || 0} records`}
          </p>
        </div>

        {hasRecords && groupData.length > 0 ? (
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={groupData} barCategoryGap={40}>
              <XAxis dataKey="group" tick={{ fill: '#a1a1aa' }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="approval" radius={12} fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[380px] flex items-center justify-center text-zinc-500 dark:text-zinc-400">
            No grouped fairness data yet.
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button 
          onClick={() => alert('Bias scan started!')}
          className="bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 hover:border-emerald-600 p-8 rounded-3xl text-left transition-all group"
        >
          <Target className="mb-6 text-emerald-600 group-hover:scale-110 transition-transform" size={32} />
          <div className="text-2xl font-semibold mb-2 dark:text-white">Run Full Bias Scan</div>
          <p className="text-zinc-600 dark:text-zinc-400">Detect bias across all protected attributes</p>
        </button>

        <button 
          onClick={() => alert('Opening Fairness Explorer...')}
          className="bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 hover:border-emerald-600 p-8 rounded-3xl text-left transition-all group"
        >
          <Zap className="mb-6 text-emerald-600 group-hover:scale-110 transition-transform" size={32} />
          <div className="text-2xl font-semibold mb-2 dark:text-white">Open What-If Explorer</div>
          <p className="text-zinc-600 dark:text-zinc-400">Test individual decisions in real-time</p>
        </button>
      </div>
    </div>
  );
}
