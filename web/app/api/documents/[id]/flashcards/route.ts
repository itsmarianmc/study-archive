import { NextRequest, NextResponse } from "next/server";
import { getAnyDocumentById, getFlashcardsByDocument, createFlashcard } from "@/lib/db";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const docId = Number(id);

    const doc = getAnyDocumentById(docId);
    if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const cards = getFlashcardsByDocument(docId);
    return NextResponse.json({
        pending: cards.filter((c) => c.status === "pending"),
        active: cards.filter((c) => c.status === "active"),
    });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const docId = Number(id);

    const doc = getAnyDocumentById(docId);
    if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";

    if (!question || !answer) {
        return NextResponse.json({ error: "Question and answer must not be empty" }, { status: 400 });
    }

    const card = createFlashcard(docId, question, answer);
    return NextResponse.json({ ok: true, card });
}
