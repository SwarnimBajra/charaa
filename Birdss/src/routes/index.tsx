import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Leaf, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AudioInput } from "@/components/AudioInput";
import { LocationInput, type LocationData } from "@/components/LocationInput";
import { BirdSpeciesGallery } from "@/components/BirdSpeciesGallery";
import { ForestMetricsCard } from "@/components/ForestMetricsCard";
import { ForestHealthVerdict } from "@/components/ForestHealthVerdict";
import { EcologicalAnalysisPanel } from "@/components/EcologicalAnalysisPanel";
import { LocationEnvironmentPanel } from "@/components/LocationEnvironmentPanel";
import { ForestScene3D } from "@/components/ForestScene3D";
import { analyzeAudio, type AnalyzeResult, type Biome } from "@/lib/birdApi";
import { fetchForestMetrics, type ForestMetrics } from "@/lib/forestApi";
import { fetchRagChunks } from "@/lib/ragApi";
import { generateEcologicalAnalysis } from "@/lib/ecologicalAnalysis";
import { fetchOpenWeather, type WeatherSnapshot } from "@/lib/weather";
import {
  fetchINaturalistData,
  generateSceneBlueprint,
  generateEcosystemInsight,
  type SceneBlueprint,
  type EcosystemInsight,
} from "@/lib/scenePlanner";
import { fetchActiveFires, type FireSummary } from "@/lib/fireApi";
import forestHero from "@/assets/forest-hero.jpg";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "MockingBird · Forest Biodiversity Intelligence" },
      {
        name: "description",
        content:
          "AI-powered forest health analysis from bird audio. Detect species and score ecosystem health.",
      },
    ],
  }),
});

