import Database from "better-sqlite3";
import path from "path";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");
const DEFAULT_OLLAMA_BASE_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const DEFAULT_VISION_MODEL = process.env.OLLAMA_VISION_MODEL ?? "qwen3.5:9b-q8_0";
const DEFAULT_TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL ?? DEFAULT_VISION_MODEL;
const DEFAULT_NOTION_TOKEN = process.env.NOTION_TOKEN ?? "";
const DEFAULT_API_PASSWORD = process.env.API_PASSWORD ?? process.env.SHORTCUT_API_PASSWORD ?? "";
const DEFAULT_NOTION_ENABLED = true;

let dbInstance: Database.Database | null = null;
let writableDbInstance: Database.Database | null = null;

const SETTINGS_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
`;

type SettingKey = "ollama_base_url" | "vision_model" | "text_model" | "notion_token" | "api_password" | "notion_enabled";

export interface AppSettings {
    ollamaBaseUrl: string;
    visionModel: string;
    textModel: string;
    notionToken: string;
    apiPassword: string;
    notionEnabled: boolean;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
    ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
    visionModel: DEFAULT_VISION_MODEL,
    textModel: DEFAULT_TEXT_MODEL,
    notionToken: DEFAULT_NOTION_TOKEN,
    apiPassword: DEFAULT_API_PASSWORD,
    notionEnabled: DEFAULT_NOTION_ENABLED,
};

function ensureSettingsSchema(db: Database.Database) {
    db.exec(SETTINGS_TABLE_SQL);
}

function getDb(): Database.Database {
    if (!dbInstance) {
        dbInstance = new Database(path.join(DATA_ROOT, "study-archive.db"), { readonly: true, fileMustExist: true });
        dbInstance.pragma("journal_mode = WAL");
    }
    return dbInstance;
}

function getWritableDb(): Database.Database {
    if (!writableDbInstance) {
        writableDbInstance = new Database(path.join(DATA_ROOT, "study-archive.db"), { fileMustExist: true });
        writableDbInstance.pragma("journal_mode = WAL");
        writableDbInstance.pragma("foreign_keys = ON");
        ensureSettingsSchema(writableDbInstance);
    }
    ensureSettingsSchema(writableDbInstance);
    return writableDbInstance;
}

function readSetting(db: Database.Database, key: SettingKey): string | undefined {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value?: string } | undefined;
    return row?.value;
}

function writeSetting(db: Database.Database, key: SettingKey, value: string) {
    db.prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value, new Date().toISOString());
}

function mapSettings(settings: Partial<AppSettings>): Partial<Record<SettingKey, string>> {
    const mapped: Partial<Record<SettingKey, string>> = {};
    if (Object.prototype.hasOwnProperty.call(settings, "ollamaBaseUrl")) mapped.ollama_base_url = settings.ollamaBaseUrl ?? "";
    if (Object.prototype.hasOwnProperty.call(settings, "visionModel")) mapped.vision_model = settings.visionModel ?? "";
    if (Object.prototype.hasOwnProperty.call(settings, "textModel")) mapped.text_model = settings.textModel ?? "";
    if (Object.prototype.hasOwnProperty.call(settings, "notionToken")) mapped.notion_token = settings.notionToken ?? "";
    if (Object.prototype.hasOwnProperty.call(settings, "apiPassword")) mapped.api_password = settings.apiPassword ?? "";
    if (Object.prototype.hasOwnProperty.call(settings, "notionEnabled")) mapped.notion_enabled = settings.notionEnabled ? "1" : "0";
    return mapped;
}

export function getAppSettings(): AppSettings {
    const db = getWritableDb();
    return {
        ollamaBaseUrl: readSetting(db, "ollama_base_url") ?? DEFAULT_APP_SETTINGS.ollamaBaseUrl,
        visionModel: readSetting(db, "vision_model") ?? DEFAULT_APP_SETTINGS.visionModel,
        textModel: readSetting(db, "text_model") ?? DEFAULT_APP_SETTINGS.textModel,
        notionToken: readSetting(db, "notion_token") ?? DEFAULT_APP_SETTINGS.notionToken,
        apiPassword: readSetting(db, "api_password") ?? DEFAULT_APP_SETTINGS.apiPassword,
        notionEnabled: (readSetting(db, "notion_enabled") ?? (DEFAULT_APP_SETTINGS.notionEnabled ? "1" : "0")) !== "0",
    };
}

export function updateAppSettings(settings: Partial<AppSettings>): AppSettings {
    const db = getWritableDb();
    const mapped = mapSettings(settings);
    for (const [key, value] of Object.entries(mapped) as [SettingKey, string][]) {
        writeSetting(db, key, value);
    }
    return getAppSettings();
}

export const LEITNER_BOX_COUNT = 5;
const LEITNER_INTERVALS_DAYS = [0, 1, 2, 4, 8, 16];

export interface DocumentRow {
    id: number;
    folder: string;
    filename: string;
    file_path: string;
    title: string;
    doc_date: string;
    tags: string;
    summary: string;
    raw_text: string;
    html_path: string;
    status: string;
    detected_at: string;
    notes: string | null;
    ocr_confidence: number | null;
    view_count: number;
}

export interface ProcessingDocumentRow {
    id: number;
    folder: string;
    filename: string;
    status: string;
    detected_at: string;
}

export function getDocuments(folder?: string): DocumentRow[] {
    const db = getDb();
    if (folder) {
        return db.prepare(`SELECT * FROM documents WHERE status = 'done' AND folder = ? ORDER BY detected_at DESC`).all(folder) as DocumentRow[];
    }
    return db.prepare(`SELECT * FROM documents WHERE status = 'done' ORDER BY detected_at DESC`).all() as DocumentRow[];
}

export function getAllDocuments(): DocumentRow[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM documents ORDER BY detected_at DESC`).all() as DocumentRow[];
}

