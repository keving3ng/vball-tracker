import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'VBall Tracker' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <nav className="border-b px-6 py-3 flex items-center gap-6">
          <span className="font-semibold text-lg">🏐 VBall Tracker</span>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">Runs</a>
          <a href="/players" className="text-sm text-muted-foreground hover:text-foreground">Players</a>
        </nav>
        <main className="px-6 py-8 max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
