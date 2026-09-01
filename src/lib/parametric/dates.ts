/**
 * Calendar arithmetic, done in UTC throughout.
 *
 * Using UTC rather than local `Date` avoids the classic off-by-one where a page
 * generated in one timezone starts the month on a different weekday than the
 * same page generated in another.
 */

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const DAY_ABBR = DAY_NAMES.map((d) => d.slice(0, 3));
export const DAY_INITIAL = DAY_NAMES.map((d) => d.slice(0, 1));

export type WeekStart = 0 | 1 | 6;

export const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** `month` is 1-based. */
export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Weekday of the 1st of `month`, 0 = Sunday. */
export function firstWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

export const utc = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day));

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * 86400000);

export const isWeekend = (date: Date): boolean => {
  const d = date.getUTCDay();
  return d === 0 || d === 6;
};

/** Column index of `weekday` when the week begins on `weekStart`. */
export const weekdayColumn = (weekday: number, weekStart: WeekStart): number =>
  (weekday - weekStart + 7) % 7;

/** Weekday headers reordered for a given week start. */
export function orderedDayLabels(
  weekStart: WeekStart,
  style: 'abbr' | 'full' | 'initial' = 'abbr'
): string[] {
  const source =
    style === 'full' ? DAY_NAMES : style === 'initial' ? DAY_INITIAL : DAY_ABBR;
  return Array.from({ length: 7 }, (_, i) => source[(i + weekStart) % 7]);
}

export interface MonthCell {
  date: Date;
  day: number;
  /** False for days spilling in from the neighbouring months. */
  inMonth: boolean;
  weekend: boolean;
  isoWeek: number;
}

/**
 * The month laid out as a rectangular grid of whole weeks, including the
 * leading/trailing days needed to fill the first and last rows.
 */
export function monthGrid(
  year: number,
  month: number,
  weekStart: WeekStart
): { weeks: MonthCell[][]; rowCount: number } {
  const lead = weekdayColumn(firstWeekday(year, month), weekStart);
  const total = daysInMonth(year, month);
  const rowCount = Math.ceil((lead + total) / 7);
  const start = addDays(utc(year, month, 1), -lead);

  const weeks: MonthCell[][] = [];
  for (let row = 0; row < rowCount; row++) {
    const cells: MonthCell[] = [];
    for (let col = 0; col < 7; col++) {
      const date = addDays(start, row * 7 + col);
      cells.push({
        date,
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === month - 1 && date.getUTCFullYear() === year,
        weekend: isWeekend(date),
        isoWeek: isoWeekNumber(date),
      });
    }
    weeks.push(cells);
  }
  return { weeks, rowCount };
}

/** ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday). */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Shift to the Thursday of this week, which always sits in the ISO year.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Monday-based start of the ISO week containing `date`. */
export function startOfWeek(date: Date, weekStart: WeekStart): Date {
  const offset = weekdayColumn(date.getUTCDay(), weekStart);
  return addDays(date, -offset);
}

/** First day of ISO week `week` in `year`, adjusted to `weekStart`. */
export function dateOfIsoWeek(year: number, week: number, weekStart: WeekStart): Date {
  const jan4 = utc(year, 1, 4);
  const week1Monday = addDays(jan4, -((jan4.getUTCDay() || 7) - 1));
  const monday = addDays(week1Monday, (week - 1) * 7);
  return weekStart === 1 ? monday : startOfWeek(monday, weekStart);
}

export const formatDate = (date: Date, pattern: 'd' | 'd MMM' | 'MMM d' | 'd MMMM yyyy'): string => {
  const d = date.getUTCDate();
  const m = date.getUTCMonth();
  switch (pattern) {
    case 'd':
      return String(d);
    case 'd MMM':
      return `${d} ${MONTH_ABBR[m]}`;
    case 'MMM d':
      return `${MONTH_ABBR[m]} ${d}`;
    case 'd MMMM yyyy':
      return `${d} ${MONTH_NAMES[m]} ${date.getUTCFullYear()}`;
  }
};

/** Number of ISO weeks in a year (52 or 53). */
export const weeksInYear = (year: number): number =>
  isoWeekNumber(utc(year, 12, 28));

/** Formats a time-of-day given in minutes since midnight. */
export function formatTime(minutes: number, use24h: boolean): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  if (use24h) return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}
