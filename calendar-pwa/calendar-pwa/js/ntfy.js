/**
 * ntfy polling & publishing (hidden from end users as "topic")
 * Default server: https://ntfy.sh
 */

const DEFAULT_SERVER = 'https://ntfy.sh';

export async function fetchMessages(topic, options = {}) {
  if (!topic) return [];
  const server = options.server || DEFAULT_SERVER;
  const since = options.since || 'all'; // 'all' = all cached messages (ntfy does not accept '7d'/'1d')
  const url = `${server}/${encodeURIComponent(topic)}/json?poll=1&since=${encodeURIComponent(since)}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/x-ndjson' },
      cache: 'no-store'
    });
    if (!res.ok) {
      if (res.status === 404) return []; // topic empty ok
      throw new Error(`HTTP ${res.status}`);
    }
    const text = await res.text();
    if (!text.trim()) return [];

    const lines = text.trim().split('\n');
    const messages = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        // ntfy message shape: { id, time, event, topic, message, title, ... }
        if (obj.event === 'message' || obj.message) {
          messages.push({
            id: obj.id,
            time: obj.time, // unix seconds
            message: obj.message || '',
            title: obj.title || '',
            topic: obj.topic || topic
          });
        }
      } catch (_) { /* skip bad line */ }
    }
    // newest first already? sort by time desc
    messages.sort((a, b) => (b.time || 0) - (a.time || 0));
    return messages;
  } catch (err) {
    console.error('ntfy fetch error', err);
    throw err;
  }
}

/**
 * Publish a message to topic
 */
export async function publishMessage(topic, body, options = {}) {
  if (!topic) throw new Error('토픽이 필요합니다');
  const server = options.server || DEFAULT_SERVER;
  const url = `${server}/${encodeURIComponent(topic)}`;

  const headers = {
    'Content-Type': 'text/plain; charset=utf-8'
  };
  if (options.title) headers['Title'] = options.title;
  if (options.priority) headers['Priority'] = String(options.priority);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: body
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`발송 실패 (${res.status}): ${t || res.statusText}`);
  }
  return true;
}

export { DEFAULT_SERVER };
