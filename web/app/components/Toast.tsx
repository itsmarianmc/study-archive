"use client";

import { useEffect, useState } from "react";
import { useToast } from "../_context/ToastContext";

export default function Toast() {
    const { toastQueue, consumeToast } = useToast();
    const [visible, setVisible] = useState(false);
    const [current, setCurrent] = useState<{ msg: string; cls?: string } | null>(null);

    useEffect(() => {
        if (toastQueue.length === 0) return;
        const item = toastQueue[0];
        setCurrent({ msg: item.msg, cls: item.cls });
        setVisible(true);
        const t = setTimeout(() => {
            setVisible(false);
            setTimeout(() => {
                setCurrent(null);
                consumeToast();
            }, 300);
        }, item.duration || 2500);
        return () => clearTimeout(t);
    }, [toastQueue, consumeToast]);

    if (!current) return (
        <div id="toast" className="toast" style={{ display: "none", visibility: "hidden" }} />
    );

    return (
        <div id="toast" className={`toast${visible ? " show" : ""}${current.cls ? " " + current.cls : ""}`}>
            {current.msg}
        </div>
    );
}