export function getProcessingDocuments(folder?: string): ProcessingDocumentRow[] {
    const db = getDb();
    if (folder) {
        return db.prepare(`SELECT * FROM documents WHERE status IN ('pending', 'processing') AND folder = ? ORDER BY detected_at DESC`).all(folder) as ProcessingDocumentRow[];
    }
    return db.prepare(`SELECT * FROM documents WHERE status IN ('pending', 'processing') ORDER BY detected_at DESC`).all() as ProcessingDocumentRow[];
}

export function getDocumentById(id: number): DocumentRow | undefined {
    const db = getDb();
    return db.prepare(`SELECT * FROM documents WHERE id = ? AND status = 'done'`).get(id) as DocumentRow | undefined;
}

export function getAnyDocumentById(id: number): DocumentRow | undefined {
    const db = getDb();
    return db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow | undefined;
}

export function getAllDocumentsByFolder(folder: string): DocumentRow[] {
    const db = getDb();
    return db.prepare(`SELECT * FROM documents WHERE folder = ?`).all(folder) as DocumentRow[];
}

export function renameDocument(id: number, title: string): void {
    getWritableDb().prepare(`UPDATE documents SET title = ? WHERE id = ?`).run(title, id);
}

export function updateDocumentNotes(id: number, notes: string): void {
    getWritableDb().prepare(`UPDATE documents SET notes = ? WHERE id = ?`).run(notes, id);
}

export function deleteDocumentRow(id: number): void {
    const db = getWritableDb();
    db.prepare(`DELETE FROM flashcards WHERE document_id = ?`).run(id);
    db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
}

export function updateDocumentFolderAndPaths(id: number, folder: string, filePath: string, htmlPath: string | null): void {
    getWritableDb()
        .prepare(`UPDATE documents SET folder = ?, file_path = ?, html_path = ? WHERE id = ?`)
        .run(folder, filePath, htmlPath, id);
}

export function incrementViewCount(id: number): void {
    getWritableDb().prepare(`UPDATE documents SET view_count = view_count + 1 WHERE id = ?`).run(id);
}

export function deleteFolderRows(folder: string): void {
    const db = getWritableDb();
    db.prepare(`DELETE FROM flashcards WHERE document_id IN (SELECT id FROM documents WHERE folder = ?)`).run(folder);
    db.prepare(`DELETE FROM documents WHERE folder = ?`).run(folder);
}

export interface FlashcardRow {
    id: number;
    document_id: number;
    question: string;
    answer: string;
    box: number;
    status: string;
    next_review_at: string;
    created_at: string;
    last_reviewed_at: string | null;
}

