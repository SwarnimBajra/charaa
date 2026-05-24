import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function looksLikeWater(haystack: string): boolean {
  const waterKeywords = [
    "river",
    "stream",
    "waterway",
    "canal",
    "lake",
    "pond",
    "reservoir",
    "wetland",
    "lagoon",
    "bay",
    "dam",
    "waterfall",
    "spring",
    "riverbank",
    "creek",
    "brook",
    // Nepal/local
    "khola",
    "nadi",
    "tal",
    "pokhari",
    "jheel",
    "jhil",
    // Nepal/local (Devanagari)
    "खोला",
    "नदी",
    "ताल",
    "पोखरी",
  ];
  return waterKeywords.some((k) => haystack.includes(k));
}

type WaterHintResult = { waterLikely: boolean; debug: any };

const waterHintCache = new Map<string, { expiresAt: number; value: WaterHintResult }>();

function cacheKey(lat: number, lon: number): string {
  // ~110m grid in latitude. Keeps cache effective without being too coarse.
  const latKey = Math.round(lat * 1000) / 1000;
  const lonKey = Math.round(lon * 1000) / 1000;
  return `${latKey},${lonKey}`;
}

async function detectNearbyWaterHintOverpass(lat: number, lon: number): Promise<WaterHintResult> {
  // Radius in meters. Larger radius helps when user clicks slightly away from the river.
  const radiusM = 1200;
  const query = `
[out:json][timeout:15];
(
  way(around:${radiusM},${lat},${lon})[waterway];
  relation(around:${radiusM},${lat},${lon})[waterway];
  way(around:${radiusM},${lat},${lon})[natural=water];
  relation(around:${radiusM},${lat},${lon})[natural=water];
  way(around:${radiusM},${lat},${lon})[water];
  relation(around:${radiusM},${lat},${lon})[water];
);
out tags 50;
`;

  const url = "https://overpass-api.de/api/interpreter";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        "User-Agent": "Mockingbird/1.0",
        "Accept": "application/json",
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!res.ok) {
      return {
        waterLikely: false,
        debug: { method: "overpass", ok: false, status: res.status, statusText: res.statusText },
      };
    }

    const data: any = await res.json();
    const elements: any[] = Array.isArray(data?.elements) ? data.elements : [];

    // Our renderer draws a river; only trigger when there's a flowing waterway nearby.
    const waterwayHit = elements.some((el) => {
      const tags = el?.tags ?? {};
      return typeof tags.waterway === "string";
    });

    return {
      waterLikely: waterwayHit,
      debug: {
        method: "overpass",
        ok: true,
        radiusM,
        count: elements.length,
        waterwayHit,
        sampleTags: elements[0]?.tags ?? null,
      },
    };
  } catch (error: any) {
    return {
      waterLikely: false,
      debug: { method: "overpass", ok: false, error: error?.message ?? String(error) },
    };
  }
}

async function detectNearbyWaterHintServer(lat: number, lon: number): Promise<WaterHintResult> {
  const key = cacheKey(lat, lon);
  const now = Date.now();
  const cached = waterHintCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { waterLikely: cached.value.waterLikely, debug: { ...cached.value.debug, cache: "hit" } };
  }

  const overpass = await detectNearbyWaterHintOverpass(lat, lon);
  if (overpass.debug?.ok === true || overpass.waterLikely === true) {
    const value = { waterLikely: overpass.waterLikely, debug: { ...overpass.debug, cache: "miss" } };
    waterHintCache.set(key, { expiresAt: now + 10 * 60 * 1000, value });
    return value;
  }

  // Fallback to Nominatim sampling (may be rate-limited, but keep as backup).
  const dists = [0.0022, 0.0065];
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const samplePoints: Array<[number, number]> = [[lat, lon]];
  for (const dLat of dists) {
    const dLon = dLat / cos;
    samplePoints.push([lat + dLat, lon], [lat - dLat, lon], [lat, lon + dLon], [lat, lon - dLon]);
  }

  const checked: Array<{
    lat: number;
    lon: number;
    ok: boolean;
    hit: boolean;
    status?: number;
    type?: string;
    category?: string;
    name?: string;
    display_name?: string;
  }> = [];

  for (const [sLat, sLon] of samplePoints) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&namedetails=1&extratags=1&zoom=18&lat=${sLat}&lon=${sLon}`;
    try {
      const res = await fetch(url, {
        headers: {
          // Nominatim usage policy: identify your application.
          "User-Agent": "Mockingbird/1.0",
          "Accept": "application/json",
        },
      });

      if (!res.ok) {
        checked.push({ lat: sLat, lon: sLon, ok: false, hit: false, status: res.status });
        continue;
      }

      const data: any = await res.json();
      const address = data.address || {};
      const namedetails = data.namedetails || {};
      const extratags = data.extratags || {};

      const haystack = [
        data.type,
        data.category,
        data.class,
        data.display_name,
        data.name,
        address.waterway,
        address.river,
        address.lake,
        address.pond,
        address.wetland,
        address.bay,
        address.natural,
        ...Object.values(namedetails),
        ...Object.values(extratags),
        ...Object.values(address),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const hit = looksLikeWater(haystack);
      checked.push({
        lat: sLat,
        lon: sLon,
        ok: true,
        hit,
        type: data.type,
        category: data.category,
        name: data.name,
        display_name: data.display_name,
      });

      if (hit) {
        const value = { waterLikely: true, debug: { method: "nominatim", checked, cache: "miss" } };
        waterHintCache.set(key, { expiresAt: now + 10 * 60 * 1000, value });
        return value;
      }
    } catch {
      checked.push({ lat: sLat, lon: sLon, ok: false, hit: false });
    }
  }

  const value = {
    waterLikely: false,
    debug: { method: "nominatim", checked, cache: "miss", overpass: overpass.debug },
  };
  waterHintCache.set(key, { expiresAt: now + 10 * 60 * 1000, value });
  return value;
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const waterHintMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  if (url.pathname !== "/api/water-hint") return next();

  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: "Invalid lat/lon" }, { status: 400 });
  }

  const includeDebug = url.searchParams.get("debug") === "1";
  const result = await detectNearbyWaterHintServer(lat, lon);
  return json(includeDebug ? result : { waterLikely: result.waterLikely });
});

export const startInstance = createStart(() => ({
  requestMiddleware: [waterHintMiddleware, errorMiddleware],
}));
