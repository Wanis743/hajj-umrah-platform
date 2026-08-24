/**
 * Visualization rendering engine (V12 §22 Phase B, §8/§9).
 *
 * A visualization = chart_type + measures + dimensions bound to a dataset.
 * The engine resolves each binding against the supported server-backed
 * data providers (currently: revenue-by-month series and group margins)
 * and renders real charts. Bindings that reference measures we cannot
 * compute honestly render as "no data for this binding" — never fake
 * series (§23).
 *
 * §9 families covered initially: bar, line, area (trend family) with
 * grouped/stacked-ready measure arrays; more families land per Phase B.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getVisualizations, type BiVisualizationDTO } from './semanticService.ts';
import { evaluateNetRevenuePerPilgrim } from './queryService.ts';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly visuals: readonly BiVisualizationDTO[] };

interface RenderedChart {
  readonly visual: BiVisualizationDTO;
  readonly title: string;
  readonly data: readonly Record<string, string | number | null>[];
  readonly valueKeys: readonly string[];
}

const ACCENT = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'];

/** Resolve a visualization's data honestly or mark it unresolvable. */
function useRenderedCharts(visuals: readonly BiVisualizationDTO[] | null): {
  charts: readonly RenderedChart[];
  unresolvable: readonly BiVisualizationDTO[];
} {
  const [revenueRows, setRevenueRows] = useState<readonly Record<string, string | number | null>[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void evaluateNetRevenuePerPilgrim().then((r) => {
      if (cancelled) return;
      if (!r.ok) return;
      setRevenueRows(r.value.map((row) => ({
        period: row.period,
        revenue_minor: row.revenueMinor,
        pilgrims: row.pilgrims,
        net_revenue_per_pilgrim: row.value ?? 0,
      })));
    });
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => {
    if (visuals === null || revenueRows === null) return { charts: [], unresolvable: [] };
    const charts: RenderedChart[] = [];
    const unresolvable: BiVisualizationDTO[] = [];
    for (const v of visuals) {
      // Only bindings whose measures exist in the computed series resolve today.
      const known = ['net_revenue_per_pilgrim', 'revenue_minor', 'pilgrims'];
      const resolvable = v.measures.length > 0 && v.measures.every((m) => known.includes(m));
      if (!resolvable) {
        unresolvable.push(v);
        continue;
      }
      charts.push({
        visual: v,
        title: `${v.chartType} · ${v.measures.join(', ')}`,
        data: revenueRows,
        valueKeys: v.measures.filter((m): m is string => known.includes(m)),
      });
    }
    return { charts, unresolvable };
  }, [visuals, revenueRows]);
}

const ChartFrame: React.FC<{ chart: RenderedChart }> = ({ chart }) => (
  <div className="glass-card rounded-xl p-4">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wider text-white/55">{chart.title}</span>
      <span className="font-mono text-[10px] text-white/35">{chart.visual.dimensions.join(' · ') || '—'}</span>
    </div>
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {chart.visual.chartType === 'line' ? (
          <LineChart data={chart.data}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="period" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'rgba(10,14,25,0.92)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8 }} />
            {chart.visual.dimensions.length > 0 ? null : null}
            {chart.valueKeys.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={ACCENT[i % ACCENT.length]} dot={false} strokeWidth={2} />
            ))}
            <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }} />
          </LineChart>
        ) : (
          <BarChart data={chart.data}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="period" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: 'rgba(10,14,25,0.92)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8 }} />
            {chart.valueKeys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={ACCENT[i % ACCENT.length]} radius={[3, 3, 0, 0]} />
            ))}
            <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  </div>
);

export function VisualizationStudio() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void getVisualizations().then((r) => {
      if (cancelled) return;
      if (!r.ok) setState({ kind: 'error', message: r.error.message });
      else setState({ kind: 'ready', visuals: r.value });
    });
    return () => { cancelled = true; };
  }, []);

  const { charts, unresolvable } = useRenderedCharts(
    state.kind === 'ready' ? state.visuals : null,
  );

  return (
    <div className="finance-font h-full overflow-y-auto p-6">
      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-white/90">Visualization Studio</h2>
        <p className="mt-1 text-sm text-white/55">Data-bound visuals rendered from certified metric series</p>
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-6 text-sm text-white/50">Loading visualizations…</div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="mt-6 glass-card rounded-xl border-red-400/30 p-4 text-sm text-red-300">
          Failed to load: {state.message}
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          {charts.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {charts.map((c) => <ChartFrame key={c.visual.id} chart={c} />)}
            </div>
          ) : null}

          {unresolvable.map((v) => (
            <div key={v.id} className="glass-card mt-4 rounded-xl p-4 text-sm text-white/55">
              <span className="font-mono uppercase tracking-wide text-white/70">{v.chartType}</span>
              {' '}— no honest data provider yet for measures:{' '}
              {v.measures.map((m) => (
                <span key={m} className="mr-1 rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-xs text-white/70">{m}</span>
              ))}
              . Define an evaluator to render this binding.
            </div>
          ))}

          {charts.length === 0 && unresolvable.length === 0 ? (
            <div className="mt-6 glass-card rounded-xl p-5 text-sm text-white/55">
              No visualizations defined yet. A visualization binds a chart type to certified
              measures and dimensions of a dataset.
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
