type TranslateFn = (key: string, ...args: any[]) => string

function normalizeWatchTextKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function translateKnownWatchText(t: TranslateFn, prefix: string, value?: string | null, fallback = '-') {
	const raw = value?.trim()
	if (!raw) return fallback
	const normalized = normalizeWatchTextKey(raw)
	if (prefix === 'reason' && normalized === 'watch_integration_account_health_unavailable') {
		return t('admin.watch.integrationTitle') === '接入诊断'
			? '接入诊断运行健康暂不可用，请稍后重试'
			: 'Integration runtime health is temporarily unavailable. Try again later.'
	}
	const key = `admin.watch.${prefix}_${normalized}`
	const translated = t(key)
	return translated === key ? raw : translated
}

export function watchReasonText(t: TranslateFn, reason?: string | null, fallback = '-') {
  return translateKnownWatchText(t, 'reason', reason, fallback)
}

export function watchStatusLabel(t: TranslateFn, status?: string | null) {
  return translateKnownWatchText(t, 'status', status, t('admin.watch.status_unchecked'))
}
