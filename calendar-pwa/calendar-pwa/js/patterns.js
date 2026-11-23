/**
 * Work pattern application logic
 */

/**
 * Apply active cycle pattern to a date if no received workType exists.
 * Pattern shape:
 * {
 *   id, name, type: 'cycle',
 *   cycle: ['주간','야간','비번','휴무'],
 *   startDate: 'YYYY-MM-DD',  // day 0 of cycle
 *   active: true
 * }
 */
export function getPatternWorkType(dateStr, patterns) {
  const active = patterns.find(p => p.active && p.type === 'cycle');
  if (!active || !active.cycle || !active.cycle.length || !active.startDate) return null;

  const start = new Date(active.startDate + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  if (isNaN(start) || isNaN(target)) return null;

  const diffDays = Math.floor((target - start) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return null; // before start

  const idx = diffDays % active.cycle.length;
  return active.cycle[idx] || null;
}

/**
 * Merge day data: received takes priority over pattern
 */
export function resolveDayDisplay(dayRecord, dateStr, patterns) {
  const workType = (dayRecord && dayRecord.workType) 
    ? dayRecord.workType 
    : getPatternWorkType(dateStr, patterns);
  const leaveList = (dayRecord && Array.isArray(dayRecord.leaveList)) 
    ? dayRecord.leaveList 
    : [];
  return { workType, leaveList, hasReceived: !!(dayRecord && (dayRecord.workType || (dayRecord.leaveList && dayRecord.leaveList.length))) };
}
