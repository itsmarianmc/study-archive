import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(__dirname, "../../data/study-archive.db");

const SETTINGS_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
`;

type SettingKey = "ollama_base_url" | "vision_model" | "text_model" | "notion_token" | "api_password";

export interface AppSettings {
    ollamaBaseUrl: string;
    visionModel: string;
    textModel: string;
    notionToken: string;
    apiPassword: string;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
    ollamaBaseUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
    visionModel: process.env.OLLAMA_VISION_MODEL ?? "qwen3.5:9b-q8_0",
    textModel: process.env.OLLAMA_TEXT_MODEL ?? process.env.OLLAMA_VISION_MODEL ?? "qwen3.5:9b-q8_0",
    notionToken: process.env.NOTION_TOKEN ?? "",
    apiPassword: process.env.API_PASSWORD ?? process.env.SHORTCUT_API_PASSWORD ?? "",
};

let dbInstance: Database.Database | null = null;

function ensureSettingsSchema(db: Database.Database) {
    db.exec(SETTINGS_TABLE_SQL);
}

function getDb(): Database.Database {
    if (!dbInstance) {
        dbInstance = new Database(DB_PATH, { fileMustExist: true });
        dbInstance.pragma("journal_mode = WAL");
        dbInstance.pragma("foreign_keys = ON");
        ensureSettingsSchema(dbInstance);
    }
    ensureSettingsSchema(dbInstance);
    return dbInstance;
}

function toDbKey(key: keyof AppSettings): SettingKey {
    switch (key) {
        case "ollamaBaseUrl":
            return "ollama_base_url";
        case "visionModel":
            return "vision_model";
        case "textModel":
            return "text_model";
        case "notionToken":
            return "notion_token";
        case "apiPassword":
            return "api_password";
    }
}

function readSetting(key: keyof AppSettings): string | undefined {
    const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(toDbKey(key)) as
        | { value?: string }
        | undefined;
    return row?.value;
}

function writeSetting(key: keyof AppSettings, value: string) {
    getDb()
        .prepare(
            `INSERT INTO app_settings (key, value, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .run(toDbKey(key), value, new Date().toISOString());
}

export function getAppSettings(): AppSettings {
    return {
        ollamaBaseUrl: readSetting("ollamaBaseUrl") ?? DEFAULT_APP_SETTINGS.ollamaBaseUrl,
        visionModel: readSetting("visionModel") ?? DEFAULT_APP_SETTINGS.visionModel,
        textModel: readSetting("textModel") ?? DEFAULT_APP_SETTINGS.textModel,
        notionToken: readSetting("notionToken") ?? DEFAULT_APP_SETTINGS.notionToken,
        apiPassword: readSetting("apiPassword") ?? DEFAULT_APP_SETTINGS.apiPassword,
    };
}

export function updateAppSettings(settings: Partial<AppSettings>): AppSettings {
    if (Object.prototype.hasOwnProperty.call(settings, "ollamaBaseUrl")) writeSetting("ollamaBaseUrl", settings.ollamaBaseUrl ?? "");
    if (Object.prototype.hasOwnProperty.call(settings, "visionModel")) writeSetting("visionModel", settings.visionModel ?? "");
    if (Object.prototype.hasOwnProperty.call(settings, "textModel")) writeSetting("textModel", settings.textModel ?? "");
    if (Object.prototype.hasOwnProperty.call(settings, "notionToken")) writeSetting("notionToken", settings.notionToken ?? "");
    if (Object.prototype.hasOwnProperty.call(settings, "apiPassword")) writeSetting("apiPassword", settings.apiPassword ?? "");
    return getAppSettings();
}