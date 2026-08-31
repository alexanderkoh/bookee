/**
 * Charts.
 *
 * Two forms only, each chosen for the job its data does:
 *
 *   MonthlyFlowChart   polarity — money in above a baseline, out below.
 *                      A diverging bar; position carries the sign, colour
 *                      reinforces it.
 *   CategoryBarChart   magnitude — one hue, sorted, so length is the message.
 *
 * The colours are not the ledger's green/red. That pair measures ΔE 5.9 under
 * deuteranopia — below the 6.0 floor — so it cannot carry meaning in a chart.
 * The blue/red diverging pair used here measures 23.8 (light) and 20.2 (dark).
 * In the ledger table green/red is fine because a sign and a text label carry
 * the meaning there; in a chart the mark is the message.
 */
import { useId, useState } from "react";
import { formatDisplay } from "../lib/money";
import type { MonthlyBucket } from "../ledger/monthly";

/** Validated diverging pair; see the note above. */
const FLOW_COLORS = {
  incoming: "var(--chart-in)",
  outgoing: "var(--chart-out)",
} as const;

/** Bars are capped rather than filling their band, so the band keeps some air. */
const MAX_BAR = 22;
const SURFACE_GAP = 2;

function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= magnitude * step) return magnitude * step;
  }
  return magnitude * 10;
}

