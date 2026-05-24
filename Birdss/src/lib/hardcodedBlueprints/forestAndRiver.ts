import type { SceneBlueprint } from "@/lib/scenePlanner";

export function makeForestAndRiverBlueprint(opts: {
  regionName: string;
  biome: string;
  canopyDensity?: SceneBlueprint["location_profile"]["canopy_density"];
  waterFeatures?: string[];
}): SceneBlueprint {
  return {
    location_profile: {
      region_name: opts.regionName,
      biome: opts.biome,
      habitat_type: "Forest Edge with River",
      canopy_density: opts.canopyDensity ?? "medium",
      moisture_level: "wet",
      biodiversity_mood: "lush",
    },
    scene_assets: {
      trees: [
        { type: "Canopy tree", count_hint: "dominant", height_m: [12, 26], dominance: "high" },
        { type: "Riparian tree", count_hint: "supporting", height_m: [8, 16], dominance: "medium" },
      ],
      understory: ["Ferns", "Reeds", "Shrubs"],
      ground_cover: ["Moss", "Leaf litter", "Wet soil"],
      water_features: opts.waterFeatures ?? ["Nearby river"],
      rocks_and_decoration: ["Boulders", "River stones", "Fallen logs"],
      wildlife_visual_cues: ["Birds in flight", "Waterbirds"],
    },
    lighting: {
      time_style: "Golden Hour",
      fog: "light",
      sun_intensity: "medium",
      atmosphere: "misty and serene",
    },
    render_guidance: {
      camera_angle: "45-degree orbit",
      composition: "Forest framing a river corridor",
      color_palette: ["#1b5e20", "#4caf50", "#4a90e2", "#d4e5d8"],
      detail_priority: ["Canopy shadows", "Water reflections", "Understory"],
    },
    confidence: {
      overall: 0.75,
      biome: 0.6,
      vegetation: 0.7,
      lighting: 0.75,
    },
    fallbacks: {
      if_data_is_sparse: ["Use standard forest-river mix"],
      if_location_is_urban_edge: ["Open the canopy and narrow the water corridor"],
    },
  };
}
