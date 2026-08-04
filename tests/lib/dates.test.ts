// Regression tests for the farm-timezone date helpers.
//
// The bug these lock down: the container runs in UTC, the farm runs on
// America/Bogota (UTC-5). Building a date with `new Date().toISOString()` rolled
// over at 7 PM local, so every evening record — the afternoon ordeño, the health
// events done after milking — was stamped with tomorrow's date.

import { describe, it, expect, afterEach, vi } from 'vitest';

import { today, addDays, shiftDate, daysBetween, FARM_TIMEZONE } from '../../src/lib/dates';
import { today as smToday, addDays as smAddDays } from '../../src/lib/state-machine';
import { today as alertsToday, shift as alertsShift } from '../../src/lib/alerts';

/** Freezes the clock at a UTC instant. */
function at(utc: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(utc));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('today', () => {
  it('uses the farm calendar, not the container calendar', () => {
    expect(FARM_TIMEZONE).toBe('America/Bogota');
  });

  it.each([
    ['2026-08-04T05:00:00Z', '2026-08-04', 'midnight on the farm'],
    ['2026-08-04T12:00:00Z', '2026-08-04', 'morning'],
    ['2026-08-04T22:00:00Z', '2026-08-04', '5 PM, before the old rollover'],
  ])('%s -> %s (%s)', (utc, expected) => {
    at(utc);
    expect(today()).toBe(expected);
  });

  // These are the instants the old implementation got wrong.
  it.each([
    ['2026-08-05T00:30:00Z', '7:30 PM on the farm'],
    ['2026-08-05T02:00:00Z', '9 PM on the farm'],
    ['2026-08-05T04:59:00Z', '11:59 PM on the farm'],
  ])('%s still reports the current farm day (%s)', (utc) => {
    at(utc);
    // UTC has already flipped to the 5th; the farm has not.
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-08-05');
    expect(today()).toBe('2026-08-04');
  });

  it('rolls over exactly at farm midnight', () => {
    at('2026-08-05T04:59:59Z');
    expect(today()).toBe('2026-08-04');

    at('2026-08-05T05:00:00Z');
    expect(today()).toBe('2026-08-05');
  });
});

describe('addDays', () => {
  it.each([
    [0, '2026-08-04'],
    [1, '2026-08-05'],
    [90, '2026-11-02'],  // the desparasitación interval
    [180, '2027-01-31'], // the Aftosa booster interval
    [-30, '2026-07-05'], // the milk-production analytics window
  ])('%i days from today -> %s', (n, expected) => {
    at('2026-08-04T12:00:00Z');
    expect(addDays(n)).toBe(expected);
  });

  it('anchors on the farm day, so an evening entry schedules from today', () => {
    at('2026-08-05T00:30:00Z'); // 7:30 PM on Aug 4 at the farm
    expect(addDays(90)).toBe('2026-11-02');
  });
});

describe('shiftDate', () => {
  it.each([
    ['2026-12-31', 1, '2027-01-01'],   // year boundary
    ['2026-01-31', 1, '2026-02-01'],   // month boundary
    ['2028-02-28', 1, '2028-02-29'],   // leap year
    ['2027-02-28', 1, '2027-03-01'],   // non-leap year
    ['2026-03-01', -1, '2026-02-28'],
    ['2026-08-04', 283, '2027-05-14'], // gestation -> estimated calving
  ])('%s shifted by %i -> %s', (iso, n, expected) => {
    expect(shiftDate(iso, n)).toBe(expected);
  });

  it('ignores any time component on the input', () => {
    expect(shiftDate('2026-08-04T23:45:00Z', 1)).toBe('2026-08-05');
  });

  it('does not depend on the wall clock', () => {
    at('2026-08-05T02:00:00Z');
    expect(shiftDate('2026-01-01', 10)).toBe('2026-01-11');
  });
});

describe('daysBetween', () => {
  it.each([
    ['2026-08-04', '2026-11-02', 90],
    ['2026-08-04', '2026-08-04', 0],
    ['2026-11-02', '2026-08-04', -90], // negative when b precedes a
    ['2027-12-31', '2028-01-01', 1],
  ])('%s -> %s is %i days', (a, b, expected) => {
    expect(daysBetween(a, b)).toBe(expected);
  });
});

// The original bug was not just wrong dates but *disagreeing* ones: the flows
// wrote on one calendar while the alert queries filtered on another, so an
// evening record could be invisible to the next morning's alert.
describe('cross-module consistency', () => {
  it('state-machine, alerts and dates all report the same farm day', () => {
    at('2026-08-05T02:00:00Z'); // 9 PM on the farm, the old danger zone

    expect(smToday()).toBe('2026-08-04');
    expect(alertsToday()).toBe('2026-08-04');
    expect(today()).toBe('2026-08-04');
  });

  it('state-machine addDays and the alerts window agree', () => {
    at('2026-08-05T02:00:00Z');

    expect(smAddDays(7)).toBe(alertsShift(7));
    expect(alertsShift(-40)).toBe(addDays(-40));
  });
});
