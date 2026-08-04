import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { PDFParse } from "pdf-parse";
import { runVisionOCR, structureText, generateFlashcards } from "./ollama-client";
import { generateDocumentHtml } from "./generate-html";

const execFileAsync = promisify(execFile);

function looksLikeRealText(text: string, minLetters = 20): boolean {
    const letters = text.replace(/[^\p{L}]/gu, "");
    return letters.length >= minLetters;
}

async function renderPdfFirstPageBase64(pdfPath: string): Promise<string> {
    const outPrefix = path.join(os.tmpdir(), `pdf-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await execFileAsync("pdftoppm", ["-png", "-r", "200", "-f", "1", "-l", "1", pdfPath, outPrefix]);

    const outPath = `${outPrefix}-1.png`;
    const buffer = fs.readFileSync(outPath);
    fs.unlinkSync(outPath);

    return buffer.toString("base64");
}

export async function processDocument(job: any) {
    const isImage = /\.(jpg|jpeg|png)$/i.test(job.file_path);
    const isPdf = /\.pdf$/i.test(job.file_path);

    let rawText: string;

    if (isImage) {
        const base64 = fs.readFileSync(job.file_path).toString("base64");
        rawText = await runVisionOCR(base64);
    } else if (isPdf) {
        const buffer = fs.readFileSync(job.file_path);
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        rawText = result.text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, "").trim();

        if (!looksLikeRealText(rawText)) {
            const imageBase64 = await renderPdfFirstPageBase64(job.file_path);
            rawText = (await runVisionOCR(imageBase64)).trim();

            if (!looksLikeRealText(rawText)) {
                throw new Error("PDF contains no extractable text, neither via text layer nor vision OCR fallback");
            }
        }
    } else {
        throw new Error(`Unsupported file type: ${job.file_path}`);
    }

    const structured = await structureText(rawText);
    const finalTitle = (job.user_title && job.user_title.trim()) || structured.title;
    const finalSummary = (job.user_summary && job.user_summary.trim()) || structured.summary;
    const confidence = Math.max(0, Math.min(100, Math.round(structured.confidence)));

    let flashcards: { question: string; answer: string }[] = [];
    try {
        flashcards = await generateFlashcards(rawText, finalSummary);
    } catch (err: any) {
        console.error(`[worker] flashcard generation failed for ${job.file_path}:`, err.message);
    }

    const htmlPath = generateDocumentHtml({
        id: job.id,
        title: finalTitle,
        folder: job.folder,
        uploadDate: job.detected_at,
        tags: structured.tags,
        summary: finalSummary,
        rawText,
        confidence,
    });

    return {
        title: finalTitle,
        docDate: structured.docDate,
        tags: structured.tags,
        summary: finalSummary,
        rawText,
        htmlPath,
        confidence,
        flashcards,
    };
}