function Index() {
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [location, setLocation] = useState<LocationData>({
    lat: "",
    lon: "",
    climate: "",
    season: "",
    forestName: "",
    biome: "",
    treeDensity: "",
  });
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<string>("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ecoAnalysis, setEcoAnalysis] = useState<string | null>(null);
  const [ecoLoading, setEcoLoading] = useState(false);
  const [ecoError, setEcoError] = useState<string | null>(null);
  const [ecoMetrics, setEcoMetrics] = useState<ForestMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Live environmental context for the chosen coordinates
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [ecosystemInsight, setEcosystemInsight] = useState<EcosystemInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [blueprint, setBlueprint] = useState<SceneBlueprint | null>(null);
  const [fire, setFire] = useState<FireSummary | null>(null);
  const [fireLoading, setFireLoading] = useState(false);

  const ready = audio && location.lat !== "" && location.lon !== "";
  const locationSet = location.lat !== "" && location.lon !== "";

  // Weather, ecosystem insight (Gemini), scene blueprint, NASA FIRMS fires —
  // all driven by lat/lon. Re-fires when coordinates change.
  useEffect(() => {
    if (!locationSet) {
      setWeather(null);
      setEcosystemInsight(null);
      setBlueprint(null);
      setFire(null);
      return;
    }

    const latNum = Number(location.lat);
    const lonNum = Number(location.lon);
    let active = true;

    setWeatherLoading(true);
    fetchOpenWeather(latNum, lonNum)
      .then((data) => {
        if (active) setWeather(data);
      })
      .catch(() => {
        if (active) setWeather(null);
      })
      .finally(() => {
        if (active) setWeatherLoading(false);
      });

    setFireLoading(true);
    fetchActiveFires(latNum, lonNum, 75, 2)
      .then((data) => {
        if (active) setFire(data);
      })
      .catch(() => {
        if (active) setFire(null);
      })
      .finally(() => {
        if (active) setFireLoading(false);
      });

    setInsightLoading(true);
    (async () => {
      try {
        const inat = await fetchINaturalistData(latNum, lonNum);
        if (!active) return;

        const insight = await generateEcosystemInsight(latNum, lonNum, {
          climate: location.climate || undefined,
          season: location.season || undefined,
        });
        if (!active) return;
        setEcosystemInsight(insight);

        // Auto-fill biome hint based on Gemini's climate label
        let mappedBiome: Biome = "pine";
        const clim = (insight.climate.label || "").toLowerCase();
        if (clim.includes("alpine") || clim.includes("mountain") || clim.includes("himalayan")) {
          mappedBiome = "alpine";
        } else if (clim.includes("tropical") || clim.includes("rainforest")) {
          mappedBiome = "rainforest";
        } else if (insight.scene_guidance?.ground_moisture === "wet") {
          mappedBiome = "wetland";
        } else if (clim.includes("arid") || clim.includes("dry")) {
          mappedBiome = "dry";
        }
        setLocation((prev) => ({
          ...prev,
          forestName: prev.forestName || insight.location.area_name,
          climate: prev.climate || insight.climate.label,
          season: prev.season || insight.season.label,
          biome: (prev.biome as Biome) || mappedBiome,
        }));

        const bp = await generateSceneBlueprint({
          location_text: insight.location.area_name,
          latitude: latNum,
          longitude: lonNum,
          radius_km: 10,
          season: insight.season.label,
          weather_summary: insight.climate.description,
          inaturalist_observations: inat.observations,
          inaturalist_taxa_summary: inat.taxaSummary,
          habitat_tags: inat.habitatTags,
          time_of_day: new Date().getHours() > 18 || new Date().getHours() < 6 ? "Night" : "Day",
          climate_label: location.climate || undefined,
          biome_hint: mappedBiome,
        });
        if (!active) return;
        setBlueprint(bp);
      } catch (err) {
        console.error("Ecosystem insight load failed:", err);
      } finally {
        if (active) setInsightLoading(false);
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.lat, location.lon]);

  useEffect(() => {
    if (!loading) return;
    const phases = [
      "Decoding audio waveform…",
      "Isolating bird vocalizations…",
      "Matching species signatures…",
      "Computing diversity metrics…",
    ];
    let p = 0;
    setProgress(0);
    setPhase(phases[0]);
    const id = window.setInterval(() => {
      p = Math.min(95, p + Math.random() * 12 + 4);
      setProgress(p);
      setPhase(phases[Math.min(phases.length - 1, Math.floor((p / 100) * phases.length))]);
    }, 320);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (!result) return;
    const currentResult = result;

    const locationLabel =
      currentResult.forestName || location.forestName || `${location.lat}, ${location.lon}`;

    let active = true;
    async function buildEcologicalAnalysis() {
      setEcoLoading(true);
      setMetricsLoading(true);
      setEcoError(null);
      try {
        const speciesNames = currentResult.speciesDetected.map((s) => s.scientificName);
        const [metrics, chunkGroups] = await Promise.all([
          fetchForestMetrics(locationLabel, currentResult),
          Promise.all(
            speciesNames.map((name) =>
              fetchRagChunks(`Ecological knowledge for ${name} in ${locationLabel}.`),
            ),
          ),
        ]);

        if (!active) return;
        setMetricsLoading(false);

        const resolvedMetrics = metrics ?? {
          unique_species: currentResult.speciesDetected.length,
          shannon_idx: 0,
          dominance: { dominance_score: 0, dominant_species: null },
          native_ratio: 0,
          forest_dependency: 0,
          rarity_score: 0,
          composite_health: { score: 0, label: "Unknown" },
        };

        setEcoMetrics(resolvedMetrics);

        const analysis = await generateEcologicalAnalysis({
          location: locationLabel,
          species: speciesNames,
          metrics: resolvedMetrics,
          retrievedChunks: speciesNames.map((name, index) => ({
            species: name,
            chunks: chunkGroups[index] ?? [],
          })),
        });

        if (!active) return;
        setEcoAnalysis(analysis);
      } catch (err) {
        if (!active) return;
        setEcoError(err instanceof Error ? err.message : "Failed to generate ecological analysis");
      } finally {
        if (active) {
          setEcoLoading(false);
          setMetricsLoading(false);
        }
      }
    }

    buildEcologicalAnalysis();
    return () => {
      active = false;
    };
  }, [result, location.forestName, location.lat, location.lon]);

  async function run() {
    if (!ready || !audio) return;
    setLoading(true);
    setError(null);
    setEcoAnalysis(null);
    setEcoMetrics(null);
    try {
      const res = await analyzeAudio({
        audio,
        filename: audioName ?? undefined,
        lat: Number(location.lat),
        lon: Number(location.lon),
        climate: location.climate || undefined,
        season: location.season || undefined,
        forestName: location.forestName || undefined,
      });
      setProgress(100);
      setResult(res);
      setTimeout(
        () => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }),
        100,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${forestHero})` }}
        />
        <div className="absolute inset-0 bg-gradient-canopy" />
        <div className="relative max-w-6xl mx-auto px-6 pt-12 pb-20 text-primary-foreground">
          <div className="inline-flex items-center gap-3 text-3xl md:text-5xl font-display font-bold tracking-wide rounded-full bg-white/10 backdrop-blur-sm border border-white/20 px-5 py-2 md:px-7 md:py-3 shadow-lg">
            <Leaf className="h-8 w-8 md:h-10 md:w-10 text-accent" />
            <span className="bg-gradient-to-r from-white to-accent bg-clip-text text-transparent">
              MockingBird
            </span>
          </div>
          <h1 className="font-display text-5xl md:text-7xl mt-4 max-w-3xl text-balance">
            Hear the forest. <em className="not-italic text-accent">Read its health.</em>
          </h1>
          <p className="mt-5 max-w-xl text-base md:text-lg opacity-85">
            Upload forest audio. BirdNET identifies species, the backend computes ecological
            metrics, and RAG-grounded AI produces a structured forest-health analysis.
          </p>
        </div>
      </section>

      {/* Workflow */}
      <section className="max-w-6xl mx-auto px-6 -mt-12 relative z-10 pb-20">
        <div className="grid lg:grid-cols-2 gap-6">
          <Step number={1} title="Capture audio">
            <AudioInput
              audio={audio}
              onChange={(blob, name) => {
                setAudio(blob);
                setAudioName(name ?? null);
              }}
            />
          </Step>
          <Step number={2} title="Anchor the location">
            <LocationInput value={location} onChange={setLocation} />
          </Step>
        </div>

        {locationSet && (
          <div className="mt-6 space-y-6">
            <LocationEnvironmentPanel
              weather={weather}
              weatherLoading={weatherLoading}
              insight={ecosystemInsight}
              insightLoading={insightLoading}
              fire={fire}
              fireLoading={fireLoading}
            />

            <div className="rounded-3xl bg-card border border-border p-6 shadow-soft">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Location 3D preview
                  </p>
                  <h3 className="font-display text-2xl mt-1">
                    {ecosystemInsight?.location.area_name || "Forest scene"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Trees, water features, and ambient weather driven by iNaturalist + Gemini
                    blueprint
                  </p>
                </div>
                {insightLoading && (
                  <span className="text-[10px] font-semibold text-primary bg-primary/10 rounded-full px-3 py-1 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Generating blueprint…
                  </span>
                )}
              </div>
              <ForestScene3D
                treeCount={80}
                birdCount={
                  result ? Math.min(24, Math.max(6, result.speciesDetected.length * 3)) : 10
                }
                forestRangeKm2={25}
                healthScore={ecoMetrics ? Math.round(ecoMetrics.composite_health.score * 100) : 60}
                biome={(location.biome as Biome) || "pine"}
                blueprint={blueprint}
                weather={weather}
                seedKey={`${location.lat},${location.lon}`}
              />
            </div>
          </div>
        )}

        <div className="mt-8 rounded-3xl bg-card border border-border p-6 shadow-soft flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="font-display text-2xl">Run analysis</h3>
            <p className="text-sm text-muted-foreground">
              {loading
                ? phase
                : ready
                  ? "Audio and coordinates ready — send to the AI engine."
                  : "Add an audio sample and location to enable analysis."}
            </p>
            {loading && (
              <div className="mt-3 h-1.5 w-full md:w-80 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-forest-canopy to-amber-bird transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            {error && <p className="text-sm text-destructive mt-1">{error}</p>}
          </div>
          <Button
            size="lg"
            onClick={run}
            disabled={!ready || loading}
            className="bg-gradient-forest hover:opacity-90 text-primary-foreground"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span className="ml-2">{loading ? "Analyzing ecosystem…" : "Identify birds"}</span>
          </Button>
        </div>

        {result && (
          <div id="results" className="mt-10 space-y-6">
            {/* 1. What we heard — detected species first (observation) */}
            <BirdSpeciesGallery species={result.speciesDetected} />

            {/* 2. What we calculated — quantitative ecological metrics */}
            {metricsLoading ? (
              <div className="rounded-3xl bg-card border border-border p-6 shadow-soft flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Computing forest metrics from `/forest`…
              </div>
            ) : ecoMetrics ? (
              <ForestMetricsCard metrics={ecoMetrics} />
            ) : null}

            {/* 3. What it means — ecological context from RAG + LLM */}
            <EcologicalAnalysisPanel analysis={ecoAnalysis} loading={ecoLoading} error={ecoError} />

            {/* 4. Bottom line — final verdict last, the climax of the page */}
            {(ecoMetrics || ecoLoading) && (
              <ForestHealthVerdict
                analysis={ecoAnalysis}
                metrics={ecoMetrics}
                loading={ecoLoading}
                error={ecoError}
              />
            )}
          </div>
        )}
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        MockingBird · Forest Biodiversity Intelligence
      </footer>
    </main>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-card border border-border p-6 shadow-soft">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-8 w-8 rounded-full bg-gradient-forest text-primary-foreground flex items-center justify-center font-display text-sm">
          {number}
        </div>
        <h2 className="font-display text-2xl">{title}</h2>
      </div>
      {children}
    </div>
  );
}
