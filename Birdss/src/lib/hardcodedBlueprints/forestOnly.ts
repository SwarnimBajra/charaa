import type { SceneBlueprint } from "@/lib/scenePlanner";

export function makeForestOnlyBlueprint(opts: {
  regionName: string;
  biome: string;
  canopyDensity?: SceneBlueprint["location_profile"]["canopy_density"];
  habitatType?: string;
}): SceneBlueprint {
  return {
    location_profile: {
      region_name: opts.regionName,
      biome: opts.biome,
      habitat_type: opts.habitatType ?? "Forest Interior",
      canopy_density: opts.canopyDensity ?? "high",
      moisture_level: "moderate",
      biodiversity_mood: "balanced",
    },
    scene_assets: {
      trees: [
        { type: "Canopy tree", count_hint: "dominant", height_m: [14, 28], dominance: "high" },
        { type: "Understory tree", count_hint: "supporting", height_m: [5, 12], dominance: "medium" },
      ],
      understory: ["Ferns", "Shrubs"],
      ground_cover: ["Leaf litter", "Moss", "Grass patches"],
      water_features: [],
      rocks_and_decoration: ["Fallen logs", "Boulders"],
      wildlife_visual_cues: ["Birds in flight"],
    },
    lighting: {
      time_style: "Day",
      fog: "light",
      sun_intensity: "medium",
      atmosphere: "clear with soft haze",
    },
    render_guidance: {
      camera_angle: "45-degree orbit",
      composition: "Centered woodland clearing",
      color_palette: ["#1b5e20", "#4caf50", "#d4e5d8", "#3e281b"],
      detail_priority: ["Canopy shadows", "Understory density"],
    },
    confidence: {
      overall: 0.7,
      biome: 0.6,
      vegetation: 0.7,
      lighting: 0.7,
    },
    fallbacks: {
      if_data_is_sparse: ["Use default forest assets"],
      if_location_is_urban_edge: ["Reduce tree count and canopy density"],
    },
  };
}
