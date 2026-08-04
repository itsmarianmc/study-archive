import { NextRequest, NextResponse } from "next/server";
import { getAppSettings, updateAppSettings, type AppSettings } from "@/lib/db";

export async function GET() {
    return NextResponse.json(getAppSettings());
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const updates: Partial<AppSettings> = {};

    for (const key of ["ollamaBaseUrl", "visionModel", "textModel", "notionToken", "apiPassword"] as const) {
        if (typeof body?.[key] === "string") {
            updates[key] = body[key].trim();
        }
    }

    if (typeof body?.notionEnabled === "boolean") {
        updates.notionEnabled = body.notionEnabled;
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: "No settings provided" }, { status: 400 });
    }

    if (typeof updates.ollamaBaseUrl === "string") {
        try {
            new URL(updates.ollamaBaseUrl);
        } catch {
            return NextResponse.json({ error: "Ollama Base URL is not a valid URL" }, { status: 400 });
        }
    }

    const settings = updateAppSettings(updates);
    return NextResponse.json({ ok: true, settings });
}