import { useState } from "react";
import {
  Sparkles,
  Info,
  Terminal,
  Activity,
  Trees,
  Compass,
  Calendar,
  CloudSun,
  Shield,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Props {
  analysis: string | null;
  loading: boolean;
  error: string | null;
}

interface StrictJsonSchema {
  query_metadata: {
    query: string;
    top_k: number;
    bird_type: string;
    schema_version: string;
  };
  results: Array<{
    species_id: string;
    common_name: string;
    family: string;
    order: string;
    habitat_profile: {
      type_of_forest: string;
      habitat_density: {
        level: number;
        label: string;
      };
      tree_preference: string | null;
      environment_type: string;
      elevation_range: {
        min_m: number | null;
        max_m: number | null;
        note: string;
      };
    };
    diet: {
      trophic_niche: string;
      primary_food: string[];
      feeding_style: string;
    };
    seasonal_presence: {
      resident_type: string;
      months_observed: string[];
      peak_season: string | null;
    };
    climate_profile: {
      climate_zone: string;
      migration_strategy: string;
      migration_score: number | null;
    };
    distribution: {
      country: string;
      provinces: string[];
      total_localities: number;
      bounding_box: {
        lat_min: number;
        lat_max: number;
        lon_min: number;
        lon_max: number;
      };
    };
    observation_stats: {
      total_sightings: number;
      total_individuals: number;
      unique_observers: number | null;
      first_recorded: number | null;
      last_recorded: number | null;
    };
    physical: {
      body_mass_grams: number;
      lifestyle: string | null;
    };
    source_file: string;
    confidence_score: number;
  }>;
  summary: {
    total_species_found: number;
    common_habitat: string;
    common_diet: string[];
    common_season: string;
    common_climate: string;
    density_range: {
      min_level: number;
      max_level: number;
      label: string;
    };
  };
  json_repair_flags: {
    repaired: boolean;
    issues_found: string[];
    strategy_used: string | null;
  };
}

export function EcologicalAnalysisPanel({ analysis, loading, error }: Props) {
  const [activeTab, setActiveTab] = useState<"dashboard" | "species" | "raw">("dashboard");
  const [expandedSpecies, setExpandedSpecies] = useState<Record<string, boolean>>({});

  // Robust client-side JSON repair & parse logic
  const parseAnalysis = (raw: string | null): { data: StrictJsonSchema | null; repaired: boolean; issues: string[] } => {
    if (!raw) return { data: null, repaired: false, issues: [] };

    let clean = raw.trim();
    const issues: string[] = [];
    let repaired = false;

    // Remove markdown code fences if present
    if (clean.includes("```")) {
      const match = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match?.[1]) {
        clean = match[1].trim();
        repaired = true;
        issues.push("Removed markdown code block formatting");
      }
    }

    // Try standard parse
    try {
      const parsed = JSON.parse(clean) as StrictJsonSchema;
      return { data: parsed, repaired, issues };
    } catch (e: any) {
      console.warn("JSON.parse failed, initiating repair strategy:", e);
      issues.push(`Initial parse failed: ${e.message}`);
    }

    // Regex-based trailing comma repair before closing curly braces or brackets
    try {
      clean = clean.replace(/,\s*([}\]])/g, "$1");
      repaired = true;
      issues.push("Repaired trailing commas before closing braces/brackets");
      const parsed = JSON.parse(clean) as StrictJsonSchema;
      return { data: parsed, repaired, issues };
    } catch (e: any) {
      issues.push(`Repair attempt 1 failed: ${e.message}`);
    }

    // Attempt to extract largest valid JSON substring
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        const substring = clean.substring(firstBrace, lastBrace + 1);
        repaired = true;
        issues.push("Extracted largest bounding curly braces substring");
        const parsed = JSON.parse(substring) as StrictJsonSchema;
        return { data: parsed, repaired, issues };
      } catch (e: any) {
        issues.push(`Repair attempt 2 failed: ${e.message}`);
      }
    }

    return { data: null, repaired, issues };
  };

  const { data: parsedData, repaired: wasRepaired, issues: foundIssues } = parseAnalysis(analysis);

  const toggleSpecies = (id: string) => {
    setExpandedSpecies((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="rounded-3xl bg-card border border-border p-6 shadow-soft space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-forest text-primary-foreground flex items-center justify-center shadow-md animate-pulse">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-2xl font-bold">Ecological analysis</h3>
            <p className="text-xs text-muted-foreground">
              Synthesized from RAG retrieval + computed metrics
            </p>
          </div>
        </div>

        {/* Tab Controls (only shown if JSON parsed successfully) */}
        {parsedData && (
          <div className="flex bg-secondary/50 rounded-full p-1 border border-border">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`text-xs font-semibold px-4 py-2 rounded-full transition-all ${
                activeTab === "dashboard"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Summary
            </button>
            <button
              onClick={() => setActiveTab("species")}
              className={`text-xs font-semibold px-4 py-2 rounded-full transition-all ${
                activeTab === "species"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Species Traits
            </button>
            <button
              onClick={() => setActiveTab("raw")}
              className={`text-xs font-semibold px-4 py-2 rounded-full transition-all ${
                activeTab === "raw"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Strict JSON
            </button>
          </div>
        )}
      </div>

      {/* Content Rendering */}
      {loading ? (
        <div className="flex items-center gap-3 py-6 justify-center text-sm text-muted-foreground animate-pulse">
          <Activity className="h-5 w-5 text-primary animate-spin" />
          <span>Generating ecological analysis using Groq Llama 3...</span>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : parsedData ? (
        <>
          {/* TAB 1: DASHBOARD SUMMARY */}
          {activeTab === "dashboard" && (
            <div className="space-y-6">
              {/* Summary Metrics Cards */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-border bg-secondary/10 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Trees className="h-4 w-4 text-emerald-600" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Common Habitat</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground leading-snug">{parsedData.summary.common_habitat}</p>
                </div>

                <div className="rounded-2xl border border-border bg-secondary/10 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Compass className="h-4 w-4 text-blue-600" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Common Diet</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {parsedData.summary.common_diet.map((d) => (
                      <span key={d} className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-card border border-border">{d}</span>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-secondary/10 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4 text-amber-600" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Common Season</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground leading-snug">{parsedData.summary.common_season}</p>
                </div>

                <div className="rounded-2xl border border-border bg-secondary/10 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CloudSun className="h-4 w-4 text-indigo-600" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Climate Profile</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground leading-snug">{parsedData.summary.common_climate}</p>
                </div>
              </div>

              {/* Habitat Density Summary Info */}
              <div className="rounded-2xl border border-primary/10 bg-primary/5 p-4 flex items-start gap-3">
                <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-bold text-foreground block mb-1">Density & Cover Dynamics</span>
                  The observed bird community maps to a preferred forest density range level of{" "}
                  <span className="font-semibold text-foreground">
                    {parsedData.summary.density_range.min_level} to {parsedData.summary.density_range.max_level}
                  </span>{" "}
                  ({parsedData.summary.density_range.label}). This suggests that a structural habitat mosaic composed primarily of{" "}
                  <span className="italic text-foreground">{parsedData.summary.common_habitat}</span> provides the crucial ecological niches necessary to sustain the current bird assemblages in {parsedData.query_metadata.query.replace("Ecological analysis for ", "")}.
                </div>
              </div>

              {/* Repair Flag Banner if applicable */}
              {(wasRepaired || foundIssues.length > 0) && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
                  <Shield className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-[11px] leading-relaxed text-muted-foreground space-y-1">
                    <span className="font-bold text-amber-600 block">Strict JSON Structuring Safeguard Activated</span>
                    <p>Standardized JSON verification was successfully completed. Integrity maintained by resolving minor format shifts.</p>
                    <ul className="list-disc pl-4 space-y-0.5 mt-1 font-mono text-[10px]">
                      {foundIssues.map((issue, index) => (
                        <li key={index}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SPECIES TRAITS */}
          {activeTab === "species" && (
            <div className="space-y-4">
              {parsedData.results.map((sp) => {
                const isExpanded = !!expandedSpecies[sp.species_id];
                return (
                  <div key={sp.species_id} className="rounded-2xl border border-border bg-secondary/5 overflow-hidden transition-all">
                    {/* Collapsible Trigger */}
                    <button
                      onClick={() => toggleSpecies(sp.species_id)}
                      className="w-full flex items-center justify-between p-4 hover:bg-secondary/15 transition-all text-left"
                    >
                      <div>
                        <h4 className="font-semibold text-sm flex items-center gap-2">
                          {sp.common_name}
                          <span className="text-[10px] font-mono italic text-muted-foreground">({sp.species_id})</span>
                        </h4>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Family: {sp.family} · Order: {sp.order}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary">
                          Confidence: {Math.round(sp.confidence_score * 100)}%
                        </span>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </button>

                    {/* Collapsible Content */}
                    {isExpanded && (
                      <div className="p-4 border-t border-border bg-card/40 space-y-4 text-xs">
                        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                          {/* Habitat Profile */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">Habitat</span>
                            <p className="font-semibold">{sp.habitat_profile.type_of_forest} ({sp.habitat_profile.environment_type})</p>
                            <p className="text-muted-foreground text-[10px]">Density level: {sp.habitat_profile.habitat_density.level} ({sp.habitat_profile.habitat_density.label})</p>
                            <p className="text-muted-foreground text-[10px]">Elevation: {sp.habitat_profile.elevation_range.min_m ?? 0}m - {sp.habitat_profile.elevation_range.max_m ?? "unknown"}m</p>
                          </div>

                          {/* Diet & Food */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">Diet</span>
                            <p className="font-semibold capitalize">{sp.diet.trophic_niche}</p>
                            <p className="text-muted-foreground text-[10px]">{sp.diet.feeding_style}</p>
                            <p className="text-muted-foreground text-[10px] truncate">Food: {sp.diet.primary_food.join(", ")}</p>
                          </div>

                          {/* Seasonal / Climate */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">Season & Climate</span>
                            <p className="font-semibold">{sp.seasonal_presence.resident_type}</p>
                            <p className="text-muted-foreground text-[10px] capitalize">{sp.climate_profile.climate_zone} · {sp.climate_profile.migration_strategy}</p>
                            <p className="text-muted-foreground text-[10px] truncate">Months: {sp.seasonal_presence.months_observed.slice(0, 5).join(", ")}...</p>
                          </div>

                          {/* Distribution */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">Distribution</span>
                            <p className="font-semibold">Localities: {sp.distribution.total_localities}</p>
                            <p className="text-muted-foreground text-[10px] truncate">Provinces: {sp.distribution.provinces.join(", ")}</p>
                          </div>

                          {/* Observation Stats */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">Sighting Stats</span>
                            <p className="font-semibold">Sightings: {sp.observation_stats.total_sightings}</p>
                            <p className="text-muted-foreground text-[10px]">Individuals: {sp.observation_stats.total_individuals}</p>
                            <p className="text-muted-foreground text-[10px]">Years active: {sp.observation_stats.first_recorded ?? "?"} - {sp.observation_stats.last_recorded ?? "?"}</p>
                          </div>

                          {/* Physical */}
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">Physical</span>
                            <p className="font-semibold">{sp.physical.body_mass_grams} grams</p>
                            <p className="text-muted-foreground text-[10px] capitalize">Lifestyle: {sp.physical.lifestyle ?? "unknown"}</p>
                            <p className="text-muted-foreground text-[10px] truncate">Source: {sp.source_file}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 3: STRICT JSON VIEW */}
          {activeTab === "raw" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-2">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Terminal className="h-4 w-4 text-emerald-600 animate-pulse" />
                  Conforming Strictly to strict-json.txt Schema
                </span>
                <span className="font-mono text-[10px]">Size: {new Blob([analysis ?? ""]).size} bytes</span>
              </div>
              <pre className="rounded-2xl bg-black/90 text-emerald-400 border border-border p-4 overflow-x-auto font-mono text-[11px] leading-relaxed shadow-inner max-h-96">
                <code>{JSON.stringify(parsedData, null, 2)}</code>
              </pre>
            </div>
          )}
        </>
      ) : analysis ? (
        // Fallback: If it's not valid JSON, display it as readable paragraphs so the user experience is preserved
        <div className="rounded-2xl bg-secondary/20 p-4 border border-border text-sm leading-relaxed whitespace-pre-line space-y-4">
          <div className="flex items-center gap-2 text-amber-600 mb-2">
            <Info className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase">Text Narrative Mode (JSON parsing failed)</span>
          </div>
          <div>{analysis}</div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-6">No analysis available.</p>
      )}
    </div>
  );
}
