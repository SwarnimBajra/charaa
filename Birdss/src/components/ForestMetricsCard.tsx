import { Activity, BarChart3, Info, Layers, Sprout, ShieldAlert, Trees } from "lucide-react";
import type { ForestMetrics } from "@/lib/forestApi";
import { cn } from "@/lib/utils";

const labelTone: Record<string, string> = {
  Excellent: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  Good: "bg-health-good/15 text-health-good border-health-good/30",
  Fair: "bg-health-mid/15 text-amber-bird border-health-mid/30",
  Poor: "bg-health-bad/15 text-health-bad border-health-bad/30",
  Critical: "bg-health-bad/25 text-health-bad border-health-bad/50",
  Unknown: "bg-muted text-muted-foreground border-border",
};

function pct(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

export function ForestMetricsCard({ metrics }: { metrics: ForestMetrics }) {
  const compositeLabel = metrics.composite_health.label || "Unknown";
  const compositePct = pct(metrics.composite_health.score);

  const subMetrics: Array<{
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    bar?: number;
    hint?: string;
  }> = [
    {
      icon: BarChart3,
      label: "Shannon diversity",
      value: metrics.shannon_idx.toFixed(3),
      hint: "Index of evenness across detected species",
    },
    {
      icon: Layers,
      label: "Unique species",
      value: String(metrics.unique_species),
    },
    {
      icon: Activity,
      label: "Dominance",
      value: `${pct(metrics.dominance.dominance_score)}%`,
      bar: metrics.dominance.dominance_score,
      hint: metrics.dominance.dominant_species
        ? `Dominant: ${metrics.dominance.dominant_species}`
        : "No dominant species",
    },
    {
      icon: Sprout,
      label: "Native ratio",
      value: `${pct(metrics.native_ratio)}%`,
      bar: metrics.native_ratio,
    },
    {
      icon: Trees,
      label: "Forest dependency",
      value: `${pct(metrics.forest_dependency)}%`,
      bar: metrics.forest_dependency,
      hint: "Share of forest-obligate species",
    },
    {
      icon: ShieldAlert,
      label: "Rarity",
      value: `${pct(metrics.rarity_score)}%`,
      bar: metrics.rarity_score,
      hint: "Presence of rare/threatened species",
    },
  ];

  return (
    <div className="rounded-3xl bg-card border border-border p-6 shadow-soft space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Forest health metrics
          </p>
          <h3 className="font-display text-2xl mt-1">Metrics breakdown</h3>
          <p className="text-sm text-muted-foreground">
            Computed from detected species via the backend `/forest` endpoint. The composite index ({compositePct}/100) is shown in the verdict below.
          </p>
        </div>
        <span
          className={cn(
            "text-xs px-3 py-1 rounded-full border whitespace-nowrap",
            labelTone[compositeLabel] ?? labelTone.Unknown,
          )}
        >
          {compositeLabel}
        </span>
      </div>

      {metrics.unique_species <= 2 && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Why is the score low?</span> With only{" "}
            {metrics.unique_species} species detected, Shannon diversity is 0 and dominance is 100%, which the
            model correctly reads as a degradation signal. If you expected a richer forest, try a longer audio
            sample (30s+) — short clips often catch only the loudest vocalizer.
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {subMetrics.map((m) => (
          <div
            key={m.label}
            className="rounded-2xl border border-border bg-background p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground">
                <m.icon className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-wider">{m.label}</span>
              </div>
              <span className="font-display text-lg tabular-nums">{m.value}</span>
            </div>
            {m.bar !== undefined && (
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-forest-canopy to-amber-bird"
                  style={{ width: `${pct(m.bar)}%` }}
                />
              </div>
            )}
            {m.hint && <p className="text-[11px] text-muted-foreground">{m.hint}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
