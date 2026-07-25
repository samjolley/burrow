import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey, dayOrdinal, daysBetween, deriveView,
  applyOpen, applyCheckin, validateImport,
} from './state.js';

// Fail loudly rather than silently asserting the wrong DST rules.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
assert.ok(/America\/(Detroit|New_York)/.test(TZ),
  `Run with TZ=America/Detroit (got ${TZ}). See README.`);

// Local wall-clock helper: L(2026, 7, 26, 2, 59) === 02:59 local on Jul 26 2026.
const L = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
// UTC instant helper, for the two DST transitions where local time is ambiguous.
const U = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

const S = (o = {}) => ({
  v: 1, habit: 'stretch', petName: 'Moss',
  hatched: '2026-07-25', lastOpenedDay: null, checkins: [], ...o,
});

const DAYKEY_CASES = [
  ['00:00 is still yesterday', L(2026, 7, 26, 0, 0), '2026-07-25'],
  ['02:59 is still yesterday', L(2026, 7, 26, 2, 59), '2026-07-25'],
  ['03:00 flips the day', L(2026, 7, 26, 3, 0), '2026-07-26'],
  ['03:01 is today', L(2026, 7, 26, 3, 1), '2026-07-26'],
  ['23:59 is today', L(2026, 7, 26, 23, 59), '2026-07-26'],
  ['month rollover', L(2026, 8, 1, 1, 0), '2026-07-31'],
  ['year rollover', L(2027, 1, 1, 2, 30), '2026-12-31'],
  ['leap-year step-back', L(2028, 3, 1, 1, 0), '2028-02-29'],
  ['non-leap step-back', L(2027, 3, 1, 1, 0), '2027-02-28'],
];

test('dayKey - boundaries and rollovers', () => {
  for (const [name, now, expect] of DAYKEY_CASES) {
    assert.equal(dayKey(now), expect, name);
  }
});

// Spring forward 2026 is Sun Mar 8: 01:59:59 EST -> 03:00:00 EDT, local 02:00-02:59
// does not exist. Fall back 2026 is Sun Nov 1: 02:00 EDT -> 01:00 EST, so local
// 01:00-01:59 happens twice and both instances must map to Oct 31.
const DST_CASES = [
  ['spring fwd 01:59 EST', U(2026, 3, 8, 6, 59), '2026-03-07'],
  ['spring fwd 03:00 EDT (day flips)', U(2026, 3, 8, 7, 0), '2026-03-08'],
  ['spring fwd 03:01 EDT', U(2026, 3, 8, 7, 1), '2026-03-08'],
  ['fall back 01:30 first pass (EDT)', U(2026, 11, 1, 5, 30), '2026-10-31'],
  ['fall back 01:30 second pass (EST)', U(2026, 11, 1, 6, 30), '2026-10-31'],
  ['fall back 02:30 EST', U(2026, 11, 1, 7, 30), '2026-10-31'],
  ['fall back 03:00 EST (day flips)', U(2026, 11, 1, 8, 0), '2026-11-01'],
];

test('dayKey - both DST transitions, America/Detroit', () => {
  for (const [name, now, expect] of DST_CASES) {
    assert.equal(dayKey(now), expect, name);
  }
});

const GAP_CASES = [
  ['spans spring forward (47 real hours)', '2026-03-07', '2026-03-09', 2],
  ['spans fall back (49 real hours)', '2026-10-31', '2026-11-02', 2],
  ['spans year end', '2026-12-31', '2027-01-02', 2],
  ['leap boundary', '2028-02-28', '2028-03-01', 2],
  ['same day', '2026-07-25', '2026-07-25', 0],
  ['clock rollback yields negative', '2026-07-26', '2026-07-25', -1],
];

test('daysBetween - calendar days, not elapsed time', () => {
  for (const [name, a, b, expect] of GAP_CASES) assert.equal(daysBetween(a, b), expect, name);
});

