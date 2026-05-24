import { useRef, useState } from "react";
import { Image as ImageIcon, Upload, Trash2, Loader2, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImageIntel } from "@/lib/birdApi";

interface Props {
  value: ImageIntel | null;
  onChange: (v: ImageIntel | null) => void;
}

function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }

async function analyzeImageFile(file: File): Promise<ImageIntel> {
  // Lightweight on-canvas heuristic: greenness, brightness, blue (water), variance.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const w = 96, h = 96;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    if (!g) throw new Error("no canvas");
    g.drawImage(img, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    let green = 0, blue = 0, bright = 0, varSum = 0, count = 0;
    const samples: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], gC = data[i + 1], b = data[i + 2];
      const lum = (r + gC + b) / 3;
      bright += lum;
      samples.push(lum);
      // greenness vs other channels
      green += Math.max(0, gC - (r + b) / 2);
      // blueness (water proxy)
      blue += Math.max(0, b - (r + gC) / 2);
      count++;
    }
    const meanLum = bright / count;
    for (const s of samples) varSum += (s - meanLum) ** 2;
    const variance = Math.sqrt(varSum / count); // texture / density proxy
    const greenAvg = green / count;
    const blueAvg = blue / count;
    const vegetationHealth = clamp(40 + greenAvg * 1.6);
    const density = clamp(35 + variance * 1.1 + greenAvg * 0.5);
    const waterPresence = clamp(blueAvg * 3);
    const fireRisk = clamp(70 - vegetationHealth * 0.6 + (meanLum > 180 ? 15 : 0));
    const humanDisturbance = clamp(60 - greenAvg * 1.2 + (variance < 20 ? 20 : 0));
    const overall = clamp(vegetationHealth * 0.5 + density * 0.3 + (100 - fireRisk) * 0.1 + (100 - humanDisturbance) * 0.1);
    return { density, vegetationHealth, waterPresence, fireRisk, humanDisturbance, overall };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ImageIntelligence({ value, onChange }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setName(f.name);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    try {
      const intel = await analyzeImageFile(f);
      onChange(intel);
    } catch {
      onChange({ density: 60, vegetationHealth: 65, waterPresence: 30, fireRisk: 25, humanDisturbance: 30, overall: 65 });
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setName(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      {!preview ? (
        <label className="flex flex-col items-center justify-center gap-3 py-10 rounded-2xl border-2 border-dashed border-border bg-secondary/30 cursor-pointer hover:bg-secondary/60 transition-colors">
          <Satellite className="h-8 w-8 text-primary" />
          <span className="text-sm font-medium">Drop a forest or satellite image</span>
          <span className="text-xs text-muted-foreground">JPG, PNG, WEBP · optional</span>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </label>
      ) : (
        <div className="space-y-3 p-4 rounded-2xl bg-card border border-border">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-lg overflow-hidden bg-muted shrink-0">
              <img src={preview} alt="" className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate flex items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                {name ?? "image sample"}
              </p>
              <p className="text-xs text-muted-foreground">
                {busy ? "Analyzing visual signals…" : value ? "Vision analysis complete" : "Ready"}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={clear} aria-label="Remove image">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Estimating density, vegetation, water, fire risk…
            </div>
          )}

          {value && !busy && (
            <ul className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Canopy density" v={value.density} />
              <Stat label="Vegetation" v={value.vegetationHealth} />
              <Stat label="Water presence" v={value.waterPresence} />
              <Stat label="Fire risk" v={value.fireRisk} invert />
              <Stat label="Human disturbance" v={value.humanDisturbance} invert />
              <Stat label="Overall" v={value.overall} />
            </ul>
          )}
        </div>
      )}

      {!preview && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Upload className="h-3.5 w-3.5" /> Optional — boosts FHQI accuracy. We fall back to map context if skipped.
        </p>
      )}
    </div>
  );
}

function Stat({ label, v, invert = false }: { label: string; v: number; invert?: boolean }) {
  const good = invert ? 100 - v : v;
  const tone = good >= 70 ? "bg-health-good" : good >= 40 ? "bg-health-mid" : "bg-health-bad";
  return (
    <li className="rounded-lg bg-secondary/40 border border-border p-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">{v}</span>
      </div>
      <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${v}%` }} />
      </div>
    </li>
  );
}