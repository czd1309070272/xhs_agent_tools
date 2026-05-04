export function truncate(text, maxLength = 110) {
  if (!text) {
    return '暂无正文预览';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function formatTaskHistoryTime(isoString) {
  if (!isoString) {
    return '未知时间';
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatTaskHistoryDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round((durationMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分 ${seconds}秒` : `${seconds}秒`;
}

export function getTaskHistoryStatusLabel(status) {
  if (status === 'failed') {
    return '失败';
  }
  if (status === 'cancelled') {
    return '取消';
  }
  return '完成';
}

export function parseMetricValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const text = String(value || '').trim().toLowerCase();
  if (!text) {
    return 0;
  }

  const normalized = text.replace(/,/g, '');
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return 0;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base)) {
    return 0;
  }

  if (normalized.includes('万') || normalized.endsWith('w')) {
    return Math.round(base * 10000);
  }
  if (normalized.includes('千') || normalized.endsWith('k')) {
    return Math.round(base * 1000);
  }
  return Math.round(base);
}

export function parsePublishedTimeToTimestamp(value, fallbackIso = '') {
  const text = String(value || '').trim();
  if (!text) {
    const fallback = Date.parse(fallbackIso || '');
    return Number.isNaN(fallback) ? 0 : fallback;
  }

  const now = new Date();
  if (text === '刚刚') {
    return now.getTime();
  }
  if (text === '昨天') {
    return now.getTime() - (24 * 60 * 60 * 1000);
  }
  if (text === '前天') {
    return now.getTime() - (2 * 24 * 60 * 60 * 1000);
  }

  let match = text.match(/^(\d+)\s*分钟前$/);
  if (match) {
    return now.getTime() - (Number(match[1]) * 60 * 1000);
  }

  match = text.match(/^(\d+)\s*小时前$/);
  if (match) {
    return now.getTime() - (Number(match[1]) * 60 * 60 * 1000);
  }

  match = text.match(/^(\d+)\s*天前$/);
  if (match) {
    return now.getTime() - (Number(match[1]) * 24 * 60 * 60 * 1000);
  }

  match = text.match(/^(\d+)\s*周前$/);
  if (match) {
    return now.getTime() - (Number(match[1]) * 7 * 24 * 60 * 60 * 1000);
  }

  match = text.match(/^(\d+)\s*个月前$/);
  if (match) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - Number(match[1]));
    return date.getTime();
  }

  match = text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const date = new Date(now.getFullYear(), Number(match[1]) - 1, Number(match[2]), 12, 0, 0, 0);
    if (date.getTime() > now.getTime()) {
      date.setFullYear(date.getFullYear() - 1);
    }
    return date.getTime();
  }

  match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0).getTime();
  }

  const direct = Date.parse(text);
  if (!Number.isNaN(direct)) {
    return direct;
  }

  const fallback = Date.parse(fallbackIso || '');
  return Number.isNaN(fallback) ? 0 : fallback;
}

export function getResultIdentity(item) {
  return item.id || item.url || `${item.title || ''}-${item.author || ''}`;
}

export function mergeLibraryResults(existingResults, incomingResults) {
  const merged = [];
  const seen = new Set();

  [...(incomingResults || []), ...(existingResults || [])].forEach((item) => {
    const key = getResultIdentity(item);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(item);
  });

  return merged;
}

export function getLibrarySearchContent(item) {
  return [
    item?.title,
    item?.author,
    item?.content,
    item?.publishedTime,
    ...(item?.tags || [])
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}
