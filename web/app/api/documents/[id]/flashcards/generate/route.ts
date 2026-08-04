import { NextRequest, NextResponse } from "next/server";
import { getAnyDocumentById, insertSuggestedFlashcards } from "@/lib/db";
import { generateFlashcardsFromText } from "@/lib/ollama";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const docId = Number(id);

    const doc = getAnyDocumentById(docId);
    if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (!doc.raw_text?.trim()) {
        return NextResponse.json({ error: "Document has no extracted text yet" }, { status: 409 });
    }

    try {
        const cards = await generateFlashcardsFromText(doc.raw_text, doc.summary || "");
        if (cards.length > 0) {
            insertSuggestedFlashcards(docId, cards);
        }

        return NextResponse.json({ ok: true, cards });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
}