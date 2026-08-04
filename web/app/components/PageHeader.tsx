"use client";

import type { ReactNode } from "react";

export default function PageHeader({
    title,
    actions,
    children,
}: {
    title: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
}) {
    const hasMoreThanOneAction = Array.isArray(actions) && actions.length > 2;
    return (
        <header className="page-header">
            <div className={ `page-header-top ${hasMoreThanOneAction ? 'page-header-top--multiple' : ''} `}>
                <a className="page-header-title" href="/">{title}</a>
                <div className="page-header-actions">
                    {actions}
                </div>
            </div>
            {children ? <div className="header-sub-elements">{children}</div> : null}
        </header>
    );
}