export function insertSuggestedFlashcards(documentId: number, cards: { question: string; answer: string }[]) {
    const db = getWritableDb();
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

export interface DueFlashcardRow extends FlashcardRow {
    folder: string;
    document_title: string;
}

export function getFlashcardsByDocument(documentId: number): FlashcardRow[] {
    return getDb()
        .prepare(`SELECT * FROM flashcards WHERE document_id = ? ORDER BY status ASC, created_at ASC`)
        .all(documentId) as FlashcardRow[];
}

export function getFlashcardCounts(documentId: number): { pending: number; active: number; due: number } {
    const now = new Date().toISOString();
    const row = getDb()
        .prepare(
            `SELECT
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'active' AND next_review_at <= @now THEN 1 ELSE 0 END) AS due
             FROM flashcards WHERE document_id = @documentId`
        )
        .get({ documentId, now }) as { pending: number | null; active: number | null; due: number | null };

    return { pending: row.pending ?? 0, active: row.active ?? 0, due: row.due ?? 0 };
}

export function createFlashcard(documentId: number, question: string, answer: string): FlashcardRow {
    const now = new Date().toISOString();
    const result = getWritableDb()
        .prepare(
            `INSERT INTO flashcards (document_id, question, answer, box, status, next_review_at, created_at)
             VALUES (?, ?, ?, 1, 'active', ?, ?)`
        )
        .run(documentId, question, answer, now, now);
    return getWritableDb().prepare(`SELECT * FROM flashcards WHERE id = ?`).get(result.lastInsertRowid) as FlashcardRow;
}

export function updateFlashcard(id: number, fields: { question?: string; answer?: string }): void {
    const current = getWritableDb().prepare(`SELECT * FROM flashcards WHERE id = ?`).get(id) as FlashcardRow | undefined;
    if (!current) return;

    getWritableDb()
        .prepare(`UPDATE flashcards SET question = ?, answer = ? WHERE id = ?`)
        .run(fields.question ?? current.question, fields.answer ?? current.answer, id);
}

export function acceptFlashcard(id: number, fields?: { question?: string; answer?: string }): void {
    const now = new Date().toISOString();
    const current = getWritableDb().prepare(`SELECT * FROM flashcards WHERE id = ?`).get(id) as FlashcardRow | undefined;
    if (!current) return;

    getWritableDb()
        .prepare(`UPDATE flashcards SET question = ?, answer = ?, status = 'active', box = 1, next_review_at = ? WHERE id = ?`)
        .run(fields?.question ?? current.question, fields?.answer ?? current.answer, now, id);
}

export function deleteFlashcard(id: number): void {
    getWritableDb().prepare(`DELETE FROM flashcards WHERE id = ?`).run(id);
}

export function getDueFlashcards(folder?: string, limit = 30): DueFlashcardRow[] {
    const now = new Date().toISOString();
    const db = getDb();

    if (folder) {
        return db
            .prepare(
                `SELECT f.*, d.folder AS folder, d.title AS document_title
                 FROM flashcards f JOIN documents d ON d.id = f.document_id
                 WHERE f.status = 'active' AND f.next_review_at <= @now AND d.folder = @folder
                 ORDER BY f.next_review_at ASC
                 LIMIT @limit`
            )
            .all({ now, folder, limit }) as DueFlashcardRow[];
    }

    return db
        .prepare(
            `SELECT f.*, d.folder AS folder, d.title AS document_title
             FROM flashcards f JOIN documents d ON d.id = f.document_id
             WHERE f.status = 'active' AND f.next_review_at <= @now
             ORDER BY f.next_review_at ASC
             LIMIT @limit`
        )
        .all({ now, limit }) as DueFlashcardRow[];
}

export function getDueCountsByFolder(): { folder: string; due: number }[] {
    const now = new Date().toISOString();
    return getDb()
        .prepare(
            `SELECT d.folder AS folder, COUNT(*) AS due
             FROM flashcards f JOIN documents d ON d.id = f.document_id
             WHERE f.status = 'active' AND f.next_review_at <= ?
             GROUP BY d.folder`
        )
        .all(now) as { folder: string; due: number }[];
}

export function reviewFlashcard(id: number, knew: boolean): FlashcardRow | undefined {
    const db = getWritableDb();
    const card = db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(id) as FlashcardRow | undefined;
    if (!card) return undefined;

    const nextBox = knew ? Math.min(card.box + 1, LEITNER_BOX_COUNT) : 1;
    const intervalDays = LEITNER_INTERVALS_DAYS[nextBox];
    const now = new Date();
    const nextReview = new Date(now);
    nextReview.setDate(nextReview.getDate() + intervalDays);

    db.prepare(`UPDATE flashcards SET box = ?, next_review_at = ?, last_reviewed_at = ? WHERE id = ?`).run(
        nextBox,
        nextReview.toISOString(),
        now.toISOString(),
        id
    );

    return db.prepare(`SELECT * FROM flashcards WHERE id = ?`).get(id) as FlashcardRow;
}
