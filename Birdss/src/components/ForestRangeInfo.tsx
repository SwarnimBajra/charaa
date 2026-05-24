import { Trees, MapPin, Compass, Ruler } from "lucide-react";
import type { AnalyzeResult } from "@/lib/birdApi";

export function ForestRangeInfo({
  result,
  lat,
  lon,
}: {
  result: AnalyzeResult;
  lat: number;
  lon: number;
}) {
  return (
    <div className="rounded-3xl bg-card border border-border p-6 shadow-soft">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Nearest forest range</p>
          <h3 className="font-display text-3xl mt-1">{result.forestName ?? "Unnamed Range"}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {result.ecoregion ?? "Mixed temperate forest"}
          </p>
        </div>
        <div className="h-12 w-12 rounded-2xl bg-gradient-forest flex items-center justify-center shrink-0">
          <Trees className="h-6 w-6 text-primary-foreground" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={MapPin} label="Coordinates" value={`${lat.toFixed(3)}, ${lon.toFixed(3)}`} />
        <Stat icon={Ruler} label="Range area" value={`${result.forestRangeKm2} km²`} />
        <Stat icon={Compass} label="Estimated birds" value={result.totalBirds.toLocaleString()} />
        <Stat icon={Trees} label="Density" value={`${Math.round(result.totalBirds / Math.max(1, result.forestRangeKm2))} /km²`} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className="font-display text-lg mt-2 truncate">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
