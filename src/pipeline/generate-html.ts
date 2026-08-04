import fs from "fs";
import path from "path";

const TEMPLATE_PATH = path.resolve(__dirname, "templates/document.html");
const OUTPUT_DIR = path.resolve(__dirname, "../../data/generated");

interface DocumentData {
    id: number;
    title: string;
    folder: string;
    uploadDate: string;
    tags: string[];
    summary: string;
    rawText: string;
    confidence?: number;
}

function buildConfidenceBadge(confidence?: number): string {
    if (typeof confidence !== "number" || Number.isNaN(confidence)) return "";

    let level = "high";
    if (confidence < 60) level = "low";
    else if (confidence < 85) level = "medium";

    return `<span class="confidence-badge confidence-badge--${level}" title="How confident the AI is that this text was recognized correctly">
        <i class="fa-solid fa-wand-magic-sparkles"></i> OCR confidence: ${confidence}%
    </span>`;
}

export function generateDocumentHtml(doc: DocumentData): string {
    const template = fs.readFileSync(TEMPLATE_PATH, "utf-8");

    const tagsHtml = doc.tags.map((t) => `<li> <a href="?q=${encodeURIComponent(t)}">${escapeHtml(t)}</a></li>`).join("");
    const contentHtml = escapeHtml(doc.rawText)
        .split("\n\n")
        .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
        .join("\n");
    const confidenceBadgeHtml = buildConfidenceBadge(doc.confidence);

    const html = template
        .replaceAll("{{id}}", String(doc.id))
        .replaceAll("{{title}}", escapeHtml(doc.title))
        .replaceAll("{{folder}}", escapeHtml(doc.folder))
        .replaceAll("{{uploadDate}}", doc.uploadDate)
        .replaceAll("{{uploadDateFormatted}}", formatDate(doc.uploadDate))
        .replaceAll("{{tagsHtml}}", tagsHtml)
        .replaceAll("{{summary}}", escapeHtml(doc.summary))
        .replaceAll("{{contentHtml}}", contentHtml)
        .replaceAll("{{confidenceBadgeHtml}}", confidenceBadgeHtml);

    const outPath = path.join(OUTPUT_DIR, doc.folder, `${doc.id}.html`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, "utf-8");

    return path.join("generated", doc.folder, `${doc.id}.html`);
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" });
}
