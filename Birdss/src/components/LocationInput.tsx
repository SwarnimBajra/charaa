import { useState } from "react";
import { MapPin, Loader2, Crosshair, Trees } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { BIOME_PRESETS, type Biome } from "@/lib/birdApi";
import { InteractiveMap } from "./InteractiveMap";

export interface LocationData {
  lat: number | "";
  lon: number | "";
  climate: string;
  season: string;
  forestName?: string;
  biome?: Biome | "";
  treeDensity?: "" | "none" | "low" | "medium" | "high";
}

interface Props {
  value: LocationData;
  onChange: (v: LocationData) => void;
}

const climates = ["Tropical", "Subtropical", "Temperate", "Alpine", "Arid"];
const seasons = ["Spring", "Summer", "Monsoon", "Autumn", "Winter"];

export function LocationInput({ value, onChange }: Props) {
  const [source, setSource] = useState<"current" | "map" | "manual">("map");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function detect() {
    if (!navigator.geolocation) {
      setErr("Geolocation not supported by this browser.");
      return;
    }
    setLoading(true);
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({
          ...value,
          lat: +pos.coords.latitude.toFixed(5),
          lon: +pos.coords.longitude.toFixed(5),
        });
        setLoading(false);
      },
      (e) => {
        setErr(e.message || "Could not access location.");
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-full bg-muted p-1">
        {(["current", "map", "manual"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSource(s)}
            className={cn(
              "px-5 py-2 text-sm font-medium rounded-full transition-all",
              source === s ? "bg-card text-foreground shadow-soft" : "text-muted-foreground"
            )}
          >
            {s === "current" ? "Use GPS" : s === "map" ? "Select on Map" : "Enter manually"}
          </button>
        ))}
      </div>

      {source === "current" && (
        <div className="rounded-2xl border border-border bg-secondary/30 p-5 flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Crosshair className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Use device GPS</p>
            <p className="text-xs text-muted-foreground truncate">
              {value.lat !== "" && value.lon !== ""
                ? `Lat ${value.lat}, Lon ${value.lon}`
                : "Enable location to auto-fill coordinates"}
            </p>
            {err && <p className="text-xs text-destructive mt-1">{err}</p>}
          </div>
          <Button onClick={detect} disabled={loading} variant="default">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            <span className="ml-2">Detect</span>
          </Button>
        </div>
      )}

      {source === "map" && (
        <div className="space-y-3">
          <InteractiveMap
            lat={value.lat}
            lon={value.lon}
            onChange={(lat, lon) => onChange({ ...value, lat, lon })}
          />
          {value.lat !== "" && value.lon !== "" && (
            <p className="text-xs text-muted-foreground text-center">
              Selected Lat: <span className="font-semibold tabular-nums text-foreground">{value.lat}</span>, Lon: <span className="font-semibold tabular-nums text-foreground">{value.lon}</span>
            </p>
          )}
        </div>
      )}

      {source === "manual" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="lat">Latitude</Label>
            <Input
              id="lat"
              type="number"
              step="0.00001"
              placeholder="27.7172"
              value={value.lat}
              onChange={(e) => onChange({ ...value, lat: e.target.value === "" ? "" : +e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lon">Longitude</Label>
            <Input
              id="lon"
              type="number"
              step="0.00001"
              placeholder="85.3240"
              value={value.lon}
              onChange={(e) => onChange({ ...value, lon: e.target.value === "" ? "" : +e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="forestName" className="flex items-center gap-2">
          <Trees className="h-3.5 w-3.5 text-primary" /> Forest / area name
        </Label>
        <Input
          id="forestName"
          placeholder="e.g. Chitwan National Park"
          value={value.forestName ?? ""}
          onChange={(e) => onChange({ ...value, forestName: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Climate</Label>
          <select
            value={value.climate}
            onChange={(e) => onChange({ ...value, climate: e.target.value })}
            className="w-full h-10 rounded-md border border-input bg-card px-3 text-sm"
          >
            <option value="">Select…</option>
            {climates.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Season</Label>
          <select
            value={value.season}
            onChange={(e) => onChange({ ...value, season: e.target.value })}
            className="w-full h-10 rounded-md border border-input bg-card px-3 text-sm"
          >
            <option value="">Select…</option>
            {seasons.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Biome preset</Label>
        <select
          value={value.biome ?? ""}
          onChange={(e) => onChange({ ...value, biome: (e.target.value || "") as Biome | "" })}
          className="w-full h-10 rounded-md border border-input bg-card px-3 text-sm"
        >
          <option value="">Auto-detect from location</option>
          {(Object.keys(BIOME_PRESETS) as Biome[]).map((b) => (
            <option key={b} value={b}>{BIOME_PRESETS[b].label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>Tree presence</Label>
        <select
          value={value.treeDensity ?? ""}
          onChange={(e) => onChange({ ...value, treeDensity: (e.target.value || "") as LocationData["treeDensity"] })}
          className="w-full h-10 rounded-md border border-input bg-card px-3 text-sm"
        >
          <option value="">Auto (blend data + climate)</option>
          <option value="none">No trees</option>
          <option value="low">Low density</option>
          <option value="medium">Medium density</option>
          <option value="high">High density</option>
        </select>
      </div>
    </div>
  );
}
