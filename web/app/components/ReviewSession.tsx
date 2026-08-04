"use client";

import { useEffect, useState } from "react";
import type { DueFlashcardRow } from "@/lib/db";

interface Props {
    folder?: string;
}

export default function ReviewSession({ folder }: Props) {
    const [cards, setCards] = useState<DueFlashcardRow[] | null>(null);
    const [index, setIndex] = useState(0);
    const [revealed, setRevealed] = useState(false);
    const [reviewedCount, setReviewedCount] = useState(0);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const url = folder ? `/api/review?folder=${encodeURIComponent(folder)}` : "/api/review";
        fetch(url)
            .then((res) => res.json())
            .then((data) => setCards(data.cards ?? []))
            .catch(() => setCards([]));
    }, [folder]);

    async function answer(knew: boolean) {
        if (!cards || submitting) return;
        const card = cards[index];
        setSubmitting(true);
        try {
            await fetch("/api/review", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: card.id, knew }),
            });
        } finally {
            setSubmitting(false);
        }
        setReviewedCount((c) => c + 1);
        setRevealed(false);
        setIndex((i) => i + 1);
    }

    if (cards === null) {
        return <p className="review-loading">Loading due flashcards…</p>;
    }

    if (cards.length === 0) {
        return (
            <div className="review-empty">
                <i className="fa-solid fa-champagne-glasses"></i>
                <p>No flashcards are due right now. Check back later!</p>
            </div>
        );
    }

    if (index >= cards.length) {
        return (
            <div className="review-empty">
                <i className="fa-solid fa-circle-check"></i>
                <p>
                    Review session complete - {reviewedCount} card{reviewedCount === 1 ? "" : "s"} reviewed.
                </p>
            </div>
        );
    }

    const card = cards[index];

    return (
        <div className="review-session">
            <div className="review-progress">
                <span>
                    Card {index + 1} of {cards.length}
                </span>
                <span className="review-progress-meta">
                    {card.document_title} <span className="review-progress-folder">{card.folder}</span>
                </span>
            </div>

            <div
                className={`review-card${revealed ? " review-card--revealed" : ""}`}
                onClick={() => setRevealed((r) => !r)}
                role="button"
                tabIndex={0}
            >
                <div className="review-card-label">{revealed ? "Answer" : "Question"}</div>
                <div className="review-card-content">{revealed ? card.answer : card.question}</div>
                {!revealed && <div className="review-card-hint">Tap to reveal the answer</div>}
            </div>

            {revealed ? (
                <div className="review-actions">
                    <button
                        type="button"
                        className="review-action review-action--no"
                        disabled={submitting}
                        onClick={() => answer(false)}
                    >
                        <i className="fa-solid fa-xmark"></i> Didn't know it
                    </button>
                    <button
                        type="button"
                        className="review-action review-action--yes"
                        disabled={submitting}
                        onClick={() => answer(true)}
                    >
                        <i className="fa-solid fa-check"></i> Knew it
                    </button>
                </div>
            ) : (
                <button type="button" className="review-reveal-btn" onClick={() => setRevealed(true)}>
                    Show answer
                </button>
            )}
        </div>
    );
}
