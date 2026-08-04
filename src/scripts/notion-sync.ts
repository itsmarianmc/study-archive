import "dotenv/config";
import { Client } from "@notionhq/client";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { getAppSettings } from "../db/settings";

const NOTION_TOKEN = getAppSettings().notionToken || process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const BASE_URL = process.env.STUDY_ARCHIVE_BASE_URL ?? "http://localhost:1920";

if (!NOTION_TOKEN || !DATABASE_ID) {
    console.error("Fehler: NOTION_TOKEN und NOTION_DATABASE_ID müssen in der .env gesetzt sein.");
    process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

const DB_PATH = path.resolve(__dirname, "../../data/study-archive.db");
const db = new Database(DB_PATH, { readonly: true });

const STATUS_PATH = path.join(path.dirname(DB_PATH), "sync-status.json");

interface SyncStatus {
    lastRunAt: string;
    success: boolean;
    source: "systemd" | "manual";
    durationMs: number;
    total: number;
    created: number;
    updated: number;
    errorCount: number;
    errors: string[];
}

function writeStatus(status: Omit<SyncStatus, "lastRunAt" | "source">) {
    const payload: SyncStatus = {
        lastRunAt: new Date().toISOString(),
        source: "systemd",
        ...status,
        errors: status.errors.slice(0, 10),
    };
    try {
        fs.writeFileSync(STATUS_PATH, JSON.stringify(payload, null, 2), "utf-8");
    } catch (err) {
        console.error("Konnte sync-status.json nicht schreiben:", err);
    }
}

interface DocRow {
    id: number;
    folder: string;
    filename: string;
    title: string | null;
    tags: string | null;
    html_path: string | null;
    status: string;
    notes: string | null;
}

function getDocType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return "PDF";
    if (["jpg", "jpeg", "png", "heic"].includes(ext)) return "Scan";
    return "Dokument";
}

async function findExistingPage(archiveId: string) {
    const res = await notion.databases.query({
        database_id: DATABASE_ID!,
        filter: {
            property: "Archive ID",
            rich_text: { equals: archiveId },
        },
    });
    return res.results[0] ?? null;
}

function buildProperties(doc: DocRow) {
    const archiveId = String(doc.id);
    const isProcessed = doc.status === "done";
    const tags: string[] = isProcessed && doc.tags ? JSON.parse(doc.tags) : [];
    const url = `${BASE_URL}/${doc.folder}/${doc.id}`;
    const title = isProcessed ? (doc.title?.trim() || doc.filename) : doc.filename;

    return {
        Title: {
            title: [{ text: { content: title } }],
        },
        Type: {
            select: { name: getDocType(doc.filename) },
        },
        Subject: {
            select: { name: doc.folder },
        },
        Tags: {
            multi_select: tags.map((t) => ({ name: t })),
        },
        URL: {
            url,
        },
        Processed: {
            checkbox: isProcessed,
        },
        Notes: {
            rich_text: doc.notes ? [{ text: { content: doc.notes.slice(0, 2000) } }] : [],
        },
        "Archive ID": {
            rich_text: [{ text: { content: archiveId } }],
        },
        "Last Synced": {
            date: { start: new Date().toISOString() },
        },
    };
}

async function syncDocument(doc: DocRow): Promise<"created" | "updated"> {
    const archiveId = String(doc.id);
    const properties = buildProperties(doc);
    const existing = await findExistingPage(archiveId);

    if (existing) {
        await notion.pages.update({ page_id: existing.id, properties });
        console.log(`~ aktualisiert: "${doc.title ?? doc.filename}" (Archive ID ${archiveId})`);
        return "updated";
    } else {
        await notion.pages.create({
            parent: { database_id: DATABASE_ID! },
            properties,
        });
        console.log(`+ neu angelegt: "${doc.title ?? doc.filename}" (Archive ID ${archiveId})`);
        return "created";
    }
}

async function main() {
    const startedAt = Date.now();
    const docs = db
        .prepare(
            `SELECT id, folder, filename, title, tags, html_path, status, notes
             FROM documents`
        )
        .all() as DocRow[];

    console.log(`Study Archive Sync gestartet: ${docs.length} Dokument(e) gefunden.`);

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const doc of docs) {
        try {
            const result = await syncDocument(doc);
            if (result === "created") created++;
            else updated++;
        } catch (err) {
            const message = `Dokument ${doc.id} (${doc.filename}): ${err instanceof Error ? err.message : String(err)}`;
            errors.push(message);
            console.error(`Fehler bei ${message}`);
        }
    }

    console.log(`Sync abgeschlossen. ${docs.length - errors.length} ok, ${errors.length} Fehler.`);

    writeStatus({
        success: errors.length === 0,
        durationMs: Date.now() - startedAt,
        total: docs.length,
        created,
        updated,
        errorCount: errors.length,
        errors,
    });

    if (errors.length > 0) process.exit(1);
}

main().catch((err) => {
    console.error("Sync komplett fehlgeschlagen:", err);
    writeStatus({
        success: false,
        durationMs: 0,
        total: 0,
        created: 0,
        updated: 0,
        errorCount: 1,
        errors: [err instanceof Error ? err.message : String(err)],
    });
    process.exit(1);
});
