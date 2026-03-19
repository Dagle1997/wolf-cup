/**
 * Tiny SVG sparkline — no axes, no labels, just the shape of the trend.
 */
export function Sparkline({
  data,
  width = 56,
  height = 18,
  color = 'currentColor',
  showZeroLine = false,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showZeroLine?: boolean;
  className?: string;
}) {
  if (data.length < 2) return null;

  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ');
  const [lastX, lastY] = pts[pts.length - 1]!;

  // Zero line for money sparklines (where values cross zero)
  const zeroY =
    showZeroLine && min < 0 && max > 0
      ? pad + (1 - (0 - min) / range) * (height - pad * 2)
      : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      {zeroY !== null && (
        <line
          x1={pad}
          y1={zeroY}
          x2={width - pad}
          y2={zeroY}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={0.5}
          strokeDasharray="2,2"
        />
      )}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={1.5} fill={color} />
    </svg>
  );
}
