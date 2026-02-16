import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.pcudashboard.com'),
  title: {
    default: 'PCU Dashboard | Performance Data Built for Coaches and Players',
    template: '%s',
  },
  description:
    'PCU Dashboard helps coaches, players, and programs track development, improve decisions, and align communication with one clear pitching performance platform.',
  openGraph: {
    title: 'PCU Dashboard | Performance Data Built for Coaches and Players',
    description:
      'PCU Dashboard helps coaches, players, and programs track development, improve decisions, and align communication with one clear pitching performance platform.',
    url: 'https://www.pcudashboard.com',
    images: [
      {
        url: '/dashboard-shot-14.png',
        alt: 'PCU Dashboard preview',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PCU Dashboard | Performance Data Built for Coaches and Players',
    description:
      'PCU Dashboard helps coaches, players, and programs track development, improve decisions, and align communication with one clear pitching performance platform.',
    images: ['/dashboard-shot-14.png'],
  },
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
