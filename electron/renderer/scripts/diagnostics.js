export function showAppError(elements, title, detail) {
  if (!elements.appErrorBanner || !elements.appErrorMeta || !elements.appErrorText) {
    return;
  }

  elements.appErrorBanner.hidden = false;
  elements.appErrorMeta.textContent = title || '未知错误';
  elements.appErrorText.textContent = formatErrorDetail(detail);
}

export function clearAppError(elements) {
  if (!elements.appErrorBanner || !elements.appErrorMeta || !elements.appErrorText) {
    return;
  }

  elements.appErrorBanner.hidden = true;
  elements.appErrorMeta.textContent = '等待诊断';
  elements.appErrorText.textContent = '';
}

export function formatErrorDetail(detail) {
  if (!detail) {
    return '无额外错误信息';
  }
  if (typeof detail === 'string') {
    return detail;
  }
  if (detail instanceof Error) {
    return [detail.message, detail.stack].filter(Boolean).join('\n');
  }
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}
