import { getAppSettings } from "../db/settings";

function getOllamaSettings() {
    return getAppSettings();
}

export async function isOllamaReachable(): Promise<boolean> {
    try {
        const res = await fetch(`${getOllamaSettings().ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        return res.ok;
    } catch {
        return false;
    }
}

export async function runVisionOCR(imageBase64: string): Promise<string> {
    const settings = getOllamaSettings();
    const res = await fetch(`${settings.ollamaBaseUrl}/api/chat`, {
        method: "POST",
        body: JSON.stringify({
            model: settings.visionModel || settings.textModel || "qwen3.5:9b-q8_0",
            messages: [
                {
                    role: "user",
                    content: "Transcribe all the text in this image verbatim. Return only the recognized text, no comments.",
                    images: [imageBase64],
                },
            ],
            think: false,
            stream: false,
        }),
        signal: AbortSignal.timeout(600_000),
    });
    const data = await res.json();
    return data.message.content as string;
}

export async function structureText(rawText: string): Promise<{
    title: string;
    docDate: string;
    tags: string[];
    summary: string;
    confidence: number;
}> {
    const settings = getOllamaSettings();
    const res = await fetch(`${settings.ollamaBaseUrl}/api/chat`, {
        method: "POST",
        body: JSON.stringify({
            model: settings.textModel || settings.visionModel || "qwen3.5:9b-q8_0",
            messages: [
                {
                    role: "user",
                    content: `Analyze the following text from school study material. The text may contain bullet points, tables, or example content that is NOT the actual topic, but only practice or example material. Pay attention to the overarching heading and the actual subject being taught, not individual bullet points within the text.

Return ONLY a JSON object with the fields:
- title: the actual study topic (usually the first heading in the text)
- docDate (YYYY-MM-DD, if recognizable, otherwise today's date)
- tags (array of 2-5 keywords about the study topic, not about example content)
- summary (2-3 sentences describing what this study material teaches)
- confidence (integer 0-100: how confident you are that the text above was extracted/recognized correctly and without garbled characters, missing words, or OCR artifacts; use a low value for text that looks corrupted, inconsistent, or hard to make sense of, and a high value for clean, coherent text)

Text:\n${rawText}`,
                },
            ],
            think: false,
            format: "json",
            stream: false,
        }),
        signal: AbortSignal.timeout(600_000),
    });
    const data = await res.json();
    return JSON.parse(data.message.content);
}

export async function generateFlashcards(
    rawText: string,
    summary: string,
    count = 8
): Promise<{ question: string; answer: string }[]> {
    const settings = getOllamaSettings();
    const res = await fetch(`${settings.ollamaBaseUrl}/api/chat`, {
        method: "POST",
        body: JSON.stringify({
            model: settings.textModel || settings.visionModel || "qwen3.5:9b-q8_0",
            messages: [
                {
                    role: "user",
                    content: `You are creating spaced-repetition flashcards from a piece of school study material.

Summary of the material: ${summary}

Full text:
${rawText}

Create up to ${count} flashcards that test recall of the actual study topic (not example content, not formatting artifacts). Rules:
- Each question must be answerable from the text alone, and must make sense without seeing the text (no "what does the text say about..." style questions).
- Prefer atomic questions (one fact/concept per card) over questions that bundle multiple facts.
- Answers should be short and precise, not full paragraphs.
- Skip trivial or purely administrative content (page numbers, dates of the worksheet itself, etc.) unless it is the actual learning content.
- If the text does not contain enough substantive content for ${count} good flashcards, return fewer rather than padding with weak ones.

Return ONLY a JSON object with the field:
- flashcards: an array of objects, each with "question" and "answer" string fields`,
                },
            ],
            think: false,
            format: "json",
            stream: false,
        }),
        signal: AbortSignal.timeout(600_000),
    });
    const data = await res.json();
    const parsed = JSON.parse(data.message.content);
    const cards = Array.isArray(parsed?.flashcards) ? parsed.flashcards : [];

    return cards
        .filter((c: any) => typeof c?.question === "string" && typeof c?.answer === "string")
        .map((c: any) => ({ question: c.question.trim(), answer: c.answer.trim() }))
        .filter((c: { question: string; answer: string }) => c.question.length > 0 && c.answer.length > 0)
        .slice(0, count);
}
