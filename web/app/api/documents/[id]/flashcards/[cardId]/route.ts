import { NextRequest, NextResponse } from "next/server";
import { getAnyDocumentById, updateFlashcard, acceptFlashcard, deleteFlashcard } from "@/lib/db";

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; cardId: string }> }
) {
    const { id, cardId } = await params;
    const docId = Number(id);
    const flashcardId = Number(cardId);

    const doc = getAnyDocumentById(docId);
    if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim() : undefined;
    const answer = typeof body?.answer === "string" ? body.answer.trim() : undefined;

    if (question === "" || answer === "") {
        return NextResponse.json({ error: "Question and answer must not be empty" }, { status: 400 });
    }

    if (body?.action === "accept") {
        acceptFlashcard(flashcardId, { question, answer });
        return NextResponse.json({ ok: true });
    }

    updateFlashcard(flashcardId, { question, answer });
    return NextResponse.json({ ok: true });
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; cardId: string }> }
) {
    const { cardId } = await params;
    deleteFlashcard(Number(cardId));
    return NextResponse.json({ ok: true });
}
