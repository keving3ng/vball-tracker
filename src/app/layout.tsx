import type { Metadata } from "next";
import Link from "next/link";
import { version } from "../../package.json";
import "./globals.css";

export const metadata: Metadata = { title: "VBall Tracker" };

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body className="min-h-screen bg-background font-sans antialiased">
				<nav className="border-b px-4 py-3 flex items-center flex-wrap gap-x-6 gap-y-2 sm:px-6">
					<Link href="/" className="font-semibold text-lg">
						🏐 VBall Tracker
					</Link>
					<Link
						href="/"
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						Runs
					</Link>
					<Link
						href="/calendar"
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						Calendar
					</Link>
					<Link
						href="/players"
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						Players
					</Link>
					<Link
						href="/audit-log"
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						Audit Log
					</Link>
					<Link
						href="/reconcile"
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						Reconcile
					</Link>
					<span className="ml-auto text-xs text-muted-foreground">
						v{version}
					</span>
				</nav>
				<main className="px-4 py-6 max-w-5xl mx-auto sm:px-6 sm:py-8">
					{children}
				</main>
			</body>
		</html>
	);
}
