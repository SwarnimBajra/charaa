import { useEffect, useRef, useState } from "react";
import { Mic, Square, Upload, FileAudio, Trash2, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  audio: Blob | null;
  onChange: (blob: Blob | null, name?: string) => void;
  onAudioElement?: (el: HTMLAudioElement | null) => void;
}

export function AudioInput({ audio, onChange, onAudioElement }: Props) {
  const [mode, setMode] = useState<"record" | "upload">("record");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);

  // Playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  // Waveform
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => () => stopTimer(), []);

  // Create / revoke object URL for the captured audio
  useEffect(() => {
    if (!audio) {
      setUrl(null);
      setDuration(0);
      setCurrent(0);
      setPlaying(false);
      onAudioElement?.(null);
      return;
    }
    const u = URL.createObjectURL(audio);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [audio]);

  // Wire up audio element + WebAudio analyser for waveform + expose to parent
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !url) return;
    onAudioElement?.(el);

    let analyser: AnalyserNode | null = null;
    let ctx: AudioContext | null = null;
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (Ctx) {
        ctx = new Ctx();
        const src = ctx!.createMediaElementSource(el);
        analyser = ctx!.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        analyser.connect(ctx!.destination);
        analyserRef.current = analyser;
        ctxRef.current = ctx;
      }
    } catch {
      analyser = null;
    }

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const a = analyserRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const g = canvas.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, w, h);
      const bars = 48;
      const gap = 3 * dpr;
      const bw = (w - gap * (bars - 1)) / bars;
      let data: Uint8Array | null = null;
      if (a) {
        data = new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(data as unknown as Uint8Array<ArrayBuffer>);
      }
      const cs = getComputedStyle(document.documentElement);
      const fg = cs.getPropertyValue("--forest-canopy").trim() || "oklch(0.62 0.14 145)";
      g.fillStyle = fg;
      for (let i = 0; i < bars; i++) {
        let v: number;
        if (data) {
          const idx = Math.floor((i / bars) * data.length * 0.7);
          v = data[idx] / 255;
        } else {
          // idle pseudo wave
          v = 0.12 + Math.abs(Math.sin(performance.now() * 0.002 + i * 0.4)) * 0.08;
        }
        const bh = Math.max(2 * dpr, v * h * 0.95);
        g.fillRect(i * (bw + gap), (h - bh) / 2, bw, bh);
      }
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { ctx?.close(); } catch {}
      analyserRef.current = null;
      ctxRef.current = null;
      onAudioElement?.(null);
    };
  }, [url]);

  function stopTimer() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredTypes = [
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/webm;codecs=opus",
        "audio/webm",
      ];
      const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const ext = mimeType.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        onChange(blob, `recording-${Date.now()}.${ext}`);
        setFileName(`live recording · ${elapsed}s`);
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e) {
      alert("Microphone permission denied.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
    stopTimer();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    onChange(f, f.name);
    setFileName(f.name);
  }

  function clear() {
    onChange(null);
    setFileName(null);
    setElapsed(0);
  }

  async function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    try {
      if (ctxRef.current?.state === "suspended") await ctxRef.current.resume();
      if (el.paused) {
        await el.play();
        setPlaying(true);
      } else {
        el.pause();
        setPlaying(false);
      }
    } catch {}
  }

  function fmt(s: number) {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${r.toString().padStart(2, "0")}`;
  }

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-full bg-muted p-1">
        {(["record", "upload"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "px-5 py-2 text-sm font-medium rounded-full transition-all capitalize",
              mode === m ? "bg-card text-foreground shadow-soft" : "text-muted-foreground"
            )}
          >
            {m === "record" ? "Record now" : "Upload file"}
          </button>
        ))}
      </div>

      {mode === "record" ? (
        <div className="flex flex-col items-center gap-6 py-8 rounded-2xl bg-gradient-to-b from-secondary/50 to-transparent border border-border">
          <button
            onClick={recording ? stopRecording : startRecording}
            className={cn(
              "h-24 w-24 rounded-full flex items-center justify-center text-primary-foreground transition-all",
              recording ? "bg-destructive animate-pulse-ring" : "bg-gradient-forest hover:scale-105 shadow-forest"
            )}
          >
            {recording ? <Square className="h-8 w-8 fill-current" /> : <Mic className="h-9 w-9" />}
          </button>

          {recording ? (
            <div className="flex items-end gap-1 h-10">
              {[...Array(20)].map((_, i) => (
                <span
                  key={i}
                  className="w-1.5 bg-primary rounded-full animate-waveform"
                  style={{ animationDelay: `${i * 0.06}s`, height: "100%" }}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {audio ? "Recording captured · tap mic to redo" : "Tap mic to capture forest ambience"}
            </p>
          )}
          {recording && <p className="font-display text-2xl tabular-nums">{elapsed}s</p>}
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-3 py-10 rounded-2xl border-2 border-dashed border-border bg-secondary/30 cursor-pointer hover:bg-secondary/60 transition-colors">
          <Upload className="h-8 w-8 text-primary" />
          <span className="text-sm font-medium">Drop or browse audio file</span>
          <span className="text-xs text-muted-foreground">MP3, WAV, OGG, OPUS (WEBM if server can convert)</span>
          <input
            type="file"
            accept="audio/mpeg,audio/wav,audio/ogg,audio/opus,audio/webm,audio/*"
            className="hidden"
            onChange={onFile}
          />
        </label>
      )}

      {audio && url && (
        <div className="space-y-3 p-4 rounded-2xl bg-card border border-border">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileAudio className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{fileName ?? "audio sample"}</p>
              <p className="text-xs text-muted-foreground">{Math.round(audio.size / 1024)} KB</p>
            </div>
            <Button variant="ghost" size="icon" onClick={clear} aria-label="Remove audio">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="h-14 rounded-xl bg-secondary/40 border border-border overflow-hidden">
            <canvas ref={canvasRef} className="w-full h-full block" />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="h-10 w-10 shrink-0 rounded-full bg-gradient-forest text-primary-foreground flex items-center justify-center shadow-soft hover:opacity-90"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.05}
                value={current}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (audioRef.current) audioRef.current.currentTime = v;
                  setCurrent(v);
                }}
                className="w-full accent-[var(--forest-canopy)]"
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">
              {fmt(current)} / {fmt(duration)}
            </span>
          </div>

          <audio
            ref={audioRef}
            src={url}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            preload="metadata"
            className="hidden"
          />
        </div>
      )}
    </div>
  );
}