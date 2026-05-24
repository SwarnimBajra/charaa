import type { AnalyzeResult } from "@/lib/birdApi";

export interface ForestMetrics {
  unique_species: number;
  shannon_idx: number;
  dominance: {
    dominance_score: number;
    dominant_species: string | null;
  };
  native_ratio: number;
  forest_dependency: number;
  rarity_score: number;
  composite_health: {
    score: number;
    label: string;
  };
}

const BASE_URL = import.meta.env.VITE_BIRD_API_URL ?? "";

function toForestSpecies(result: AnalyzeResult) {
  const rows: Array<{
    audio_path: string;
    start_time: number;
    end_time: number;
    species_label: string;
    confidence: number;
  }> = [];

  for (const s of result.speciesDetected) {
    const label = `${s.scientificName}_${s.name}`;
    const count = Math.max(1, Math.round(s.count));
    for (let i = 0; i < count; i += 1) {
      rows.push({
        audio_path: "frontend",
        start_time: 0,
        end_time: 0,
        species_label: label,
        confidence: Math.max(0.01, s.confidence),
      });
    }
  }

  return rows;
}

export async function fetchForestMetrics(loc: string, result: AnalyzeResult): Promise<ForestMetrics | null> {
  if (!BASE_URL) return null;

  const payload = {
    loc,
    species: toForestSpecies(result),
  };

  const res = await fetch(`${BASE_URL}/forest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) return null;
  const data = await res.json();

  return {
    unique_species: data.unique_species ?? result.speciesDetected.length,
    shannon_idx: data.shannon_idx ?? 0,
    dominance: data.dominance ?? { dominance_score: 0, dominant_species: null },
    native_ratio: data.native_ratio ?? 0,
    forest_dependency: data.forest_dependency ?? 0,
    rarity_score: data.rarity_score ?? 0,
    composite_health: data.composite_health ?? { score: 0, label: "Unknown" },
  };
}
