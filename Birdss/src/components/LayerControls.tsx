import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LayerState {
  ndvi: boolean;
  fire: boolean;
  water: boolean;
  landUse: boolean;
}

const LAYERS: { key: keyof LayerState; label: string; hint: string }[] = [
  { key: "ndvi", label: "NDVI Vegetation", hint: "Greenness index" },
  { key: "fire", label: "Fire Detection", hint: "Thermal anomalies" },
  { key: "water", label: "Rivers & Water", hint: "Hydrology mapping" },
  { key: "landUse", label: "Deforestation Trend", hint: "Land-use change" },
];

export function LayerControls({ value, onChange }: { value: LayerState; onChange: (v: LayerState) => void }) {
  return (
    <div className="rounded-3xl bg-card border border-border p-6 shadow-soft">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <Layers className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="font-display text-2xl">Map layers</h3>
          <p className="text-sm text-muted-foreground">Toggle data overlays driving the analysis</p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {LAYERS.map((l) => {
          const active = value[l.key];
          return (
            <button
              key={l.key}
              onClick={() => onChange({ ...value, [l.key]: !active })}
              className={cn(
                "text-left rounded-2xl border p-4 transition-all",
                active
                  ? "bg-gradient-forest text-primary-foreground border-transparent shadow-soft"
                  : "bg-secondary/30 border-border hover:border-primary/40"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{l.label}</span>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    active ? "bg-primary-foreground" : "bg-muted-foreground/40"
                  )}
                />
              </div>
              <p className={cn("text-xs mt-1", active ? "opacity-80" : "text-muted-foreground")}>{l.hint}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}