import './globals.css';

export const metadata = {
  title: 'Manna',
  description: 'Word before work. A private morning page.',
  // No-index headers while the page is publicly deployed without auth.
  // Remove once the auth gate is in place (v0.1.6).
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
