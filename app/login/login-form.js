'use client';

// =============================================================================
// Manna — login form (v0.1.3)
// =============================================================================
// Client component. Renders one or two fields depending on whether a
// remembered-email cookie was found on this device. Submits JSON to
// /api/auth/login. On success, hard-navigates to /.
// =============================================================================

import { useState } from 'react';
import styles from './login.module.css';

function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.indexOf('@');
  if (at < 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, 1);
  return `${visible}${'•'.repeat(Math.max(local.length - 1, 1))}${domain}`;
}

export default function LoginForm({ rememberedEmail }) {
  const passcodeOnly = Boolean(rememberedEmail);
  const [email, setEmail] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: passcodeOnly ? '' : email.trim().toLowerCase(),
          passcode: passcode.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Sign in failed.');
        setSubmitting(false);
        return;
      }
      // Hard navigate so server components re-evaluate auth state.
      window.location.href = '/';
    } catch {
      setError('Could not reach the server. Try again.');
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.shell}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {!passcodeOnly && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email</span>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
              disabled={submitting}
            />
          </label>
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Passcode</span>
          <input
            className={styles.input}
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus={passcodeOnly}
            required
            disabled={submitting}
          />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        {passcodeOnly && (
          <p className={styles.hint}>
            Signing in as {maskEmail(rememberedEmail)}.{' '}
            <a href="/login?fresh=1">Use a different email</a>
          </p>
        )}
      </form>
    </section>
  );
}
