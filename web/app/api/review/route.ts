import { NextRequest, NextResponse } from "next/server";
import { getDueFlashcards, reviewFlashcard } from "@/lib/db";

export async function GET(request: NextRequest) {
    const folder = request.nextUrl.searchParams.get("folder") ?? undefined;
    const cards = getDueFlashcards(folder || undefined);
    return NextResponse.json({ cards });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const id = Number(body?.id);
    const knew = body?.knew === true;

    if (!id) {
        return NextResponse.json({ error: "Missing flashcard id" }, { status: 400 });
    }

    const card = reviewFlashcard(id, knew);
    if (!card) {
        return NextResponse.json({ error: "Flashcard not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, card });
}
