/**
 * BuildLog — Terminal-style panel for displaying Docker build output.
 *
 * Phase 1: Shows a static "Waiting for deployment..." message.
 * Phase 3+: Will stream real Docker build logs via Socket.io.
 *
 * @param {Object}   props
 * @param {string[]} props.lines — array of log line strings
 * @param {boolean}  props.isStreaming — true while a build is in progress
 */

import { useEffect, useRef } from 'react';

export default function BuildLog({ lines = [], isStreaming = false }) {
  const bodyRef = useRef(null);

  // Auto-scroll to bottom as new log lines arrive (Phase 3 behaviour)
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="terminal-panel animate-in">
      {/* macOS-style window chrome */}
      <div className="terminal-header">
        <div className="terminal-controls">
          <div className="terminal-dot red"   title="Close" />
          <div className="terminal-dot yellow" title="Minimise" />
          <div className="terminal-dot green"  title="Maximise" />
        </div>
        <div className="terminal-title">
          <span>🖥️</span>
          <span>Build Logs</span>
          {isStreaming && (
            <span style={{ color: 'var(--color-building)', fontSize: '0.7rem' }}>
              ● Streaming…
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
          bash
        </span>
      </div>

      {/* Log body */}
      <div className="terminal-body" ref={bodyRef} style={{ maxHeight: 280, overflowY: 'auto' }}>
        {lines.length === 0 ? (
          /* Phase 1: no active deployment → waiting state */
          <div className="terminal-prompt">
            <span className="terminal-prompt-char">$</span>
            <span className="terminal-waiting">Waiting for deployment…</span>
            <span className="terminal-cursor" />
          </div>
        ) : (
          /* Phase 3+: render streamed log lines */
          lines.map((line, idx) => (
            <div key={idx} className="terminal-prompt">
              <span className="terminal-prompt-char" style={{ userSelect: 'none' }}>›</span>
              <span>{line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
