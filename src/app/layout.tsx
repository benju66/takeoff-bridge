import type { Metadata } from "next";
import "./globals.css";
import ThemeToggle from "../components/ThemeToggle";
import { AuthProvider } from "@/context/AuthContext";
import LayoutShell from "@/components/layout/LayoutShell";

export const metadata: Metadata = {
  title: "Takeoff Bridge — Construction Estimating Platform",
  description: "Professional construction cost estimation platform. Parse takeoff CSV data, map cost codes, and generate Procore-ready budget exports.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const saved = localStorage.getItem('theme');
                  if (saved === 'dark' || saved === 'light') {
                    document.documentElement.setAttribute('data-theme', saved);
                  } else {
                    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <LayoutShell>
            {children}
          </LayoutShell>
          <ThemeToggle />
        </AuthProvider>
      </body>
    </html>
  );
}
