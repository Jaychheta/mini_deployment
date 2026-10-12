import React from 'react';

/**
 * TriggerBadge.jsx — Visual indicator for deployment trigger types:
 *   - MANUAL: 👤 Manual
 *   - WEBHOOK: ⚡ GitHub Push
 *   - REDEPLOY: 🔄 Redeploy
 *   - ROLLBACK: ⏪ Rollback
 */
export default function TriggerBadge({ source }) {
  const s = (source || 'MANUAL').toUpperCase();

  if (s === 'WEBHOOK') {
    return (
      <span style={{
        fontSize: '0.75rem',
        padding: '2px 8px',
        borderRadius: 99,
        background: '#eff6ff',
        color: '#1d4ed8',
        border: '1px solid #bfdbfe',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontWeight: 500,
      }}>
        ⚡ Push
      </span>
    );
  }

  if (s === 'REDEPLOY') {
    return (
      <span style={{
        fontSize: '0.75rem',
        padding: '2px 8px',
        borderRadius: 99,
        background: '#f5f3ff',
        color: '#6d28d9',
        border: '1px solid #ddd6fe',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontWeight: 500,
      }}>
        🔄 Redeploy
      </span>
    );
  }

  if (s === 'ROLLBACK') {
    return (
      <span style={{
        fontSize: '0.75rem',
        padding: '2px 8px',
        borderRadius: 99,
        background: '#fff1f2',
        color: '#be123c',
        border: '1px solid #fecdd3',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontWeight: 500,
      }}>
        ⏪ Rollback
      </span>
    );
  }

  return (
    <span style={{
      fontSize: '0.75rem',
      padding: '2px 8px',
      borderRadius: 99,
      background: '#f8fafc',
      color: '#475569',
      border: '1px solid #e2e8f0',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      fontWeight: 500,
    }}>
      👤 Manual
    </span>
  );
}
