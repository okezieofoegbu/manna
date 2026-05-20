import './globals.css';

export const metadata = {
  title: 'Manna',
  description: 'Word before work. A private morning page.',
  // No-index headers remain in place. The auth gate (v0.1.3) keeps casual
  // visitors out of the rendered page, but we still don't want this URL
  // indexed by search engines. Remove these once a custom domain and full
  // RLS audit ship in v0.1.7.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
