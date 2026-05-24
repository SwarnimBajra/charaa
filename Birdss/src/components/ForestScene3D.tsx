import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { BIOME_PRESETS, type Biome } from "@/lib/birdApi";
import { type SceneBlueprint } from "@/lib/scenePlanner";
import type { WeatherSnapshot } from "@/lib/weather";

interface ForestScene3DProps {
  treeCount?: number;
  birdCount?: number;
  forestRangeKm2?: number;
  healthScore?: number; // 0-100
  biome?: Biome;
  audioIntensity?: number; // fallback when no audio element
  audioElement?: HTMLMediaElement | null;
  blueprint?: SceneBlueprint | null;
  weather?: WeatherSnapshot | null;
  seedKey?: string;
}

interface Creature {
  mesh: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  speed: number;
  radius: number;
  heightOffset: number;
  angle: number;
  flapSpeed: number;
  yOffset: number;
}

function isWebGLAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

function normalizeBiome(b: string): Biome {
  const lower = (b || "").toLowerCase();
  if (lower.includes("rainforest") || lower.includes("tropical")) return "rainforest";
  if (lower.includes("alpine") || lower.includes("mountain") || lower.includes("montane") || lower.includes("subalpine") || lower.includes("himalayan")) return "alpine";
  if (lower.includes("wetland") || lower.includes("swamp") || lower.includes("marsh")) return "wetland";
  if (lower.includes("dry") || lower.includes("arid") || lower.includes("savanna")) return "dry";
  return "pine"; // default
}

