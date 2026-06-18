import { useState } from 'react';
import type { LogLine } from '../utils/types';

interface LogsSectionProps {
  lines: LogLine[];
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function LogsSection({ lines }: LogsSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? lines.slice(-50) : lines.slice(-5);

  return (
    <section className="sp-section sp-section--logs">
      <button
        className="sp-logs-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="sp-section-title">Logs</span>
        <span className="sp-logs-toggle">{expanded ? '▲' : '▼'}</span>
      </button>

      {(expanded || lines.length > 0) && (
        <div className={`sp-logs-body ${expanded ? 'sp-logs-body--expanded' : ''}`}>
          {visible.length === 0 ? (
            <div className="sp-logs-empty">No log entries yet.</div>
          ) : (
            visible.map((line, i) => (
              <div
                key={`${line.ts}-${i}`}
                className={`sp-log-line sp-log-line--${line.level}`}
              >
                <span className="sp-log-ts">{formatTs(line.ts)}</span>
                <span className="sp-log-msg">{line.msg}</span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
