import type { Metadata, Viewport } from 'next';
import './globals.css';
import StatDefinitionTooltips from './stat-definition-tooltips';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
  themeColor: '#00020f',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://www.pcudashboard.com'),
  title: {
    default: 'Pearl | Player Development Hub for Baseball Coaches',
    template: '%s',
  },
  description:
    'Pearl Player Development helps coaches, players, and programs track development, improve decisions, and align communication through one clear performance platform.',
  openGraph: {
    title: 'Pearl | Player Development Hub for Baseball Coaches',
    description:
      'Pearl Player Development helps coaches, players, and programs track development, improve decisions, and align communication through one clear performance platform.',
    url: 'https://www.pcudashboard.com',
    images: [
      {
        url: '/pearl-social-preview.png',
        width: 1200,
        height: 630,
        alt: 'Pearl Player Development',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pearl | Player Development Hub for Baseball Coaches',
    description:
      'Pearl Player Development helps coaches, players, and programs track development, improve decisions, and align communication through one clear performance platform.',
    images: [
      {
        url: '/pearl-social-preview.png',
        width: 1200,
        height: 630,
        alt: 'Pearl Player Development',
      },
    ],
  },
  icons: {
    icon: [
      { url: '/pearl-favicon-v5.ico', sizes: '64x64', type: 'image/x-icon' },
      { url: '/pearl-favicon-v5.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/pearl-favicon-v5.ico',
    apple: '/pearl-favicon-v5.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <StatDefinitionTooltips />
      </body>
    </html>
  );
}