function hashStringToSeed(input: string): number {
  // FNV-1a 32-bit hash -> positive int; stable across sessions.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

export function ForestScene3D({
  treeCount = 80,
  birdCount = 12,
  forestRangeKm2 = 25,
  healthScore = 75,
  biome = "pine",
  audioIntensity = 0.25,
  audioElement = null,
  blueprint = null,
  weather = null,
  seedKey,
}: ForestScene3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ audioIntensity });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    propsRef.current.audioIntensity = audioIntensity;
  }, [audioIntensity]);

  const parsedBiome = blueprint ? normalizeBiome(blueprint.location_profile.biome) : biome;
  const preset = BIOME_PRESETS[parsedBiome] ?? BIOME_PRESETS.pine;

  // Scale trees based on preset and optionally blueprint count
  const canopy = blueprint?.location_profile?.canopy_density;
  const canopyFactor = canopy === "high" ? 1.2 : canopy === "medium" ? 1.0 : canopy === "low" ? 0.55 : 1.0;
  const minTrees = canopy === "low" ? 12 : canopy === "medium" ? 28 : 40;

  const baseTrees = (blueprint?.scene_assets?.trees ? 120 : treeCount) * canopyFactor;
  const adjustedTrees = Math.round(
    Math.min(300, Math.max(minTrees, (baseTrees + forestRangeKm2 * 1.2) * preset.treeMultiplier))
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const container = containerRef.current;
    if (!container) return;

    if (!isWebGLAvailable()) {
      setFailed(true);
      return;
    }

    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let frameId = 0;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;
    const disposables: Array<{ dispose: () => void }> = [];
    const creatures: Creature[] = [];

    try {
      const width = container.clientWidth || 600;
      const height = container.clientHeight || 460;

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      Object.assign(renderer.domElement.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        display: "block",
      });
      container.appendChild(renderer.domElement);

      scene = new THREE.Scene();

      // Dynamic Colors based on color_palette or preset
      let skyColStr = preset.skyColor;
      let leafHueVal = preset.leafHue;
      let groundHueVal = preset.groundHue;
      let paletteColors: THREE.Color[] = [];

      // Custom override for biome sky color to make shifts drastic
      if (parsedBiome === "alpine") {
        skyColStr = "#e4edf5"; // icy bright blue
      } else if (parsedBiome === "rainforest") {
        skyColStr = "#b8e3c3"; // dense green mist
      } else if (parsedBiome === "wetland") {
        skyColStr = "#c2d4ce"; // damp teal sky
      } else if (parsedBiome === "dry") {
        skyColStr = "#eedebd"; // dusty orange sky
      }

      if (blueprint && blueprint.render_guidance?.color_palette?.length > 0) {
        const palette = blueprint.render_guidance.color_palette;
        paletteColors = palette.map((c) => new THREE.Color(c));
        skyColStr = palette[palette.length - 1];
      }

      const skyColor = new THREE.Color(skyColStr);
      scene.background = skyColor;

      // Fog density from blueprint or preset
      let fogDensityFactor = preset.fogDensity;
      if (blueprint?.lighting?.fog) {
        const fogMap = { none: 0.05, light: 0.2, medium: 0.5, heavy: 0.8 };
        fogDensityFactor = fogMap[blueprint.lighting.fog] ?? preset.fogDensity;
      }
      const weatherKey = weather?.main?.toLowerCase() ?? "";
      if (weatherKey.includes("rain") || weatherKey.includes("drizzle") || weatherKey.includes("thunder")) {
        fogDensityFactor = Math.min(0.85, fogDensityFactor + 0.25);
      } else if (weatherKey.includes("fog") || weatherKey.includes("mist") || weatherKey.includes("haze")) {
        fogDensityFactor = Math.min(0.9, fogDensityFactor + 0.35);
      } else if (weatherKey.includes("snow")) {
        fogDensityFactor = Math.min(0.8, fogDensityFactor + 0.2);
      }
      const fogNear = 18 + (1 - fogDensityFactor) * 8;
      const fogFar = 42 - fogDensityFactor * 10;
      const fog = new THREE.Fog(skyColor, fogNear, fogFar);
      scene.fog = fog;

      camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
      camera.position.set(16, 11, 16);
      camera.lookAt(0, 2, 0);

      let sunIntensity = 1.05;
      if (weatherKey.includes("rain") || weatherKey.includes("drizzle") || weatherKey.includes("thunder")) {
        sunIntensity = 0.65;
      } else if (weatherKey.includes("cloud") || weatherKey.includes("fog") || weatherKey.includes("mist") || weatherKey.includes("haze")) {
        sunIntensity = 0.8;
      } else if (weatherKey.includes("snow")) {
        sunIntensity = 0.9;
      }

      scene.add(new THREE.AmbientLight(0xffffff, 0.65));
      const dir = new THREE.DirectionalLight(0xffffff, sunIntensity);
      dir.position.set(20, 30, 10);
      scene.add(dir);
      const rim = new THREE.HemisphereLight(skyColor, 0x223322, 0.4);
      scene.add(rim);

      // Procedural rolling terrain
      const terrainSegs = 70;
      const terrainGeo = new THREE.PlaneGeometry(44, 44, terrainSegs, terrainSegs);
      terrainGeo.rotateX(-Math.PI / 2);
      const basePositions = Float32Array.from(terrainGeo.attributes.position.array);
      const roughness = preset.terrainRoughness;
      const hasWater = blueprint && blueprint.scene_assets.water_features.length > 0;

      // Helper: terrain height at (x,z) — sample the procedural function
      const heightAt = (x: number, z: number) => {
        let h =
          Math.sin(x * 0.18) * Math.cos(z * 0.21) * 0.9 * roughness +
          Math.sin((x + z) * 0.07) * 0.6 * roughness +
          Math.sin(x * 0.4 + 1.3) * 0.15 * roughness;

        if (hasWater) {
          // Carve out a river bed along z = -2 to 2
          const distFromRiver = Math.abs(z);
          if (distFromRiver < 6) {
            h -= (6 - distFromRiver) * 0.35;
          }
        }
        return h;
      };

      // Bake rolling height variation into base positions
      for (let i = 0; i < basePositions.length; i += 3) {
        const x = basePositions[i];
        const z = basePositions[i + 2];
        const h = heightAt(x, z);
        basePositions[i + 1] = h;
        (terrainGeo.attributes.position.array as Float32Array)[i + 1] = h;
      }
      terrainGeo.attributes.position.needsUpdate = true;
      terrainGeo.computeVertexNormals();

      // Terrain material and color (drastic ground shifts)
      let groundColor = new THREE.Color().setHSL(groundHueVal, 0.35, 0.3);
      if (paletteColors.length >= 3) {
        groundColor = paletteColors[2];
      } else {
        if (parsedBiome === "alpine") {
          groundColor.setHex(0xe8ecef); // snowy white/grey ground
        } else if (parsedBiome === "rainforest") {
          groundColor.setHex(0x133815); // rich jungle moss
        } else if (parsedBiome === "wetland") {
          groundColor.setHex(0x221e1a); // dark wet mud
        } else if (parsedBiome === "dry") {
          groundColor.setHex(0xcca67c); // dry savanna sand
        } else {
          groundColor.setHex(0x3e281b); // brown pine needle dirt
        }
      }

      const terrainMat = new THREE.MeshStandardMaterial({
        color: groundColor,
        roughness: 1,
        flatShading: true,
      });
      const terrain = new THREE.Mesh(terrainGeo, terrainMat);
      scene.add(terrain);
      disposables.push(terrainGeo, terrainMat);

      // Water plane if water features are present
      if (hasWater) {
        const waterGeo = new THREE.PlaneGeometry(44, 12);
        waterGeo.rotateX(-Math.PI / 2);
        const waterMat = new THREE.MeshStandardMaterial({
          color: parsedBiome === "wetland" ? 0x1f3c3d : 0x4a90e2, // dark green swamp water vs bright blue
          transparent: true,
          opacity: 0.7,
          roughness: 0.05,
          metalness: 0.9,
        });
        const water = new THREE.Mesh(waterGeo, waterMat);
        water.position.set(0, -0.6, 0); // place slightly lower than default ground level
        scene.add(water);
        disposables.push(waterGeo, waterMat);
      }

      // Determine tree types and allocations
      interface TreeTypeConfig {
        name: string;
        count: number;
        leafWidth: number;
        leafHeight: number;
        leafColor: THREE.Color;
        heightRange: [number, number];
      }

      const treeConfigs: TreeTypeConfig[] = [];
      // Seed the scene so different locations produce different (but stable) layouts.
      const seedSource =
        seedKey ??
        (blueprint
          ? JSON.stringify({
              region: blueprint.location_profile.region_name,
              biome: blueprint.location_profile.biome,
              habitat: blueprint.location_profile.habitat_type,
              water: blueprint.scene_assets?.water_features ?? [],
              trees: (blueprint.scene_assets?.trees ?? []).map((t) => t.type),
            })
          : `${parsedBiome}:${adjustedTrees}:${healthScore}`);
      let seed = hashStringToSeed(seedSource);
      const rand = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      const blueprintTreeList = blueprint?.scene_assets?.trees;
      const blueprintDefinesTrees = Array.isArray(blueprintTreeList);

      if (blueprintTreeList && blueprintTreeList.length > 0) {
        const totalDominancePoints = blueprint.scene_assets.trees.reduce((acc, t) => {
          const pts = t.dominance === "high" ? 6 : t.dominance === "medium" ? 3 : 1;
          return acc + pts;
        }, 0);

        blueprint.scene_assets.trees.forEach((t, idx) => {
          const pts = t.dominance === "high" ? 6 : t.dominance === "medium" ? 3 : 1;
          const proportion = pts / totalDominancePoints;
          const count = Math.round(adjustedTrees * proportion);
          if (count <= 0) return;

          const nameLower = t.type.toLowerCase();
          let leafWidth = 0.85;
          let leafHeight = 1.6;
          
          if (
            nameLower.includes("pine") ||
            nameLower.includes("fir") ||
            nameLower.includes("conifer") ||
            nameLower.includes("hemlock") ||
            nameLower.includes("pinus")
          ) {
            leafWidth = 0.55;
            leafHeight = 2.1;
          } else if (
            nameLower.includes("rhododendron") ||
            nameLower.includes("oak") ||
            nameLower.includes("broadleaf") ||
            nameLower.includes("sal") ||
            nameLower.includes("ficus")
          ) {
            leafWidth = 1.1;
            leafHeight = 1.35;
          }

          let leafColor = new THREE.Color().setHSL(leafHueVal + ((healthScore - 50) / 100) * 0.04, 0.55, 0.34);
          if (paletteColors.length > 0) {
            const colIndex = idx % paletteColors.length;
            leafColor = paletteColors[colIndex].clone().multiplyScalar(0.9);
          } else {
            const shift = idx * 0.035;
            leafColor.setHSL((preset.leafHue + shift) % 1.0, 0.55, 0.34);
          }

          treeConfigs.push({
            name: t.type,
            count,
            leafWidth,
            leafHeight,
            leafColor,
            heightRange: t.height_m || [10, 25],
          });
        });
      }

      // Default fallback config based on normalized biome
      if (treeConfigs.length === 0 && !blueprintDefinesTrees) {
        const leafHue = preset.leafHue + ((healthScore - 50) / 100) * 0.04;
        let lWidth = 0.85;
        let lHeight = 1.6;
        if (parsedBiome === "alpine") {
          lWidth = 0.55;
          lHeight = 2.2;
        } else if (parsedBiome === "rainforest") {
          lWidth = 1.15;
          lHeight = 1.3;
        }

        treeConfigs.push({
          name: "Default Tree",
          count: adjustedTrees,
          leafWidth: lWidth,
          leafHeight: lHeight,
          leafColor: new THREE.Color().setHSL(leafHue, 0.55, 0.34),
          heightRange: parsedBiome === "alpine" ? [12, 28] : [10, 25],
        });
      }

      // Create geometry & materials for trunks
      const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
      const trunkMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.08, 0.4, 0.18),
        roughness: 0.9,
      });
      disposables.push(trunkGeo, trunkMat);

      // Instanced meshes per tree config
      interface TreeGroup {
        trunks: THREE.InstancedMesh;
        leaves: THREE.InstancedMesh;
        config: TreeTypeConfig;
        count: number;
      }

      const treeGroups: TreeGroup[] = [];
      treeConfigs.forEach((config) => {
        const leafGeo = new THREE.ConeGeometry(config.leafWidth, config.leafHeight, 8);
        const leafMat = new THREE.MeshStandardMaterial({
          color: config.leafColor,
          roughness: 0.8,
          flatShading: true,
        });
        disposables.push(leafGeo, leafMat);

        const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, config.count);
        const leaves = new THREE.InstancedMesh(leafGeo, leafMat, config.count);
        scene!.add(trunks);
        scene!.add(leaves);

        treeGroups.push({
          trunks,
          leaves,
          config,
          count: config.count,
        });
      });

      // Clustered placement: 6 cluster seeds + scatter
      const clusters: Array<{ x: number; z: number; r: number }> = [];
      for (let c = 0; c < 6; c++) {
        const angle = rand() * Math.PI * 2;
        const dist = 3 + rand() * 11;
        clusters.push({ x: Math.cos(angle) * dist, z: Math.sin(angle) * dist, r: 3 + rand() * 4 });
      }

      interface TreeInstance {
        groupIndex: number;
        localIndex: number;
        x: number;
        z: number;
        s: number;
        phase: number;
        sway: number;
        leafHeight: number;
      }

      const treeInstances: TreeInstance[] = [];
      const dummy = new THREE.Object3D();

      treeGroups.forEach((group, groupIdx) => {
        for (let localIdx = 0; localIdx < group.count; localIdx++) {
          let x: number, z: number;
          if (rand() < 0.78) {
            const c = clusters[Math.floor(rand() * clusters.length)];
            const a = rand() * Math.PI * 2;
            const r = Math.sqrt(rand()) * c.r;
            x = c.x + Math.cos(a) * r;
            z = c.z + Math.sin(a) * r;
          } else {
            const a = rand() * Math.PI * 2;
            const r = 2 + Math.sqrt(rand()) * 16;
            x = Math.cos(a) * r;
            z = Math.sin(a) * r;
          }

          if (hasWater && Math.abs(z) < 3.5) {
            z += z >= 0 ? 3.0 : -3.0;
          }

          const heightVal = group.config.heightRange[0] + rand() * (group.config.heightRange[1] - group.config.heightRange[0]);
          const s = (heightVal / 18) * (0.7 + rand() * 0.4);
          const phase = rand() * Math.PI * 2;
          const sway = 0.025 + rand() * 0.04;

          treeInstances.push({
            groupIndex: groupIdx,
            localIndex: localIdx,
            x,
            z,
            s,
            phase,
            sway,
            leafHeight: group.config.leafHeight,
          });

          const y = heightAt(x, z);
          dummy.position.set(x, y + 0.5 * s, z);
          dummy.scale.set(s, s, s);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          group.trunks.setMatrixAt(localIdx, dummy.matrix);

          dummy.position.set(x, y + (1.0 + group.config.leafHeight * 0.45) * s, z);
          dummy.updateMatrix();
          group.leaves.setMatrixAt(localIdx, dummy.matrix);
        }
        group.trunks.instanceMatrix.needsUpdate = true;
        group.leaves.instanceMatrix.needsUpdate = true;
      });

      // Rock Assets (white boulders for alpine, dark mossy rocks for rainforest)
      if (blueprint && blueprint.scene_assets.rocks_and_decoration.length > 0) {
        const rockGeo = new THREE.DodecahedronGeometry(0.5, 1);
        let rockCol = 0x6e6e6e;
        if (parsedBiome === "alpine") rockCol = 0xd5dbdb; // light snowy stone
        else if (parsedBiome === "rainforest") rockCol = 0x273727; // dark green mossy stone

        const rockMat = new THREE.MeshStandardMaterial({
          color: rockCol,
          roughness: 0.95,
          flatShading: true,
        });
        const rockCount = 18;
        const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);

        for (let i = 0; i < rockCount; i++) {
          const rx = (rand() - 0.5) * 36;
          const rz = hasWater ? (rand() >= 0.5 ? 4.5 + rand() * 4 : -4.5 - rand() * 4) : (rand() - 0.5) * 36;
          const ry = heightAt(rx, rz) - 0.05;
          const scale = 0.4 + rand() * 0.9;
          dummy.position.set(rx, ry, rz);
          dummy.scale.set(scale, scale * (0.8 + rand() * 0.5), scale);
          dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, 0);
          dummy.updateMatrix();
          rocks.setMatrixAt(i, dummy.matrix);
        }
        rocks.instanceMatrix.needsUpdate = true;
        scene.add(rocks);
        disposables.push(rockGeo, rockMat, rocks);
      }

      // Animated Creatures (Birds) according to Biome
      const creatureCount = Math.min(24, Math.max(5, birdCount));
      let birdColor1 = 0x3e2723; // default eagle brown
      let birdColor2 = 0x4e342e;
      let flapSpeedBase = 12;
      let scaleBase = 1.0;

      if (parsedBiome === "rainforest") {
        birdColor1 = 0x00e676; // tropical green
        birdColor2 = 0xff3d00; // tropical red
        flapSpeedBase = 16;
        scaleBase = 0.85;
      } else if (parsedBiome === "alpine") {
        birdColor1 = 0xd7ccc8; // snow eagle grey
        birdColor2 = 0x5d4037;
        flapSpeedBase = 6; // slow soaring
        scaleBase = 1.5; // larger size
      } else if (parsedBiome === "wetland") {
        birdColor1 = 0xe0f7fa; // egret white
        birdColor2 = 0x80deea; // light blue
        flapSpeedBase = 9;
        scaleBase = 1.2;
      } else if (parsedBiome === "dry") {
        birdColor1 = 0xffb74d; // desert orange
        birdColor2 = 0x8d6e63; // sandy brown
        flapSpeedBase = 14;
        scaleBase = 0.75;
      } else {
        birdColor1 = 0xfdd835; // canary yellow
        birdColor2 = 0x43a047; // songbird green
        flapSpeedBase = 15;
        scaleBase = 0.8;
      }

      const bodyGeo = new THREE.ConeGeometry(0.08 * scaleBase, 0.3 * scaleBase, 4);
      bodyGeo.rotateX(Math.PI / 2); // point forward
      const wingGeo = new THREE.BufferGeometry();
      const wWidth = 0.5 * scaleBase;
      const wLength = 0.22 * scaleBase;
      const wingVertices = new Float32Array([
        0, 0, 0,
        wWidth, 0, -0.08 * scaleBase,
        0, 0, -wLength,
      ]);
      wingGeo.setAttribute("position", new THREE.BufferAttribute(wingVertices, 3));
      wingGeo.computeVertexNormals();

      const bodyMat = new THREE.MeshStandardMaterial({ color: birdColor1, roughness: 0.8 });
      const wingMat = new THREE.MeshStandardMaterial({ color: birdColor2, roughness: 0.8, side: THREE.DoubleSide });
      disposables.push(bodyGeo, wingGeo, bodyMat, wingMat);

      for (let i = 0; i < creatureCount; i++) {
        const group = new THREE.Group();

        // Body
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        group.add(bodyMesh);

        // Left wing
        const wingL = new THREE.Mesh(wingGeo, wingMat);
        wingL.position.set(-0.04 * scaleBase, 0, 0.04 * scaleBase);
        wingL.scale.x = -1;
        group.add(wingL);

        // Right wing
        const wingR = new THREE.Mesh(wingGeo, wingMat);
        wingR.position.set(0.04 * scaleBase, 0, 0.04 * scaleBase);
        group.add(wingR);

        scene.add(group);

        const radius = 6 + rand() * 12;
        const speed = (0.25 + rand() * 0.35) * (parsedBiome === "alpine" ? 0.6 : 1.2);
        const heightOffset = 5 + rand() * 7;
        const angle = rand() * Math.PI * 2;
        const flapSpeed = flapSpeedBase + (rand() - 0.5) * 3;

        creatures.push({
          mesh: group,
          wingL,
          wingR,
          speed,
          radius,
          heightOffset,
          angle,
          flapSpeed,
          yOffset: rand() * 10
        });
      }

      // Floating particles with Biome specific colors
      const particleCount = 420;
      const pGeo = new THREE.BufferGeometry();
      const pPos = new Float32Array(particleCount * 3);
      const pBase = new Float32Array(particleCount * 3);
      for (let i = 0; i < particleCount; i++) {
        const x = (Math.random() - 0.5) * 38;
        const y = Math.random() * 10 + 1;
        const z = (Math.random() - 0.5) * 38;
        pPos[i * 3] = pBase[i * 3] = x;
        pPos[i * 3 + 1] = pBase[i * 3 + 1] = y;
        pPos[i * 3 + 2] = pBase[i * 3 + 2] = z;
      }
      pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));

      let pColor = 0xffffff;
      let pSize = 0.11;
      if (parsedBiome === "wetland") {
        pColor = 0x99ff33; // glowing yellow-green swamp fireflies
        pSize = 0.15;
      } else if (parsedBiome === "dry") {
        pColor = 0xffd54f; // golden sandy dust
      } else if (parsedBiome === "alpine") {
        pSize = 0.18; // larger white snowflakes
      }

      const pMat = new THREE.PointsMaterial({
        color: pColor,
        size: pSize,
        transparent: true,
        opacity: 0.55 + fogDensityFactor * 0.3,
        depthWrite: false,
      });
      const particles = new THREE.Points(pGeo, pMat);
      scene.add(particles);
      disposables.push(pGeo, pMat);

      // Optional live audio analyser
      try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (Ctx && audioElement) {
          audioCtx = new Ctx();
          analyser = audioCtx!.createAnalyser();
          analyser.fftSize = 128;
          freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
          try {
            const src = audioCtx!.createMediaElementSource(audioElement);
            src.connect(analyser);
            analyser.connect(audioCtx!.destination);
          } catch {
            analyser = null;
            freqData = null;
          }
        }
      } catch {
        audioCtx = null;
        analyser = null;
      }

      const clock = new THREE.Clock();
      let cameraAngle = Math.PI / 4;
      let smoothIntensity = 0;

      const animate = () => {
        if (disposed || !renderer || !scene || !camera) return;
        frameId = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();
        const dt = clock.getDelta();

        // Audio intensity
        let intensity = propsRef.current.audioIntensity;
        if (analyser && freqData) {
          analyser.getByteFrequencyData(freqData as unknown as Uint8Array<ArrayBuffer>);
          let sum = 0;
          for (let i = 0; i < freqData.length; i++) sum += freqData[i];
          intensity = Math.min(1, (sum / (freqData.length * 255)) * 1.8);
        }
        smoothIntensity += (intensity - smoothIntensity) * 0.12;
        const wind = 0.35 + smoothIntensity * 0.9;

        // Terrain subtle wave
        const pos = terrainGeo.attributes.position as THREE.BufferAttribute;
        const amp = 0.05 + smoothIntensity * 0.35;
        for (let i = 0; i < pos.count; i++) {
          const ix = i * 3;
          const x = basePositions[ix];
          const z = basePositions[ix + 2];
          const d = Math.sqrt(x * x + z * z);
          const w = Math.sin(d * 0.3 - t * 1.2) * amp * Math.max(0, 1 - d / 26);
          (pos.array as Float32Array)[ix + 1] = basePositions[ix + 1] + w;
        }
        pos.needsUpdate = true;

        // Wind sway for each tree group
        treeInstances.forEach((ti) => {
          const group = treeGroups[ti.groupIndex];
          const localIdx = ti.localIndex;

          const swayX = Math.sin(t * 1.3 + ti.phase) * ti.sway * wind;
          const swayZ = Math.cos(t * 1.0 + ti.phase * 1.3) * ti.sway * wind * 0.7;
          const y = heightAt(ti.x, ti.z);

          // trunk
          dummy.position.set(ti.x, y + 0.5 * ti.s, ti.z);
          dummy.scale.set(ti.s, ti.s, ti.s);
          dummy.rotation.set(swayX * 0.3, 0, swayZ * 0.3);
          dummy.updateMatrix();
          group.trunks.setMatrixAt(localIdx, dummy.matrix);

          // leaves
          dummy.position.set(
            ti.x + swayX * 1.2,
            y + (1.0 + ti.leafHeight * 0.45) * ti.s,
            ti.z + swayZ * 1.2
          );
          dummy.rotation.set(swayX, 0, swayZ);
          dummy.updateMatrix();
          group.leaves.setMatrixAt(localIdx, dummy.matrix);
        });

        treeGroups.forEach((group) => {
          group.trunks.instanceMatrix.needsUpdate = true;
          group.leaves.instanceMatrix.needsUpdate = true;
        });

        // Animate creatures (birds flapping and flying)
        creatures.forEach((c) => {
          c.angle += dt * c.speed;
          
          const ox = Math.cos(c.angle) * c.radius;
          const oz = Math.sin(c.angle) * c.radius;
          const baseHeight = heightAt(ox, oz);
          const oy = baseHeight + c.heightOffset + Math.sin(t * 1.4 + c.yOffset) * 1.0;

          c.mesh.position.set(ox, oy, oz);

          // Face movement direction
          const nextAngle = c.angle + 0.1;
          const tx = Math.cos(nextAngle) * c.radius;
          const tz = Math.sin(nextAngle) * c.radius;
          const ty = heightAt(tx, tz) + c.heightOffset + Math.sin((t + 0.1) * 1.4 + c.yOffset) * 1.0;
          c.mesh.lookAt(tx, ty, tz);

          // flapping wings
          const flap = Math.sin(t * c.flapSpeed) * 0.7;
          c.wingL.rotation.z = -flap;
          c.wingR.rotation.z = flap;
        });

        // Particles drift
        const pArr = pGeo.attributes.position.array as Float32Array;
        for (let i = 0; i < particleCount; i++) {
          const ix = i * 3;
          if (parsedBiome === "alpine") {
            // Snowy particles fall downwards
            pArr[ix + 1] -= dt * (1.2 + Math.sin(t * 0.5 + i) * 0.3);
            pArr[ix] += Math.sin(t * 0.35 + i) * 0.015;
            if (pArr[ix + 1] < -1) {
              pArr[ix + 1] = 11;
              pArr[ix] = (Math.random() - 0.5) * 38;
            }
          } else {
            // Drift/float
            pArr[ix] = pBase[ix] + Math.sin(t * 0.35 + i) * (0.5 + smoothIntensity * 0.8);
            pArr[ix + 1] = pBase[ix + 1] + Math.sin(t * 0.55 + i * 0.3) * (0.35 + smoothIntensity * 1.1);
            pArr[ix + 2] = pBase[ix + 2] + Math.cos(t * 0.28 + i * 0.7) * (0.5 + smoothIntensity * 0.8);
          }
        }
        pGeo.attributes.position.needsUpdate = true;

        // Custom pulsing opacity for wetland fireflies
        if (parsedBiome === "wetland") {
          pMat.opacity = (0.35 + fogDensityFactor * 0.2 + smoothIntensity * 0.2) * (0.55 + Math.sin(t * 3.5) * 0.45);
        } else {
          pMat.opacity = 0.45 + fogDensityFactor * 0.25 + smoothIntensity * 0.2;
        }

        // Fog pulse
        fog.near = fogNear - smoothIntensity * 5;
        fog.far = fogFar - smoothIntensity * 6;

        // Cinematic camera
        cameraAngle += dt * 0.08;
        const radius = 20 + Math.sin(t * 0.12) * 0.6;
        camera.position.x = Math.cos(cameraAngle) * radius + Math.sin(t * 0.4) * 0.4;
        camera.position.z = Math.sin(cameraAngle) * radius + Math.cos(t * 0.35) * 0.4;
        camera.position.y = 10.5 + Math.sin(t * 0.22) * 0.6;
        camera.lookAt(Math.sin(t * 0.1) * 0.4, 2 + Math.cos(t * 0.18) * 0.2, 0);

        renderer.render(scene, camera);
      };
      animate();

      const onResize = () => {
        if (!renderer || !camera || !container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(container);

      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        ro.disconnect();
        if (audioCtx) {
          try {
            audioCtx.close();
          } catch {}
        }
        creatures.forEach((c) => {
          scene?.remove(c.mesh);
        });
        disposables.forEach((d) => {
          try {
            d.dispose();
          } catch {}
        });
        if (renderer) {
          renderer.dispose();
          if (renderer.domElement.parentNode === container) {
            container.removeChild(renderer.domElement);
          }
        }
      };
    } catch (err) {
      console.error("ForestScene3D init failed:", err);
      setFailed(true);
      return () => {
        if (renderer) {
          try {
            renderer.dispose();
          } catch {}
        }
      };
    }
  }, [adjustedTrees, healthScore, parsedBiome, audioElement, blueprint]);

  const sceneLabel = blueprint?.location_profile?.habitat_type || preset.label;
  const moodSuffix = blueprint?.location_profile?.biodiversity_mood ? ` · ${blueprint.location_profile.biodiversity_mood} mood` : "";

  return (
    <div className="relative w-full h-[460px] rounded-3xl overflow-hidden border border-border bg-gradient-to-b from-sky-200 to-emerald-100 shadow-lg">
      <div
        id="forest-3d-container"
        ref={containerRef}
        className="absolute inset-0"
        style={{ position: "absolute", inset: 0, overflow: "hidden" }}
      />
      {failed && <ForestFallback />}
      <div className="absolute top-4 left-4 bg-card/85 backdrop-blur rounded-xl px-3 py-2 border border-border text-xs pointer-events-none max-w-[280px]">
        <p className="font-display text-sm font-semibold flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
          3D Forest Scene
        </p>
        <p className="text-muted-foreground truncate">
          {failed ? "Static preview mode" : `${sceneLabel}${moodSuffix}`}
        </p>
        {blueprint && (
          <p className="text-[10px] text-primary/70 mt-1 truncate">
            Region: {blueprint.location_profile.region_name}
          </p>
        )}
      </div>
      <div className="absolute bottom-4 right-4 flex gap-2 pointer-events-none flex-wrap max-w-[80%]">
        <Badge label="Trees" value={adjustedTrees} />
        <Badge label="Birds in flight" value={Math.min(birdCount, 24)} />
        <Badge label="Range" value={`${forestRangeKm2} km²`} />
        {blueprint && <Badge label="AI Confidence" value={`${Math.round(blueprint.confidence.overall * 100)}%`} />}
      </div>
    </div>
  );
}

function ForestFallback() {
  return (
    <div
      className="absolute inset-0 animate-pulse"
      style={{
        background:
          "radial-gradient(ellipse at 50% 80%, oklch(0.55 0.12 150) 0%, oklch(0.35 0.08 160) 45%, oklch(0.2 0.05 200) 100%)",
      }}
      aria-label="Forest visualization unavailable"
    />
  );
}

function Badge({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card/85 backdrop-blur rounded-xl px-3 py-1.5 border border-border text-xs">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}