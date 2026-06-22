import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Mic, Camera, Focus, Monitor, Disc, Globe } from 'lucide-react';
import { Icon } from './Icon';

interface SourceCardProps {
  type: 'tab' | 'screen' | 'window' | 'mic' | 'system-audio' | 'camera' | 'focus' | string;
  label: string;
  status: string;
  active?: boolean;
  warning?: boolean;
  blocked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  icon?: LucideIcon;
  children?: React.ReactNode;
}

export function SourceCard({
  type,
  label,
  status,
  active = false,
  warning = false,
  blocked = false,
  disabled = false,
  onClick,
  icon,
  children,
}: SourceCardProps) {
  // Determine icon if not explicitly passed
  let resolvedIcon: LucideIcon = Monitor;
  if (icon) {
    resolvedIcon = icon;
  } else {
    switch (type) {
      case 'mic':
        resolvedIcon = Mic;
        break;
      case 'camera':
        resolvedIcon = Camera;
        break;
      case 'focus':
        resolvedIcon = Focus;
        break;
      case 'tab':
        resolvedIcon = Globe;
        break;
      case 'system-audio':
        resolvedIcon = Disc;
        break;
    }
  }

  let cardClass = 'source-card';
  if (active) cardClass += ' source-card--active';
  if (warning) cardClass += ' source-card--warning';
  if (blocked) cardClass += ' source-card--blocked';
  if (disabled) cardClass += ' source-card--disabled';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onClick && !disabled && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={cardClass}
      onClick={!disabled ? onClick : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="source-card-header">
        <div className="source-card-title-group">
          <Icon icon={resolvedIcon} size={15} className="source-card-icon" />
          <span className="source-card-title">{label}</span>
        </div>
        <span className="source-card-status">{status}</span>
      </div>
      {children}
    </div>
  );
}
