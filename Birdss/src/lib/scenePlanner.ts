import { type Biome } from "./birdApi";
import { makeForestOnlyBlueprint } from "./hardcodedBlueprints/forestOnly";

export interface UserInputs {
  location_text: string;
  latitude: number | null;
  longitude: number | null;
  radius_km: number;
  season: string | null;
  weather_summary: string | null;
  inaturalist_observations: any[];
  inaturalist_taxa_summary: Array<{ taxon: string; count: number }>;
  habitat_tags: string[];
  time_of_day: string | null;
  tree_override?: "none" | "low" | "medium" | "high";
  climate_label?: string | null;
  biome_hint?: Biome | null;
}

export interface TreeAsset {
  type: string;
  count_hint: string;
  height_m: [number, number];
  dominance: "low" | "medium" | "high";
}

export interface SceneBlueprint {
  location_profile: {
    region_name: string;
    biome: string;
    habitat_type: string;
    canopy_density: "low" | "medium" | "high";
    moisture_level: "dry" | "moderate" | "wet";
    biodiversity_mood: "sparse" | "balanced" | "lush";
  };
  scene_assets: {
    trees: TreeAsset[];
    understory: string[];
    ground_cover: string[];
    water_features: string[];
    rocks_and_decoration: string[];
    wildlife_visual_cues: string[];
  };
  lighting: {
    time_style: string;
    fog: "none" | "light" | "medium" | "heavy";
    sun_intensity: "low" | "medium" | "high";
    atmosphere: string;
  };
  render_guidance: {
    camera_angle: string;
    composition: string;
    color_palette: string[];
    detail_priority: string[];
  };
  confidence: {
    overall: number;
    biome: number;
    vegetation: number;
    lighting: number;
  };
  fallbacks: {
    if_data_is_sparse: string[];
    if_location_is_urban_edge: string[];
  };
}

export interface EcosystemInsight {
  location: {
    area_name: string;
    country: string;
    region: string;
    latitude: number;
    longitude: number;
  };
  climate: {
    label: string;
    description: string;
    confidence: number;
  };
  season: {
    label: string;
    description: string;
    confidence: number;
  };
  vegetation_density: {
    label: "Sparse" | "Moderate" | "Good" | "Dense" | string;
    ndvi_simulation: number;
    status: string;
    description: string;
    confidence: number;
  };
  fire_risk: {
    label: "Low" | "Moderate" | "High" | "Critical" | string;
    thermal_anomaly_index: number;
    status: string;
    description: string;
    confidence: number;
  };
  water_resources: {
    label: "Scarce" | "Limited" | "Good" | "Rich" | string;
    water_presence_index: number;
    status: string;
    description: string;
    confidence: number;
  };
  land_use_change: {
    label: "Stable" | "Mild change" | "Active change" | "Rapid change" | string;
    index: number;
    status: string;
    description: string;
    confidence: number;
  };
  ai_insight: {
    headline: string;
    summary: string;
    recommended_action: string;
  };
  scene_guidance: {
    canopy_density: "low" | "medium" | "high" | string;
    ground_moisture: "dry" | "moderate" | "wet" | string;
    fog_level: "none" | "light" | "medium" | "heavy" | string;
    dominant_colors: string[];
    visual_mood: string;
  };
  confidence_overall: number;
}

/**
 * Fetch nearby observations and summarize taxa and habitat tags from iNaturalist.
 */
