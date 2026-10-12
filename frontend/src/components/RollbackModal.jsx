import React from 'react';

/**
 * RollbackModal.jsx — Clean, accessible confirmation dialog for safe rollbacks.
 *
 * Clearly reminds the user:
 *   - The exact target deployment ID and commit SHA.
 *   - Zero downtime safety: candidate is built and health-checked before switching.
 *   - If health check fails, the live production route remains untouched.
 */
export default function RollbackModal({
  isOpen,
  targetDeployment,
  onClose,
  onConfirm,
  loading = false,
  error = '',
}) {
  if (!isOpen || !targetDeployment) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(3px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '16px',
    }}>
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        width: '100%',
        maxWidth: '520px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        animation: 'fadeIn 0.15s ease-out',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: '#eff6ff',
            color: '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
          }}>
            ⏪
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, color: '#0f172a' }}>
              Confirm Safe Rollback
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              Restore previous version without downtime
            </p>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '24px' }}>
          {error && (
            <div style={{
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '0.875rem',
              marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <div style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
            fontSize: '0.875rem',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', marginBottom: '6px' }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>Target Version:</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>
                #{targetDeployment.id.slice(0, 8)}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', marginBottom: '6px' }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>Target Commit:</span>
              <span style={{ fontFamily: 'monospace', color: '#2563eb', fontWeight: 600 }}>
                {targetDeployment.commitHash ? targetDeployment.commitHash.slice(0, 7) : '—'}
              </span>
            </div>
            {targetDeployment.commitMessage && (
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', marginBottom: '6px' }}>
                <span style={{ color: '#64748b', fontWeight: 500 }}>Commit Message:</span>
                <span style={{ color: '#334155', fontStyle: 'italic' }}>
                  "{targetDeployment.commitMessage}"
                </span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px' }}>
              <span style={{ color: '#64748b', fontWeight: 500 }}>Originally Live:</span>
              <span style={{ color: '#475569' }}>
                {new Date(targetDeployment.createdAt).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Zero Downtime Guarantee Notice */}
          <div style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '8px',
            padding: '12px 14px',
            display: 'flex',
            gap: '10px',
            fontSize: '0.825rem',
            color: '#15803d',
            lineHeight: 1.5,
          }}>
            <span style={{ fontSize: '1.1rem' }}>🛡️</span>
            <div>
              <strong>Zero-Downtime Safety Guarantee:</strong>
              <div style={{ marginTop: '2px' }}>
                A fresh container will be built and verified by health checks. Production traffic only switches once the replacement is 100% healthy. If anything fails, the current production app remains untouched.
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          backgroundColor: '#f8fafc',
          borderTop: '1px solid #f1f5f9',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '12px',
        }}>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="btn btn-outline btn-sm"
            style={{ minWidth: '80px' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(targetDeployment)}
            disabled={loading}
            className="btn btn-primary btn-sm"
            style={{ minWidth: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            {loading ? (
              <>
                <span className="spinner-sm" /> Initiating...
              </>
            ) : (
              'Confirm Rollback ↗'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
