import { MapPin, Globe2 } from "lucide-react";

interface Props {
  lat: number;
  lon: number;
  forestName?: string;
  ecoregion?: string;
}

/**
 * Static map preview via Google Maps Static API.
 * Falls back to a styled card if VITE_GOOGLE_MAPS_API_KEY is missing or the image fails.
 */
export function MapPreview({ lat, lon, forestName, ecoregion }: Props) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const url = key
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=10&size=640x320&scale=2&maptype=terrain&markers=color:0x4a7c59|${lat},${lon}&key=${key}`
    : null;

  return (
    <div className="rounded-3xl bg-card border border-border p-4 shadow-soft">
      <div className="flex items-center justify-between mb-3 px-2">
        <div className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">{forestName ?? "Location preview"}</p>
        </div>
        <p className="text-xs text-muted-foreground">{ecoregion}</p>
      </div>
      <div className="relative h-56 rounded-2xl overflow-hidden border border-border bg-secondary/40">
        {url ? (
          <img
            src={url}
            alt={`Map of ${forestName ?? "location"}`}
            className="w-full h-full object-cover"
            onError={(e) => ((e.currentTarget.style.display = "none"))}
          />
        ) : (
          <FallbackMap lat={lat} lon={lon} />
        )}
        <div className="absolute bottom-2 left-2 bg-card/90 backdrop-blur rounded-lg px-2 py-1 text-xs flex items-center gap-1">
          <MapPin className="h-3 w-3 text-primary" />
          <span className="tabular-nums">{lat.toFixed(3)}, {lon.toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}

function FallbackMap({ lat, lon }: { lat: number; lon: number }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background:
          "radial-gradient(circle at 35% 40%, oklch(0.78 0.08 145) 0%, oklch(0.55 0.1 155) 45%, oklch(0.32 0.06 160) 100%)",
      }}
    >
      <div className="text-center text-primary-foreground">
        <MapPin className="h-8 w-8 mx-auto opacity-80" />
        <p className="font-display text-lg mt-2">{lat.toFixed(2)}°, {lon.toFixed(2)}°</p>
        <p className="text-xs opacity-70 mt-1">Map preview unavailable</p>
      </div>
    </div>
  );
}