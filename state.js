// Burrow — pure logic. No DOM, no localStorage, no Date.now().
// Everything here takes `now` as a parameter so state.test.js can inject a clock.

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_NAME = 24;

export const MILESTONES = [
  { at: 3, id: 'leaf' },
  { at: 7, id: 'scarf' },
  { at: 14, id: 'mug' },
  { at: 30, id: 'lantern' },
];

export const RETURN_LINES = [
  "Oh! You're back. I had the nicest nap.",
  'I saved you a spot by the window.',
  'I was dreaming about you. Ready when you are, no rush.',
];

/**
 * The virtual day a timestamp belongs to, as YYYY-MM-DD, day boundary at 03:00 LOCAL.
 * Never toISOString() (UTC, off by one all evening), never new Date("YYYY-MM-DD")
 * (parses as UTC midnight), never now - 3h (misclassifies DST transitions).
 */
export function dayKey(now) {
  const d = new Date(now);
  let y = d.getFullYear();
  let m = d.getMonth();
  let day = d.getDate();

  if (d.getHours() < 3) {
    // ponytail: noon anchor, not midnight — the step-back only needs the date,
    // and noon is immune to any zone that has no 00:00 on a spring-forward day.
    // day-1 === 0 rolls to the previous month; month -1 rolls to the previous year.
    const prev = new Date(y, m, day - 1, 12, 0, 0, 0);
    y = prev.getFullYear();
    m = prev.getMonth();
    day = prev.getDate();
  }

  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A stored YYYY-MM-DD key as whole days since the UTC epoch. UTC is used purely as a
 * fixed 86400000ms ruler; it never touches the local semantics dayKey established.
 * NaN for anything malformed, so this doubles as the date validator for validateImport.
 */
export function dayOrdinal(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return NaN;
  const [y, m, d] = key.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  // Date.UTC silently normalises 2026-02-30 -> 2026-03-02. Round-trip to reject.
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return NaN;
  return t / 86400000;
}

/** Whole calendar days from key `a` to key `b`. Negative if b is before a. */
export const daysBetween = (a, b) => dayOrdinal(b) - dayOrdinal(a);

/**
 * Pure. Everything the UI needs, from persisted state + an injected clock.
 * Never returns 'celebrate' — that is a UI-only transient owned by the tap handler.
 */
export function deriveView(state, now) {
  const today = dayKey(now);
  const s = state || {};

  const uniq = new Set(Array.isArray(s.checkins) ? s.checkins : []);
  const daysTogether = uniq.size;
  const checkedInToday = uniq.has(today);

  // Gap is measured from last OPENED, not last check-in. Without this,
  // "opened Tuesday, didn't check in" and "never opened Tuesday" are the same
  // stored state, and the return greeting replays forever.
  const raw = s.lastOpenedDay ? daysBetween(s.lastOpenedDay, today) : 0;
  const gapDays = Number.isFinite(raw) ? raw : 0;

  let visual;
  let greeting = null;

  if (checkedInToday) {
    visual = 'cozy';
  } else if (gapDays >= 2) {
    visual = 'napping';
    greeting = RETURN_LINES[dayOrdinal(today) % RETURN_LINES.length];
  } else if (gapDays === 1) {
    visual = 'asleep';
  } else {
    visual = 'awake';
  }

  return {
    today,
    hatched: !!s.hatched,
    checkedInToday,
    daysTogether,
    accessories: MILESTONES.filter((m) => daysTogether >= m.at).map((m) => m.id),
    visual,
    greeting,
    gapDays,
    staleOpen: gapDays > 0,
  };
}

/**
 * Advance lastOpenedDay. Monotonic.
 * ponytail: only ever advances. A device clock set forward then back freezes napping
 * detection until the real date catches up. Accepted for a one-week family test —
 * the alternative is a spurious warm greeting from a five-minute clock slip.
 */
export function applyOpen(state, now) {
  const today = dayKey(now);
  if (!state.lastOpenedDay || daysBetween(state.lastOpenedDay, today) > 0) {
    state.lastOpenedDay = today;
  }
  return state;
}

/**
 * Idempotent. Two taps in the same virtual day produce one entry.
 * ponytail: one-per-day means one per *device-reported* virtual-day key.
 * A changed device clock can bend it. Accepted; there is no trusted time source.
 */
export function applyCheckin(state, now) {
  const today = dayKey(now);
  if (!state.checkins.includes(today)) state.checkins.push(today);
  return state;
}

export const cleanName = (s) => (typeof s === 'string' ? s.trim().slice(0, MAX_NAME) : '');

const fail = (error) => ({ ok: false, error });

export function validateImport(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('That is not valid JSON. Paste the whole line, including the { and the }.');
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Expected a single { ... } object.');

  const petName = cleanName(raw.petName);
  const habit = cleanName(raw.habit);
  if (!petName) return fail('petName is missing or empty.');
  if (!habit) return fail('habit is missing or empty.');

  if (Number.isNaN(dayOrdinal(raw.hatched))) return fail('hatched is not a valid YYYY-MM-DD date.');

  if (!Array.isArray(raw.checkins)) return fail('checkins must be an array.');
  const bad = raw.checkins.find((k) => Number.isNaN(dayOrdinal(k)));
  if (bad !== undefined) return fail(`Bad date in checkins: ${JSON.stringify(bad)}`);

  // ponytail: lexical sort IS chronological for zero-padded YYYY-MM-DD. No comparator.
  const checkins = [...new Set(raw.checkins)].sort();

  let lastOpenedDay = raw.lastOpenedDay ?? null;
  if (lastOpenedDay !== null && Number.isNaN(dayOrdinal(lastOpenedDay))) {
    return fail('lastOpenedDay is not a valid YYYY-MM-DD date.');
  }
  // Pull forward to the newest check-in, so restoring an old export does not
  // immediately fire the warm-return greeting for a gap that never happened.
  const newest = checkins[checkins.length - 1];
  if (newest && (!lastOpenedDay || daysBetween(lastOpenedDay, newest) > 0)) lastOpenedDay = newest;

  // Whitelist reconstruction: extra keys in the pasted JSON are dropped, not merged.
  return {
    ok: true,
    state: { v: 1, habit, petName, hatched: raw.hatched, lastOpenedDay, checkins },
    summary: `${petName} — "${habit}" — ${checkins.length} days together (hatched ${raw.hatched})`,
  };
}
