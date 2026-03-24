import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'The No Fun League',
  description: 'AI-powered fantasy football where trash talk, chaos, and domination are fully automated.',
  keywords: ['fantasy football', 'AI', 'trash talk', 'fantasy sports'],
  themeColor: '#0a0a0a',
  openGraph: {
    title: 'The No Fun League',
    description: 'AI-powered fantasy football chaos',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
