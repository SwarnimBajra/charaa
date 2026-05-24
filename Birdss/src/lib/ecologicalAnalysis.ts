import type { ForestMetrics } from "@/lib/forestApi";

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY ?? "";
const GROQ_MODEL = import.meta.env.VITE_GROQ_MODEL ?? "llama3-8b-8192";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export interface EcologicalAnalysisInput {
  location: string;
  species: string[];
  metrics: ForestMetrics;
  retrievedChunks: Array<{
    species: string;
    chunks: Array<Record<string, unknown>>;
  }>;
}

/**
 * Attempt to repair broken JSON strings using multiple strategies.
 * Returns the parsed object or null.
 */
function repairAndParse(raw: string): { parsed: Record<string, unknown> | null; repaired: boolean; issues: string[] } {
  const issues: string[] = [];
  let repaired = false;
  let clean = raw.trim();

  // Strategy 1: Remove markdown code fences
  if (clean.includes("```")) {
    const match = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match?.[1]) {
      clean = match[1].trim();
      repaired = true;
      issues.push("Removed markdown code block formatting");
    }
  }

  // Strategy 2: Direct parse
  try {
    return { parsed: JSON.parse(clean), repaired, issues };
  } catch (e: any) {
    issues.push(`Direct parse failed: ${e.message}`);
  }

  // Strategy 3: Remove trailing commas before ] or }
  try {
    const noTrailing = clean.replace(/,\s*([}\]])/g, "$1");
    repaired = true;
    issues.push("Removed trailing commas");
    return { parsed: JSON.parse(noTrailing), repaired, issues };
  } catch (e: any) {
    issues.push(`Trailing comma repair failed: ${e.message}`);
  }

  // Strategy 4: Extract largest bounding braces
  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      const substring = clean.substring(firstBrace, lastBrace + 1);
      repaired = true;
      issues.push("Extracted bounding braces substring");
      return { parsed: JSON.parse(substring), repaired, issues };
    } catch (e: any) {
      issues.push(`Brace extraction failed: ${e.message}`);
    }

    // Strategy 5: Brace extraction + trailing comma removal
    try {
      const substring = clean.substring(firstBrace, lastBrace + 1).replace(/,\s*([}\]])/g, "$1");
      repaired = true;
      issues.push("Combined brace extraction + trailing comma removal");
      return { parsed: JSON.parse(substring), repaired, issues };
    } catch (e: any) {
      issues.push(`Combined repair failed: ${e.message}`);
    }
  }

  return { parsed: null, repaired, issues };
}

