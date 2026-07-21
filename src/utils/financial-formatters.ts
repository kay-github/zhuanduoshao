export function formatCurrency(value: number, withUnit = true) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  const result = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

  return withUnit ? `¥${result}` : result
}

export function formatChinaDateTime(value: string) {
  const date = new Date(value)

  if (!Number.isFinite(date.getTime())) {
    return '--'
  }

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const readPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '--'

  return `${readPart('month')}-${readPart('day')} ${readPart('hour')}:${readPart('minute')}`
}

export function formatShareQuantity(value: number) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPlainNumber(value: number, maximumFractionDigits: number) {
  if (!Number.isFinite(value)) {
    return ''
  }

  return new Intl.NumberFormat('zh-CN', {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value)
}

export function formatYiFromYuan(value: number) {
  return formatYiUnit(value / 100_000_000)
}

export function formatMarketCapFromYuan(value: number) {
  return formatYiFromYuan(value)
}

export function formatYiUnit(value: number) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  const usesWanYi = value >= 10_000
  const displayValue = usesWanYi ? value / 10_000 : value
  const maximumFractionDigits = usesWanYi ? 2 : Number.isInteger(value) ? 0 : 1

  return `${new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(displayValue)}${usesWanYi ? '万亿' : '亿'}`
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) {
    return '--'
  }

  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

export function profitClass(value: number) {
  if (!Number.isFinite(value)) {
    return 'is-flat'
  }

  if (value > 0) {
    return 'is-up'
  }

  if (value < 0) {
    return 'is-down'
  }

  return 'is-flat'
}
