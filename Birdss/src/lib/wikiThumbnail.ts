// Wikipedia summary fetcher used by multiple components for thumbnail/extract/url.
// Pulled out of BirdSpeciesGallery so trees, food sources, etc. can reuse the same path.

export interface WikiInfo {
  thumb?: string;
  extract?: string;
  url?: string;
}

const cache = new Map<string, WikiInfo>();

export async function fetchWikiInfo(title: string): Promise<WikiInfo> {
  const key = title.trim();
  if (!key) return {};
  if (cache.has(key)) return cache.get(key)!;
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}?redirect=true`,
    );
    if (!res.ok) {
      const empty: WikiInfo = {};
      cache.set(key, empty);
      return empty;
    }
    const data = await res.json();
    const info: WikiInfo = {
      thumb: data.thumbnail?.source,
      extract: data.extract,
      url: data.content_urls?.desktop?.page,
    };
    cache.set(key, info);
    return info;
  } catch {
    const empty: WikiInfo = {};
    cache.set(key, empty);
    return empty;
  }
}

// Take a string like "Shorea robusta (sal)" and produce candidate Wikipedia titles
// in priority order: scientific name first (more unique), then the parenthetical
// common name, then the raw string.
export function wikiCandidatesFromLabel(label: string): string[] {
  const trimmed = label.trim();
  const candidates: string[] = [];
  const parenMatch = trimmed.match(/^([^(]+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    candidates.push(parenMatch[1].trim()); // before the parens (often scientific name)
    candidates.push(parenMatch[2].trim()); // inside the parens (often common name)
  }
  candidates.push(trimmed);
  // Dedupe while preserving order.
  return Array.from(new Set(candidates.filter(Boolean)));
}

export async function fetchBestWikiInfo(label: string): Promise<WikiInfo> {
  for (const candidate of wikiCandidatesFromLabel(label)) {
    const info = await fetchWikiInfo(candidate);
    if (info.thumb) return info;
  }
  // No thumbnail anywhere — still return the first non-empty result so we have URL/extract.
  for (const candidate of wikiCandidatesFromLabel(label)) {
    const info = await fetchWikiInfo(candidate);
    if (info.url || info.extract) return info;
  }
  return {};
}
