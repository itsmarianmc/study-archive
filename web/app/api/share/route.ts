import { NextRequest, NextResponse } from "next/server";
import { getAppSettings } from "@/lib/db";
import { saveUploadedFiles } from "@/lib/upload";

function getPasswordFromRequest(request: NextRequest, formData: FormData): string {
    const headerPassword = request.headers.get("x-study-archive-api-password") ?? request.headers.get("x-api-password");
    if (headerPassword) return headerPassword.trim();

    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer) return bearer.trim();

    const formPassword = formData.get("password");
    return typeof formPassword === "string" ? formPassword.trim() : "";
}

function getStringField(formData: FormData, key: string): string | undefined {
    const value = formData.get(key);
    return typeof value === "string" ? value : undefined;
}

export async function POST(request: NextRequest) {
    const formData = await request.formData();
    const settings = getAppSettings();
    const requiredPassword = settings.apiPassword.trim();
    const providedPassword = getPasswordFromRequest(request, formData);

    if (requiredPassword && providedPassword !== requiredPassword) {
        return NextResponse.json({ error: "Invalid API password" }, { status: 401 });
    }

    const rawFolder = formData.get("folder");
    if (typeof rawFolder !== "string" || !rawFolder.trim()) {
        return NextResponse.json({ error: "No subject was selected" }, { status: 400 });
    }

    const files = [
        ...formData.getAll("files").filter((entry): entry is File => entry instanceof File),
        ...formData.getAll("file").filter((entry): entry is File => entry instanceof File),
    ];

    if (files.length === 0) {
        return NextResponse.json({ error: "No files were submitted" }, { status: 400 });
    }

    try {
        const saved = await saveUploadedFiles({
            folder: rawFolder,
            files,
            title: getStringField(formData, "title"),
            summary: getStringField(formData, "summary"),
            notes: getStringField(formData, "notes"),
        });

        return NextResponse.json({ ok: true, files: saved });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
}