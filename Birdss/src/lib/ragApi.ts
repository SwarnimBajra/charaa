export interface RagSpeciesInfo {
  name: string;
  species: string;
  habitat: string;
  food: string;
  health: string;
  paragraph?: string;
}

interface RagQueryResponse {
  answer: string;
  sources: string[];
  context_used: number;
  retrieved_chunks: Array<Record<string, unknown>>;
}

const BASE_URL = import.meta.env.VITE_RAG_API_URL ?? "";
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY ?? "";
const GROQ_MODEL = import.meta.env.VITE_GROQ_MODEL ?? "llama3-8b-8192";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

function safeJsonParse(text: string): RagSpeciesInfo | null {
  try {
    const parsed = JSON.parse(text) as RagSpeciesInfo;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.name || !parsed.species) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function queryRag(query: string): Promise<string | null> {
  if (!BASE_URL) return null;
  const res = await fetch(`${BASE_URL}/rag/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: 5, generate: false }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as RagQueryResponse;
  return typeof data.answer === "string" ? data.answer.trim() : null;
}

export async function fetchRagChunks(query: string): Promise<Array<Record<string, unknown>>> {
  if (!BASE_URL) return [];

  const res = await fetch(`${BASE_URL}/rag/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k: 5, generate: false }),
  });

  if (!res.ok) return [];
  const data = (await res.json()) as RagQueryResponse;
  return Array.isArray(data.retrieved_chunks) ? data.retrieved_chunks : [];
}

async function chunksToJson(
  chunks: Array<Record<string, unknown>>,
  name: string,
  scientificName?: string
): Promise<RagSpeciesInfo | null> {
  if (!GROQ_API_KEY) return null;

  const systemPrompt =
    "Convert the retrieved context into a single JSON object with keys: " +
    "name, species, habitat, food, health. Preserve all factual details from the context. " +
    "If the context lacks a field, use \"unknown\" for that field. " +
    "Do not add any keys. Do not wrap in markdown or code fences.";

  const userPrompt =
    `Bird: ${name}${scientificName ? ` (${scientificName})` : ""}. ` +
    `Retrieved Context: ${JSON.stringify(chunks, null, 2)}`;

  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 600,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) return null;

  const parsed = safeJsonParse(answer);
  if (parsed) return parsed;

  const match = answer.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return safeJsonParse(match[0]);
}

async function paragraphToJson(paragraph: string, name: string, scientificName?: string): Promise<RagSpeciesInfo | null> {
  if (!GROQ_API_KEY) return null;

  const systemPrompt =
    "Convert the user paragraph into a single JSON object with keys: " +
    "name, species, habitat, food, health. Preserve all factual details from the paragraph. " +
    "Use concise sentences. Do not add any keys. Do not wrap in markdown or code fences.";

  const userPrompt =
    `Bird: ${name}${scientificName ? ` (${scientificName})` : ""}. ` +
    `Paragraph: ${paragraph}`;

  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 600,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const answer = data.choices?.[0]?.message?.content?.trim();
  if (!answer) return null;

  const parsed = safeJsonParse(answer);
  if (parsed) return { ...parsed, paragraph };

  const match = answer.match(/\{[\s\S]*\}/);
  if (!match) return null;
  const fallback = safeJsonParse(match[0]);
  return fallback ? { ...fallback, paragraph } : null;
}

export async function querySpeciesInfo(
  name: string,
  scientificName?: string,
  existingParagraph?: string | null
): Promise<RagSpeciesInfo | null> {
  if (!BASE_URL) return null;

  const chunks = await fetchRagChunks(
    `Ecological knowledge for ${scientificName ?? name}.`
  );

  if (chunks.length > 0) {
    return chunksToJson(chunks, name, scientificName);
  }

  if (existingParagraph) {
    return paragraphToJson(existingParagraph, name, scientificName);
  }

  return null;
}
