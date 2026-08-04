import { NextRequest, NextResponse } from "next/server";
import { saveUploadedFiles } from "@/lib/upload";

export async function POST(request: NextRequest) {
    const formData = await request.formData();
    const rawFolder = formData.get("folder");
    const title = formData.get("title");
    const summary = formData.get("summary");
    const notes = formData.get("notes");

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
            folder: typeof rawFolder === "string" ? rawFolder : "",
            files,
            title: typeof title === "string" ? title : undefined,
            summary: typeof summary === "string" ? summary : undefined,
            notes: typeof notes === "string" ? notes : undefined,
        });

        return NextResponse.json(
            saved.length === 1
                ? { ok: true, folder: saved[0].folder, filename: saved[0].filename, files: saved }
                : { ok: true, folder: saved[0]?.folder ?? rawFolder, files: saved }
        );
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
}
