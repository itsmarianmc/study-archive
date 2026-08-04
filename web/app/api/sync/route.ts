import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";
import { getAllDocuments, getAppSettings } from "@/lib/db";
import { writeSyncStatus } from "@/lib/sync-status";

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const BASE_URL = process.env.STUDY_ARCHIVE_BASE_URL ?? "http://localhost:1920";

function getDocType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return "PDF";
    if (["jpg", "jpeg", "png", "heic"].includes(ext)) return "Scan";
    return "Dokument";
}

async function findExistingPage(notion: Client, archiveId: string) {
    const res = await notion.databases.query({
        database_id: DATABASE_ID!,
        filter: {
            property: "Archive ID",
            rich_text: { equals: archiveId },
        },
    });
    return res.results[0] ?? null;
}

export async function POST() {
    const settings = getAppSettings();

    if (!settings.notionEnabled) {
        return NextResponse.json({ error: "Notion sync is disabled in settings." }, { status: 409 });
    }

    const NOTION_TOKEN = settings.notionToken || process.env.NOTION_TOKEN;

    if (!NOTION_TOKEN || !DATABASE_ID) {
        return NextResponse.json(
            { error: "NOTION_TOKEN oder NOTION_DATABASE_ID fehlt in der Umgebung." },
            { status: 500 }
        );
    }

    const startedAt = Date.now();
    const notion = new Client({ auth: NOTION_TOKEN });
    const docs = getAllDocuments();

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const doc of docs) {
        try {
            const archiveId = String(doc.id);
            const isProcessed = doc.status === "done";
            const tags: string[] = isProcessed && doc.tags ? JSON.parse(doc.tags) : [];
            const url = `${BASE_URL}/${doc.folder}/${doc.id}`;
            const title = isProcessed ? (doc.title?.trim() || doc.filename) : doc.filename;

            const properties = {
                Titel: { title: [{ text: { content: title } }] },
                Typ: { select: { name: getDocType(doc.filename) } },
                Subject: { select: { name: doc.folder } },
                Tags: { multi_select: tags.map((t) => ({ name: t })) },
                URL: { url },
                Processed: { checkbox: isProcessed },
                Notes: { rich_text: doc.notes ? [{ text: { content: doc.notes.slice(0, 2000) } }] : [] },
                "Archive ID": { rich_text: [{ text: { content: archiveId } }] },
                "Last Synced": { date: { start: new Date().toISOString() } },
            };

            const existing = await findExistingPage(notion, archiveId);

            if (existing) {
                await notion.pages.update({ page_id: existing.id, properties });
                updated++;
            } else {
                await notion.pages.create({ parent: { database_id: DATABASE_ID }, properties });
                created++;
            }
        } catch (err) {
            errors.push(`${doc.filename}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    writeSyncStatus({
        success: errors.length === 0,
        source: "manual",
        durationMs: Date.now() - startedAt,
        total: docs.length,
        created,
        updated,
        errorCount: errors.length,
        errors,
    });

    return NextResponse.json({
        total: docs.length,
        created,
        updated,
        errors,
    });
}
