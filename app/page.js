import { isConfigured } from '@/lib/supabase';
import { getActiveTheme, getThemePassages } from '@/lib/themes';

// Manna's single page.
// v0.1.0: shows the quiet header, the active theme and its anchor
// passages (read from Supabase), the divider, and a placeholder brief.
// The devotional reflection and the real email brief arrive in later versions.

export const dynamic = 'force-dynamic';

function todayLong() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function MannaPage() {
  // If the environment is not configured yet, show a calm setup message
  // rather than crashing.
  if (!isConfigured) {
    return (
      <main className="manna-shell">
        <header className="manna-header">
          <div className="manna-wordmark">Manna</div>
          <div className="manna-tagline">Word before work.</div>
        </header>
        <section className="manna-setup">
          <h2>Manna is not configured yet</h2>
          <p className="manna-note">
            Copy <code>.env.local.example</code> to <code>.env.local</code> and
            fill in your Supabase URL and anon key, then restart the dev server.
            Full steps are in <code>INSTRUCTIONS.md</code>.
          </p>
        </section>
      </main>
    );
  }

  // Configured — load the active theme and its passages.
  let theme = null;
  let passages = [];
  let loadError = null;

  try {
    theme = await getActiveTheme();
    if (theme) {
      passages = await getThemePassages(theme.id);
    }
  } catch (err) {
    loadError = err.message;
  }

  return (
    <main className="manna-shell">
      <header className="manna-header">
        <div className="manna-wordmark">Manna</div>
        <div className="manna-tagline">Word before work.</div>
        <div className="manna-meta">
          {todayLong()}
          {theme && (
            <>
              {' · '}
              <span className="theme">{theme.name}</span>
            </>
          )}
        </div>
      </header>

      <section className="manna-devotional">
        <div className="manna-section-label">The devotional</div>

        {loadError && (
          <p className="manna-note">
            <strong>Could not load the theme.</strong> {loadError} — check that
            the schema has been applied and the theme seeded. See{' '}
            <code>INSTRUCTIONS.md</code>.
          </p>
        )}

        {!loadError && !theme && (
          <p className="manna-note">
            <strong>No active theme found.</strong> Run the seed SQL from{' '}
            <code>DB_SCHEMA.md</code> to load the <em>abiding</em> theme, then
            refresh.
          </p>
        )}

        {!loadError && theme && (
          <>
            <p className="manna-note" style={{ marginBottom: '1.5rem' }}>
              {theme.description}
            </p>
            <div className="manna-section-label">Anchor passages</div>
            <ul className="manna-passage-list">
              {passages.map((pasg) => (
                <li key={pasg.id}>
                  <span className="manna-passage-ref">{pasg.reference}</span>
                </li>
              ))}
            </ul>
            <p className="manna-note" style={{ marginTop: '1.5rem' }}>
              In v0.1.0 Manna shows the theme and its passages. The daily
              passage selection, the Bible text, and the written reflection
              arrive in v0.1.2.
            </p>
          </>
        )}
      </section>

      <div className="manna-divider" />

      <section className="manna-brief">
        <div className="manna-section-label">The day&apos;s brief</div>
        <p className="manna-note">
          The Transworld brief will appear here. The Zoho Mail integration and
          email synthesis arrive in v0.1.3. Word first; work second.
        </p>
      </section>

      <footer className="manna-footer">Manna v0.1.0</footer>
    </main>
  );
}