test('dayOrdinal - rejects malformed and out-of-range keys', () => {
  for (const bad of ['2026-13-45', '2026-02-30', '2026-7-26', '26-07-26', 'garbage', '', null, 20260726]) {
    assert.ok(Number.isNaN(dayOrdinal(bad)), `should reject ${JSON.stringify(bad)}`);
  }
});

const VIEW_CASES = [
  ['A hatched, zero check-ins',
    S({ lastOpenedDay: '2026-07-25' }), L(2026, 7, 25, 9),
    { daysTogether: 0, visual: 'awake', greeting: null, accessories: [] }],
  ['B checked in today -> cozy',
    S({ lastOpenedDay: '2026-07-25', checkins: ['2026-07-25'] }), L(2026, 7, 25, 9),
    { daysTogether: 1, visual: 'cozy', greeting: null }],
  ['C next morning -> asleep, no greeting',
    S({ lastOpenedDay: '2026-07-25', checkins: ['2026-07-25'] }), L(2026, 7, 26, 7),
    { visual: 'asleep', greeting: null, gapDays: 1, staleOpen: true }],
  ['D opened yesterday WITHOUT checking in -> asleep, NOT napping',
    S({ lastOpenedDay: '2026-07-26', checkins: ['2026-07-25'] }), L(2026, 7, 27, 9),
    { visual: 'asleep', greeting: null, gapDays: 1 }],
  ['E genuine 2-day gap -> napping + greeting',
    S({ lastOpenedDay: '2026-07-25', checkins: ['2026-07-25'] }), L(2026, 7, 27, 9),
    { visual: 'napping', gapDays: 2 }],
  ['J clock rollback -> cozy, no greeting, no stale write',
    S({ lastOpenedDay: '2026-07-27', checkins: ['2026-07-26', '2026-07-27'] }), L(2026, 7, 26, 10),
    { gapDays: -1, visual: 'cozy', greeting: null, staleOpen: false }],
  ['L duplicate stored keys dedupe',
    S({ checkins: ['2026-07-25', '2026-07-25', '2026-07-26'] }), L(2026, 7, 27, 9),
    { daysTogether: 2 }],
  ['M spring fwd 01:59 still cozy',
    S({ lastOpenedDay: '2026-03-07', checkins: ['2026-03-07'] }), U(2026, 3, 8, 6, 59),
    { visual: 'cozy', today: '2026-03-07' }],
  ['M spring fwd 03:00 flips to asleep',
    S({ lastOpenedDay: '2026-03-07', checkins: ['2026-03-07'] }), U(2026, 3, 8, 7, 0),
    { visual: 'asleep', gapDays: 1, today: '2026-03-08' }],
  ['N fall back 01:30 first pass (EDT) still cozy',
    S({ lastOpenedDay: '2026-10-31', checkins: ['2026-10-31'] }), U(2026, 11, 1, 5, 30),
    { visual: 'cozy', today: '2026-10-31' }],
  ['N fall back 01:30 second pass (EST) still cozy',
    S({ lastOpenedDay: '2026-10-31', checkins: ['2026-10-31'] }), U(2026, 11, 1, 6, 30),
    { visual: 'cozy', today: '2026-10-31' }],
  ['N fall back 02:30 EST still cozy',
    S({ lastOpenedDay: '2026-10-31', checkins: ['2026-10-31'] }), U(2026, 11, 1, 7, 30),
    { visual: 'cozy', today: '2026-10-31' }],
  ['N fall back 03:00 EST flips to asleep',
    S({ lastOpenedDay: '2026-10-31', checkins: ['2026-10-31'] }), U(2026, 11, 1, 8, 0),
    { visual: 'asleep', today: '2026-11-01' }],
  ['O 3-day gap spanning spring forward -> napping',
    S({ lastOpenedDay: '2026-03-06', checkins: ['2026-03-06'] }), U(2026, 3, 9, 15),
    { gapDays: 3, visual: 'napping' }],
  ['P 2-day gap spanning year end -> napping',
    S({ lastOpenedDay: '2026-12-31', checkins: ['2026-12-31'] }), L(2027, 1, 2, 10),
    { gapDays: 2, visual: 'napping' }],
  ['Q corrupt lastOpenedDay degrades to gap 0',
    S({ lastOpenedDay: 'garbage' }), L(2026, 7, 26, 9),
    { gapDays: 0, visual: 'awake', greeting: null }],
];

