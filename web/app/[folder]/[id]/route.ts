import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDocumentById, incrementViewCount } from "@/lib/db";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ folder: string; id: string }> }
) {
    const { folder, id } = await params;
    const doc = getDocumentById(Number(id));

    if (!doc || doc.folder !== folder) {
        return new NextResponse("Not found", { status: 404 });
    }

    const absolutePath = path.join(DATA_ROOT, doc.html_path);

    if (!fs.existsSync(absolutePath)) {
        return new NextResponse("HTML file missing on disk", { status: 500 });
    }

    incrementViewCount(doc.id);

    const html = fs.readFileSync(absolutePath, "utf-8");
    return new NextResponse(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}
