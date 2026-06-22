import React from 'react';
import { LayoutDashboard, Sliders, Settings, History } from 'lucide-react';
import { Icon } from './Icon';

export type TabType = 'dashboard' | 'sources' | 'settings' | 'history';

interface BottomNavProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  disabled?: boolean;
}

export function BottomNav({ activeTab, onChangeTab, disabled = false }: BottomNavProps) {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sources', label: 'Sources', icon: Sliders },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'history', label: 'History', icon: History },
  ] as const;

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            className={`bottom-nav-item ${isActive ? 'bottom-nav-item--active' : ''}`}
            onClick={() => !disabled && onChangeTab(tab.id)}
            disabled={disabled}
            type="button"
          >
            <Icon icon={tab.icon} size={15} className="bottom-nav-icon" />
            <span className="bottom-nav-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
