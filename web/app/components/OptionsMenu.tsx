"use client";

import { useEffect, useRef, useState } from "react";

export interface OptionsMenuItem {
    label: string;
    onClick: () => void;
    danger?: boolean;
}

export default function OptionsMenu({ items }: { items: OptionsMenuItem[] }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="options-menu" ref={ref}>
            <button
                type="button"
                className="options-menu-trigger"
                aria-label="Options"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen((o) => !o);
                }}
            >
                <i className="fa-solid fa-ellipsis"></i>
            </button>

            {open && (
                <div className="options-menu-dropdown">
                    {items.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            className={`options-menu-item${item.danger ? " options-menu-item--danger" : ""}`}
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOpen(false);
                                item.onClick();
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
