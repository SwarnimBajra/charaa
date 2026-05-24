// Backend integration point. Replace BASE_URL + endpoint with your FastAPI/Flask service.
// Expected backend contract: POST /analyze-audio (multipart) returning AnalyzeResult.

export interface DetectedSpecies {
  name: string;
  scientificName: string;
  confidence: number;
  count: number;
  imageUrl?: string;
  indicator?: boolean;
  ecologicalRole?: string;
  conservationStatus?: "LC" | "NT" | "VU" | "EN" | "CR" | "DD";
  description?: string;
}

export interface AnalyzeResult {
  biodiversityScore: number; // 0-100
  speciesDetected: DetectedSpecies[];
  totalBirds: number;
  healthStatus: "Healthy" | "Moderate" | "Degraded";
  trend: "improving" | "stable" | "declining";
  forestRangeKm2: number;
  forestHealthIndex: number; // 0-100
  acousticComplexity: number; // 0-100
  forestName?: string;
  ecoregion?: string;
  estimatedTreeCount?: number;
  biome?: Biome;
  fhqi?: number;                 // 0-100 Forest Health Quality Index
  fhqiStatus?: "Healthy" | "Moderate" | "Degraded";
  imageIntel?: ImageIntel;
}

export interface ImageIntel {
  density: number;          // 0-100
  vegetationHealth: number; // 0-100
  waterPresence: number;    // 0-100
  fireRisk: number;         // 0-100
  humanDisturbance: number; // 0-100
  overall: number;          // 0-100 derived
}

export interface AnalyzePayload {
  audio: Blob;
  filename?: string;
  lat: number;
  lon: number;
  climate?: string;
  season?: string;
  forestName?: string;
  biome?: Biome;
  imageIntel?: ImageIntel;
}

export type Biome =
  | "rainforest"
  | "pine"
  | "alpine"
  | "wetland"
  | "dry";

export const BIOME_PRESETS: Record<Biome, {
  label: string;
  treeMultiplier: number;
  fogDensity: number;        // 0-1
  terrainRoughness: number;  // 0-1
  leafHue: number;           // 0-1 (HSL)
  groundHue: number;
  skyColor: string;
}> = {
  rainforest: { label: "Tropical Rainforest", treeMultiplier: 1.4, fogDensity: 0.55, terrainRoughness: 0.5, leafHue: 0.32, groundHue: 0.22, skyColor: "#c9e8d2" },
  pine:       { label: "Pine Forest",         treeMultiplier: 1.1, fogDensity: 0.3,  terrainRoughness: 0.6, leafHue: 0.36, groundHue: 0.18, skyColor: "#d4e5d8" },
  alpine:     { label: "Alpine Forest",       treeMultiplier: 0.75, fogDensity: 0.4, terrainRoughness: 0.95, leafHue: 0.4, groundHue: 0.16, skyColor: "#dde7ec" },
  wetland:    { label: "Wetland Forest",      treeMultiplier: 0.9, fogDensity: 0.75, terrainRoughness: 0.25, leafHue: 0.28, groundHue: 0.25, skyColor: "#cde0d8" },
  dry:        { label: "Dry Tropical Forest", treeMultiplier: 0.75, fogDensity: 0.2, terrainRoughness: 0.45, leafHue: 0.18, groundHue: 0.12, skyColor: "#e6dfc8" },
};

const BASE_URL = import.meta.env.VITE_BIRD_API_URL ?? "";

