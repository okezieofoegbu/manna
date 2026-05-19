import './globals.css';

export const metadata = {
  title: 'Manna',
  description: 'Word before work. A private morning page.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
