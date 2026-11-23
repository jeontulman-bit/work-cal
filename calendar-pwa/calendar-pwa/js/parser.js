/**
 * Protocol parser for work/leave messages.
 * Formats:
 *   12.5/근무종류(철야)
 *   12.5/연가(홍길동 연가,김갑돌 병가)
 * Multi-line supported.
 */

/**
 * Infer full year for month.day based on current date.
 * Rule: if now is Nov/Dec and incoming is 1.x → next year
 *       if now is Jan and incoming is 12.x → prev year
 */
export function inferYear(month, day, now = new Date()) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  let year = currentYear;
  if (currentMonth >= 11 && month <= 2) {
    year = currentYear + 1;
  } else if (currentMonth <= 2 && month >= 11) {
    year = currentYear - 1;
  }
  return year;
}

/**
 * Validate date exists (handles 2.30 etc.)
 */
export function isValidDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Parse a single line of protocol.
 * Returns { type: 'work'|'leave', date: 'YYYY-MM-DD', value: string|string[] } or null
 */
export function parseLine(line, now = new Date()) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim().replace(/\u3000/g, ' '); // full-width space
  if (!trimmed) return null;

  // Normalize full/half width parens and slash
  const normalized = trimmed
    .replace(/／/g, '/')
    .replace(/（/g, '(')
    .replace(/）/g, ')');

  // Match: MM.DD / type ( content )
  const re = /^(\d{1,2})\.(\d{1,2})\s*\/\s*(근무종류|연가)\s*\((.*)\)\s*$/;
  const m = normalized.match(re);
  if (!m) return null;

  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const kind = m[3];
  const content = m[4].trim();

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const year = inferYear(month, day, now);
  if (!isValidDate(year, month, day)) return null;

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  if (kind === '근무종류') {
    return {
      type: 'work',
      date: dateStr,
      month: dateStr.slice(0, 7),
      value: content || null
    };
  }

  if (kind === '연가') {
    const items = content
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    return {
      type: 'leave',
      date: dateStr,
      month: dateStr.slice(0, 7),
      value: items // empty array means clear
    };
  }

  return null;
}

/**
 * Parse full message body (possibly multi-line)
 */
export function parseMessage(body, now = new Date()) {
  if (!body) return [];
  const lines = String(body).split(/\r?\n/);
  const results = [];
  for (const line of lines) {
    const parsed = parseLine(line, now);
    if (parsed) results.push(parsed);
  }
  return results;
}

/**
 * Build protocol string from form values
 */
export function buildProtocol(dateStr, type, value) {
  // dateStr expected as "M.D" or "MM.DD"
  if (type === 'work') {
    return `${dateStr}/근무종류(${value || ''})`;
  }
  if (type === 'leave') {
    const list = Array.isArray(value) ? value.join(',') : (value || '');
    return `${dateStr}/연가(${list})`;
  }
  return '';
}

// Simple unit-test like helpers (can be called from console)
export function selfTest() {
  const cases = [
    ['12.5/근무종류(철야)', { type: 'work', value: '철야' }],
    ['12.5/연가(홍길동 연가,김갑돌 병가)', { type: 'leave', value: ['홍길동 연가', '김갑돌 병가'] }],
    ['12.5/연가()', { type: 'leave', value: [] }],
    ['  12.5 / 근무종류 ( 주간 )  ', { type: 'work', value: '주간' }],
    ['2.30/근무종류(테스트)', null], // invalid date
    ['invalid', null],
  ];
  const now = new Date(2026, 10, 22); // Nov 22 2026
  for (const [input, expected] of cases) {
    const got = parseLine(input, now);
    if (expected === null) {
      if (got !== null) console.warn('FAIL', input, got);
    } else {
      if (!got || got.type !== expected.type || JSON.stringify(got.value) !== JSON.stringify(expected.value)) {
        console.warn('FAIL', input, got);
      }
    }
  }
  console.log('parser selfTest done');
}
