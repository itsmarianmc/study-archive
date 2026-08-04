import { NextRequest, NextResponse } from "next/server";
import { getDocuments } from "@/lib/db";

export const dynamic = "force-dynamic";

function formatUploadDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" });
}

export async function GET(request: NextRequest) {
    const folder = request.nextUrl.searchParams.get("folder") ?? undefined;
    const q = request.nextUrl.searchParams.get("q")?.toLowerCase();

    let docs = getDocuments(folder);

    if (q) {
        docs = docs.filter((doc) => {
            const tagsString = doc.tags || "";
            const dateString = formatUploadDate(doc.detected_at).toLowerCase();
            const content = doc.raw_text || "";
            const haystack = `${doc.title} ${doc.summary} ${tagsString} ${content} ${dateString}`.toLowerCase();
            return haystack.includes(q);
        });
    }

    return NextResponse.json(docs);
}
