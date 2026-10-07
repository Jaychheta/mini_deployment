/**
 * Header component — sticky top navigation bar.
 * Displays the platform logo, name, and a live API status indicator.
 */

import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export default function Header() {
  const [apiStatus, setApiStatus] = useState('checking'); // 'ok' | 'error' | 'checking'

  // Poll the health endpoint every 30 seconds to show live backend status
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(`${API_BASE}/health`);
        const data = await res.json();
        setApiStatus(data.status === 'ok' ? 'ok' : 'error');
      } catch {
        setApiStatus('error');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="header">
      <div className="container">
        <div className="header-inner">
          {/* Logo */}
          <div className="header-logo">
            <div className="header-logo-icon">🚀</div>
            <span>Mini Deploy Platform</span>
            <span className="header-badge">Phase 1</span>
          </div>

          {/* API Status */}
          <div className="header-status">
            <div
              className="status-dot"
              style={{
                background: apiStatus === 'ok' ? 'var(--color-live)' : apiStatus === 'error' ? 'var(--color-failed)' : 'var(--color-building)',
                boxShadow: apiStatus === 'ok' ? '0 0 8px var(--color-live)' : 'none',
              }}
            />
            <span>
              {apiStatus === 'ok'
                ? 'API Online'
                : apiStatus === 'error'
                ? 'API Offline'
                : 'Connecting...'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
