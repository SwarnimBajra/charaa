/**
 * NASA FIRMS active fire / thermal anomaly data.
 * Free MAP_KEY at https://firms.modaps.eosdis.nasa.gov/api/map_key/
 * Endpoint returns CSV: latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,
 *                       satellite,instrument,confidence,version,bright_ti5,frp,daynight
 */
export interface ActiveFire {
  latitude: number;
  longitude: number;
  acqDate: string;
  acqTime: string;
  confidence: string; // "low" | "nominal" | "high" for VIIRS, 0-100 for MODIS
  brightnessK: number;
  fireRadiativePower: number; // FRP in megawatts
  satellite: string;
  daynight: "D" | "N" | string;
  distanceKm: number; // computed
}

export interface FireSummary {
  available: boolean;
  source: "NASA FIRMS" | "unconfigured";
  fireCount: number;
  highConfidenceCount: number;
  nearestKm: number | null;
  fires: ActiveFire[];
  daysWindow: number;
  fetchedAt: number;
  error?: string;
}

const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const DEFAULT_SOURCE = "VIIRS_SNPP_NRT";

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").trim();
    });
    return row;
  });
}

/**
 * Fetch active fires within `radiusKm` of (lat, lon) over the last `days` days.
 * Uses a bounding box around the point; results are then filtered + sorted by true distance.
 */
export async function fetchActiveFires(
  lat: number,
  lon: number,
  radiusKm: number = 75,
  days: number = 2,
): Promise<FireSummary> {
  const key = import.meta.env.VITE_NASA_FIRMS_KEY || "";
  const now = Date.now();

  if (!key) {
    return {
      available: false,
      source: "unconfigured",
      fireCount: 0,
      highConfidenceCount: 0,
      nearestKm: null,
      fires: [],
      daysWindow: days,
      fetchedAt: now,
      error: "VITE_NASA_FIRMS_KEY not configured",
    };
  }

  // 1 deg lat ≈ 111 km; 1 deg lon ≈ 111*cos(lat) km.
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  const west = lon - dLon;
  const east = lon + dLon;
  const south = lat - dLat;
  const north = lat + dLat;

  const url = `${FIRMS_BASE}/${key}/${DEFAULT_SOURCE}/${west.toFixed(4)},${south.toFixed(4)},${east.toFixed(4)},${north.toFixed(4)}/${days}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return {
        available: false,
        source: "NASA FIRMS",
        fireCount: 0,
        highConfidenceCount: 0,
        nearestKm: null,
        fires: [],
        daysWindow: days,
        fetchedAt: now,
        error: `FIRMS returned ${res.status}`,
      };
    }

    const text = await res.text();
    // If the API key is invalid, FIRMS returns an HTML/text error instead of CSV.
    if (!text.toLowerCase().startsWith("latitude")) {
      return {
        available: false,
        source: "NASA FIRMS",
        fireCount: 0,
        highConfidenceCount: 0,
        nearestKm: null,
        fires: [],
        daysWindow: days,
        fetchedAt: now,
        error: "FIRMS returned non-CSV (likely invalid MAP_KEY)",
      };
    }

    const rows = parseCSV(text);
    const fires: ActiveFire[] = rows
      .map((r) => {
        const fLat = Number(r.latitude);
        const fLon = Number(r.longitude);
        if (!Number.isFinite(fLat) || !Number.isFinite(fLon)) return null;
        const dist = haversineKm(lat, lon, fLat, fLon);
        if (dist > radiusKm) return null;
        return {
          latitude: fLat,
          longitude: fLon,
          acqDate: r.acq_date || "",
          acqTime: r.acq_time || "",
          confidence: r.confidence || "",
          brightnessK: Number(r.bright_ti4 || r.brightness || 0),
          fireRadiativePower: Number(r.frp || 0),
          satellite: r.satellite || "",
          daynight: (r.daynight as "D" | "N") || "",
          distanceKm: dist,
        };
      })
      .filter((f): f is ActiveFire => f !== null)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const highConfidenceCount = fires.filter((f) => {
      const c = f.confidence.toLowerCase();
      return c === "high" || c === "h" || Number(c) >= 80;
    }).length;

    return {
      available: true,
      source: "NASA FIRMS",
      fireCount: fires.length,
      highConfidenceCount,
      nearestKm: fires.length > 0 ? Math.round(fires[0].distanceKm * 10) / 10 : null,
      fires: fires.slice(0, 50),
      daysWindow: days,
      fetchedAt: now,
    };
  } catch (err) {
    return {
      available: false,
      source: "NASA FIRMS",
      fireCount: 0,
      highConfidenceCount: 0,
      nearestKm: null,
      fires: [],
      daysWindow: days,
      fetchedAt: now,
      error: err instanceof Error ? err.message : "Fire fetch failed",
    };
  }
}
