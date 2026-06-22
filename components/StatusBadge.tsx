import React from 'react';

interface StatusBadgeProps {
  status:
    | 'idle'
    | 'active'
    | 'paused'
    | 'blocked'
    | 'recording'
    | 'available'
    | 'coming_soon'
    | 'connected'
    | 'disconnected'
    | 'error'
    | 'recovering'
    | string;
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const normStatus = status.toLowerCase().replace(' ', '_');
  const displayLabel = label || status.toUpperCase().replace('_', ' ');

  let colorClass = '';
  switch (normStatus) {
    case 'active':
    case 'connected':
    case 'available':
      colorClass = 'status-badge--success';
      break;
    case 'paused':
    case 'warning':
    case 'recovering':
      colorClass = 'status-badge--warning';
      break;
    case 'error':
    case 'blocked':
    case 'recording':
    case 'disconnected':
      colorClass = 'status-badge--error';
      break;
    case 'coming_soon':
      colorClass = 'status-badge--coming-soon';
      break;
    default:
      colorClass = 'status-badge--idle';
      break;
  }

  return (
    <span className={`status-badge ${colorClass}`}>
      {displayLabel}
    </span>
  );
}
