import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PCU Dashboard | Pitching Development Intelligence',
  description:
    'PCU Dashboard helps coaches, players, and programs track development, improve decisions, and align communication with one clear pitching performance platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
