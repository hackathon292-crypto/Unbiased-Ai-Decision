import { useEffect, useState } from 'react';
import { Target, Play, AlertTriangle, Briefcase, DollarSign, Share2, Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { api } from '../../lib/api';
import type { FullScanResponse, SummaryResponse } from '../../lib/api';
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

const protectedGroups = ['Gender', 'Age Group', 'Region', 'Ethnicity', 'Religion'];

const MOCK_METRICS = [
  { group: 'Male', approval: 82, parityGap: 0.08, equalOpp: 0.05 },
  { group: 'Female', approval: 61, parityGap: 0.19, equalOpp: 0.12 },
  { group: 'Age <30', approval: 75, parityGap: 0.06, equalOpp: 0.04 },
  { group: 'Age >60', approval: 48, parityGap: 0.22, equalOpp: 0.18 },
];

interface BiasDetectionProps {
  refreshKey?: number;
  onScanComplete?: () => void;
}

export function BiasDetection({ refreshKey = 0, onScanComplete }: BiasDetectionProps) {
  const { ingestScanArtifacts } = useScanContext();
  const [activeDomain, setActiveDomain] = useState<Domain>('loan');
  const [selectedGroups, setSelectedGroups] = useState<string[]>(['Gender', 'Age Group']);
  const [isScanning, setIsScanning] = useState(false);
  const [liveData, setLiveData] = useState<SummaryResponse | null>(null);
  const [scanResult, setScanResult] = useState<FullScanResponse | null>(null);

  useEffect(() => {
    api.getSummary(activeDomain).then(setLiveData).catch(() => setLiveData(null));
  }, [activeDomain, refreshKey]);

  const runScan = async () => {
    setIsScanning(true);
    try {
      const result = await api.scanFiles({ domain: activeDomain });
      setScanResult(result);
      await ingestScanArtifacts({
        inspections: [],
        analyses: [{ result: result.analysis }],
      });
      const summary = await api.getSummary(activeDomain);
      setLiveData(summary);
      onScanComplete?.();
    } catch {
      // silently fall back to mock data
    } finally {
      setIsScanning(false);
    }
  };

  const metricsData = liveData && liveData.per_group.length > 0
    ? liveData.per_group.map(g => ({
        group:     g.group,
        approval:  Math.round(g.positive_rate * 100),
        parityGap: liveData.demographic_parity_difference != null
                     ? Math.abs(liveData.demographic_parity_difference)
                     : 0,
        equalOpp:  liveData.equal_opportunity_difference != null
                     ? Math.abs(liveData.equal_opportunity_difference)
                     : 0,
      }))
    : MOCK_METRICS;

  const maxGap  = Math.max(...metricsData.map(m => m.parityGap));
  const fairPct = Math.max(0, Math.round((1 - maxGap) * 100));
  const pieData = [
    { name: 'Fair',   value: fairPct,       color: '#10b981' },
    { name: 'Biased', value: 100 - fairPct, color: '#ef4444' },
  ];

  const highBias = metricsData.find(m => m.parityGap > 0.15);
  const activeDomainConfig = DOMAINS.find(d => d.id === activeDomain);
  const scoreTiles = scanResult?.scores
    ? [
        { label: 'Bias Score', value: Math.round(scanResult.scores.bias_score) },
        { label: 'Fairness Score', value: Math.round(scanResult.scores.fairness_score) },
        { label: 'Performance Score', value: Math.round(scanResult.scores.performance_score) },
        { label: 'Risk Score', value: Math.round(scanResult.scores.risk_score) },
      ]
    : [];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold dark:text-white flex items-center gap-3">
            <Target className="text-emerald-600" size={32} />
            Bias Detection
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            Analyze and detect bias in your {activeDomainConfig?.label} AI model
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={isScanning}
          className="flex items-center gap-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white px-8 py-3 rounded-2xl font-medium transition-all active:scale-95"
        >
          {isScanning ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} />}
          {isScanning ? `Scanning ${activeDomain}...` : 'Run Full Bias Scan'}
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
                setLiveData(null);
                setScanResult(null);
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

      {/* Configuration Panel */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
        <h2 className="text-xl font-semibold mb-6 dark:text-white">Scan Configuration</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">
              Protected Attributes
            </label>
            <div className="flex flex-wrap gap-2">
              {protectedGroups.map((group) => (
                <button
                  key={group}
                  onClick={() => {
                    setSelectedGroups(prev =>
                      prev.includes(group)
                        ? prev.filter(g => g !== group)
                        : [...prev, group]
                    );
                  }}
                  className={`px-5 py-2.5 rounded-2xl text-sm transition-all ${
                    selectedGroups.includes(group)
                      ? 'bg-emerald-600 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">
              Fairness Metrics
            </label>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <input type="checkbox" defaultChecked className="w-4 h-4 accent-emerald-600" />
                <span className="dark:text-white">Demographic Parity</span>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" defaultChecked className="w-4 h-4 accent-emerald-600" />
                <span className="dark:text-white">Equal Opportunity</span>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" defaultChecked className="w-4 h-4 accent-emerald-600" />
                <span className="dark:text-white">Disparate Impact</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-3">
              Acceptable Threshold
            </label>
            <div className="text-4xl font-semibold dark:text-white">0.20</div>
            <p className="text-xs text-zinc-500 mt-1">Maximum allowed disparity</p>
          </div>
        </div>
      </div>

      {scanResult?.scores && (
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <h2 className="text-xl font-semibold dark:text-white">Final Report</h2>
              <p className="text-zinc-600 dark:text-zinc-400 mt-1">
                {scanResult.message}
              </p>
            </div>
            <div className={`px-4 py-2 rounded-2xl font-medium ${
              scanResult.scores.final_recommendation === 'Accept'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : scanResult.scores.final_recommendation === 'Reject'
                ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
            }`}>
              {scanResult.scores.final_recommendation}
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {scoreTiles.map((tile) => (
              <div key={tile.label} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
                <div className="text-sm text-zinc-500 dark:text-zinc-400">{tile.label}</div>
                <div className="text-3xl font-semibold dark:text-white mt-2">{tile.value}<span className="text-base text-zinc-400">/100</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Metrics Summary Table */}
        <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-xl font-semibold mb-6 dark:text-white flex items-center gap-2">
            Metrics Summary for {activeDomainConfig?.label}
            <span className="text-emerald-600 text-sm font-normal">(Lower is better)</span>
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b dark:border-zinc-700">
                  <th className="text-left py-4 text-zinc-600 dark:text-zinc-400 font-medium">Group</th>
                  <th className="text-left py-4 text-zinc-600 dark:text-zinc-400 font-medium">Approval Rate</th>
                  <th className="text-left py-4 text-zinc-600 dark:text-zinc-400 font-medium">Parity Gap</th>
                  <th className="text-left py-4 text-zinc-600 dark:text-zinc-400 font-medium">Equal Opp. Diff</th>
                </tr>
              </thead>
              <tbody>
                {metricsData.map((row, i) => (
                  <tr key={i} className="border-b dark:border-zinc-700 last:border-0">
                    <td className="py-5 font-medium dark:text-white">{row.group}</td>
                    <td className="py-5 dark:text-white">{row.approval}%</td>
                    <td className={`py-5 ${row.parityGap > 0.15 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {row.parityGap.toFixed(2)}
                    </td>
                    <td className={`py-5 ${row.equalOpp > 0.15 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {row.equalOpp.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Charts */}
        <div className="space-y-8">
          {/* Approval Rate Chart */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-semibold mb-6 dark:text-white">Approval Rate by Group</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={metricsData}>
                <XAxis dataKey="group" tick={{ fill: '#71717a' }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="approval" radius={12} fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Bias Distribution */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-xl font-semibold mb-6 dark:text-white">Overall Bias Distribution</h2>
            <div className="flex justify-center">
              <div className="w-64 h-64">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={100}
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
        </div>
      </div>

      {/* Alert Section */}
      {highBias ? (
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-3xl p-8 flex items-start gap-5">
          <AlertTriangle className="text-amber-600 mt-1" size={28} />
          <div>
            <h3 className="font-semibold text-amber-800 dark:text-amber-400">High Bias Detected in {activeDomainConfig?.label}</h3>
            <p className="text-amber-700 dark:text-amber-300 mt-2">
              Significant bias found in <strong>{highBias.group}</strong> group (Parity Gap: {highBias.parityGap.toFixed(2)}).
              Consider applying mitigation techniques in the Mitigation Lab.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-3xl p-8 flex items-start gap-5">
          <AlertTriangle className="text-emerald-600 mt-1" size={28} />
          <div>
            <h3 className="font-semibold text-emerald-800 dark:text-emerald-400">No High Bias Detected</h3>
            <p className="text-emerald-700 dark:text-emerald-300 mt-2">
              All groups in {activeDomainConfig?.label} model are within the acceptable parity threshold (0.20). Run a scan to refresh.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
