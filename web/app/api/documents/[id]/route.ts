import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAnyDocumentById, renameDocument, deleteDocumentRow, updateDocumentNotes } from "@/lib/db";

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), "../data");

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const doc = getAnyDocumentById(Number(id));
    if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    return NextResponse.json({ notes: doc.notes ?? "" });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const docId = Number(id);

    const body = await request.json().catch(() => null);
    const doc = getAnyDocumentById(docId);
    if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (typeof body?.notes === "string" && typeof body?.title !== "string") {
        updateDocumentNotes(docId, body.notes.trim());
        return NextResponse.json({ ok: true, notes: body.notes.trim() });
    }

    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
        return NextResponse.json({ error: "Title must not be empty" }, { status: 400 });
    }

    renameDocument(docId, title);

    if (typeof body?.notes === "string") {
        updateDocumentNotes(docId, body.notes.trim());
    }

    return NextResponse.json({ ok: true, title });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const docId = Number(id);

    const doc = getAnyDocumentById(docId);
    if (!doc) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    deleteDocumentRow(docId);

    if (doc.file_path && fs.existsSync(doc.file_path)) {
        fs.unlinkSync(doc.file_path);
    }
    if (doc.html_path) {
        const absoluteHtmlPath = path.join(DATA_ROOT, doc.html_path);
        if (fs.existsSync(absoluteHtmlPath)) fs.unlinkSync(absoluteHtmlPath);
    }

    return NextResponse.json({ ok: true });
}