test('deriveView - table', () => {
  for (const [name, state, now, expect] of VIEW_CASES) {
    const got = deriveView(state, now);
    for (const [k, v] of Object.entries(expect)) {
      assert.deepEqual(got[k], v, `${name}: ${k}`);
    }
  }
});

const MILESTONE_CASES = [
  [0, []], [2, []],
  [3, ['leaf']], [6, ['leaf']],
  [7, ['leaf', 'scarf']], [13, ['leaf', 'scarf']],
  [14, ['leaf', 'scarf', 'mug']], [29, ['leaf', 'scarf', 'mug']],
  [30, ['leaf', 'scarf', 'mug', 'lantern']], [45, ['leaf', 'scarf', 'mug', 'lantern']],
];

test('milestones - thresholds at 3/7/14/30, off-by-one guarded on both sides', () => {
  for (const [n, expect] of MILESTONE_CASES) {
    const checkins = Array.from({ length: n }, (_, i) => dayKey(L(2026, 6, 1, 12) + i * 86400000));
    const v = deriveView(S({ checkins }), L(2026, 9, 1, 12));
    assert.equal(v.daysTogether, n, `daysTogether === unique(checkins).length at n=${n}`);
    assert.deepEqual(v.accessories, expect, `accessories at n=${n}`);
  }
});

test('F - return greeting shows exactly once and never replays', () => {
  const st = S({ lastOpenedDay: '2026-07-25', checkins: ['2026-07-25'] });

  const first = deriveView(st, L(2026, 7, 27, 9));
  assert.equal(first.visual, 'napping');
  assert.equal(typeof first.greeting, 'string');
  applyOpen(st, L(2026, 7, 27, 9));
  assert.equal(st.lastOpenedDay, '2026-07-27');

  const second = deriveView(st, L(2026, 7, 27, 9, 30));
  assert.equal(second.greeting, null);
  assert.equal(second.visual, 'awake');

  const third = deriveView(st, L(2026, 7, 27, 23, 50));
  assert.equal(third.greeting, null);

  const nextDay = deriveView(st, L(2026, 7, 28, 9));
  assert.equal(nextDay.greeting, null);
  assert.equal(nextDay.visual, 'asleep');
});

test('G - rapid double tap is idempotent', () => {
  const st = S({ lastOpenedDay: '2026-07-26', checkins: ['2026-07-25'] });
  const now = L(2026, 7, 26, 8);
  applyCheckin(st, now);
  applyCheckin(st, now);
  applyCheckin(st, now + 40);
  assert.deepEqual(st.checkins, ['2026-07-25', '2026-07-26']);
  assert.equal(deriveView(st, now).daysTogether, 2);
});

test('H - 02:59 tap counts as yesterday, 03:00 tap opens a new day', () => {
  const st = S({ lastOpenedDay: '2026-07-25', checkins: [] });
  applyCheckin(st, L(2026, 7, 26, 2, 59));
  assert.deepEqual(st.checkins, ['2026-07-25']);
  assert.equal(deriveView(st, L(2026, 7, 26, 2, 59)).visual, 'cozy');
  assert.equal(deriveView(st, L(2026, 7, 26, 3, 0)).checkedInToday, false);
  applyCheckin(st, L(2026, 7, 26, 3, 0));
  assert.deepEqual(st.checkins, ['2026-07-25', '2026-07-26']);
  assert.equal(deriveView(st, L(2026, 7, 26, 3, 0)).daysTogether, 2);
});

