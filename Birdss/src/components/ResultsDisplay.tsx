import { TrendingUp, TrendingDown, Minus, Bird, Trees, Activity, MapPinned } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell } from "recharts";
import type { AnalyzeResult } from "@/lib/birdApi";
import { cn } from "@/lib/utils";

const statusStyles: Record<AnalyzeResult["healthStatus"], string> = {
  Healthy: "bg-health-good/15 text-health-good border-health-good/30",
  Moderate: "bg-health-mid/15 text-amber-bird border-health-mid/30",
  Degraded: "bg-health-bad/15 text-health-bad border-health-bad/30",
};

export function ResultsDisplay({ result }: { result: AnalyzeResult }) {
  const TrendIcon = result.trend === "improving" ? TrendingUp : result.trend === "declining" ? TrendingDown : Minus;
  const chartData = result.speciesDetected.map((s) => ({ name: s.name.split(" ")[0], count: s.count }));
  const fhqi = result.fhqi ?? result.biodiversityScore;
  const fhqiStatus = result.fhqiStatus ?? result.healthStatus;

  return (
    <div className="space-y-6">
      {/* Hero score */}
      <div className="rounded-3xl bg-gradient-forest text-primary-foreground p-8 shadow-forest relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_20%_20%,white,transparent_50%)]" />
        <div className="relative grid md:grid-cols-2 gap-6 items-center">
          <div>
            <p className="text-sm uppercase tracking-widest opacity-70">Forest Health Quality Index · FHQI</p>
            <div className="flex items-baseline gap-3 mt-2">
              <span className="font-display text-7xl font-light">{fhqi}</span>
              <span className="text-2xl opacity-60">/100</span>
            </div>
            <div className={cn("inline-flex items-center gap-2 mt-4 px-4 py-1.5 rounded-full border bg-card/10 backdrop-blur",
              "border-white/20")}>
              <TrendIcon className="h-4 w-4" />
              <span className="text-sm font-medium capitalize">{fhqiStatus} · {result.trend}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Metric icon={Bird} label="Species" value={result.speciesDetected.length} />
            <Metric icon={Activity} label="Total birds" value={result.totalBirds} />
            <Metric icon={Trees} label="Forest range" value={`${result.forestRangeKm2} km²`} />
            <Metric icon={MapPinned} label="Forest health" value={`${result.forestHealthIndex}`} />
          </div>
        </div>
      </div>

      {/* Species + chart */}
      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 rounded-3xl bg-card border border-border p-6 shadow-soft">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-2xl">Detected species</h3>
            <span className={cn("text-xs px-3 py-1 rounded-full border", statusStyles[result.healthStatus])}>
              {result.healthStatus}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {result.speciesDetected.map((s) => (
              <li key={s.name} className="py-3 flex items-center gap-4">
                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-forest-canopy/30 to-amber-bird/30 flex items-center justify-center">
                  <Bird className="h-5 w-5 text-forest-deep" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">{s.name}</p>
                    {s.indicator && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent-foreground uppercase tracking-wider">
                        indicator
                      </span>
                    )}
                  </div>
                  <p className="text-xs italic text-muted-foreground truncate">{s.scientificName}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-xl tabular-nums">{s.count}</p>
                  <p className="text-xs text-muted-foreground">{Math.round(s.confidence * 100)}% conf.</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-2 rounded-3xl bg-card border border-border p-6 shadow-soft">
          <h3 className="font-display text-2xl mb-2">Counts</h3>
          <p className="text-sm text-muted-foreground mb-4">Birds estimated per species</p>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "var(--muted)" }}
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}
                />
                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={`oklch(${0.45 + i * 0.06} 0.13 ${145 - i * 8})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Acoustic complexity</span>
              <span className="font-medium">{result.acousticComplexity}/100</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-forest-canopy to-amber-bird"
                style={{ width: `${result.acousticComplexity}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/10 backdrop-blur p-4 border border-white/10">
      <Icon className="h-4 w-4 opacity-70" />
      <p className="font-display text-2xl mt-2">{value}</p>
      <p className="text-xs opacity-70">{label}</p>
    </div>
  );
}