export async function fetchINaturalistData(
  lat: number,
  lon: number,
  radiusKm: number = 10
): Promise<{
  observations: any[];
  taxaSummary: Array<{ taxon: string; count: number }>;
  habitatTags: string[];
}> {
  try {
    const url = `https://api.inaturalist.org/v1/observations?lat=${lat}&lng=${lon}&radius=${radiusKm}&order_by=observations.id&order=desc&per_page=30&quality_grade=research`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`iNaturalist API returned status: ${res.status}`);
    }
    const data = await res.json();
    const results = data.results || [];

    const observations = results.map((obs: any) => ({
      species_guess: obs.species_guess || "Unknown species",
      common_name: obs.taxon?.preferred_common_name || obs.species_guess || "Unknown common name",
      scientific_name: obs.taxon?.name || "Unknown scientific name",
      iconic_taxon: obs.taxon?.iconic_taxon_name || "Unknown",
      rank: obs.taxon?.rank || "unknown",
      observed_on: obs.observed_on || "unknown",
      place_guess: obs.place_guess || "unknown",
    }));

    // Calculate taxa summary
    const counts: Record<string, number> = {};
    const tagsSet = new Set<string>();

    results.forEach((obs: any) => {
      const taxonName = obs.taxon?.iconic_taxon_name || "Other";
      counts[taxonName] = (counts[taxonName] || 0) + 1;

      // Extract simple habitat hints/tags from observations
      if (obs.place_guess) {
        const parts = obs.place_guess.split(",").map((s: string) => s.trim().toLowerCase());
        parts.forEach((p: string) => {
          if (p.length > 3 && !p.includes("district") && !p.includes("zone") && !p.includes("nepal")) {
            tagsSet.add(p);
          }
        });
      }
      if (obs.taxon?.preferred_common_name) {
        const nameLower = obs.taxon.preferred_common_name.toLowerCase();
        if (nameLower.includes("pine") || nameLower.includes("sal ") || nameLower.includes("oak") || nameLower.includes("rhododendron")) {
          tagsSet.add(nameLower.split(" ").slice(-1)[0]);
        }
      }
    });

    const taxaSummary = Object.keys(counts).map((taxon) => ({
      taxon,
      count: counts[taxon],
    }));

    return {
      observations: observations.slice(0, 15),
      taxaSummary,
      habitatTags: Array.from(tagsSet).slice(0, 10),
    };
  } catch (error) {
    console.error("Error fetching iNaturalist data:", error);
    return {
      observations: [],
      taxaSummary: [],
      habitatTags: [],
    };
  }
}

/**
 * Perform reverse geocoding via OpenStreetMap Nominatim.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<{
  area_name: string;
  country: string;
  region: string;
  admin_area: string;
}> {
  try {
    // Note: browsers disallow setting certain headers (e.g. `User-Agent`).
    // Use a plain fetch so reverse geocoding doesn't fail client-side.
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&zoom=14&lat=${lat}&lon=${lon}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Reverse geocode failed");
    const data = await res.json();
    const address = data.address || {};

    const area_name =
      address.park ||
      address.nature_reserve ||
      address.natural ||
      address.forest ||
      address.attraction ||
      address.suburb ||
      address.village ||
      address.county ||
      "Selected Forest Area";

    const country = address.country || "Nepal";
    const region = address.state || address.province || address.state_district || "Bagmati Province";
    const admin_area = address.county || address.district || address.city || "Chitwan";

    return { area_name, country, region, admin_area };
  } catch (error) {
    console.error("Geocoding failed, using fallbacks:", error);
    return {
      area_name: "Forest Zone",
      country: "Nepal",
      region: "Himalayan Forest Range",
      admin_area: "Chitwan"
    };
  }
}

/**
 * Fetch elevation from Open-Meteo elevation API.
 */
export async function fetchElevation(lat: number, lon: number): Promise<number> {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return data.elevation?.[0] ?? 1400;
  } catch {
    return 1400; // Nepal hill average fallback
  }
}

/**
 * Generate 3D forest scene plan.
 *
 * Note: This is intentionally hardcoded/heuristic so the 3D scene changes
 * deterministically by location and nearby features (forest / river / both),
 * without requiring Gemini.
 */
export async function generateSceneBlueprint(inputs: UserInputs): Promise<SceneBlueprint> {
  return generateFallbackBlueprint(inputs);
}

