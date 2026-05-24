import {
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Flame,
  Leaf,
  Loader2,
  MapPin,
  Thermometer,
  Wind,
} from "lucide-react";
import type { WeatherSnapshot } from "@/lib/weather";
import type { EcosystemInsight } from "@/lib/scenePlanner";
import type { FireSummary } from "@/lib/fireApi";
import { cn } from "@/lib/utils";

interface Props {
  weather: WeatherSnapshot | null;
  weatherLoading: boolean;
  insight: EcosystemInsight | null;
  insightLoading: boolean;
  fire: FireSummary | null;
  fireLoading: boolean;
}

function weatherIcon(main: string) {
  const m = main.toLowerCase();
  if (m.includes("rain") || m.includes("drizzle") || m.includes("thunder")) return CloudRain;
  if (m.includes("snow")) return CloudSnow;
  if (m.includes("fog") || m.includes("mist") || m.includes("haze")) return CloudFog;
  return CloudSun;
}

const RISK_TONE: Record<string, string> = {
  Low: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  Moderate: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  High: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  Critical: "bg-red-500/15 text-red-600 border-red-500/30",
  Unknown: "bg-muted text-muted-foreground border-border",
};

function fireBadge(
  fire: FireSummary | null,
  insight: EcosystemInsight | null,
): { label: string; tone: string; subtitle: string; source: string } {
  if (fire?.available && fire.fireCount > 0) {
    let label: keyof typeof RISK_TONE = "Moderate";
    if (fire.highConfidenceCount >= 3 || (fire.nearestKm !== null && fire.nearestKm < 10))
      label = "Critical";
    else if (fire.fireCount >= 5 || (fire.nearestKm !== null && fire.nearestKm < 25))
      label = "High";
    return {
      label,
      tone: RISK_TONE[label],
      subtitle: `${fire.fireCount} active hotspot${fire.fireCount === 1 ? "" : "s"} within ${75}km · nearest ${fire.nearestKm}km`,
      source: `NASA FIRMS · last ${fire.daysWindow}d`,
    };
  }
  if (fire?.available && fire.fireCount === 0) {
    return {
      label: "Low",
      tone: RISK_TONE.Low,
      subtitle: `No active hotspots within 75km in the last ${fire.daysWindow} days`,
      source: "NASA FIRMS",
    };
  }
  // Fall back to Gemini's AI-estimated risk
  if (insight?.fire_risk) {
    const label = insight.fire_risk.label || "Unknown";
    return {
      label,
      tone: RISK_TONE[label] ?? RISK_TONE.Unknown,
      subtitle: insight.fire_risk.description || insight.fire_risk.status || "AI-estimated risk",
      source: "AI-estimated (no FIRMS key)",
    };
  }
  return {
    label: "Unknown",
    tone: RISK_TONE.Unknown,
    subtitle: "Fire data unavailable",
    source: fire?.error ?? "Not configured",
  };
}

export function LocationEnvironmentPanel({
  weather,
  weatherLoading,
  insight,
  insightLoading,
  fire,
  fireLoading,
}: Props) {
  const Wx = weatherIcon(weather?.main ?? "");
  const fb = fireBadge(fire, insight);

  return (
    <div className="rounded-3xl bg-card border border-border p-6 shadow-soft space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Live environmental context
          </p>
          <h3 className="font-display text-2xl mt-1">
            {insight?.location.area_name || "Selected location"}
          </h3>
          {insight?.location.region && (
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="h-3.5 w-3.5" />
              {insight.location.region}
              {insight.location.country ? `, ${insight.location.country}` : ""}
            </p>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* WEATHER */}
        <div className="rounded-2xl border border-border bg-background p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wx className="h-4 w-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                Current weather
              </span>
            </div>
            {weather?.iconUrl && (
              <img src={weather.iconUrl} alt={weather.main} className="h-9 w-9 -my-2" />
            )}
          </div>
          {weatherLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Fetching weather…
            </div>
          ) : weather ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl tabular-nums">
                  {Math.round(weather.tempC)}°
                </span>
                <span className="text-xs text-muted-foreground capitalize">
                  {weather.description}
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Droplets className="h-3 w-3" />
                  {weather.humidity}% humidity
                </span>
                <span className="flex items-center gap-1">
                  <Wind className="h-3 w-3" />
                  {weather.windMps.toFixed(1)} m/s
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic">Weather unavailable.</p>
          )}
        </div>

        {/* CLIMATE / SEASON / VEGETATION */}
        <div className="rounded-2xl border border-border bg-background p-4 space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Thermometer className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              Climate &amp; season
            </span>
          </div>
          {insightLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Reading geo-context…
            </div>
          ) : insight ? (
            <>
              <p className="font-medium text-sm">{insight.climate.label}</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                {insight.climate.description}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/40 border border-border">
                  {insight.season.label}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/40 border border-border flex items-center gap-1">
                  <Leaf className="h-2.5 w-2.5" />
                  Vegetation: {insight.vegetation_density.label}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/40 border border-border flex items-center gap-1">
                  <Droplets className="h-2.5 w-2.5" />
                  Water: {insight.water_resources.label}
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground italic">Climate insight unavailable.</p>
          )}
        </div>

        {/* FIRE STATUS */}
        <div className="rounded-2xl border border-border bg-background p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Flame className="h-4 w-4" />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                Forest fire status
              </span>
            </div>
            <span
              className={cn(
                "text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap",
                fb.tone,
              )}
            >
              {fb.label}
            </span>
          </div>
          {fireLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking satellite hotspots…
            </div>
          ) : (
            <>
              <p className="text-sm leading-snug">{fb.subtitle}</p>
              <p className="text-[10px] text-muted-foreground">Source: {fb.source}</p>
              {fire?.available && fire.fireCount > 0 && fire.fires[0] && (
                <p className="text-[10px] text-muted-foreground">
                  Latest: {fire.fires[0].acqDate} · FRP{" "}
                  {fire.fires[0].fireRadiativePower.toFixed(1)} MW · confidence{" "}
                  {fire.fires[0].confidence}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
