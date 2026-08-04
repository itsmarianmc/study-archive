import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { WatchedFile } from "../watcher/types";

const DB_PATH = path.resolve(__dirname, "../../data/study-archive.db");
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.resolve(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

const existingColumns = new Set(
    (db.prepare(`PRAGMA table_info(documents)`).all() as { name: string }[]).map((c) => c.name)
);
for (const col of ["user_title", "user_summary", "notes"]) {
    if (!existingColumns.has(col)) {
        db.exec(`ALTER TABLE documents ADD COLUMN ${col} TEXT`);
    }
}
if (!existingColumns.has("ocr_confidence")) {
    db.exec(`ALTER TABLE documents ADD COLUMN ocr_confidence INTEGER`);
}
if (!existingColumns.has("view_count")) {
    db.exec(`ALTER TABLE documents ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`);
}

export function enqueueFile(file: WatchedFile & { userTitle?: string; userSummary?: string; notes?: string }) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO documents (folder, filename, file_path, status, detected_at, user_title, user_summary, notes)
        VALUES (@folder, @filename, @path, 'pending', @detectedAt, @userTitle, @userSummary, @notes)
    `);
    stmt.run({
        folder: file.folder,
        filename: file.filename,
        path: file.path,
        detectedAt: file.detectedAt.toISOString(),
        userTitle: file.userTitle ?? null,
        userSummary: file.userSummary ?? null,
        notes: file.notes ?? null,
    });
}

export function getNextPending() {
    return db
        .prepare(`SELECT * FROM documents WHERE status = 'pending' AND attempts < 5 ORDER BY detected_at ASC LIMIT 1`)
        .get();
}

export function markProcessing(id: number) {
    db.prepare(`UPDATE documents SET status = 'processing', attempts = attempts + 1 WHERE id = ?`).run(id);
}

export function markDone(id: number, data: { title: string; docDate: string; tags: string[]; summary: string; rawText: string; htmlPath: string; confidence?: number; flashcards?: { question: string; answer: string }[] }) {
    db.prepare(`
        UPDATE documents
        SET status = 'done',
            title = COALESCE(NULLIF(user_title, ''), @title),
            doc_date = @docDate, tags = @tags,
            summary = COALESCE(NULLIF(user_summary, ''), @summary),
            raw_text = @rawText, html_path = @htmlPath,
            ocr_confidence = @ocrConfidence,
            processed_at = @processedAt
        WHERE id = @id
    `).run({
        id,
        title: data.title,
        docDate: data.docDate,
        tags: JSON.stringify(data.tags),
        summary: data.summary,
        rawText: data.rawText,
        htmlPath: data.htmlPath,
        ocrConfidence: typeof data.confidence === "number" ? data.confidence : null,
        processedAt: new Date().toISOString(),
    });

    if (data.flashcards && data.flashcards.length > 0) {
        insertSuggestedFlashcards(id, data.flashcards);
    }
}

export function insertSuggestedFlashcards(documentId: number, cards: { question: string; answer: string }[]) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
        INSERT INTO flashcards (document_id, question, answer, box, status, next_review_at, created_at)
        VALUES (@documentId, @question, @answer, 1, 'pending', @now, @now)
    `);
    const insertMany = db.transaction((items: { question: string; answer: string }[]) => {
        for (const card of items) {
            stmt.run({ documentId, question: card.question, answer: card.answer, now });
        }
    });
    insertMany(cards);
}

export function markFailed(id: number, error: string) {
    db.prepare(`UPDATE documents SET status = 'pending', last_error = ? WHERE id = ?`).run(error, id);
}