function detectForestSignal(inputs: UserInputs): boolean {
  const tags = (inputs.habitat_tags ?? []).join(" ").toLowerCase();
  const location = (inputs.location_text ?? "").toLowerCase();
  const taxa = (inputs.inaturalist_taxa_summary ?? [])
    .map((t) => t.taxon)
    .join(" ")
    .toLowerCase();

  const haystack = `${location} ${tags} ${taxa}`;
  const keywordHit =
    haystack.includes("forest") ||
    haystack.includes("jungle") ||
    haystack.includes("wood") ||
    haystack.includes("national park") ||
    haystack.includes("reserve") ||
    haystack.includes("conservation") ||
    haystack.includes("pine") ||
    haystack.includes("oak") ||
    haystack.includes("sal") ||
    haystack.includes("rhododendron");

  const observationDensity = inputs.inaturalist_observations?.length ?? 0;
  return keywordHit || observationDensity >= 6;
}

function chooseBiome(opts: {
  lat: number | null;
  elevM: number;
  forestLikely: boolean;
}): Biome {
  const isHighAlt = opts.elevM > 2500;
  const isLowAlt = opts.elevM < 900;
  const isTropical = typeof opts.lat === "number" && opts.lat < 27.2;

  if (isHighAlt) return "alpine";
  if (opts.forestLikely && isTropical) return "rainforest";
  if (opts.forestLikely && isLowAlt) return "rainforest";
  if (opts.forestLikely) return "pine";
  return "dry";
}

/**
 * Generate Geospatial Ecosystem Insight Panel using Gemini Structured Output.
 */
