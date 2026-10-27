const MS_PER_DAY = 24 * 60 * 60 * 1000;

const isWeekend = (date: Date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;

/** `days` business days (Monday to Friday) after the UTC day of `from`, as `YYYY-MM-DD`. */
export const addBusinessDays = (from: Date, days: number) => {
  let date = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  let remaining = days;
  while (remaining > 0) {
    date = new Date(date.getTime() + MS_PER_DAY);
    if (!isWeekend(date)) {
      remaining--;
    }
  }
  return date.toISOString().slice(0, 10);
};
