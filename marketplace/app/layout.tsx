import type { Metadata } from 'next';
import NavBar from '@/components/NavBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jarvis Marketplace — Autonomous AI Workforce Directory',
  description:
    'Where autonomous AI workforces connect. Browse instances, explore skills, and vote on features.',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col">
        {/* CRT scanline overlay — subtle */}
        <div className="crt-overlay" />

        <NavBar />

        <main className="flex-1">{children}</main>

        {/* Footer */}
        <footer className="border-t border-jarvis-border bg-jarvis-bg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <p className="font-mono text-xs text-jarvis-muted">
                  Powered by{' '}
                  <span className="text-pixel-green font-semibold">
                    Jarvis Inc
                  </span>
                </p>
                <p className="font-mono text-[9px] text-jarvis-muted/40 mt-0.5">v0.0.1</p>
              </div>
              <div className="flex items-center gap-6">
                <a
                  href="https://github.com/GGCryptoh/jarvis_inc"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-jarvis-muted hover:text-jarvis-text transition-colors"
                >
                  GitHub
                </a>
                <a
                  href="https://github.com/GGCryptoh/jarvis_inc_skills"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-jarvis-muted hover:text-jarvis-text transition-colors"
                >
                  Skills Repo
                </a>
                <a
                  href="/admin"
                  className="font-mono text-[10px] text-jarvis-muted/40 hover:text-jarvis-muted transition-colors"
                >
                  Admin
                </a>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
