import { Home, Database, Target, Zap, Shield, FileText, Settings, Menu, Briefcase, Share2 } from 'lucide-react';
import { useState } from 'react';

const menuItems = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'hiring-prediction', label: 'Hiring Prediction', icon: Briefcase },
  { id: 'social-recommendation', label: 'Social Recommend', icon: Share2 },
  { id: 'datasets', label: 'Datasets & Models', icon: Database },
  { id: 'bias-detection', label: 'Bias Detection', icon: Target },
  { id: 'fairness-explorer', label: 'Fairness Explorer', icon: Zap },
  { id: 'mitigation-lab', label: 'Mitigation Lab', icon: Shield },
  { id: 'reports', label: 'Reports & Audit', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

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

interface SidebarProps {
  activePage: Page;
  setActivePage: (page: Page) => void;
}

export function Sidebar({ activePage, setActivePage }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 h-full transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'} flex flex-col`}>
      <div className="p-5 flex items-center justify-between border-b dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">U</div>
          {!collapsed && <span className="font-semibold text-2xl tracking-tight dark:text-white">Unbiased AI</span>}
        </div>
        <button 
          onClick={() => setCollapsed(!collapsed)} 
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all duration-200 hover:scale-110"
        >
          <Menu size={20} className="dark:text-zinc-400" />
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id as Page)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all duration-200 hover:scale-105 ${
                isActive
                  ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 font-medium shadow-md'
                  : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:shadow-md hover:-translate-y-0.5'
              }`}
            >
              <Icon size={20} className="dark:text-zinc-400" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="p-5 border-t dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-500">
        {!collapsed && "v0.1 • Ensuring Fair AI Decisions"}
      </div>
    </div>
  );
}