export async function analyzeAudio(payload: AnalyzePayload): Promise<AnalyzeResult> {
  if (!BASE_URL) {
    // Mock response while backend is wired up
    await new Promise((r) => setTimeout(r, 2200));
    return mockResult(payload);
  }

  const form = new FormData();
  form.append("audio", payload.audio, payload.filename ?? "recording.webm");
  form.append("lat", String(payload.lat));
  form.append("lon", String(payload.lon));
  if (payload.climate) form.append("climate", payload.climate);
  if (payload.season) form.append("season", payload.season);
  if (payload.forestName) form.append("forestName", payload.forestName);
  if (payload.biome) form.append("biome", payload.biome);
  if (payload.imageIntel) form.append("imageIntel", JSON.stringify(payload.imageIntel));

  const res = await fetch(`${BASE_URL}/analyze-audio`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Analysis failed (${res.status})`);
  return res.json();
}

function mockResult(p: AnalyzePayload): AnalyzeResult {
  const species: DetectedSpecies[] = [
    { name: "Himalayan Bulbul", scientificName: "Pycnonotus leucogenys", confidence: 0.94, count: 7, indicator: true,
      ecologicalRole: "Seed disperser", conservationStatus: "LC",
      description: "A vocal canopy frugivore whose presence indicates a healthy fruit-bearing understory." },
    { name: "White-throated Kingfisher", scientificName: "Halcyon smyrnensis", confidence: 0.88, count: 2, indicator: true,
      ecologicalRole: "Wetland indicator", conservationStatus: "LC",
      description: "A waterside hunter — strong populations signal clean stream and pond systems nearby." },
    { name: "Great Barbet", scientificName: "Psilopogon virens", confidence: 0.82, count: 4,
      ecologicalRole: "Seed disperser", conservationStatus: "LC",
      description: "A loud, fruit-loving canopy bird tied to mature broadleaf trees." },
    { name: "Oriental Magpie-Robin", scientificName: "Copsychus saularis", confidence: 0.79, count: 5,
      ecologicalRole: "Insectivore", conservationStatus: "LC",
      description: "An adaptive songbird whose intricate dawn chorus reflects insect abundance." },
    { name: "Common Myna", scientificName: "Acridotheres tristis", confidence: 0.72, count: 9,
      ecologicalRole: "Generalist forager", conservationStatus: "LC",
      description: "A highly adaptive species — dominance may suggest edge or disturbed habitat." },
  ];
  const total = species.reduce((s, x) => s + x.count, 0);
  const score = Math.min(100, 45 + species.length * 8 + Math.floor(Math.random() * 10));
  const range = Math.round((20 + Math.random() * 80) * 10) / 10;
  const forestName =
    p.forestName ||
    (p.lat > 28 ? "Shivalik Foothills Reserve"
      : p.lat > 10 ? "Western Ghats Sanctuary"
      : p.lat > 0 ? "Equatorial Lowland Forest"
      : "Southern Temperate Range");
  const biome: Biome = p.biome ||
    (p.lat > 50 ? "alpine"
      : Math.abs(p.lat) < 12 ? "rainforest"
      : p.climate === "Arid" ? "dry"
      : "pine");
  // Compute unified Forest Health Quality Index from audio + image + location stability
  const acousticScore = score;
  const imageScore = p.imageIntel?.overall ?? 60 + Math.floor(Math.random() * 25);
  const locationStability = 55 + Math.floor(Math.random() * 30);
  const fhqi = Math.round(acousticScore * 0.45 + imageScore * 0.35 + locationStability * 0.20);
  const fhqiStatus: AnalyzeResult["fhqiStatus"] = fhqi >= 80 ? "Healthy" : fhqi >= 50 ? "Moderate" : "Degraded";

  return {
    biodiversityScore: score,
    speciesDetected: species,
    totalBirds: total,
    healthStatus: score >= 75 ? "Healthy" : score >= 50 ? "Moderate" : "Degraded",
    trend: score >= 70 ? "improving" : score >= 50 ? "stable" : "declining",
    forestRangeKm2: range,
    forestHealthIndex: Math.max(20, score - 5 + Math.floor(Math.random() * 10)),
    acousticComplexity: 60 + Math.floor(Math.random() * 35),
    forestName,
    ecoregion: BIOME_PRESETS[biome].label,
    estimatedTreeCount: Math.round(range * 1200 + Math.random() * 5000),
    biome,
    fhqi,
    fhqiStatus,
    imageIntel: p.imageIntel ?? {
      density: 50 + Math.floor(Math.random() * 40),
      vegetationHealth: imageScore,
      waterPresence: 30 + Math.floor(Math.random() * 50),
      fireRisk: Math.max(5, 60 - imageScore + Math.floor(Math.random() * 20)),
      humanDisturbance: Math.max(5, 70 - imageScore + Math.floor(Math.random() * 20)),
      overall: imageScore,
    },
  };
}
