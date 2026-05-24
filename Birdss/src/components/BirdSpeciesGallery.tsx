import { useEffect, useState } from "react";
import { Bird, ExternalLink } from "lucide-react";
import type { DetectedSpecies } from "@/lib/birdApi";
import { querySpeciesInfo, type RagSpeciesInfo } from "@/lib/ragApi";

interface WikiInfo {
  thumb?: string;
  extract?: string;
  url?: string;
}

async function fetchWiki(title: string): Promise<WikiInfo> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
    );
    if (!res.ok) return {};
    const data = await res.json();
    return {
      thumb: data.thumbnail?.source,
      extract: data.extract,
      url: data.content_urls?.desktop?.page,
    };
  } catch {
    return {};
  }
}

export function BirdSpeciesGallery({ species }: { species: DetectedSpecies[] }) {
  return (
    <div className="rounded-3xl bg-card border border-border p-6 shadow-soft">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="font-display text-2xl">Identified species</h3>
          <p className="text-sm text-muted-foreground">Reference imagery & info from Wikipedia</p>
        </div>
        <span className="text-xs px-3 py-1 rounded-full bg-forest-canopy/15 text-forest-deep border border-forest-canopy/30">
          {species.length} species
        </span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {species.map((s) => (
          <SpeciesCard key={s.name} species={s} />
        ))}
      </div>
    </div>
  );
}

function SpeciesCard({ species }: { species: DetectedSpecies }) {
  const [info, setInfo] = useState<WikiInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [ragInfo, setRagInfo] = useState<RagSpeciesInfo | null>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragError, setRagError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Try scientific name first (more unique), fall back to common name
    (async () => {
      let res = await fetchWiki(species.scientificName);
      if (!res.thumb) res = { ...(await fetchWiki(species.name)), ...res };
      if (!cancelled) {
        setInfo(res);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [species.name, species.scientificName]);

  useEffect(() => {
    let cancelled = false;
    setRagLoading(true);
    setRagError(null);
    (async () => {
      const res = await querySpeciesInfo(
        species.name,
        species.scientificName,
        species.description ?? null,
      );
      if (!cancelled) {
        if (res) {
          setRagInfo(res);
        } else {
          setRagError("RAG lookup unavailable");
        }
        setRagLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [species.name, species.scientificName]);

  return (
    <article className="group rounded-2xl overflow-hidden border border-border bg-background hover:shadow-soft hover:-translate-y-0.5 transition-all duration-300">
      <div className="aspect-[4/3] bg-gradient-to-br from-forest-canopy/20 to-amber-bird/20 relative overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 animate-pulse bg-muted" />
        ) : info?.thumb ? (
          <img
            src={info.thumb}
            alt={species.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Bird className="h-12 w-12 text-forest-deep/40" />
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="font-medium truncate">{species.name}</h4>
            <p className="text-xs italic text-muted-foreground truncate">
              {species.scientificName}
            </p>
          </div>
          {info?.url && (
            <a
              href={info.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-forest-deep shrink-0"
              aria-label="Open Wikipedia article"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-3 line-clamp-3">
          {species.description ??
            info?.extract ??
            "Reference observation logged from forest audio."}
        </p>
        <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3 text-xs">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            RAG profile
          </p>
          {ragLoading ? (
            <p className="text-muted-foreground">Fetching knowledge base response...</p>
          ) : ragError ? (
            <p className="text-muted-foreground">{ragError}</p>
          ) : ragInfo ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">Name</span>
                  <p className="font-medium">{ragInfo.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Species</span>
                  <p className="font-medium">{ragInfo.species}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Habitat</span>
                  <p className="font-medium">{ragInfo.habitat}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Food</span>
                  <p className="font-medium">{ragInfo.food}</p>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Health</span>
                <p className="font-medium">{ragInfo.health}</p>
              </div>
              {ragInfo.paragraph && <p className="text-muted-foreground">{ragInfo.paragraph}</p>}
              <pre className="rounded-lg bg-background/60 border border-border p-2 overflow-x-auto">
                {JSON.stringify(ragInfo, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-muted-foreground">No RAG data returned.</p>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Confidence</span>
          <span className="font-medium">{Math.round(species.confidence * 100)}%</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-forest-canopy to-amber-bird"
            style={{ width: `${species.confidence * 100}%` }}
          />
        </div>
      </div>
    </article>
  );
}
