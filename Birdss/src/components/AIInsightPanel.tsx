import { Sparkles, ShieldCheck, Flame, Droplets, Activity, Percent, ArrowUpRight } from "lucide-react";
import type { AnalyzeResult, ImageIntel } from "@/lib/birdApi";
import type { LayerState } from "./LayerControls";
import { type EcosystemInsight } from "@/lib/scenePlanner";

interface Props {
  result: AnalyzeResult;
  intel: ImageIntel;
  layers: LayerState;
  ecosystemInsight?: EcosystemInsight | null;
}

export function AIInsightPanel({ result, intel, layers, ecosystemInsight = null }: Props) {
  // If we have the advanced ecosystem insight from Gemini, render a premium geospatial dashboard!
  if (ecosystemInsight) {
    const {
      climate,
      season,
      vegetation_density,
      fire_risk,
      water_resources,
      land_use_change,
      ai_insight,
      confidence_overall
    } = ecosystemInsight;

    return (
      <div className="rounded-3xl bg-card border border-border p-6 shadow-soft space-y-6 transition-all duration-300 hover:shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-forest text-primary-foreground flex items-center justify-center shadow-md animate-pulse">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-2xl font-bold tracking-tight">Geospatial Forest Intelligence</h3>
              <p className="text-xs text-muted-foreground">
                Synthesized from satellite telemetry & remote-sensing proxies
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/20 text-primary text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm">
            <Percent className="h-3.5 w-3.5" />
            <span>AI Confidence: {Math.round(confidence_overall * 100)}%</span>
          </div>
        </div>

        {/* Narrative Insight Panel */}
        <div className="rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/5 to-emerald-500/5 p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 opacity-15">
            <Sparkles className="h-12 w-12 text-primary" />
          </div>
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-1">
            {ai_insight.headline || "Ecosystem Condition Statement"}
          </p>
          <p className="text-sm text-foreground/90 leading-relaxed font-medium">
            {ai_insight.summary}
          </p>
          {ai_insight.recommended_action && (
            <div className="mt-4 pt-3 border-t border-border flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-foreground">Recommended protocol: </span>
                {ai_insight.recommended_action}
              </div>
            </div>
          )}
        </div>

        {/* 2x2 Remote Sensing Metrics Grid */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Vegetation Density */}
          <MetricCard
            title="Vegetation Density (NDVI)"
            value={vegetation_density.ndvi_simulation}
            max={100}
            label={vegetation_density.label}
            status={vegetation_density.status}
            description={vegetation_density.description}
            barColor="bg-gradient-to-r from-emerald-500 to-green-600"
            icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />}
          />

          {/* Fire Risk */}
          <MetricCard
            title="Fire Risk Index"
            value={fire_risk.thermal_anomaly_index}
            max={100}
            label={fire_risk.label}
            status={fire_risk.status}
            description={fire_risk.description}
            barColor="bg-gradient-to-r from-amber-500 to-red-500"
            icon={<Flame className="h-4 w-4 text-amber-600" />}
          />

          {/* Water Resources */}
          <MetricCard
            title="Surface Water Resources"
            value={water_resources.water_presence_index}
            max={100}
            label={water_resources.label}
            status={water_resources.status}
            description={water_resources.description}
            barColor="bg-gradient-to-r from-sky-400 to-blue-600"
            icon={<Droplets className="h-4 w-4 text-blue-600" />}
          />

          {/* Land Use Change */}
          <MetricCard
            title="Land Cover Dynamics"
            value={land_use_change.index}
            max={100}
            label={land_use_change.label}
            status={land_use_change.status}
            description={land_use_change.description}
            barColor="bg-gradient-to-r from-slate-400 to-indigo-500"
            icon={<Activity className="h-4 w-4 text-indigo-600" />}
          />
        </div>

        {/* Macro Geography Footer */}
        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-border text-xs text-muted-foreground">
          <div className="bg-secondary/40 px-3 py-2 rounded-xl border border-border/50">
            <span className="font-semibold text-foreground block mb-0.5">Macro Climate</span>
            {climate.label} · {climate.description}
          </div>
          <div className="bg-secondary/40 px-3 py-2 rounded-xl border border-border/50">
            <span className="font-semibold text-foreground block mb-0.5">Seasonal Aspect</span>
            {season.label} · {season.description}
          </div>
        </div>
      </div>
    );
  }

  // Fallback to old behavior if no ecosystemInsight is provided
  const fhqi = result.fhqi ?? result.biodiversityScore;
  const lines: string[] = [];

  if (layers.ndvi) {
    lines.push(
      intel.vegetationHealth >= 70
        ? `Vegetation density is robust (NDVI proxy ${intel.vegetationHealth}/100), indicating a mature, photosynthetically active canopy.`
        : intel.vegetationHealth >= 40
        ? `Vegetation is moderate (${intel.vegetationHealth}/100) — patchy canopy or seasonal stress likely.`
        : `Sparse vegetation signal (${intel.vegetationHealth}/100) suggests degradation or recent clearing.`
    );
  }
  if (layers.landUse) {
    lines.push(
      intel.humanDisturbance < 30
        ? `Land-use signature is stable; minimal anthropogenic disturbance detected — afforestation trend probable.`
        : intel.humanDisturbance < 60
        ? `Moderate human footprint observed; monitor edge effects and fragmentation.`
        : `High disturbance index (${intel.humanDisturbance}/100) — deforestation pressure flagged for review.`
    );
  }
  if (layers.fire) {
    lines.push(
      intel.fireRisk < 30
        ? `Fire risk is low across the region; thermal anomalies within seasonal baseline.`
        : intel.fireRisk < 60
        ? `Elevated fire risk (${intel.fireRisk}/100) — drying fuel loads warrant alert-tier monitoring.`
        : `Critical fire risk (${intel.fireRisk}/100). Recommend pre-positioned suppression resources.`
    );
  }
  if (layers.water) {
    lines.push(
      intel.waterPresence >= 60
        ? `Surface water resources are abundant — hydrology supports diverse fauna and acts as a fire buffer.`
        : intel.waterPresence >= 30
        ? `Water presence is adequate but seasonal; track flow continuity through dry months.`
        : `Water scarcity detected — riparian habitat and amphibian populations at risk.`
    );
  }

  const verdict =
    fhqi >= 80
      ? "Overall verdict: ecosystem is functioning at a healthy baseline. Maintain protective status and continue passive monitoring."
      : fhqi >= 50
      ? "Overall verdict: ecosystem shows moderate stress. Targeted interventions (corridor protection, fire mitigation, replanting) recommended."
      : "Overall verdict: ecosystem is degraded. Immediate conservation action and on-ground verification advised.";

  return (
    <div className="rounded-3xl bg-card border border-border p-6 shadow-soft">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-xl bg-gradient-forest text-primary-foreground flex items-center justify-center">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-display text-2xl">AI insight</h3>
          <p className="text-sm text-muted-foreground">
            Synthesized from acoustic, imagery and geospatial layers
          </p>
        </div>
      </div>
      <ul className="space-y-3 text-sm leading-relaxed">
        {lines.length === 0 ? (
          <li className="text-muted-foreground italic">All map layers are disabled — enable a layer to generate insight.</li>
        ) : (
          lines.map((l, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>{l}</span>
            </li>
          ))
        )}
      </ul>
      <div className="mt-5 pt-4 border-t border-border text-sm font-medium">
        {verdict}
      </div>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: number;
  max: number;
  label: string;
  status: string;
  description: string;
  barColor: string;
  icon: React.ReactNode;
}

function MetricCard({ title, value, max, label, status, description, barColor, icon }: MetricCardProps) {
  const pct = Math.round((value / max) * 100);

  return (
    <div className="rounded-2xl border border-border bg-secondary/20 p-4 space-y-3 transition-all hover:bg-secondary/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-card border border-border shadow-sm flex items-center gap-1">
          {label}
          <ArrowUpRight className="h-3 w-3 opacity-60" />
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between items-baseline">
          <span className="text-2xl font-display font-extrabold tracking-tight tabular-nums">
            {value}
            <span className="text-xs font-normal text-muted-foreground">/{max}</span>
          </span>
          <span className="text-[10px] text-muted-foreground uppercase font-bold">{status}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-normal">
        {description}
      </p>
    </div>
  );
}