function abbreviate(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${(value / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

interface Hover {
  index: number;
  x: number;
  y: number;
}

/**
 * Money in and out per month, for one asset.
 *
 * Diverging: incoming rises from the zero line, outgoing falls from it. The
 * baseline is the reference the eye reads against, so it is the only emphasised
 * rule on the chart.
 */
export function MonthlyFlowChart({
  months,
  assetCode,
  height = 210,
}: {
  months: MonthlyBucket[];
  assetCode: string;
  height?: number;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const titleId = useId();

  const width = 720;
  const padding = { top: 14, right: 12, bottom: 22, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const peak = Math.max(
    ...months.map((month) => Math.max(Number(month.incoming), Number(month.outgoing))),
    0,
  );
  const scaleMax = niceCeiling(peak);
  const zeroY = padding.top + plotHeight / 2;
  const halfHeight = plotHeight / 2;

  const band = plotWidth / Math.max(months.length, 1);
  const barWidth = Math.min(MAX_BAR, band * 0.42);

  const toHeight = (amount: string) =>
    scaleMax === 0 ? 0 : (Number(amount) / scaleMax) * halfHeight;

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart__svg"
        role="img"
        aria-labelledby={titleId}
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHover(null)}
      >
        <title id={titleId}>
          Money in and out per month in {assetCode}, for the last {months.length} months
        </title>

        {/* Gridlines: hairline, solid, recessive. */}
        {[1, 0.5, 0, -0.5, -1].map((fraction) => (
          <line
            key={fraction}
            x1={padding.left}
            x2={width - padding.right}
            y1={zeroY - fraction * halfHeight}
            y2={zeroY - fraction * halfHeight}
            className={fraction === 0 ? "chart__baseline" : "chart__grid"}
          />
        ))}

        {/* Both arms are labelled with magnitudes and the baseline with 0:
            on a diverging axis the sign is carried by which side of zero a bar
            sits on, so a repeated "10k" above and below is correct — but only
            once the zero is there to read them against. */}
        {[1, 0.5, 0, -0.5, -1].map((fraction) => (
          <text
            key={fraction}
            x={padding.left - 8}
            y={zeroY - fraction * halfHeight + 3}
            className={fraction === 0 ? "chart__tick chart__tick--zero" : "chart__tick"}
            textAnchor="end"
          >
            {fraction === 0 ? "0" : abbreviate(Math.abs(fraction) * scaleMax)}
          </text>
        ))}

        {months.map((month, index) => {
          const centre = padding.left + band * index + band / 2;
          const inHeight = toHeight(month.incoming);
          const outHeight = toHeight(month.outgoing);
          const active = hover?.index === index;

          return (
            <g key={month.month}>
              {/* Hit target spans the whole band, not just the bars. */}
              <rect
                x={padding.left + band * index}
                y={padding.top}
                width={band}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHover({ index, x: centre, y: padding.top })}
              />

              {active ? (
                <rect
                  x={padding.left + band * index}
                  y={padding.top}
                  width={band}
                  height={plotHeight}
                  className="chart__hover-band"
                />
              ) : null}

              {inHeight > 0 ? (
                <rect
                  x={centre - barWidth - SURFACE_GAP / 2}
                  y={zeroY - inHeight}
                  width={barWidth}
                  height={inHeight}
                  fill={FLOW_COLORS.incoming}
                  rx={3}
                  className="chart__bar"
                />
              ) : null}

              {outHeight > 0 ? (
                <rect
                  x={centre + SURFACE_GAP / 2}
                  y={zeroY}
                  width={barWidth}
                  height={outHeight}
                  fill={FLOW_COLORS.outgoing}
                  rx={3}
                  className="chart__bar"
                />
              ) : null}

              <text x={centre} y={height - 6} className="chart__tick" textAnchor="middle">
                {month.label}
              </text>
            </g>
          );
        })}
      </svg>

      {hover ? (
        <div
          className="chart__tooltip"
          style={{
            left: `${(hover.x / width) * 100}%`,
            top: 0,
          }}
          role="status"
        >
          <p className="chart__tooltip-title">{months[hover.index]!.label}</p>
          <p className="chart__tooltip-row">
            <span className="chart__key" style={{ background: FLOW_COLORS.incoming }} />
            In <strong>{formatDisplay(months[hover.index]!.incoming)}</strong>
          </p>
          <p className="chart__tooltip-row">
            <span className="chart__key" style={{ background: FLOW_COLORS.outgoing }} />
            Out <strong>{formatDisplay(months[hover.index]!.outgoing)}</strong>
          </p>
          <p className="chart__tooltip-row chart__tooltip-row--net">
            Net <strong>{formatDisplay(months[hover.index]!.net, { signed: true })}</strong>{" "}
            {assetCode}
          </p>
        </div>
      ) : null}

      {/* Two series, so a legend is always present — identity is never colour alone. */}
      <figcaption className="chart__legend">
        <span className="chart__legend-item">
          <span className="chart__key" style={{ background: FLOW_COLORS.incoming }} />
          Money in
        </span>
        <span className="chart__legend-item">
          <span className="chart__key" style={{ background: FLOW_COLORS.outgoing }} />
          Money out
        </span>
        <span className="chart__legend-unit">{assetCode}</span>
      </figcaption>
    </figure>
  );
}

export interface CategoryBar {
  id: string;
  label: string;
  amount: string;
}

/**
 * Magnitude by category, sorted.
 *
 * One hue: these categories are nominal, so colouring them individually would
 * spend the identity channel re-encoding what bar length already says.
 */
export function CategoryBarChart({
  bars,
  assetCode,
  max = 6,
}: {
  bars: CategoryBar[];
  assetCode: string;
  max?: number;
}) {
  const sorted = bars.toSorted((a, b) => Number(b.amount) - Number(a.amount));
  const shown = sorted.slice(0, max);
  const peak = Math.max(...shown.map((bar) => Number(bar.amount)), 0);

  if (shown.length === 0) {
    return <p className="text-sm muted">Nothing categorized in this period yet.</p>;
  }

  return (
    <div className="category-bars">
      {shown.map((bar) => (
        <div className="category-bar" key={bar.id}>
          <span className="category-bar__label truncate" title={bar.label}>
            {bar.label}
          </span>
          <span className="category-bar__track">
            <span
              className="category-bar__fill"
              style={{ width: peak === 0 ? "0%" : `${(Number(bar.amount) / peak) * 100}%` }}
            />
          </span>
          <span className="category-bar__value numeric">{formatDisplay(bar.amount)}</span>
        </div>
      ))}
      {sorted.length > max ? (
        <p className="field__hint">
          {sorted.length - max} smaller categor{sorted.length - max === 1 ? "y" : "ies"} not shown ·{" "}
          {assetCode}
        </p>
      ) : (
        <p className="field__hint">{assetCode}</p>
      )}
    </div>
  );
}
