import { NextRequest, NextResponse } from "next/server";
import { buildDigestMarkdown } from "@/lib/digest";

const BASE_URL = process.env.STUDY_ARCHIVE_BASE_URL ?? "";

export async function GET(request: NextRequest) {
    const daysParam = Number(request.nextUrl.searchParams.get("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(90, Math.round(daysParam)) : 7;

    const markdown = buildDigestMarkdown(days, BASE_URL);
    const filename = `study-archive-digest-${new Date().toISOString().slice(0, 10)}.md`;

    return new NextResponse(markdown, {
        headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
        },
    });
}