export async function generateEcologicalAnalysis(input: EcologicalAnalysisInput): Promise<string | null> {
  if (!GROQ_API_KEY) {
    console.warn("GROQ_API_KEY is not configured.");
    return null;
  }

  const chunkText = JSON.stringify(input.retrievedChunks, null, 2);

  const systemPrompt = `You are an expert ecological analysis assistant specializing in Nepalese bird biodiversity and forest ecosystem health.
Your task is to analyze the observed species, computed ecological metrics, and RAG-retrieved ecological knowledge, then compile a highly detailed, structured analysis.

CRITICAL: You MUST strictly return your response as a single, valid JSON object following the exact schema below.
Do NOT include any introduction, explanation, markdown formatting, or code blocks. Return ONLY the JSON object.
GUIDELINE: "Do not hallucinate". Rely strictly on the provided context, ecological metrics, and established ornithological facts.

JSON SCHEMA TO CONFORM TO:
{
  "query_metadata": {
    "query": "Ecological analysis for ${input.location}",
    "top_k": ${input.retrievedChunks.length},
    "bird_type": "forest and woodland birds",
    "schema_version": "1.0"
  },
  "results": [
    {
      "species_id": "[Scientific name of the species]",
      "common_name": "[Common name of the species]",
      "family": "[Bird family, e.g. Columbidae]",
      "order": "[Bird order, e.g. Columbiformes]",
      "habitat_profile": {
        "type_of_forest": "[Specific forest habitat in Nepal]",
        "habitat_density": {
          "level": [Density level 1 (dense), 2 (semi-open), 3 (open)],
          "label": "[Label corresponding to level]"
        },
        "tree_preference": "[Preferred tree species or type of trees if known, or null]",
        "environment_type": "[terrestrial, arboreal, or wetland]",
        "elevation_range": {
          "min_m": [minimum elevation in meters as number or null],
          "max_m": [maximum elevation in meters as number or null],
          "note": "[Brief note about altitudinal zones in Nepal]"
        }
      },
      "diet": {
        "trophic_niche": "[e.g. omnivore, frugivore, granivore, invertivore]",
        "primary_food": ["[list of primary foods, e.g. seeds, fruits, insects]"],
        "feeding_style": "[e.g. ground foraging, canopy foraging]"
      },
      "seasonal_presence": {
        "resident_type": "[e.g. year-round, winter visitor, summer migrant]",
        "months_observed": ["[list of months observed in Nepal, e.g. January, February...]"],
        "peak_season": "[Peak season label or null]"
      },
      "climate_profile": {
        "climate_zone": "[e.g. subtropical, temperate, subalpine]",
        "migration_strategy": "[e.g. sedentary, altitudinal migrant, long-distance migrant]",
        "migration_score": [Migration score as number or null]
      },
      "distribution": {
        "country": "Nepal",
        "provinces": ["[provinces in Nepal where found, e.g. Bagmati, Gandaki...]"],
        "total_localities": [estimated or matched localities count as number],
        "bounding_box": {
          "lat_min": [approximate min latitude in Nepal],
          "lat_max": [approximate max latitude in Nepal],
          "lon_min": [approximate min longitude in Nepal],
          "lon_max": [approximate max longitude in Nepal]
        }
      },
      "observation_stats": {
        "total_sightings": [number of observations in database or reasonable estimate],
        "total_individuals": [number of individuals recorded or reasonable estimate],
        "unique_observers": [reasonable estimated number or null],
        "first_recorded": [earliest record year as number or null],
        "last_recorded": [latest record year as number or null]
      },
      "physical": {
        "body_mass_grams": [average body mass in grams as number],
        "lifestyle": "[e.g. insessorial, terrestrial, aerial or null]"
      },
      "source_file": "[Scientific name or primary source]",
      "confidence_score": [confidence rating between 0 and 1, e.g., 0.85]
    }
  ],
  "summary": {
    "total_species_found": ${input.species.length},
    "common_habitat": "[Dominant or common habitat across all detected species]",
    "common_diet": ["[List of most common food items across species]"],
    "common_season": "[Dominant seasonal presence type]",
    "common_climate": "[Dominant climate zone]",
    "density_range": {
      "min_level": [min habitat density level among species],
      "max_level": [max habitat density level among species],
      "label": "[e.g., semi-open to open habitats]"
    }
  },
  "forest_health_assessment": {
    "health_label": "[One of: Excellent, Good, Fair, Poor, Critical — must align with composite_health.label from the metrics provided]",
    "verdict": "[2-3 sentence plain-English assessment of the forest's health, synthesizing the composite_health score, dominance, native ratio, forest dependency, and rarity. If only generalist/edge species (e.g. crows, mynas, common bulbuls) are present, explicitly say the forest shows signs of degradation or disturbance. If diverse forest-dependent species are present, say the forest is healthy and well-structured.]",
    "expected_trees": ["[List 3-6 tree species or tree types that SHOULD be present based on the bird species detected and their RAG habitat profiles. Use specific names where possible (e.g. 'Shorea robusta (sal)', 'Quercus species (oak)', 'Rhododendron arboreum')]"],
    "expected_food_sources": ["[List 3-6 specific food items the detected birds need from the ecosystem — combine fruits, seeds, insects, nectar etc. with concrete examples]"],
    "ecology_type": "[One short phrase describing the forest structure expected from the bird community, e.g. 'dense broadleaf canopy', 'open mixed woodland', 'sparse degraded edge habitat', 'wetland-adjacent forest', 'subtropical rainforest']",
    "key_strengths": ["[List 1-4 positive ecological signals from the detected species and metrics. Empty list if none.]"],
    "key_concerns": ["[List 1-4 warning signs — dominance by generalists, low diversity, missing forest-obligate species, low rarity, etc. Empty list if none.]"]
  },
  "json_repair_flags": {
    "repaired": false,
    "issues_found": [],
    "strategy_used": null
  }
}`;

  const userPrompt = `
Location: ${input.location}

Observed Species list:
${input.species.map((s) => `* ${s}`).join("\n")}

Computed Ecological Metrics:
* Unique Species Count: ${input.metrics.unique_species}
* Shannon Diversity Index: ${input.metrics.shannon_idx}
* Dominance Score: ${input.metrics.dominance.dominance_score} (Dominant Species: ${input.metrics.dominance.dominant_species ?? "None"})
* Native Species Ratio: ${(input.metrics.native_ratio * 100).toFixed(1)}%
* Average Forest Dependency: ${input.metrics.forest_dependency}
* Average Rarity: ${input.metrics.rarity_score}
* Composite Forest Health Index: ${input.metrics.composite_health.score} (${input.metrics.composite_health.label})

Retrieved RAG Ecological Knowledge Chunks:
${chunkText}
`;

  try {
    const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Groq API error:", errText);
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) return null;

    // Multi-strategy repair pipeline
    const { parsed, repaired, issues } = repairAndParse(answer);

    if (parsed) {
      // Inject repair metadata into the JSON
      if (repaired || issues.length > 0) {
        (parsed as any).json_repair_flags = {
          repaired,
          issues_found: issues,
          strategy_used: repaired ? "client-side multi-strategy repair" : null,
        };
      }
      return JSON.stringify(parsed);
    }

    // Last resort: return raw answer for the frontend fallback renderer
    console.warn("All JSON repair strategies failed, returning raw answer. Issues:", issues);
    return answer;
  } catch (error) {
    console.error("Failed to call Groq API:", error);
    return null;
  }
}
