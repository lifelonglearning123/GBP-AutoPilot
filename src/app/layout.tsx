import type { Metadata } from 'next';
import './globals.css';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: 'GBP Autopilot',
  description: 'Google Business Profile local SEO on autopilot.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400..700&family=Sora:wght@500..700&display=swap" />
      </head>
      <body>
        <div className="min-h-screen flex">
          <Nav />
          <main className="flex-1 min-w-0 px-8 py-8 max-w-[1300px]">{children}</main>
        </div>
      </body>
    </html>
  );
}
