import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopNavbar } from './components/TopNavbar';
import { Dashboard } from './features/dashboard/Dashboard';
import { BiasDetection } from './features/bias-detection/BiasDetection';
import { FairnessExplorer } from './features/fairness-explorer/FairnessExplorer';
import { MitigationLab } from './features/mitigation-lab/MitigationLab';
import { Reports } from './features/reports/Reports';
import { Datasets } from './features/datasets/Datasets';
import { Settings } from './features/settings/Settings';
import { HiringPrediction } from './features/hiring-prediction/HiringPrediction';
import { SocialRecommendation } from './features/social-recommendation/SocialRecommendation';

type Page = 
  | 'dashboard' 
  | 'datasets' 
  | 'bias-detection' 
  | 'fairness-explorer' 
  | 'mitigation-lab' 
  | 'reports'
  | 'settings'
  | 'hiring-prediction'
  | 'social-recommendation';

function App() {
  const [activePage, setActivePage] = useState<Page>('dashboard');
  // Incremented every time "New Scan" is clicked. Datasets page watches this
  // and auto-scans every uploaded file + analyzes datasets without manual setup.
  const [scanTrigger, setScanTrigger] = useState(0);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);

  const handleNewScan = () => {
    setActivePage('datasets');
    setScanTrigger((n) => n + 1);
  };

  const handleScanComplete = () => {
    setDataRefreshKey((n) => n + 1);
  };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return <Dashboard refreshKey={dataRefreshKey} />;
      case 'datasets':
        return <Datasets scanTrigger={scanTrigger} onScanComplete={handleScanComplete} />;
      case 'bias-detection':
        return <BiasDetection refreshKey={dataRefreshKey} onScanComplete={handleScanComplete} />;
      case 'fairness-explorer':
        return <FairnessExplorer />;
      case 'mitigation-lab':
        return <MitigationLab />;
      case 'reports':
        return <Reports refreshKey={dataRefreshKey} />;
      case 'settings':
        return <Settings />;
      case 'hiring-prediction':
        return <HiringPrediction />;
      case 'social-recommendation':
        return <SocialRecommendation />;
      default:
        return <Dashboard refreshKey={dataRefreshKey} />;
    }
  };

  return (
    <div className="flex h-screen bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      <Sidebar 
        activePage={activePage} 
        setActivePage={setActivePage} 
      />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNavbar onNewScan={handleNewScan} />
        <main className="flex-1 overflow-auto p-6 bg-zinc-50 dark:bg-zinc-950">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default App;
