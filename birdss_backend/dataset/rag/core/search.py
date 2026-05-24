import ollama

class Search:
    def __init__(self, llm_model="huihui_ai/qwen2.5-abliterate:7b"):
        self.model = llm_model

    def ask(self, query: str, retrieved_results: list) -> dict:
        """Construct prompt with context and query local Ollama model for answer."""
        context_used = len(retrieved_results)
        context_text = ""
        sources = set()
        
        # Build context blocks containing source filenames or clean species names
        for i, chunk in enumerate(retrieved_results, 1):
            source_file = chunk.get("source_file", "unknown")
            context_text += f"[Document {i} - Source: {source_file}]\n{chunk.get('text', '')}\n\n"
            if "source_file" in chunk:
                sources.add(source_file)

        # High-precision system instructions
        prompt = f"""You are an expert ornithologist specialized in Nepalese birds.
Your task is to answer the user's question using ONLY the retrieved scientific context provided below.

Retrieved Context:
{context_text}

User Question:
{query}

Instructions:
- Base your answer strictly on the facts inside the retrieved context. Do not invent details.
- Cite the sources directly within your answer exactly as they are written in the context blocks above (e.g., "...as observed in Bagmati province [Source: Yellow-bellied Warbler]" or "...as documented in your upload [Source: test_upload_doc.txt]").
- If the context does not contain enough information to answer the question, state: "I don't have enough information to answer that."
- Format your response clearly in standard, readable paragraphs.
"""
        try:
            response = ollama.chat(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                options={"temperature": 0.2}
            )
            answer = response['message']['content'].strip()
        except Exception as e:
            answer = f"Error generating answer with local model: {str(e)}"

        return {
            "answer": answer,
            "sources": list(sources),
            "context_used": context_used
        }