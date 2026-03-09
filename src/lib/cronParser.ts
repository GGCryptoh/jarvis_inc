/**
 * Minimal cron evaluator — checks if a cron expression is due.
 * Supports: minute hour day-of-month month day-of-week
 * Special values: * (any), star/N (every N), comma-separated lists, ranges (1-5)
 */

export function isCronDue(cron: string, lastRun: Date | null, now: Date = new Date()): boolean {
  if (!cron || !cron.trim()) return false;

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minPat, hourPat, domPat, monPat, dowPat] = parts;

  // Check if current time matches the cron pattern
  if (!matchField(minPat, now.getMinutes(), 0, 59)) return false;
  if (!matchField(hourPat, now.getHours(), 0, 23)) return false;
  if (!matchField(domPat, now.getDate(), 1, 31)) return false;
  if (!matchField(monPat, now.getMonth() + 1, 1, 12)) return false;
  if (!matchField(dowPat, now.getDay(), 0, 6)) return false;

  // If we matched, ensure we haven't already run in this minute
  if (lastRun) {
    const lastMinute = Math.floor(lastRun.getTime() / 60000);
    const nowMinute = Math.floor(now.getTime() / 60000);
    if (lastMinute >= nowMinute) return false;
  }

  return true;
}

function matchField(pattern: string, value: number, _min: number, _max: number): boolean {
  if (pattern === '*') return true;

  // Step: */N (every N from min)
  if (pattern.startsWith('*/')) {
    const step = parseInt(pattern.slice(2), 10);
    return !isNaN(step) && step > 0 && (value - _min) % step === 0;
  }

  // Comma-separated list: 1,5,10
  const parts = pattern.split(',');
  return parts.some((p) => {
    // Start/step: N/S (e.g. 49/5 = 49,54,59)
    if (p.includes('/')) {
      const [startStr, stepStr] = p.split('/');
      const start = parseInt(startStr, 10);
      const step = parseInt(stepStr, 10);
      if (isNaN(start) || isNaN(step) || step <= 0) return false;
      if (value < start) return false;
      return (value - start) % step === 0;
    }
    // Range: 1-5
    if (p.includes('-')) {
      const [lo, hi] = p.split('-').map(Number);
      return !isNaN(lo) && !isNaN(hi) && value >= lo && value <= hi;
    }
    return parseInt(p, 10) === value;
  });
}