test('I - hatching before 3am hatches into yesterday, consistently', () => {
  const born = L(2026, 7, 26, 0, 30);
  const st = S({ hatched: dayKey(born), lastOpenedDay: dayKey(born), checkins: [] });
  assert.equal(st.hatched, '2026-07-25');
  assert.equal(deriveView(st, born).daysTogether, 0);
  applyCheckin(st, L(2026, 7, 26, 0, 35));
  assert.deepEqual(st.checkins, ['2026-07-25']);
  assert.equal(deriveView(st, L(2026, 7, 26, 0, 35)).daysTogether, 1);
  assert.equal(deriveView(st, L(2026, 7, 26, 0, 35)).visual, 'cozy');
});

test('J - lastOpenedDay is monotonic under clock rollback', () => {
  const st = S({ lastOpenedDay: '2026-07-27', checkins: ['2026-07-27'] });
  applyOpen(st, L(2026, 7, 26, 10));
  assert.equal(st.lastOpenedDay, '2026-07-27');
  applyOpen(st, L(2026, 7, 28, 10));
  assert.equal(st.lastOpenedDay, '2026-07-28');
});

test('milestone reveal is detected by diffing across the mutation, not by deriveView', () => {
  const checkins = Array.from({ length: 2 }, (_, i) => dayKey(L(2026, 7, 24, 12) + i * 86400000));
  const st = S({ lastOpenedDay: '2026-07-26', checkins });
  const now = L(2026, 7, 26, 9);
  const before = deriveView(st, now);
  applyCheckin(st, now);
  const after = deriveView(st, now);
  assert.equal(before.accessories.length, 0);
  assert.deepEqual(after.accessories, ['leaf']);
  assert.ok(after.accessories.length > before.accessories.length, 'reveal fires');
  assert.ok(!('celebrate' in after), 'celebrate is never a derived state');
  assert.equal(after.visual, 'cozy');
});

test('validateImport - accepts a good payload, normalises it', () => {
  const res = validateImport(JSON.stringify({
    v: 1, habit: '  stretch  ', petName: 'Moss', hatched: '2026-07-20',
    lastOpenedDay: '2026-07-20', checkins: ['2026-07-22', '2026-07-20', '2026-07-22'],
    evil: 'should be dropped',
  }));
  assert.equal(res.ok, true);
  assert.equal(res.state.habit, 'stretch');
  assert.deepEqual(res.state.checkins, ['2026-07-20', '2026-07-22']);
  assert.equal(res.state.lastOpenedDay, '2026-07-22', 'pulled forward to newest check-in');
  assert.ok(!('evil' in res.state), 'extra keys are dropped, not merged');
});

test('validateImport - rejects every malformed shape', () => {
  const bad = [
    ['not json', 'valid JSON'],
    ['[]', 'single { ... } object'],
    ['{"habit":"x","hatched":"2026-07-20","checkins":[]}', 'petName'],
    ['{"petName":"M","hatched":"2026-07-20","checkins":[]}', 'habit'],
    ['{"petName":"M","habit":"x","hatched":"2026-13-01","checkins":[]}', 'hatched'],
    ['{"petName":"M","habit":"x","hatched":"2026-07-20","checkins":"nope"}', 'array'],
    ['{"petName":"M","habit":"x","hatched":"2026-07-20","checkins":["2026-02-30"]}', 'Bad date'],
    ['{"petName":"M","habit":"x","hatched":"2026-07-20","checkins":[],"lastOpenedDay":"x"}', 'lastOpenedDay'],
  ];
  for (const [text, needle] of bad) {
    const res = validateImport(text);
    assert.equal(res.ok, false, `should reject: ${text}`);
    assert.ok(res.error.includes(needle), `error for ${text} should mention ${needle}, got: ${res.error}`);
  }
});

test('validateImport - long names are capped, not rejected', () => {
  const res = validateImport(JSON.stringify({
    petName: 'x'.repeat(200), habit: 'y'.repeat(200), hatched: '2026-07-20', checkins: [],
  }));
  assert.equal(res.ok, true);
  assert.equal(res.state.petName.length, 24);
  assert.equal(res.state.habit.length, 24);
});
