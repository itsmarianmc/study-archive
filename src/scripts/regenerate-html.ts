import { db } from "../db/queue";
import { generateDocumentHtml } from "../pipeline/generate-html";

const docs = db.prepare(`
    SELECT id, folder, filename, title, doc_date, tags, summary, raw_text, detected_at, ocr_confidence
    FROM documents
    WHERE status = 'done'
`).all() as any[];

for (const doc of docs) {
    const tags = JSON.parse(doc.tags);
    const htmlPath = generateDocumentHtml({
        id: doc.id,
        title: doc.title,
        folder: doc.folder,
        uploadDate: doc.detected_at,
        tags,
        summary: doc.summary,
        rawText: doc.raw_text,
        confidence: typeof doc.ocr_confidence === "number" ? doc.ocr_confidence : undefined,
    });
    db.prepare(`UPDATE documents SET html_path = ? WHERE id = ?`).run(htmlPath, doc.id);
    console.log(`Regenerated ${doc.folder}/${doc.id}`);
}
