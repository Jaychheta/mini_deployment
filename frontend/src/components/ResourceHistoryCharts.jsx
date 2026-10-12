/**
 * ResourceHistoryCharts.jsx — Pure SVG Historical Resource Usage Charts.
 * Shows CPU % and Memory (MB) over time with 1h / 6h / 24h range selection and hover tooltips.
 */

import React, { useState } from 'react';

function SimpleSvgAreaChart({ data, metricKey, unit = '%', color = '#2563eb', gradientId, height = 180 }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  if (!data || data.length === 0) {
    return null;
  }

  const paddingLeft = 40;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;
  const chartWidth = 600;
  const chartHeight = height;

  const values = data.map((d) => Number(d[metricKey] || 0));
  const minVal = 0;
  const rawMax = Math.max(...values);
  const maxVal = rawMax <= 0 ? 10 : Math.ceil(rawMax * 1.25);

  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;

  const getX = (index) => {
    if (data.length <= 1) return paddingLeft + plotWidth / 2;
    return paddingLeft + (index / (data.length - 1)) * plotWidth;
  };

  const getY = (val) => {
    const clamped = Math.max(minVal, Math.min(val, maxVal));
    const ratio = (clamped - minVal) / (maxVal - minVal);
    return paddingTop + plotHeight - ratio * plotHeight;
  };

  // Generate SVG path for line
  const points = data.map((d, i) => `${getX(i)},${getY(d[metricKey])}`);
  const linePath = `M ${points.join(' L ')}`;

  // Area path
  const firstX = getX(0);
  const lastX = getX(data.length - 1);
  const bottomY = paddingTop + plotHeight;
  const areaPath = `M ${firstX},${bottomY} L ${points.join(' L ')} L ${lastX},${bottomY} Z`;

  // Horizontal grid lines (0%, 50%, 100%)
  const yTicks = [
    { val: minVal, y: getY(minVal) },
    { val: maxVal / 2, y: getY(maxVal / 2) },
    { val: maxVal, y: getY(maxVal) },
  ];

  const activePoint = hoveredIndex !== null && data[hoveredIndex] ? data[hoveredIndex] : null;

  return (
    <div style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={paddingLeft}
              y1={tick.y}
              x2={chartWidth - paddingRight}
              y2={tick.y}
              stroke="#e5e7eb"
              strokeDasharray={i === 0 ? 'none' : '3 3'}
              strokeWidth="1"
            />
            <text
              x={paddingLeft - 8}
              y={tick.y + 4}
              fontSize="10"
              fill="#9ca3af"
              textAnchor="end"
              fontFamily="sans-serif"
            >
              {Math.round(tick.val)}{unit}
            </text>
          </g>
        ))}

        {/* Filled Area */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Stroke Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Data points & hover detection */}
        {data.map((d, i) => {
          const cx = getX(i);
          const cy = getY(d[metricKey]);
          const isHovered = hoveredIndex === i;

          return (
            <g key={i}>
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? 5 : (data.length < 25 ? 3 : 1)}
                fill={color}
                stroke="#ffffff"
                strokeWidth={isHovered ? 2 : 1}
              />
              {/* Invisible larger hover target */}
              <circle
                cx={cx}
                cy={cy}
                r="12"
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            </g>
          );
        })}

        {/* X Axis Time Labels */}
        {data.length > 0 && (
          <>
            <text
              x={paddingLeft}
              y={chartHeight - 8}
              fontSize="10"
              fill="#9ca3af"
              fontFamily="sans-serif"
            >
              {new Date(data[0].recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </text>
            <text
              x={chartWidth - paddingRight}
              y={chartHeight - 8}
              fontSize="10"
              fill="#9ca3af"
              textAnchor="end"
              fontFamily="sans-serif"
            >
              {new Date(data[data.length - 1].recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </text>
          </>
        )}
      </svg>

      {/* Floating Tooltip */}
      {activePoint && hoveredIndex !== null && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 20,
            background: 'rgba(17, 24, 39, 0.9)',
            color: '#ffffff',
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: '0.75rem',
            pointerEvents: 'none',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
        >
          <div>
            <strong>Value:</strong> {activePoint[metricKey]}{unit}
          </div>
          <div style={{ color: '#d1d5db', fontSize: '0.7rem' }}>
            {new Date(activePoint.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResourceHistoryCharts({ history, loading, error, period, onPeriodChange }) {
  const periods = [
    { id: '1h', label: 'Last 1 Hour' },
    { id: '6h', label: 'Last 6 Hours' },
    { id: '24h', label: 'Last 24 Hours' },
  ];

  return (
    <div className="chart-card">
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>
            Historical Resource Usage
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
            Real Docker statistics recorded over time in PostgreSQL
          </p>
        </div>

        {/* Time period filter */}
        <div className="chart-controls">
          {periods.map((p) => (
            <button
              key={p.id}
              className={`chart-btn ${period === p.id ? 'active' : ''}`}
              onClick={() => onPeriodChange(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 10px' }} />
          <span style={{ fontSize: '0.85rem' }}>Loading historical metrics…</span>
        </div>
      ) : error ? (
        <div className="alert alert-error" style={{ margin: '16px 0' }}>
          Failed to load historical metrics: {error}
        </div>
      ) : !history || history.length === 0 ? (
        <div className="empty-state" style={{ padding: '36px 16px' }}>
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-text">
            No historical resource samples found for the selected time range ({period}).
            <br />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Metrics are automatically sampled every 10 seconds while the container is running.
            </span>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
          {/* CPU History */}
          <div style={{ border: '1px solid #f3f4f6', borderRadius: 8, padding: 16, background: '#fafafa' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
              CPU Usage Over Time (%)
            </div>
            <SimpleSvgAreaChart
              data={history}
              metricKey="cpuPercent"
              unit="%"
              color="#2563eb"
              gradientId="cpuGradient"
              height={170}
            />
          </div>

          {/* Memory History */}
          <div style={{ border: '1px solid #f3f4f6', borderRadius: 8, padding: 16, background: '#fafafa' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
              Memory Usage Over Time (MB)
            </div>
            <SimpleSvgAreaChart
              data={history}
              metricKey="memoryUsedMb"
              unit=" MB"
              color="#10b981"
              gradientId="memGradient"
              height={170}
            />
          </div>
        </div>
      )}
    </div>
  );
}
