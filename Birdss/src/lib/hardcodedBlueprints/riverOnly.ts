import type { SceneBlueprint } from "@/lib/scenePlanner";

export function makeRiverOnlyBlueprint(opts: {
  regionName: string;
  biome: string;
  canopyDensity?: SceneBlueprint["location_profile"]["canopy_density"];
  waterFeatures?: string[];
}): SceneBlueprint {
  return {
    location_profile: {
      region_name: opts.regionName,
      biome: opts.biome,
      habitat_type: "Riparian Corridor",
      canopy_density: opts.canopyDensity ?? "low",
      moisture_level: "wet",
      biodiversity_mood: "balanced",
    },
    scene_assets: {
      trees: [
        { type: "Riparian tree", count_hint: "sparse", height_m: [8, 18], dominance: "medium" },
      ],
      understory: ["Reeds", "Grasses"],
      ground_cover: ["Wet soil", "Pebbles", "Grass patches"],
      water_features: opts.waterFeatures ?? ["Nearby river"],
      rocks_and_decoration: ["River stones", "Driftwood"],
      wildlife_visual_cues: ["Waterbirds"],
    },
    lighting: {
      time_style: "Day",
      fog: "medium",
      sun_intensity: "medium",
      atmosphere: "humid and cool",
    },
    render_guidance: {
      camera_angle: "45-degree orbit",
      composition: "River as primary feature",
      color_palette: ["#4a90e2", "#2e7d32", "#cde0d8", "#221e1a"],
      detail_priority: ["Water reflections", "Wet ground"],
    },
    confidence: {
      overall: 0.7,
      biome: 0.6,
      vegetation: 0.5,
      lighting: 0.7,
    },
    fallbacks: {
      if_data_is_sparse: ["Keep river feature, reduce vegetation variety"],
      if_location_is_urban_edge: ["Reduce vegetation and add open banks"],
    },
  };
}
