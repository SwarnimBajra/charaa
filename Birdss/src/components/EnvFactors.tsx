import { Trees, Flame, Droplets, Globe2 } from "lucide-react";
import type { ImageIntel } from "@/lib/birdApi";
import { cn } from "@/lib/utils";

type Status = "Good" | "Moderate" | "Poor";

function statusFor(value: number, invert = false): Status {
  const v = invert ? 100 - value : value;
  return v >= 70 ? "Good" : v >= 40 ? "Moderate" : "Poor";
}

const statusStyles: Record<Status, string> = {
  Good: "bg-health-good/15 text-health-good border-health-good/30",
  Moderate: "bg-health-mid/15 text-amber-bird border-health-mid/30",
  Poor: "bg-health-bad/15 text-health-bad border-health-bad/30",
};

interface Props {
  intel: ImageIntel;
  enabledLayers: { ndvi: boolean; fire: boolean; water: boolean; landUse: boolean };
}

export function EnvFactors({ intel, enabledLayers }: Props) {
  const factors = [
    { key: "ndvi", icon: Trees, label: "Vegetation Density", sub: "NDVI simulation", value: intel.vegetationHealth, status: statusFor(intel.vegetationHealth), enabled: enabledLayers.ndvi },
    { key: "fire", icon: Flame, label: "Fire Risk", sub: "Thermal anomaly index", value: intel.fireRisk, status: statusFor(intel.fireRisk, true), enabled: enabledLayers.fire },
    { key: "water", icon: Droplets, label: "Water Resources", sub: "Rivers · lakes presence", value: intel.waterPresence, status: statusFor(intel.waterPresence), enabled: enabledLayers.water },
    { key: "landUse", icon: Globe2, label: "Land Use Change", sub: "Deforestation trend", value: 100 - intel.humanDisturbance, status: statusFor(100 - intel.humanDisturbance), enabled: enabledLayers.landUse },
  ];

  return (
    <div className="rounded-3xl bg-card border border-border p-6 shadow-soft">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="font-display text-2xl">Multi-factor analysis</h3>
          <p className="text-sm text-muted-foreground">Environmental signals from satellite & imagery layers</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {factors.map((f) => (
          <div
            key={f.key}
            className={cn(
              "rounded-2xl border p-4 transition-opacity",
              "bg-secondary/30 border-border",
              !f.enabled && "opacity-40"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider", statusStyles[f.status])}>
                {f.status}
              </span>
            </div>
            <p className="mt-3 text-sm font-medium">{f.label}</p>
            <p className="text-xs text-muted-foreground">{f.sub}</p>
            <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-forest-canopy to-amber-bird transition-all duration-500"
                style={{ width: `${Math.round(f.value)}%` }}
              />
            </div>
            <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{Math.round(f.value)}/100</p>
          </div>
        ))}
      </div>
    </div>
  );
}