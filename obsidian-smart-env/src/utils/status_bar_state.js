/**
 * Count notification events from event logs.
 * @param {Object} [event_logs]
 * @param {Array<{event_key?: string}>} [event_logs.session_events]
 * @returns {number}
 */
export function get_notification_event_count(event_logs) {
  const session_events = event_logs?.session_events;
  if (!Array.isArray(session_events)) return 0;
  let count = 0;
  for (const entry of session_events) {
    const event_key = entry?.event_key;
    if (typeof event_key === 'string' && event_key.startsWith('notification:')) {
      count += 1;
    }
  }
  return count;
}

/**
 * Build status bar state based on the environment.
 * @param {import('../../smart_env.js').SmartEnv} env
 * @returns {{message: string, title: string, indicator_count: number, indicator_level: (string|null), embed_queue_count: number}}
 */
export function get_status_bar_state(env) {
  const embed_queue_count = Object.keys(env?.smart_sources?.sources_re_import_queue || {}).length;
  const notification_count = get_notification_event_count(env?.event_logs);
  const version = env?.constructor?.version;
  const startup_health = env?.smart_sources?.startup_health;
  let message = `Smart Env${version ? ' ' + version : ''}`;
  let title = get_startup_health_title(startup_health) || 'Smart Environment status';
  let indicator_level = null;

  if (embed_queue_count > 0) {
    message = `Embed now (${embed_queue_count})`;
    title = 'Click to re-import.';
    indicator_level = 'attention';
  } else if (startup_health?.import_queue_count > 0 && startup_health.import_time_ms === null) {
    message = `Importing ${startup_health.import_queue_count}`;
    indicator_level = 'attention';
  } else if (startup_health?.embed_queue_count > 0 && startup_health.embed_time_ms === null) {
    message = `Embedding ${startup_health.embed_queue_count}`;
    indicator_level = 'attention';
  } else if (startup_health?.source_count) {
    message = `Smart Env: ${format_compact_count(startup_health.source_count)} sources`;
  } else if (notification_count > 0) {
    indicator_level = env?.event_logs?.notification_status || 'info';
  }

  return {
    message,
    title,
    indicator_count: notification_count,
    indicator_level,
    embed_queue_count,
  };
}

function get_startup_health_title(startup_health) {
  if (!startup_health) return null;
  const lines = [
    'Smart Environment status',
    `Sources: ${startup_health.source_count ?? 0}`,
  ];
  if (startup_health.import_queue_count !== null) {
    lines.push(`Import queue: ${startup_health.import_queue_count}`);
  }
  if (startup_health.embed_queue_count !== null) {
    lines.push(`Embed queue: ${startup_health.embed_queue_count}`);
  }
  const skipped_count = Object.values(startup_health.skipped_sources || {})
    .reduce((count, entry) => count + (entry?.count || 0), 0);
  if (skipped_count) lines.push(`Skipped imports: ${skipped_count}`);
  return lines.join('\n');
}

function format_compact_count(count) {
  if (count < 10000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}
