import { NextResponse } from "next/server";
import { getDueCountsByFolder } from "@/lib/db";

export async function GET() {
    const counts = getDueCountsByFolder();
    const total = counts.reduce((sum, c) => sum + c.due, 0);
    return NextResponse.json({ counts, total });
}
