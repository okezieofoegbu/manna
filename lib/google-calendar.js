// lib/google-calendar.js
//
// v0.1.5 — Google Calendar API client for scheduling brief items.
// Mirrors the shape of lib/zoho.js: a refresh-token exchange, then
// a thin wrapper around the Calendar API for event creation.
//
// Setup is documented in INSTRUCTIONS.md §6b. The refresh token is
// obtained once via Google's OAuth Playground and stored in Vercel
// env vars + ~/manna/.env.local.
//
// Defensive error surfacing — raw Google responses appear in error
// messages (first 400 chars) so the pipeline can be iterated against
// real API behavior, the same pattern as lib/zoho.js.
//
// Scopes required: https://www.googleapis.com/auth/calendar.events
//   (lets us create/update/delete events; does not let us read
//   other people's calendars or write to system shared calendars.
//   For a single-owner-write app this is the right minimum.)

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

export function isGoogleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN,
  );
}

// Exchange the refresh token for a short-lived access token.
// Access tokens last ~1 hour; we mint a fresh one for each event
// creation call rather than caching, mirroring lib/zoho.js. The
// volume is low (~5 schedule actions/day max) so this is fine.
async function refreshAccessToken() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
  });

  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!resp.ok || !json?.access_token) {
    throw new Error(
      `Google token refresh failed (${resp.status}): ${text.slice(0, 400)}`,
    );
  }
  return json.access_token;
}

// Create a calendar event.
//
// dateTime strings are RFC3339 without offset (e.g. "2026-05-21T09:00:00")
// — Google interprets them in the timeZone field. This matches what
// <input type="datetime-local"> gives the browser, so the route can
// pass it straight through after appending ":00" for seconds. See
// app/api/actions/schedule/route.js for the conversion.
export async function createCalendarEvent({
  summary,
  description,
  startDateTime,
  endDateTime,
  timeZone,
  calendarId,
}) {
  if (!startDateTime || !endDateTime) {
    throw new Error('createCalendarEvent requires startDateTime and endDateTime');
  }
  const tz = timeZone || process.env.MANNA_TIMEZONE || 'Africa/Lagos';
  const calId = encodeURIComponent(
    calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary',
  );

  const accessToken = await refreshAccessToken();

  const event = {
    summary: summary || '(no subject)',
    description: description || '',
    start: { dateTime: startDateTime, timeZone: tz },
    end: { dateTime: endDateTime, timeZone: tz },
    // Source link in the event description (added by the route) lets
    // the owner click back to the original email from the calendar.
  };

  const resp = await fetch(
    `${GOOGLE_CALENDAR_BASE}/calendars/${calId}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    },
  );

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!resp.ok) {
    throw new Error(
      `Google Calendar event creation failed (${resp.status}): ${text.slice(0, 400)}`,
    );
  }

  return {
    eventId: json.id,
    htmlLink: json.htmlLink || null,
    calendarId:
      calendarId || process.env.GOOGLE_CALENDAR_ID || 'primary',
    start: json.start?.dateTime || startDateTime,
    end: json.end?.dateTime || endDateTime,
    timeZone: tz,
  };
}
