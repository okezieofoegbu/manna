// =============================================================================
// Manna — /login (v0.1.3)
// =============================================================================
// The auth gate. If a valid session cookie exists, redirect to /. Otherwise
// render the login form. If a remembered-email cookie is set on this device,
// the form shows passcode-only; ?fresh=1 forces both fields.
// =============================================================================

import { redirect } from 'next/navigation';
import {
  getCurrentUser,
  getRememberedEmail,
  isAuthConfigured,
} from '@/lib/auth';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Manna — Sign in',
  description: 'Sign in to Manna.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default async function LoginPage({ searchParams }) {
  // Setup check — clearer than crashing.
  if (!isAuthConfigured()) {
    return (
      <main className="manna-shell">
        <header className="manna-header">
          <div className="manna-wordmark">Manna</div>
          <div className="manna-tagline">Word before work.</div>
        </header>
        <section className="manna-setup">
          <h2>Auth is not configured yet</h2>
          <p className="manna-note">
            <code>SESSION_SECRET</code> is not set. Generate one and add it to{' '}
            <code>.env.local</code> (and to Vercel for production), then
            restart the dev server. See the v0.1.3 README.
          </p>
        </section>
      </main>
    );
  }

  // Already signed in? Send to /.
  const user = await getCurrentUser();
  if (user) redirect('/');

  // ?fresh=1 forces a clean form even if an email cookie is set.
  const params = (await searchParams) || {};
  const fresh = params.fresh === '1';
  const rememberedEmail = fresh ? null : await getRememberedEmail();

  return (
    <main className="manna-shell">
      <header className="manna-header">
        <div className="manna-wordmark">Manna</div>
        <div className="manna-tagline">Word before work.</div>
      </header>
      <LoginForm rememberedEmail={rememberedEmail} />
    </main>
  );
}
