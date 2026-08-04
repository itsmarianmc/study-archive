import { NextRequest, NextResponse } from "next/server";
import { getAnyDocumentById, getDocuments } from "@/lib/db";

const MAX_RELATED = 5;

function parseTags(tags: string | null): string[] {
    if (!tags) return [];
    try {
        const parsed = JSON.parse(tags);
        return Array.isArray(parsed) ? parsed.map((t) => String(t).toLowerCase()) : [];
    } catch {
        return [];
    }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const docId = Number(id);
    const doc = getAnyDocumentById(docId);

    if (!doc || doc.status !== "done") {
        return NextResponse.json({ related: [] });
    }

    const sourceTags = new Set(parseTags(doc.tags));
    if (sourceTags.size === 0) {
        return NextResponse.json({ related: [] });
    }

    const candidates = getDocuments().filter((d) => d.id !== docId);

    const scored = candidates
        .map((candidate) => {
            const candidateTags = parseTags(candidate.tags);
            const overlap = candidateTags.filter((t) => sourceTags.has(t)).length;
            return { candidate, overlap };
        })
        .filter((entry) => entry.overlap > 0)
        .sort((a, b) => {
            if (b.overlap !== a.overlap) return b.overlap - a.overlap;
            if (a.candidate.folder === doc.folder && b.candidate.folder !== doc.folder) return -1;
            if (b.candidate.folder === doc.folder && a.candidate.folder !== doc.folder) return 1;
            return b.candidate.detected_at.localeCompare(a.candidate.detected_at);
        })
        .slice(0, MAX_RELATED);

    return NextResponse.json({
        related: scored.map(({ candidate, overlap }) => ({
            id: candidate.id,
            folder: candidate.folder,
            title: candidate.title,
            overlap,
        })),
    });
}
