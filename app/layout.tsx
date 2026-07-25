import type { Metadata, Viewport } from 'next';
import './globals.css';
import StatDefinitionTooltips from './stat-definition-tooltips';
import pearlMark from '../pearl/clam transparent.png';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://www.pcudashboard.com'),
  title: {
    default: 'Pearl Player Development | Data Built for Coaches and Players',
    template: '%s',
  },
  description:
    'Pearl Player Development helps coaches, players, and programs track development, improve decisions, and align communication through one clear performance platform.',
  openGraph: {
    title: 'Pearl Player Development | Data Built for Coaches and Players',
    description:
      'Pearl Player Development helps coaches, players, and programs track development, improve decisions, and align communication through one clear performance platform.',
    url: 'https://www.pcudashboard.com',
    images: [
      {
        url: '/dashboard-shot-14.png',
        alt: 'Pearl Player Development dashboard preview',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pearl Player Development | Data Built for Coaches and Players',
    description:
      'Pearl Player Development helps coaches, players, and programs track development, improve decisions, and align communication through one clear performance platform.',
    images: ['/dashboard-shot-14.png'],
  },
  icons: {
    icon: [{ url: pearlMark.src, type: 'image/png' }],
    shortcut: pearlMark.src,
    apple: pearlMark.src,
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
