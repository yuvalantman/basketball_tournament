"use client";

import { PARAM_ABBR, RATING_PARAMS } from "@/lib/constants";

// Lightweight SVG radar. `values` are normalized 0..1 per param. When
// `showSpokeLabels` is false we render shape only (used for the
// radar_normalized visibility mode where no numbers/labels should leak).
export function RadarChart({
  values,
  size = 200,
  color = "var(--primary)",
  showSpokeLabels = true,
}: {
  values: Record<string, number>;
  size?: number;
  color?: string;
  showSpokeLabels?: boolean;
}) {
  const params = RATING_PARAMS;
  const n = params.length;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - (showSpokeLabels ? 26 : 8);

  const point = (i: number, radius: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  };

  const rings = [0.25, 0.5, 0.75, 1];

  const shape = params
    .map((p, i) => {
      const v = Math.max(0.05, Math.min(1, values[p] ?? 0));
      const [x, y] = point(i, r * v);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="max-w-full"
    >
      {/* grid rings */}
      {rings.map((ring) => (
        <polygon
          key={ring}
          points={params
            .map((_, i) => {
              const [x, y] = point(i, r * ring);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
        />
      ))}
      {/* spokes */}
      {params.map((_, i) => {
        const [x, y] = point(i, r);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="var(--border)"
            strokeWidth={1}
          />
        );
      })}
      {/* value shape */}
      <polygon
        points={shape}
        fill={color}
        fillOpacity={0.25}
        stroke={color}
        strokeWidth={2}
      />
      {/* labels */}
      {showSpokeLabels &&
        params.map((p, i) => {
          const [x, y] = point(i, r + 14);
          return (
            <text
              key={p}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={9}
              fill="var(--muted)"
            >
              {PARAM_ABBR[p]}
            </text>
          );
        })}
    </svg>
  );
}
