import "./globals.css";
import { ToastProvider } from "./_context/ToastContext";
import Toast from "./components/Toast";
import PwaRegister from "./components/PwaRegister";

export const metadata = {
    title: "Study Archive",
    description: "Local-first study material archive",
    manifest: "/manifest.webmanifest",
    icons: {
        icon: ["/icons/icon-192.png", "/icons/icon-512.png"],
        apple: "/icons/apple-touch-icon.png",
    },
};

export const viewport = {
    themeColor: "#0f0f10",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <link rel="stylesheet" href="https://static.itsmarian.dev/fonts/font-awesome-v7.2.0/css/all.min.css" />
                <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
                <meta name="mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <meta name="apple-mobile-web-app-title" content="Study Archive" />
            </head>
            <body>
                <ToastProvider>
                    <div className="page-shell">
                        {children}
                        <footer className="site-footer">
                            <p>
                                <a href="">Study Archive by itsmarian</a>
                                &nbsp;•&nbsp;
                                <a href="https://github.com/itsmarianmc/study-archive" target="_blank" rel="noopener noreferrer">GitHub</a>
                                &nbsp;•&nbsp;
                                <a href="https://ko-fi.com/itsmarian" target="_blank" rel="noopener noreferrer">Support</a>
                            </p>
                        </footer>
                    </div>
                    <Toast />
                    <PwaRegister />
                </ToastProvider>
            </body>
        </html>
    );
}