export async function generateEcosystemInsight(
  lat: number,
  lon: number,
  extra?: { climate?: string; season?: string }
): Promise<EcosystemInsight> {
  const apiKey = import.meta.env.VITE_AI_STUDIO_KEY || "";
  
  // 1. Gather all inputs
  const geo = await reverseGeocode(lat, lon);
  const elev = await fetchElevation(lat, lon);
  const inat = await fetchINaturalistData(lat, lon);

  // 2. Synthesize/simulate realistic proxy signals based on coordinates & altitude
  // Nepal ranges: lat ~26.3 to 30.5, lon ~80 to 88.3
  const isNepal = lat >= 26 && lat <= 31 && lon >= 80 && lon <= 89;
  const isHighAlt = elev > 2500;
  const isLowAlt = elev < 900;
  
  // Calculate remote sensing proxies
  let ndvi = 78; // forest baseline
  if (isHighAlt) ndvi = 32; // alpine vegetation
  else if (elev > 1800) ndvi = 62; // pine/temperate
  else if (isLowAlt) ndvi = 88; // tropical lushness

  // Add small noise
  ndvi = Math.max(10, Math.min(100, ndvi + Math.floor((Math.random() - 0.5) * 10)));

  const thermalAnomaly = isHighAlt ? 8 : 18; // mostly cold unless hot lower valley
  const waterPresence = hasWaterSignal(inat.habitatTags, geo.area_name) ? 82 : (isLowAlt ? 65 : 48);
  const landUseStable = geo.area_name.toLowerCase().includes("park") || geo.area_name.toLowerCase().includes("reserve") || geo.area_name.toLowerCase().includes("conservation");
  const landUseChange = landUseStable ? 12 : 28;

  const climateZone = extra?.climate || (isHighAlt ? "Alpine" : (elev > 1800 ? "Temperate" : (elev > 900 ? "Subtropical" : "Tropical")));
  const seasonContext = extra?.season || getSeasonForMonth(new Date().getMonth());

  const weatherSummary = climateZone === "Tropical" ? "Warm and humid" : (climateZone === "Alpine" ? "Cold and misty" : "Mild, clear skies");
  
  const payload = {
    location: {
      place_name: geo.area_name,
      latitude: lat,
      longitude: lon,
      country: geo.country,
      region: geo.region,
      admin_area: geo.admin_area
    },
    geospatial_signals: {
      ndvi_score: ndvi,
      thermal_anomaly_index: thermalAnomaly,
      water_presence_index: waterPresence,
      land_use_change_index: landUseChange,
      elevation: elev,
      land_cover_class: isHighAlt ? "Subalpine Conifer Woodland" : (isLowAlt ? "Tropical Broadleaf Forest" : "Pine/Mixed Temperate Forest"),
      nearby_water_features: hasWaterSignal(inat.habitatTags, geo.area_name) ? ["river", "stream"] : ["brook"],
      nearby_habitat_tags: inat.habitatTags
    },
    biodiversity_context: {
      inaturalist_taxa_summary: inat.taxaSummary,
      inaturalist_observation_density: inat.observations.length,
      inaturalist_habitat_signals: inat.habitatTags
    },
    environmental_context: {
      climate_zone: climateZone,
      seasonal_context: seasonContext,
      weather_summary: weatherSummary,
      date_context: new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })
    }
  };

  if (!apiKey) {
    console.warn("VITE_AI_STUDIO_KEY is missing. Using local ecosystem insight fallback.");
    return generateFallbackInsight(payload);
  }

  const promptText = `
You are a geospatial forest intelligence engine for a nature-monitoring app.

Your job is to analyze a selected location and synthesize a clear forest/ecosystem insight panel from geospatial signals, remote-sensing proxies, and biodiversity context.

You must:
- Use only the provided inputs.
- Never invent facts that are not supported by the data.
- Prefer conservative, location-grounded interpretations.
- Return valid JSON only conforming to the schema.
- Keep the result suitable for a UI dashboard and a 3D forest scene generator.
- Use simple, readable labels, but include brief scientific reasoning inside the JSON.

INPUTS:
${JSON.stringify(payload, null, 2)}

TASK:
1. Identify the forest or area name from the place information.
2. Infer climate using the climate zone and surrounding context.
3. Infer season in a way that makes sense for the location and date.
4. Interpret vegetation density using NDVI and habitat signals.
5. Interpret fire risk using thermal anomaly and dryness indicators.
6. Interpret water resources using rivers, lakes, wetlands, and water presence.
7. Interpret land use change using stability/disturbance signals.
8. Write a short AI insight summary that sounds like an intelligent monitoring system (under 4 sentences).
9. Provide confidence scores for each section.
10. Keep the tone scientific, calm, and positive, but not exaggerated.

IMPORTANT RULES:
- If a value is missing, infer only a conservative fallback.
- If the location is urban or near urban edges, reduce forest confidence.
- If NDVI is high, vegetation density should usually be "Good" or "Dense".
- If thermal anomaly is low, fire risk should be "Low" or "Moderate".
- If water presence is low, do not describe the area as water-rich.
- If land use change is stable, describe minimal disturbance or stable cover.
- Do not mention sources by name in the final narrative.
- Do not output markdown.
- Output JSON only conforming to the schema.

LABEL GUIDELINES:
Vegetation density: 0-25=Sparse, 26-50=Moderate, 51-75=Good, 76-100=Dense
Fire risk: 0-20=Low, 21-50=Moderate, 51-75=High, 76-100=Critical
Water resources: 0-20=Scarce, 21-50=Limited, 51-75=Good, 76-100=Rich
Land use change: 0-20=Stable, 21-50=Mild change, 51-75=Active change, 76-100=Rapid change

STYLE OF AI INSIGHT:
- "Vegetation cover is healthy and well-established."
- "Fire pressure remains low under current conditions."
- "Water availability is present but seasonal."
- "Land use appears stable with limited disturbance."
- "Overall ecosystem condition is functioning at a healthy baseline."
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: promptText }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                location: {
                  type: "OBJECT",
                  properties: {
                    area_name: { type: "STRING" },
                    country: { type: "STRING" },
                    region: { type: "STRING" },
                    latitude: { type: "NUMBER" },
                    longitude: { type: "NUMBER" },
                  },
                  required: ["area_name", "country", "region", "latitude", "longitude"],
                },
                climate: {
                  type: "OBJECT",
                  properties: {
                    label: { type: "STRING" },
                    description: { type: "STRING" },
                    confidence: { type: "NUMBER" },
                  },
                  required: ["label", "description", "confidence"],
                },
                season: {
                  type: "OBJECT",
                  properties: {
                    label: { type: "STRING" },
                    description: { type: "STRING" },
                    confidence: { type: "NUMBER" },
                  },
                  required: ["label", "description", "confidence"],
                },
                vegetation_density: {
                  type: "OBJECT",
                  properties: {
                    label: { type: "STRING" },
                    ndvi_simulation: { type: "NUMBER" },
                    status: { type: "STRING" },
                    description: { type: "STRING" },
                    confidence: { type: "NUMBER" },
                  },
                  required: ["label", "ndvi_simulation", "status", "description", "confidence"],
                },
                fire_risk: {
                  type: "OBJECT",
                  properties: {
                    label: { type: "STRING" },
                    thermal_anomaly_index: { type: "NUMBER" },
                    status: { type: "STRING" },
                    description: { type: "STRING" },
                    confidence: { type: "NUMBER" },
                  },
                  required: ["label", "thermal_anomaly_index", "status", "description", "confidence"],
                },
                water_resources: {
                  type: "OBJECT",
                  properties: {
                    label: { type: "STRING" },
                    water_presence_index: { type: "NUMBER" },
                    status: { type: "STRING" },
                    description: { type: "STRING" },
                    confidence: { type: "NUMBER" },
                  },
                  required: ["label", "water_presence_index", "status", "description", "confidence"],
                },
                land_use_change: {
                  type: "OBJECT",
                  properties: {
                    label: { type: "STRING" },
                    index: { type: "NUMBER" },
                    status: { type: "STRING" },
                    description: { type: "STRING" },
                    confidence: { type: "NUMBER" },
                  },
                  required: ["label", "index", "status", "description", "confidence"],
                },
                ai_insight: {
                  type: "OBJECT",
                  properties: {
                    headline: { type: "STRING" },
                    summary: { type: "STRING" },
                    recommended_action: { type: "STRING" },
                  },
                  required: ["headline", "summary", "recommended_action"],
                },
                scene_guidance: {
                  type: "OBJECT",
                  properties: {
                    canopy_density: { type: "STRING" },
                    ground_moisture: { type: "STRING" },
                    fog_level: { type: "STRING" },
                    dominant_colors: { type: "ARRAY", items: { type: "STRING" } },
                    visual_mood: { type: "STRING" },
                  },
                  required: ["canopy_density", "ground_moisture", "fog_level", "dominant_colors", "visual_mood"],
                },
                confidence_overall: { type: "NUMBER" }
              },
              required: [
                "location",
                "climate",
                "season",
                "vegetation_density",
                "fire_risk",
                "water_resources",
                "land_use_change",
                "ai_insight",
                "scene_guidance",
                "confidence_overall"
              ],
            },
          },
        }),
      }
    );

    if (!response.ok) throw new Error("Gemini request failed");
    const resJson = await response.json();
    const textResult = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) throw new Error("Empty response candidates");
    return JSON.parse(textResult) as EcosystemInsight;
  } catch (error) {
    console.error("Gemini failed, using local insight synthesis fallback:", error);
    return generateFallbackInsight(payload);
  }
}

function hasWaterSignal(tags: string[], place: string): boolean {
  const t = tags.join(" ").toLowerCase();
  const p = place.toLowerCase();
  return (
    t.includes("water") ||
    t.includes("river") ||
    t.includes("wetland") ||
    t.includes("stream") ||
    t.includes("lake") ||
    t.includes("pond") ||
    t.includes("brook") ||
    t.includes("creek") ||
    t.includes("canal") ||
    t.includes("reservoir") ||
    // Nepal/local hints
    t.includes("khola") ||
    t.includes("nadi") ||
    t.includes("tal") ||
    t.includes("pokhari") ||
    p.includes("lake") ||
    p.includes("river") ||
    p.includes("wetland") ||
    p.includes("stream") ||
    p.includes("pond") ||
    p.includes("canal") ||
    p.includes("reservoir") ||
    // Nepal/local place-name hints
    p.includes("khola") ||
    p.includes("nadi") ||
    p.includes("tal") ||
    p.includes("pokhari")
  );
}

async function detectNearbyWaterHint(lat: number | null, lon: number | null): Promise<boolean> {
  if (lat == null || lon == null) return false;
  try {
    // Use same-origin server proxy so browsers don't get blocked by CORS.
    const res = await fetch(`/api/water-hint?lat=${lat}&lon=${lon}`);
    if (!res.ok) return false;
    const data = (await res.json()) as { waterLikely?: boolean };
    return data.waterLikely === true;
  } catch {
    return false;
  }
}

function getSeasonForMonth(month: number): string {
  if (month >= 2 && month <= 4) return "Spring";
  if (month >= 5 && month <= 7) return "Summer";
  if (month >= 8 && month <= 10) return "Autumn";
  return "Winter";
}

function generateFallbackInsight(payload: any): EcosystemInsight {
  const ndvi = payload.geospatial_signals.ndvi_score;
  const thermal = payload.geospatial_signals.thermal_anomaly_index;
  const water = payload.geospatial_signals.water_presence_index;
  const landUse = payload.geospatial_signals.land_use_change_index;

  const vegLabel = ndvi > 75 ? "Dense" : (ndvi > 50 ? "Good" : (ndvi > 25 ? "Moderate" : "Sparse"));
  const fireLabel = thermal > 75 ? "Critical" : (thermal > 50 ? "High" : (thermal > 20 ? "Moderate" : "Low"));
  const waterLabel = water > 75 ? "Rich" : (water > 50 ? "Good" : (water > 20 ? "Limited" : "Scarce"));
  const landLabel = landUse > 75 ? "Rapid change" : (landUse > 50 ? "Active change" : (landUse > 20 ? "Mild change" : "Stable"));

  return {
    location: {
      area_name: payload.location.place_name,
      country: payload.location.country,
      region: payload.location.region,
      latitude: payload.location.latitude,
      longitude: payload.location.longitude
    },
    climate: {
      label: payload.environmental_context.climate_zone,
      description: `Ecosystem sits within a ${payload.environmental_context.climate_zone.toLowerCase()} climate belt.`,
      confidence: 0.85
    },
    season: {
      label: payload.environmental_context.seasonal_context,
      description: `Analyzing under ${payload.environmental_context.seasonal_context.toLowerCase()} seasonal profile.`,
      confidence: 0.9
    },
    vegetation_density: {
      label: vegLabel,
      ndvi_simulation: ndvi,
      status: ndvi > 50 ? "Healthy" : "Stressed",
      description: `NDVI signal stands at ${ndvi}/100, reflecting ${vegLabel.toLowerCase()} canopy density.`,
      confidence: 0.8
    },
    fire_risk: {
      label: fireLabel,
      thermal_anomaly_index: thermal,
      status: thermal < 30 ? "Safe" : "Warning",
      description: `Thermal anomalies index at ${thermal}/100. Fire pressure is ${fireLabel.toLowerCase()}.`,
      confidence: 0.8
    },
    water_resources: {
      label: waterLabel,
      water_presence_index: water,
      status: water > 50 ? "Sufficient" : "Low",
      description: `Surface water indices indicate ${waterLabel.toLowerCase()} hydrologic resources.`,
      confidence: 0.75
    },
    land_use_change: {
      label: landLabel,
      index: landUse,
      status: landUse < 30 ? "Stable" : "Alert",
      description: `Land stability index at ${landUse}/100, confirming a ${landLabel.toLowerCase()} land-use pattern.`,
      confidence: 0.8
    },
    ai_insight: {
      headline: `${vegLabel} Forest Canopy & ${fireLabel} Fire Risk`,
      summary: `Vegetation cover is healthy and well-established. Fire pressure remains low under current conditions. Water availability is present but seasonal. Land use appears stable with limited disturbance.`,
      recommended_action: "Continue routine satellite sweeps and acoustic monitoring."
    },
    scene_guidance: {
      canopy_density: ndvi > 75 ? "high" : (ndvi > 40 ? "medium" : "low"),
      ground_moisture: water > 60 ? "wet" : (water > 30 ? "moderate" : "dry"),
      fog_level: water > 75 ? "heavy" : (water > 45 ? "medium" : "light"),
      dominant_colors: ndvi > 75 ? ["#1B5E20", "#2E7D32", "#4CAF50"] : ["#8D6E63", "#4CAF50", "#E0F2F1"],
      visual_mood: ndvi > 75 ? "lush and humid" : "serene alpine"
    },
    confidence_overall: 0.83
  };
}

/**
 * Hardcoded scene blueprint generator.
 */
async function generateFallbackBlueprint(inputs: UserInputs): Promise<SceneBlueprint> {
  const lat = typeof inputs.latitude === "number" ? inputs.latitude : null;
  const lon = typeof inputs.longitude === "number" ? inputs.longitude : null;
  const elevM = lat != null && lon != null ? await fetchElevation(lat, lon) : 1400;
  const regionName = inputs.location_text || "Selected Area";

  const density = deriveTreeDensity(inputs, elevM);
  const forestLikely = density !== "none";
  const biome = inputs.biome_hint || chooseBiome({ lat, elevM, forestLikely });

  const canopyDensity: SceneBlueprint["location_profile"]["canopy_density"] =
    density === "high" ? "high" : density === "medium" ? "medium" : "low";

  if (density === "none") {
    console.info("[SceneBlueprint] open-terrain", {
      lat,
      lon,
      regionName,
      density,
      biome: "dry",
      canopyDensity: "low",
    });
    return makeOpenTerrainBlueprint({
      regionName,
      biome: "dry",
      canopyDensity: "low",
    });
  }

  console.info("[SceneBlueprint] forest-density", {
    lat,
    lon,
    regionName,
    density,
    biome,
    canopyDensity,
  });
  return makeForestOnlyBlueprint({ regionName, biome, canopyDensity });
}

function deriveTreeDensity(inputs: UserInputs, elevM: number): "none" | "low" | "medium" | "high" {
  if (inputs.tree_override) return inputs.tree_override;

  const inatScore = computeInaturalistTreeScore(inputs);
  const envScore = computeEnvTreeScore(inputs, elevM);

  const blended = clamp(inatScore * 0.6 + envScore * 0.4, 0, 1);
  if (blended < 0.2) return "none";
  if (blended < 0.45) return "low";
  if (blended < 0.7) return "medium";
  return "high";
}

function computeInaturalistTreeScore(inputs: UserInputs): number {
  const tags = (inputs.habitat_tags ?? []).join(" ").toLowerCase();
  const taxa = (inputs.inaturalist_taxa_summary ?? []).map((t) => t.taxon.toLowerCase());
  const observations = inputs.inaturalist_observations?.length ?? 0;

  let score = observations > 0 ? 0.25 : 0.15;

  if (observations >= 10) score += 0.25;
  else if (observations >= 5) score += 0.15;

  if (taxa.includes("plantae")) score += 0.35;
  if (taxa.includes("fungi")) score += 0.08;

  const forestHints = ["forest", "jungle", "wood", "pine", "oak", "sal", "rhododendron", "canopy"];
  if (forestHints.some((k) => tags.includes(k))) score += 0.35;

  const sparseHints = ["urban", "desert", "bare", "rock", "scrub", "grassland"];
  if (sparseHints.some((k) => tags.includes(k))) score -= 0.25;

  return clamp(score, 0, 1);
}

function computeEnvTreeScore(inputs: UserInputs, elevM: number): number {
  let score = 0.4;

  const climate = (inputs.climate_label || "").toLowerCase();
  if (climate.includes("tropical")) score += 0.35;
  if (climate.includes("subtropical")) score += 0.25;
  if (climate.includes("temperate")) score += 0.2;
  if (climate.includes("alpine")) score -= 0.2;
  if (climate.includes("arid") || climate.includes("dry")) score -= 0.25;

  if (inputs.biome_hint) {
    if (inputs.biome_hint === "rainforest") score += 0.35;
    if (inputs.biome_hint === "pine") score += 0.2;
    if (inputs.biome_hint === "wetland") score += 0.1;
    if (inputs.biome_hint === "alpine") score -= 0.15;
    if (inputs.biome_hint === "dry") score -= 0.2;
  }

  if (elevM > 3200) score -= 0.2;
  if (elevM < 900) score += 0.15;

  return clamp(score, 0, 1);
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function makeOpenTerrainBlueprint(opts: {
  regionName: string;
  biome: string;
  canopyDensity?: SceneBlueprint["location_profile"]["canopy_density"];
}): SceneBlueprint {
  return {
    location_profile: {
      region_name: opts.regionName,
      biome: opts.biome,
      habitat_type: "Open terrain",
      canopy_density: opts.canopyDensity ?? "low",
      moisture_level: "moderate",
      biodiversity_mood: "sparse",
    },
    scene_assets: {
      trees: [],
      understory: ["Sparse shrubs"],
      ground_cover: ["Dry grass", "Rocky soil"],
      water_features: [],
      rocks_and_decoration: ["Boulders", "Pebbles"],
      wildlife_visual_cues: ["Distant birds"],
    },
    lighting: {
      time_style: "Day",
      fog: "light",
      sun_intensity: "medium",
      atmosphere: "clear",
    },
    render_guidance: {
      camera_angle: "45-degree orbit",
      composition: "Open ground with sparse vegetation",
      color_palette: ["#c9c2b0", "#a07d4a", "#ede4cf", "#88795f"],
      detail_priority: ["Terrain", "Sky"],
    },
    confidence: {
      overall: 0.6,
      biome: 0.5,
      vegetation: 0.5,
      lighting: 0.6,
    },
    fallbacks: {
      if_data_is_sparse: ["Keep terrain open with minimal vegetation"],
      if_location_is_urban_edge: ["Reduce vegetation and increase ground exposure"],
    },
  };
}

export interface WikimediaImage {
  pageid: number;
  title: string;
  url: string;
  description?: string;
  author?: string;
}

export async function fetchLocalWikimediaImages(lat: number, lon: number): Promise<WikimediaImage[]> {
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lat}|${lon}&ggsradius=10000&ggslimit=12&prop=imageinfo&iiprop=url|extmetadata&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Wikimedia request failed");
    const data = await res.json();
    
    const pages = data.query?.pages || {};
    const images: WikimediaImage[] = [];
    
    Object.keys(pages).forEach((key) => {
      const page = pages[key];
      const info = page.imageinfo?.[0];
      if (info && info.url) {
        // filter for image files
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(info.url);
        if (!isImage) return;

        const ext = info.extmetadata || {};
        const description = ext.ImageDescription?.value 
          ? ext.ImageDescription.value.replace(/<[^>]*>/g, "").slice(0, 150)
          : undefined;
        const author = ext.Artist?.value 
          ? ext.Artist.value.replace(/<[^>]*>/g, "")
          : undefined;

        images.push({
          pageid: page.pageid,
          title: page.title.replace(/^File:/i, "").replace(/\.[^/.]+$/, ""),
          url: info.url,
          description,
          author
        });
      }
    });
    
    return images;
  } catch (error) {
    console.error("Error fetching Wikimedia images:", error);
    return [];
  }
}
