import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAnyDocumentById } from "@/lib/db";

function getContentType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case ".pdf":
            return "application/pdf";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        default:
            return "application/octet-stream";
    }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const doc = getAnyDocumentById(Number(id));

    if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!doc.file_path || !fs.existsSync(doc.file_path)) {
        return NextResponse.json({ error: "Original file missing on disk" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(doc.file_path);
    const downloadName = doc.filename || path.basename(doc.file_path);

    return new NextResponse(fileBuffer, {
        headers: {
            "Content-Type": getContentType(downloadName),
            "Content-Disposition": `attachment; filename="${encodeURIComponent(downloadName)}"`,
            "Content-Length": String(fileBuffer.length),
        },
    });
}
