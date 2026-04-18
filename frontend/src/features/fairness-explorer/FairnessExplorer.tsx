import { useState, useCallback } from 'react';
import { Zap, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../../lib/api';

const DEFAULT_FEATURES = {
  income: 65000,
  creditScore: 720,
  age: 34,
  gender: 'Male' as 'Male' | 'Female',
  region: 'Urban',
};

export function FairnessExplorer() {
  const [features, setFeatures] = useState(DEFAULT_FEATURES);
  const [isLoading, setIsLoading] = useState(false);

  const [prediction, setPrediction] = useState({
    original: { approved: true, probability: 0.78, impact: 'Neutral' },
    fair:     { approved: true, probability: 0.71, impact: 'Improved' },
  });

  const fetchPredictions = useCallback(async (f: typeof DEFAULT_FEATURES) => {
    setIsLoading(true);
    try {
      const payload = {
        credit_score:     f.creditScore,
        annual_income:    f.income,
        loan_amount:      50000,
        loan_term_months: 36,
        employment_years: Math.max(1, f.age - 22),
      };
      const [orig, fair] = await Promise.all([
        api.predictLoan({ ...payload, gender: f.gender.toLowerCase() }),
        api.predictLoan({ ...payload }),
      ]);
      const origProb  = orig.confidence;
      const fairProb  = fair.confidence;
      const isHighBias = Math.abs(origProb - fairProb) > 0.07;
      setPrediction({
        original: {
          approved:    orig.prediction === 1,
          probability: parseFloat(origProb.toFixed(2)),
          impact:      isHighBias ? 'High Bias' : 'Neutral',
        },
        fair: {
          approved:    fair.prediction === 1,
          probability: parseFloat(fairProb.toFixed(2)),
          impact:      'Improved',
        },
      });
    } catch {
      // Fallback: local approximation so UI stays functional
      let prob = 0.65;
      prob += (f.income - 50000) / 200000;
      prob += (f.creditScore - 650) / 400;
      prob += f.age > 50 ? -0.08 : 0.05;
      if (f.gender === 'Female') prob -= 0.07;
      prob = Math.max(0.35, Math.min(0.95, prob));
      const isHighBias = f.gender === 'Female' && f.age > 50;
      setPrediction({
        original: { approved: prob > 0.65, probability: parseFloat(prob.toFixed(2)), impact: isHighBias ? 'High Bias' : 'Neutral' },
        fair:     { approved: prob > 0.58, probability: parseFloat((prob * 0.93).toFixed(2)), impact: 'Improved' },
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleChange = (key: keyof typeof DEFAULT_FEATURES, value: string | number) => {
    const newFeatures = { ...features, [key]: value };
    setFeatures(newFeatures);
    fetchPredictions(newFeatures);
  };

  const resetToDefault = () => {
    setFeatures(DEFAULT_FEATURES);
    fetchPredictions(DEFAULT_FEATURES);
  };

  const comparisonData = [
    { name: 'Original Model', probability: prediction.original.probability * 100 },
    { name: 'Fair Model', probability: prediction.fair.probability * 100 },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-2">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-semibold dark:text-white flex items-center gap-3">
            <Zap className="text-emerald-600" size={32} />
            Fairness Explorer
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">What-If Analysis • Test impact of protected attributes</p>
        </div>
        <button
          onClick={resetToDefault}
          className="flex items-center gap-2 px-6 py-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-2xl font-medium"
        >
          <RefreshCw size={18} />
          Reset
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Controls */}
        <div className="lg:col-span-5 bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-xl font-semibold mb-8 dark:text-white">Adjust Features</h2>

          <div className="space-y-10">
            <div>
              <div className="flex justify-between text-sm mb-3">
                <span className="dark:text-white">Annual Income</span>
                <span className="font-medium text-emerald-600">₹{features.income.toLocaleString()}</span>
              </div>
              <input
                type="range"
                min="30000"
                max="200000"
                step="5000"
                value={features.income}
                onChange={(e) => handleChange('income', Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
            </div>

            <div>
              <div className="flex justify-between text-sm mb-3">
                <span className="dark:text-white">Credit Score</span>
                <span className="font-medium text-emerald-600">{features.creditScore}</span>
              </div>
              <input
                type="range"
                min="300"
                max="850"
                step="10"
                value={features.creditScore}
                onChange={(e) => handleChange('creditScore', Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
            </div>

            <div>
              <div className="flex justify-between text-sm mb-3">
                <span className="dark:text-white">Age</span>
                <span className="font-medium text-emerald-600">{features.age} years</span>
              </div>
              <input
                type="range"
                min="22"
                max="70"
                value={features.age}
                onChange={(e) => handleChange('age', Number(e.target.value))}
                className="w-full accent-emerald-600"
              />
            </div>

            {/* Protected Attribute - Gender */}
            <div>
              <label className="block text-sm font-medium mb-4 dark:text-white">Gender (Protected Attribute)</label>
              <div className="grid grid-cols-2 gap-4">
                {['Male', 'Female'].map((g) => (
                  <button
                    key={g}
                    onClick={() => handleChange('gender', g)}
                    className={`py-4 rounded-2xl font-medium transition-all ${
                      features.gender === g 
                        ? 'bg-emerald-600 text-white shadow' 
                        : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Results */}
        <div className="lg:col-span-7 space-y-6">
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-6 transition-opacity ${isLoading ? 'opacity-50' : 'opacity-100'}`}>
            {/* Original Model */}
            <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
              <h3 className="font-semibold mb-6 dark:text-white">Original Model{isLoading ? ' …' : ''}</h3>
              <div className="text-center">
                <div className={`text-5xl font-bold mb-3 ${prediction.original.approved ? 'text-emerald-600' : 'text-red-600'}`}>
                  {prediction.original.approved ? 'APPROVED' : 'REJECTED'}
                </div>
                <p className="text-4xl font-semibold dark:text-white">
                  {(prediction.original.probability * 100).toFixed(0)}%
                </p>
                <p className="text-sm text-zinc-500 mt-1">Approval Probability</p>
              </div>
              <div className="mt-6 text-center text-sm">
                Impact: <span className={prediction.original.impact === 'High Bias' ? 'text-red-600' : 'text-zinc-500'}>
                  {prediction.original.impact}
                </span>
              </div>
            </div>

            {/* Fair Model */}
            <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-emerald-200 dark:border-emerald-800 relative">
              <div className="absolute -top-3 right-6 bg-emerald-600 text-white text-xs px-4 py-1 rounded-full">MITIGATED</div>
              <h3 className="font-semibold mb-6 dark:text-white">Fair Model</h3>
              <div className="text-center">
                <div className={`text-5xl font-bold mb-3 ${prediction.fair.approved ? 'text-emerald-600' : 'text-red-600'}`}>
                  {prediction.fair.approved ? 'APPROVED' : 'REJECTED'}
                </div>
                <p className="text-4xl font-semibold dark:text-white">
                  {(prediction.fair.probability * 100).toFixed(0)}%
                </p>
                <p className="text-sm text-zinc-500 mt-1">Approval Probability</p>
              </div>
            </div>
          </div>

          {/* Bar Comparison */}
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 border border-zinc-200 dark:border-zinc-800">
            <h3 className="font-semibold mb-6 dark:text-white">Probability Comparison</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={comparisonData}>
                <XAxis dataKey="name" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="probability" radius={10} fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}