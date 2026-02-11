import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PCU Dashboard | Pitching Development Intelligence',
  description:
    'PCU Dashboard helps coaches, players, and programs track development, improve decisions, and align communication with one clear pitching performance platform.',
  icons: {
    icon: [
      { url: '/favicon.ico', type: 'image/x-icon' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/pitching-coach-u-logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
