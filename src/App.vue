<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { STOCKS, getFallbackQuote, isStockCode, type StockCode, type StockQuote } from '../shared/stocks'
import AppHeader from './components/AppHeader.vue'
import QuotePanel from './components/QuotePanel.vue'
import ScenarioProjectionPanel from './components/ScenarioProjectionPanel.vue'
import {
  DIVIDEND_TAX_BRACKETS,
  YUAN_PER_YI,
  adjustPositionForCorporateActions,
  calculateCurrentPositionMetrics,
  calculateRequiredPriceForProfit,
  calculateTargetMarketCapScenario,
  getDividendTaxRate,
  isDividendTaxBracketKey,
  type DividendTaxBracketKey,
} from './lib/portfolio-calculations'
import {
  MAX_POSITION_COST_PRICE,
  MAX_POSITION_QUANTITY,
  clonePositionDrafts,
  getChinaDateString,
  isValidBasisDate,
  mergeAnonymousDraftsWithSavedPositions,
  validatePositionDraft,
  type PositionDraft,
} from './lib/position-draft-state'
import { createSessionEpoch } from './lib/session-epoch'
import { buildShareCardData } from './lib/share-card'
import { exportShareCard } from './lib/share-card-renderer'
import {
  formatChinaDateTime,
  formatCurrency,
  formatPercent,
  formatPlainNumber,
  formatShareQuantity,
  formatYiUnit,
  profitClass,
} from './utils/financial-formatters'

interface UserSummary {
  id: string
  username: string
}

interface QuotePayload {
  code: string
  name: string
  label: string
  latestPrice: number
  totalMarketCap: number
  priceChangePct: number
  updatedAt: string
  asOf?: string | null
  fetchedAt?: string | null
}

interface PositionPayload {
  userId?: string
  stockCode: string
  quantity: number
  costPrice: number
  basisDate?: string
  updatedAt?: string
}

interface DividendRecordPayload {
  reportDate: string
  totalRatio: number | null
  sendRatio: number | null
  transferRatio: number | null
  cashDividendRatio: number | null
  cashDividendDescription: string
  dividendYield: number | null
  recordDate: string
  exDate: string
  planProgress: string
  latestAnnouncementDate: string
}

interface DividendPayload {
  code: string
  name: string
  label: string
  records: DividendRecordPayload[]
}

type QuoteFreshness = 'live' | 'snapshot' | 'fallback'
type DividendFreshness = 'live' | 'partial' | 'cached' | 'fallback'

interface PersistedAppState {
  stateVersion?: number
  positionDraftScope?: 'anonymous'
  selectedCode?: string
  customMarketCap?: string
  customTargetMode?: string
  dividendTaxBracket?: string
  dividendTaxBrackets?: Partial<Record<StockCode, string>>
  targetProfitWan?: string
  selectedScenarioTargets?: number[]
  positionDrafts?: Partial<Record<StockCode, Partial<PositionDraft>>>
}

type AuthMode = 'login' | 'register'
type CustomTargetMode = 'marketCap' | 'price'
type SavePositionResult = 'saved' | 'changed-after-submit' | 'stale-session'

const presetMarketCaps = [10_000, 12_000, 13_000, 15_000, 18_000, 20_000]
const defaultSelectedScenarioTargets = [12_000, 15_000, 20_000]
const LOCAL_STATE_VERSION = 2
const LOCAL_STATE_KEY = 'zhuanduoshao_app_state_v2'
const LEGACY_LOCAL_STATE_KEY = 'zhuanduoshao_app_state_v1'
const QUOTE_AUTO_REFRESH_MS = 30_000
const SESSION_EXPIRED_MESSAGE = '登录状态已失效，已恢复登录前的本地草稿，请重新登录'
const SESSION_CHANGED_MESSAGE = '登录账号已在其他页面变更，已恢复登录前的本地草稿，请重新登录'
const legacyDefaultPosition = {
  quantity: 2000,
  costPrice: 84.5,
}
const defaultPosition = {
  quantity: 0,
  costPrice: 0,
  basisDate: todayDateValue(),
}

const selectedCode = ref<StockCode>('300502')
const customMarketCap = ref('23000')
const customTargetMode = ref<CustomTargetMode>('marketCap')
const targetProfitWan = ref('')
const authMode = ref<AuthMode>('login')
const authDialogOpen = ref(false)
const user = ref<UserSummary | null>(null)
const quotesPending = ref(false)
const quotesError = ref('')
const quoteFreshness = ref<QuoteFreshness>('fallback')
const quoteSource = ref('')
const dividendsPending = ref(false)
const dividendsError = ref('')
const dividendFreshness = ref<DividendFreshness>('fallback')
const dividendSource = ref('')
const positionsPending = ref(false)
const positionSavePending = ref(false)
const saveAllPending = ref(false)
const positionEditorOpen = ref(false)
const selectedScenarioTargets = ref<number[]>([...defaultSelectedScenarioTargets])
const positionMessage = ref('')
const positionError = ref('')
const localDraftError = ref('')
const authPending = ref(false)
const logoutPending = ref(false)
const authError = ref('')

const authForm = reactive({
  username: '',
  password: '',
})

const quoteMap = reactive(createQuoteMap())
const dividendMap = reactive(createDividendMap())
const positionDrafts = reactive(createPositionDrafts())
const dividendTaxBrackets = reactive(createDividendTaxBracketMap())
const pendingAnonymousDraftCodes = ref<StockCode[]>([])

let localStateReady = false
let anonymousDraftSnapshot = createPositionDrafts()
const sessionEpoch = createSessionEpoch()
let positionLoadSequence = 0

const customMarketCapWanYi = computed({
  get() {
    const customValue = Number(customMarketCap.value)

    if (!Number.isFinite(customValue) || customValue <= 0) {
      return ''
    }

    return formatPlainNumber(customValue / 10_000, 4)
  },
  set(value: string | number) {
    const rawValue = String(value).trim()

    if (!rawValue) {
      customMarketCap.value = ''
      return
    }

    const numericValue = Number(rawValue)

    if (!Number.isFinite(numericValue) || numericValue < 0) {
      return
    }

    customMarketCap.value = formatPlainNumber(numericValue * 10_000, 2)
  },
})

// Price-mode view over the same custom target: the target always lives in 亿
// internally; a price input is converted through the current cap/price ratio.
const customTargetPrice = computed({
  get() {
    const customValue = Number(customMarketCap.value)
    const { latestPrice, totalMarketCap } = activeStock.value

    if (!Number.isFinite(customValue) || customValue <= 0 || latestPrice <= 0 || totalMarketCap <= 0) {
      return ''
    }

    return formatPlainNumber((customValue * YUAN_PER_YI * latestPrice) / totalMarketCap, 2)
  },
  set(value: string | number) {
    const rawValue = String(value).trim()

    if (!rawValue) {
      customMarketCap.value = ''
      return
    }

    const numericValue = Number(rawValue)
    const { latestPrice, totalMarketCap } = activeStock.value

    if (!Number.isFinite(numericValue) || numericValue < 0 || latestPrice <= 0 || totalMarketCap <= 0) {
      return
    }

    customMarketCap.value = formatPlainNumber((numericValue / latestPrice) * (totalMarketCap / YUAN_PER_YI), 2)
  },
})

const stockOptions = computed(() => STOCKS.map((stock) => quoteMap[stock.code]))
const activeStock = computed(() => quoteMap[selectedCode.value])
const activeDividend = computed(() => dividendMap[selectedCode.value])
const activePosition = computed(() => positionDrafts[selectedCode.value])
const activeDividendTaxBracket = computed({
  get: () => dividendTaxBrackets[selectedCode.value],
  set: (value: DividendTaxBracketKey) => {
    dividendTaxBrackets[selectedCode.value] = value
  },
})
const quoteTimeText = computed(() => {
  if (activeStock.value.asOf) {
    return `行情时点 ${formatChinaDateTime(activeStock.value.asOf)}`
  }

  if (activeStock.value.fetchedAt) {
    return `缓存抓取 ${formatChinaDateTime(activeStock.value.fetchedAt)}`
  }

  return '内置回退数据'
})
const adjustedPosition = computed(() =>
  adjustPositionForCorporateActions(
    activePosition.value,
    activeDividend.value.records,
    todayDateValue(),
    getDividendTaxRate(activeDividendTaxBracket.value),
  ),
)
const currentMetrics = computed(() =>
  calculateCurrentPositionMetrics(adjustedPosition.value, activeStock.value.latestPrice),
)
const costAmount = computed(() => currentMetrics.value.costAmount)
const currentValue = computed(() => currentMetrics.value.currentValue)
const currentProfit = computed(() => currentMetrics.value.currentProfit)
const currentProfitPct = computed(() => currentMetrics.value.currentProfitPct)

const targetMarketCaps = computed(() => {
  const values = [...presetMarketCaps]
  const customValue = Number(customMarketCap.value)

  if (Number.isFinite(customValue) && customValue > 0) {
    values.push(customValue)
  }

  return [...new Set(values)].sort((a, b) => a - b)
})

const visibleTargetMarketCaps = computed(() =>
  targetMarketCaps.value.filter((target) => selectedScenarioTargets.value.includes(target)),
)

const scenarioRows = computed(() =>
  visibleTargetMarketCaps.value.map((target) => {
    const scenario = calculateTargetMarketCapScenario({
      targetMarketCapYi: target,
      latestPrice: activeStock.value.latestPrice,
      currentTotalMarketCap: activeStock.value.totalMarketCap,
      adjustedQuantity: adjustedPosition.value.quantity,
      cashDividendAmount: adjustedPosition.value.cashDividendAmount,
      originalCostAmount: costAmount.value,
      currentValue: currentValue.value,
    })

    return {
      targetLabel: formatYiUnit(target),
      ...scenario,
    }
  }),
)

const sharePendingTarget = ref<number | null>(null)
const shareStatusText = ref('')

async function shareScenario(targetMarketCapYi: number) {
  const row = scenarioRows.value.find((item) => item.targetMarketCapYi === targetMarketCapYi)

  if (!row || sharePendingTarget.value !== null) {
    return
  }

  sharePendingTarget.value = targetMarketCapYi
  shareStatusText.value = ''

  try {
    const card = buildShareCardData({
      stockName: activeStock.value.name,
      stockCode: activeStock.value.code,
      latestPrice: activeStock.value.latestPrice,
      targetMarketCapYi,
      targetPrice: row.targetPrice,
      distancePct: row.distancePct,
      adjustedQuantity: adjustedPosition.value.quantity,
      targetValue: row.targetValue,
      totalProfit: row.totalProfit,
      totalProfitPct: row.totalProfitPct,
      generatedDate: todayDateValue(),
    })

    const result = await exportShareCard(card, `赚多少-${activeStock.value.name}-${targetMarketCapYi}亿.png`)
    shareStatusText.value = result === 'shared' ? '已打开系统分享' : '分享图已保存到下载'
  } catch (error) {
    shareStatusText.value = readUnknownError(error, '分享图生成失败')
  } finally {
    sharePendingTarget.value = null
  }
}

const reverseProjection = computed(() => {
  const profitWan = Number(targetProfitWan.value)

  if (!Number.isFinite(profitWan) || profitWan <= 0) {
    return null
  }

  const result = calculateRequiredPriceForProfit({
    targetTotalProfit: profitWan * 10_000,
    latestPrice: activeStock.value.latestPrice,
    currentTotalMarketCap: activeStock.value.totalMarketCap,
    adjustedQuantity: adjustedPosition.value.quantity,
    cashDividendAmount: adjustedPosition.value.cashDividendAmount,
    originalCostAmount: costAmount.value,
  })

  if (!result.achievable) {
    return {
      achievable: false as const,
      message:
        adjustedPosition.value.quantity <= 0
          ? '请先录入持仓数量后再反推'
          : '按当前持仓，累计分红已覆盖该目标收益',
    }
  }

  return {
    achievable: true as const,
    requiredPriceText: formatCurrency(result.requiredPrice),
    requiredMarketCapText: formatYiUnit(result.requiredMarketCapYi),
    distanceText: formatPercent(result.distancePct),
    distancePct: result.distancePct,
  }
})

const quoteStatusText = computed(() => {
  if (quotesPending.value) {
    return '正在刷新多源行情'
  }

  if (quotesError.value) {
    return quotesError.value
  }

  if (quoteFreshness.value === 'live') {
    return quoteSource.value ? `实时多源行情 · ${quoteSource.value}` : '实时多源行情已接通'
  }

  if (quoteFreshness.value === 'snapshot') {
    return quoteSource.value
      ? `实时源短暂波动，当前展示最近成功缓存 · ${quoteSource.value}`
      : '实时源短暂波动，当前展示最近成功缓存'
  }

  return '实时源与缓存都不可用，当前展示内置回退数据'
})

const dividendStatusText = computed(() => {
  if (dividendsPending.value) {
    return '正在同步分红送转数据'
  }

  if (dividendsError.value) {
    return dividendsError.value
  }

  if (dividendFreshness.value === 'live') {
    return dividendSource.value ? `公司行动已同步 · ${dividendSource.value}` : '公司行动已同步'
  }

  if (dividendFreshness.value === 'partial') {
    return dividendSource.value ? `部分公司行动来自缓存 · ${dividendSource.value}` : '部分公司行动来自缓存'
  }

  if (dividendFreshness.value === 'cached') {
    return dividendSource.value ? `当前使用公司行动缓存 · ${dividendSource.value}` : '当前使用公司行动缓存'
  }

  return '公司行动暂未同步，当前按原始持仓估算'
})

const positionStatusText = computed(() => {
  if (positionsPending.value) {
    return '正在同步账号持仓'
  }

  if (positionError.value) {
    return positionError.value
  }

  if (!user.value && localDraftError.value) {
    return localDraftError.value
  }

  if (pendingAnonymousDraftCodes.value.length > 0) {
    const stockNames = pendingAnonymousDraftCodes.value
      .map((code) => STOCKS.find((stock) => stock.code === code)?.name)
      .filter((name) => name !== undefined)

    return `${stockNames.join('、')} 保留了登录前的本地录入，尚未保存到当前账号；请确认后点击保存`
  }

  if (positionMessage.value) {
    return positionMessage.value
  }

  if (user.value) {
    return `当前账号：${user.value.username}`
  }

  return '未登录输入仅保存在当前浏览器'
})

const customTargetSummary = computed(() => {
  const customValue = Number(customMarketCap.value)

  if (!Number.isFinite(customValue) || customValue <= 0) {
    return '未设置'
  }

  const priceText = customTargetPrice.value ? `，对应股价约 ${formatCurrency(Number(customTargetPrice.value))}` : ''
  return `${formatYiUnit(customValue)}${priceText}`
})

const positionSummaryText = computed(
  () =>
    `基准日原始数据：${activePosition.value.quantity} 股、成本 ${formatCurrency(activePosition.value.costPrice)}；自定义目标 ${customTargetSummary.value}`,
)

const positionAutoSummaryText = computed(
  () =>
    `${positionSummaryText.value}；日期 ${activePosition.value.basisDate}，送转后按 ${formatShareQuantity(adjustedPosition.value.quantity)} 股推演`,
)

const corporateActionSummaryText = computed(() => {
  if (adjustedPosition.value.appliedActions.length === 0) {
    return '暂无需要自动应用的已实施分红送转'
  }

  const taxNote =
    adjustedPosition.value.dividendTaxAmount > 0
      ? `（税前 ${formatCurrency(adjustedPosition.value.preTaxCashDividendAmount)}，红利税 ${formatCurrency(
          adjustedPosition.value.dividendTaxAmount,
        )}）`
      : ''

  return `${adjustedPosition.value.appliedActions.length} 次已实施分红送转，累计现金 ${formatCurrency(
    adjustedPosition.value.cashDividendAmount,
  )}${taxNote}`
})

// A-share trading sessions (China time): 09:30-11:30, 13:00-15:00, Mon-Fri.
// Holidays are not modeled; an extra refresh on a holiday is harmless.
function isMarketTradingTime(now = new Date()) {
  const chinaParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const readPart = (type: Intl.DateTimeFormatPartTypes) =>
    chinaParts.find((part) => part.type === type)?.value ?? ''
  const weekday = readPart('weekday')

  if (weekday === 'Sat' || weekday === 'Sun') {
    return false
  }

  const minutes = Number(readPart('hour')) * 60 + Number(readPart('minute'))
  return (minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60)
}

const marketOpen = ref(isMarketTradingTime())
let quoteRefreshTimer: ReturnType<typeof setInterval> | undefined

const marketSessionText = computed(() => (marketOpen.value ? '交易时段 · 自动刷新' : '非交易时段'))

function refreshQuotesOnTimer() {
  marketOpen.value = isMarketTradingTime()

  if (marketOpen.value && !quotesPending.value && document.visibilityState === 'visible') {
    void loadQuotes()
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    refreshQuotesOnTimer()
  }
}

watch(selectedCode, () => {
  positionMessage.value = ''
  positionError.value = ''
  persistLocalState()
})

watch(customMarketCap, () => {
  ensureCustomTargetSelected()
  persistLocalState()
})

watch(selectedScenarioTargets, () => {
  persistLocalState()
})

watch([customTargetMode, targetProfitWan], () => {
  persistLocalState()
})

watch(
  dividendTaxBrackets,
  () => {
    persistLocalState()
  },
  { deep: true },
)

watch(
  targetMarketCaps,
  (nextTargets, previousTargets) => {
    const nextTargetSet = new Set(nextTargets)
    let nextSelectedTargets = selectedScenarioTargets.value.filter((target) => nextTargetSet.has(target))
    const previousCustomTarget = previousTargets?.find((target) => !presetMarketCaps.includes(target))
    const nextCustomTarget = nextTargets.find((target) => !presetMarketCaps.includes(target))

    if (nextCustomTarget && previousCustomTarget && previousCustomTarget !== nextCustomTarget) {
      nextSelectedTargets = nextSelectedTargets.filter((target) => target !== previousCustomTarget)
    }

    if (nextCustomTarget && !nextSelectedTargets.includes(nextCustomTarget)) {
      nextSelectedTargets = [...nextSelectedTargets, nextCustomTarget]
    }

    if (nextSelectedTargets.length === 0) {
      nextSelectedTargets = nextTargets.slice(0, Math.min(3, nextTargets.length))
    }

    selectedScenarioTargets.value = [...new Set(nextSelectedTargets)].sort((a, b) => a - b)
  },
  { immediate: true },
)

watch(
  positionDrafts,
  () => {
    persistLocalState()
  },
  { deep: true },
)

onMounted(() => {
  restoreLocalState()
  localStateReady = true
  if (persistLocalState()) {
    window.localStorage.removeItem(LEGACY_LOCAL_STATE_KEY)
  }
  void loadQuotes()
  void loadDividends()
  void restoreSession()
  quoteRefreshTimer = setInterval(refreshQuotesOnTimer, QUOTE_AUTO_REFRESH_MS)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  clearInterval(quoteRefreshTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

function createQuoteMap() {
  return STOCKS.reduce(
    (all, stock) => {
      all[stock.code] = getFallbackQuote(stock.code)
      return all
    },
    {} as Record<StockCode, StockQuote>,
  )
}

function createDividendMap() {
  return STOCKS.reduce(
    (all, stock) => {
      all[stock.code] = {
        code: stock.code,
        name: stock.name,
        label: stock.label,
        records: [],
      }
      return all
    },
    {} as Record<StockCode, DividendPayload>,
  )
}

function createPositionDrafts() {
  return STOCKS.reduce(
    (all, stock) => {
      all[stock.code] = { ...defaultPosition }
      return all
    },
    {} as Record<StockCode, PositionDraft>,
  )
}

function createDividendTaxBracketMap() {
  return STOCKS.reduce(
    (all, stock) => {
      all[stock.code] = 'over-1y'
      return all
    },
    {} as Record<StockCode, DividendTaxBracketKey>,
  )
}

function setPositionDrafts(nextDrafts: Record<StockCode, PositionDraft>) {
  for (const stock of STOCKS) {
    positionDrafts[stock.code] = { ...nextDrafts[stock.code] }
  }
}

function beginSessionTransition() {
  positionLoadSequence += 1
  positionsPending.value = false
  positionSavePending.value = false
  saveAllPending.value = false
  return sessionEpoch.begin()
}

function isCurrentAuthenticatedSession(epoch: number, userId: string) {
  return sessionEpoch.isCurrent(epoch) && user.value?.id === userId
}

function positionDraftsMatch(left: PositionDraft, right: PositionDraft) {
  return (
    left.quantity === right.quantity && left.costPrice === right.costPrice && left.basisDate === right.basisDate
  )
}

function captureAnonymousDraftSnapshot() {
  anonymousDraftSnapshot = clonePositionDrafts(
    STOCKS.map((stock) => stock.code),
    positionDrafts,
  )
}

function restoreAnonymousDraftSnapshot() {
  pendingAnonymousDraftCodes.value = []
  setPositionDrafts(anonymousDraftSnapshot)
}

function openAuth(mode: AuthMode) {
  authMode.value = mode
  authDialogOpen.value = true
  authError.value = ''
  authForm.password = ''
}

function closeAuthDialog() {
  authDialogOpen.value = false
  authError.value = ''
  authForm.password = ''
}

function switchAuthMode(mode: AuthMode) {
  authMode.value = mode
  authError.value = ''
  authForm.password = ''
}

function clearPositionFeedback() {
  positionMessage.value = ''
  positionError.value = ''
}

function togglePositionEditor() {
  positionEditorOpen.value = !positionEditorOpen.value
}

function toggleScenarioTarget(target: number) {
  const isSelected = selectedScenarioTargets.value.includes(target)

  if (isSelected) {
    if (selectedScenarioTargets.value.length === 1) {
      return
    }

    selectedScenarioTargets.value = selectedScenarioTargets.value.filter((item) => item !== target)
    return
  }

  selectedScenarioTargets.value = [...selectedScenarioTargets.value, target].sort((a, b) => a - b)
}

function readCustomTargetMarketCap() {
  const customValue = Number(customMarketCap.value)
  return Number.isFinite(customValue) && customValue > 0 ? customValue : null
}

function ensureCustomTargetSelected() {
  const customValue = readCustomTargetMarketCap()

  if (!customValue || selectedScenarioTargets.value.includes(customValue)) {
    return
  }

  selectedScenarioTargets.value = [...selectedScenarioTargets.value, customValue].sort((a, b) => a - b)
}

function todayDateValue() {
  return getChinaDateString()
}

function normalizeDateValue(value: unknown, fallbackValue = todayDateValue()) {
  if (typeof value !== 'string' || !isValidBasisDate(value, todayDateValue())) {
    return fallbackValue
  }

  return value
}

function dateFromIsoValue(value: unknown, fallbackValue = todayDateValue()) {
  if (typeof value !== 'string') {
    return fallbackValue
  }

  const parsedDate = new Date(value)

  if (!Number.isFinite(parsedDate.getTime())) {
    return fallbackValue
  }

  return normalizeDateValue(getChinaDateString(parsedDate), fallbackValue)
}

function normalizeDraftValue(value: unknown, fallbackValue: number, maximumValue = Number.MAX_VALUE) {
  const numericValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > maximumValue) {
    return fallbackValue
  }

  return numericValue
}

function restoreSavedPositionDraft(savedDraft: Partial<PositionDraft>): PositionDraft {
  const savedQuantity = normalizeDraftValue(
    savedDraft.quantity,
    defaultPosition.quantity,
    MAX_POSITION_QUANTITY,
  )
  const savedCostPrice = normalizeDraftValue(
    savedDraft.costPrice,
    defaultPosition.costPrice,
    MAX_POSITION_COST_PRICE,
  )
  const isLegacyDemoValue =
    savedCostPrice === legacyDefaultPosition.costPrice &&
    (savedQuantity === legacyDefaultPosition.quantity || savedQuantity === defaultPosition.quantity)

  if (isLegacyDemoValue) {
    return { ...defaultPosition, basisDate: normalizeDateValue(savedDraft.basisDate, defaultPosition.basisDate) }
  }

  return {
    quantity: Math.trunc(savedQuantity),
    costPrice: savedCostPrice,
    basisDate: normalizeDateValue(savedDraft.basisDate, defaultPosition.basisDate),
  }
}

function restoreLocalState() {
  let sourceKey = LOCAL_STATE_KEY
  let rawState: string | null = null

  try {
    rawState = window.localStorage.getItem(LOCAL_STATE_KEY)

    if (!rawState) {
      sourceKey = LEGACY_LOCAL_STATE_KEY
      rawState = window.localStorage.getItem(LEGACY_LOCAL_STATE_KEY)
    }
  } catch {
    localDraftError.value = '当前浏览器无法读取本地草稿，请勿在未登录状态下依赖本地保存'
    return
  }

  if (!rawState) {
    return
  }

  try {
    const parsedState = JSON.parse(rawState) as PersistedAppState

    if (typeof parsedState.selectedCode === 'string' && isStockCode(parsedState.selectedCode)) {
      selectedCode.value = parsedState.selectedCode
    }

    if (typeof parsedState.customMarketCap === 'string') {
      customMarketCap.value = parsedState.customMarketCap
    }

    if (parsedState.customTargetMode === 'marketCap' || parsedState.customTargetMode === 'price') {
      customTargetMode.value = parsedState.customTargetMode
    }

    for (const stock of STOCKS) {
      const savedBracket = parsedState.dividendTaxBrackets?.[stock.code] ?? parsedState.dividendTaxBracket

      if (isDividendTaxBracketKey(savedBracket)) {
        dividendTaxBrackets[stock.code] = savedBracket
      }
    }

    if (typeof parsedState.targetProfitWan === 'string') {
      targetProfitWan.value = parsedState.targetProfitWan
    }

    if (Array.isArray(parsedState.selectedScenarioTargets)) {
      const restoredTargets = parsedState.selectedScenarioTargets.filter(
        (target): target is number => Number.isFinite(target) && target > 0,
      )

      // An empty restored list would leave the projection blank with no watcher
      // to refill it; fall back to the defaults instead.
      if (restoredTargets.length > 0) {
        selectedScenarioTargets.value = restoredTargets
      }
    }

    if (parsedState.positionDrafts) {
      for (const stock of STOCKS) {
        const savedDraft = parsedState.positionDrafts[stock.code]

        if (!savedDraft) {
          continue
        }

        positionDrafts[stock.code] = restoreSavedPositionDraft(savedDraft)
      }
    }

    captureAnonymousDraftSnapshot()
    ensureCustomTargetSelected()
  } catch {
    window.localStorage.removeItem(sourceKey)
  }
}

function persistLocalState() {
  if (!localStateReady) {
    return false
  }

  if (!user.value) {
    captureAnonymousDraftSnapshot()
  }

  const nextState: PersistedAppState = {
    stateVersion: LOCAL_STATE_VERSION,
    positionDraftScope: 'anonymous',
    selectedCode: selectedCode.value,
    customMarketCap: customMarketCap.value,
    customTargetMode: customTargetMode.value,
    dividendTaxBrackets: STOCKS.reduce(
      (all, stock) => {
        all[stock.code] = dividendTaxBrackets[stock.code]
        return all
      },
      {} as Partial<Record<StockCode, string>>,
    ),
    targetProfitWan: targetProfitWan.value,
    selectedScenarioTargets: selectedScenarioTargets.value,
    positionDrafts: STOCKS.reduce(
      (all, stock) => {
        all[stock.code] = {
          quantity: anonymousDraftSnapshot[stock.code].quantity,
          costPrice: anonymousDraftSnapshot[stock.code].costPrice,
          basisDate: anonymousDraftSnapshot[stock.code].basisDate,
        }
        return all
      },
      {} as Partial<Record<StockCode, Partial<PositionDraft>>>,
    ),
  }

  try {
    window.localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(nextState))
    localDraftError.value = ''
    return true
  } catch {
    localDraftError.value = '本地草稿保存失败，请登录后保存持仓，或暂时不要关闭当前页面'
    return false
  }
}

function normalizeQuote(payload: QuotePayload) {
  if (!isStockCode(payload.code)) {
    return null
  }

  return {
    code: payload.code,
    name: payload.name,
    label: payload.label,
    latestPrice: payload.latestPrice,
    totalMarketCap: payload.totalMarketCap,
    priceChangePct: payload.priceChangePct,
    updatedAt: payload.updatedAt,
    asOf: typeof payload.asOf === 'string' ? payload.asOf : null,
    fetchedAt: typeof payload.fetchedAt === 'string' ? payload.fetchedAt : null,
  } satisfies StockQuote
}

function normalizeDividend(payload: DividendPayload) {
  if (!isStockCode(payload.code) || !Array.isArray(payload.records)) {
    return null
  }

  return {
    code: payload.code,
    name: payload.name,
    label: payload.label,
    records: payload.records.filter((record) => record && typeof record.exDate === 'string'),
  } satisfies DividendPayload
}

function readApiError(payload: unknown, fallbackMessage: string) {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error
  }

  return fallbackMessage
}

function readUnknownError(error: unknown, fallbackMessage: string) {
  return error instanceof Error && error.message ? error.message : fallbackMessage
}

async function readJsonResponse(response: Response) {
  return (await response.json().catch(() => null)) as unknown
}

async function loadQuotes() {
  quotesPending.value = true
  quotesError.value = ''

  try {
    const response = await fetch('/api/quotes', {
      headers: {
        Accept: 'application/json',
      },
    })

    const payload = (await readJsonResponse(response)) as {
      quotes?: QuotePayload[]
      freshness?: QuoteFreshness
      source?: string
    } | null

    if (!response.ok) {
      throw new Error(readApiError(payload, '行情接口暂时不可用'))
    }

    quoteFreshness.value = payload?.freshness ?? 'fallback'
    quoteSource.value = typeof payload?.source === 'string' ? payload.source : ''

    for (const quote of payload?.quotes ?? []) {
      const normalizedQuote = normalizeQuote(quote)

      if (normalizedQuote) {
        quoteMap[normalizedQuote.code] = normalizedQuote
      }
    }
  } catch (error) {
    quoteFreshness.value = 'fallback'
    quoteSource.value = ''
    quotesError.value = `${readUnknownError(error, '行情刷新失败')}，当前展示本地已加载数据`
  } finally {
    quotesPending.value = false
  }
}

async function loadDividends() {
  dividendsPending.value = true
  dividendsError.value = ''

  try {
    const response = await fetch('/api/dividends', {
      headers: {
        Accept: 'application/json',
      },
    })

    const payload = (await readJsonResponse(response)) as {
      dividends?: DividendPayload[]
      freshness?: DividendFreshness
      source?: string
    } | null

    if (!response.ok) {
      throw new Error(readApiError(payload, '分红送转接口暂时不可用'))
    }

    dividendFreshness.value = payload?.freshness ?? 'fallback'
    dividendSource.value = typeof payload?.source === 'string' ? payload.source : ''

    for (const dividend of payload?.dividends ?? []) {
      const normalizedDividend = normalizeDividend(dividend)

      if (normalizedDividend) {
        dividendMap[normalizedDividend.code] = normalizedDividend
      }
    }
  } catch (error) {
    dividendFreshness.value = 'fallback'
    dividendSource.value = ''
    dividendsError.value = `${readUnknownError(error, '分红送转同步失败')}，当前按原始持仓估算`
  } finally {
    dividendsPending.value = false
  }
}

async function restoreSession() {
  const requestEpoch = beginSessionTransition()

  try {
    const response = await fetch('/api/auth/me', {
      headers: {
        Accept: 'application/json',
      },
      credentials: 'same-origin',
    })

    const payload = (await readJsonResponse(response)) as { user?: UserSummary } | null

    if (!sessionEpoch.isCurrent(requestEpoch)) {
      return
    }

    if (response.status === 401) {
      user.value = null
      authError.value = ''
      return
    }

    if (!response.ok || !payload?.user) {
      throw new Error(readApiError(payload, '登录状态恢复失败'))
    }

    captureAnonymousDraftSnapshot()
    persistLocalState()
    user.value = payload.user
    authError.value = ''
    await loadPositions(requestEpoch)
  } catch (error) {
    if (!sessionEpoch.isCurrent(requestEpoch)) {
      return
    }

    user.value = null
    authError.value = readUnknownError(error, '登录状态恢复失败')
  }
}

async function loadPositions(requestEpoch = sessionEpoch.capture()) {
  const requestUser = user.value

  if (!requestUser || !isCurrentAuthenticatedSession(requestEpoch, requestUser.id)) {
    return false
  }

  const requestUserId = requestUser.id
  const requestSequence = ++positionLoadSequence
  positionsPending.value = true
  positionError.value = ''

  try {
    const response = await fetch('/api/positions', {
      headers: {
        Accept: 'application/json',
        'X-Expected-User-Id': requestUserId,
      },
      credentials: 'same-origin',
    })

    const payload = (await readJsonResponse(response)) as { positions?: PositionPayload[] } | null

    if (
      requestSequence !== positionLoadSequence ||
      !isCurrentAuthenticatedSession(requestEpoch, requestUserId)
    ) {
      return false
    }

    if (response.status === 401) {
      handleExpiredSession()
      return false
    }

    if (response.status === 409) {
      handleExpiredSession(SESSION_CHANGED_MESSAGE)
      return false
    }

    if (!response.ok) {
      throw new Error(readApiError(payload, '持仓加载失败'))
    }

    const savedPositions: Partial<Record<StockCode, PositionDraft>> = {}

    for (const savedPosition of payload?.positions ?? []) {
      if (savedPosition.userId !== requestUserId || !isStockCode(savedPosition.stockCode)) {
        continue
      }

      savedPositions[savedPosition.stockCode] = {
        quantity: Math.trunc(
          normalizeDraftValue(savedPosition.quantity, defaultPosition.quantity, MAX_POSITION_QUANTITY),
        ),
        costPrice: normalizeDraftValue(
          savedPosition.costPrice,
          defaultPosition.costPrice,
          MAX_POSITION_COST_PRICE,
        ),
        basisDate: normalizeDateValue(savedPosition.basisDate, dateFromIsoValue(savedPosition.updatedAt)),
      }
    }

    const mergedState = mergeAnonymousDraftsWithSavedPositions(
      STOCKS.map((stock) => stock.code),
      anonymousDraftSnapshot,
      savedPositions,
    )

    setPositionDrafts(mergedState.drafts)
    pendingAnonymousDraftCodes.value = mergedState.pendingStockCodes

    for (const stockCode of mergedState.matchedStockCodes) {
      anonymousDraftSnapshot[stockCode] = { ...defaultPosition, basisDate: todayDateValue() }
    }

    persistLocalState()
    positionMessage.value = '已同步账号持仓'
    return true
  } catch (error) {
    if (
      requestSequence === positionLoadSequence &&
      isCurrentAuthenticatedSession(requestEpoch, requestUserId)
    ) {
      positionError.value = readUnknownError(error, '持仓加载失败')
    }

    return false
  } finally {
    if (
      requestSequence === positionLoadSequence &&
      isCurrentAuthenticatedSession(requestEpoch, requestUserId)
    ) {
      positionsPending.value = false
    }
  }
}

async function submitAuth() {
  const submittedAuthMode = authMode.value
  captureAnonymousDraftSnapshot()
  persistLocalState()
  const requestEpoch = beginSessionTransition()
  authPending.value = true
  authError.value = ''

  try {
    const response = await fetch(submittedAuthMode === 'login' ? '/api/auth/login' : '/api/auth/register', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: authForm.username,
        password: authForm.password,
      }),
    })

    const payload = (await readJsonResponse(response)) as { user?: UserSummary } | null

    if (!sessionEpoch.isCurrent(requestEpoch)) {
      return
    }

    if (!response.ok || !payload?.user) {
      throw new Error(readApiError(payload, '登录失败'))
    }

    user.value = payload.user
    closeAuthDialog()
    await loadPositions(requestEpoch)

    if (!sessionEpoch.isCurrent(requestEpoch)) {
      return
    }

    if (user.value && !positionError.value && pendingAnonymousDraftCodes.value.length === 0) {
      positionMessage.value = submittedAuthMode === 'register' ? '注册成功，已自动登录并同步持仓' : '登录成功，已同步持仓'
    }
  } catch (error) {
    if (sessionEpoch.isCurrent(requestEpoch)) {
      authError.value = readUnknownError(error, '提交失败')
    }
  } finally {
    if (sessionEpoch.isCurrent(requestEpoch)) {
      authPending.value = false
    }
  }
}

async function logout() {
  logoutPending.value = true
  authPending.value = false
  authError.value = ''
  const requestEpoch = beginSessionTransition()

  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: '{}',
    })

    const payload = await readJsonResponse(response)

    if (!sessionEpoch.isCurrent(requestEpoch)) {
      return
    }

    if (!response.ok) {
      throw new Error(readApiError(payload, '退出登录失败'))
    }

    user.value = null
    restoreAnonymousDraftSnapshot()
    positionMessage.value = '已退出登录'
    positionError.value = ''
    persistLocalState()
  } catch (error) {
    if (sessionEpoch.isCurrent(requestEpoch)) {
      authError.value = readUnknownError(error, '退出登录失败')
    }
  } finally {
    if (sessionEpoch.isCurrent(requestEpoch)) {
      logoutPending.value = false
    }
  }
}

async function saveActivePosition() {
  const requestUser = user.value

  if (!requestUser) {
    openAuth('login')
    return
  }

  if (logoutPending.value) {
    return
  }

  const stockCode = selectedCode.value
  const stockName = activeStock.value.name
  const validationError = getPositionValidationError(stockCode)

  if (validationError) {
    positionMessage.value = ''
    positionError.value = validationError
    return
  }

  const requestEpoch = sessionEpoch.capture()
  const requestUserId = requestUser.id
  positionSavePending.value = true
  positionError.value = ''

  try {
    const result = await savePosition(stockCode, requestEpoch, requestUserId)

    if (!isCurrentAuthenticatedSession(requestEpoch, requestUserId) || result === 'stale-session') {
      return
    }

    if (result === 'changed-after-submit') {
      positionMessage.value = `${stockName} 已保存提交时的数据；当前输入有新修改，请再次保存`
      return
    }

    positionMessage.value = `${stockName} 持仓已保存`
    positionEditorOpen.value = false
  } catch (error) {
    if (isCurrentAuthenticatedSession(requestEpoch, requestUserId)) {
      positionError.value = readUnknownError(error, '持仓保存失败')
    }
  } finally {
    if (isCurrentAuthenticatedSession(requestEpoch, requestUserId)) {
      positionSavePending.value = false
    }
  }
}

async function saveAllPositions() {
  const requestUser = user.value

  if (!requestUser) {
    openAuth('login')
    return
  }

  if (logoutPending.value) {
    return
  }

  for (const stock of STOCKS) {
    const validationError = getPositionValidationError(stock.code)

    if (validationError) {
      positionMessage.value = ''
      positionError.value = `${stock.name}：${validationError}`
      return
    }
  }

  const requestEpoch = sessionEpoch.capture()
  const requestUserId = requestUser.id
  const submittedDrafts = clonePositionDrafts(
    STOCKS.map((stock) => stock.code),
    positionDrafts,
  )
  saveAllPending.value = true
  positionError.value = ''

  try {
    for (const stock of STOCKS) {
      const result = await savePosition(stock.code, requestEpoch, requestUserId, submittedDrafts[stock.code])

      if (!isCurrentAuthenticatedSession(requestEpoch, requestUserId) || result === 'stale-session') {
        return
      }

      if (result === 'changed-after-submit') {
        positionMessage.value = `${stock.name} 已保存提交时的数据；当前输入有新修改，请再次保存`
        return
      }
    }

    const changedStock = STOCKS.find(
      (stock) => !positionDraftsMatch(positionDrafts[stock.code], submittedDrafts[stock.code]),
    )

    if (changedStock) {
      positionMessage.value = `${changedStock.name} 已保存提交时的数据；当前输入有新修改，请再次保存`
      return
    }

    positionMessage.value = '两只股票持仓已全部保存'
    positionEditorOpen.value = false
  } catch (error) {
    if (isCurrentAuthenticatedSession(requestEpoch, requestUserId)) {
      positionError.value = readUnknownError(error, '批量保存失败')
    }
  } finally {
    if (isCurrentAuthenticatedSession(requestEpoch, requestUserId)) {
      saveAllPending.value = false
    }
  }
}

async function savePosition(
  stockCode: StockCode,
  requestEpoch: number,
  requestUserId: string,
  submittedDraft: PositionDraft = { ...positionDrafts[stockCode] },
): Promise<SavePositionResult> {
  const validationError = validatePositionDraft(submittedDraft, todayDateValue())

  if (validationError) {
    throw new Error(validationError)
  }

  const response = await fetch('/api/positions', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Expected-User-Id': requestUserId,
    },
    credentials: 'same-origin',
    body: JSON.stringify({
      stockCode,
      quantity: submittedDraft.quantity,
      costPrice: submittedDraft.costPrice,
      basisDate: submittedDraft.basisDate,
    }),
  })

  const payload = (await readJsonResponse(response)) as { position?: PositionPayload } | null

  if (!isCurrentAuthenticatedSession(requestEpoch, requestUserId)) {
    return 'stale-session'
  }

  if (response.status === 401) {
    handleExpiredSession()
    throw new Error(SESSION_EXPIRED_MESSAGE)
  }

  if (response.status === 409) {
    handleExpiredSession(SESSION_CHANGED_MESSAGE)
    throw new Error(SESSION_CHANGED_MESSAGE)
  }

  if (!response.ok) {
    throw new Error(readApiError(payload, '持仓保存失败'))
  }

  if (
    !payload?.position ||
    payload.position.userId !== requestUserId ||
    payload.position.stockCode !== stockCode
  ) {
    throw new Error('服务器未返回有效的持仓保存结果，请刷新后确认')
  }

  if (!positionDraftsMatch(positionDrafts[stockCode], submittedDraft)) {
    return 'changed-after-submit'
  }

  positionDrafts[stockCode] = {
    quantity: Math.trunc(
      normalizeDraftValue(payload.position.quantity, submittedDraft.quantity, MAX_POSITION_QUANTITY),
    ),
    costPrice: normalizeDraftValue(
      payload.position.costPrice,
      submittedDraft.costPrice,
      MAX_POSITION_COST_PRICE,
    ),
    basisDate: normalizeDateValue(payload.position.basisDate, dateFromIsoValue(payload.position.updatedAt)),
  }

  clearSyncedAnonymousDraft(stockCode)
  return 'saved'
}

function getPositionValidationError(stockCode: StockCode) {
  return validatePositionDraft(positionDrafts[stockCode], todayDateValue())
}

function handleExpiredSession(message = SESSION_EXPIRED_MESSAGE) {
  beginSessionTransition()
  authPending.value = false
  user.value = null
  restoreAnonymousDraftSnapshot()
  positionMessage.value = ''
  positionError.value = message
  persistLocalState()
}

function clearSyncedAnonymousDraft(stockCode: StockCode) {
  if (!pendingAnonymousDraftCodes.value.includes(stockCode)) {
    return
  }

  anonymousDraftSnapshot[stockCode] = { ...defaultPosition, basisDate: todayDateValue() }
  pendingAnonymousDraftCodes.value = pendingAnonymousDraftCodes.value.filter((code) => code !== stockCode)
  persistLocalState()
}

</script>

<template>
  <div class="app-shell">
    <div class="bg-orb bg-orb-left"></div>
    <div class="bg-orb bg-orb-right"></div>

    <AppHeader
      :user="user"
      :auth-dialog-open="authDialogOpen"
      :auth-mode="authMode"
      :username="authForm.username"
      :password="authForm.password"
      :auth-pending="authPending"
      :logout-pending="logoutPending"
      :auth-error="authError"
      @open-auth="openAuth"
      @close-auth="closeAuthDialog"
      @switch-auth-mode="switchAuthMode"
      @submit-auth="submitAuth"
      @logout="logout"
      @update:username="authForm.username = $event"
      @update:password="authForm.password = $event"
    />

    <main class="dashboard-grid">
      <QuotePanel
        :stocks="stockOptions"
        :selected-code="selectedCode"
        :time-text="quoteTimeText"
        :session-text="marketSessionText"
        :pending="quotesPending"
        :error="quotesError"
        :is-fallback="quoteFreshness === 'fallback'"
        :status-text="quoteStatusText"
        @refresh="loadQuotes"
        @select="selectedCode = $event"
      />

      <section class="panel position-card">
        <div class="card-header">
          <div>
            <p class="section-kicker">持仓数据</p>
            <h3>{{ activeStock.name }} 概览</h3>
          </div>
          <div class="position-header-meta">
            <span class="header-note">{{ activeStock.code }}</span>
            <span class="status-text">{{ user ? '已登录' : '未登录' }}</span>
          </div>
        </div>

        <div class="metric-strip position-metrics">
          <article>
            <span>成本总额</span>
            <strong class="metric-number">{{ formatCurrency(costAmount) }}</strong>
          </article>
          <article>
            <span>当前市值</span>
            <strong class="metric-number">{{ formatCurrency(currentValue) }}</strong>
          </article>
          <article>
            <span>有效股数</span>
            <strong class="metric-number">{{ formatShareQuantity(adjustedPosition.quantity) }}</strong>
          </article>
          <article>
            <span>累计分红</span>
            <strong class="metric-number">{{ formatCurrency(adjustedPosition.cashDividendAmount) }}</strong>
          </article>
          <article>
            <span>当前收益</span>
            <strong :class="['metric-number', profitClass(currentProfit)]">{{ formatCurrency(currentProfit) }}</strong>
          </article>
          <article>
            <span>当前收益率</span>
            <strong :class="['metric-number', profitClass(currentProfit)]">{{ formatPercent(currentProfitPct) }}</strong>
          </article>
        </div>

        <div class="position-editor-summary">
          <div class="position-editor-copy">
            <p class="section-kicker">编辑入口</p>
            <h4>{{ positionEditorOpen ? '正在编辑持仓参数' : '点击展开后录入或调整持仓' }}</h4>
            <p class="status-text">{{ positionAutoSummaryText }}</p>
          </div>

          <button
            class="ghost-button position-toggle-button"
            type="button"
            :aria-expanded="positionEditorOpen"
            aria-controls="position-editor-panel"
            @click="togglePositionEditor"
          >
            {{ positionEditorOpen ? '收起持仓录入' : '录入 / 修改持仓' }}
          </button>
        </div>

        <p
          id="position-status"
          :class="[
            'status-text',
            'position-status',
            { 'is-negative': positionError || (!user && localDraftError) },
          ]"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {{ positionStatusText }}
        </p>

        <div class="corporate-action-summary">
          <p :class="['status-text', { 'is-negative': dividendsError || dividendFreshness === 'fallback' }]">
            {{ dividendStatusText }}
          </p>
          <strong>{{ corporateActionSummaryText }}</strong>
        </div>

        <div v-if="positionEditorOpen" id="position-editor-panel" class="position-editor-panel">
          <p id="position-input-guidance" class="position-input-guidance">
            请填写持仓基准日当天、尚未计入该日后分红送转的原始数量与成本价。若填写券商当前已送转或已摊薄的数据，会造成重复计算。
          </p>

          <div class="form-grid">
            <label>
              <span>基准日原始持仓数量</span>
              <input
                v-model.number="positionDrafts[selectedCode].quantity"
                type="number"
                min="0"
                :max="MAX_POSITION_QUANTITY"
                step="1"
                :disabled="positionsPending || positionSavePending || saveAllPending || logoutPending"
                aria-describedby="position-input-guidance position-status"
                required
                @input="clearPositionFeedback"
              />
            </label>

            <label>
              <span>基准日原始成本价</span>
              <input
                v-model.number="positionDrafts[selectedCode].costPrice"
                type="number"
                min="0"
                :max="MAX_POSITION_COST_PRICE"
                step="0.0001"
                :disabled="positionsPending || positionSavePending || saveAllPending || logoutPending"
                aria-describedby="position-input-guidance position-status"
                required
                @input="clearPositionFeedback"
              />
            </label>

            <label>
              <span>持仓基准日</span>
              <input
                v-model="positionDrafts[selectedCode].basisDate"
                type="date"
                :max="todayDateValue()"
                :disabled="positionsPending || positionSavePending || saveAllPending || logoutPending"
                aria-describedby="position-input-guidance position-status"
                required
                @input="clearPositionFeedback"
              />
            </label>

            <label>
              <span>红利税档位（按持股期限）</span>
              <select v-model="activeDividendTaxBracket" aria-describedby="position-input-guidance">
                <option v-for="bracket in DIVIDEND_TAX_BRACKETS" :key="bracket.key" :value="bracket.key">
                  {{ bracket.label }} · {{ bracket.rate > 0 ? `${bracket.rate * 100}%` : '免税' }}
                </option>
              </select>
            </label>

            <label>
              <span>自定义目标市值</span>
              <div class="input-suffix">
                <input v-model="customMarketCapWanYi" type="number" min="0" step="0.1" />
                <em>万亿</em>
              </div>
            </label>
          </div>

          <div class="form-actions">
            <button
              v-if="user"
              class="primary-button"
              type="button"
              :disabled="positionsPending || positionSavePending || saveAllPending || logoutPending"
              @click="saveActivePosition"
            >
              {{ positionSavePending ? '保存中...' : `保存 ${activeStock.name} 持仓` }}
            </button>

            <button
              v-if="user"
              class="ghost-button"
              type="button"
              :disabled="positionsPending || positionSavePending || saveAllPending || logoutPending"
              @click="saveAllPositions"
            >
              {{ saveAllPending ? '批量保存中...' : '保存全部持仓' }}
            </button>

            <button v-else class="ghost-button" type="button" @click="openAuth('login')">登录后保存</button>
          </div>
        </div>
      </section>

      <ScenarioProjectionPanel
        v-model:custom-target="customMarketCapWanYi"
        v-model:custom-target-price="customTargetPrice"
        v-model:custom-target-mode="customTargetMode"
        v-model:target-profit-wan="targetProfitWan"
        :stock-name="activeStock.name"
        :custom-target-summary="`当前目标 ${customTargetSummary}`"
        :reverse-projection="reverseProjection"
        :target-market-caps="targetMarketCaps"
        :selected-targets="selectedScenarioTargets"
        :rows="scenarioRows"
        :share-pending-target="sharePendingTarget"
        :share-status-text="shareStatusText"
        @toggle-target="toggleScenarioTarget"
        @share="shareScenario"
      />

      <section class="panel notes-card">
        <div class="card-header">
          <div>
            <p class="section-kicker">说明</p>
            <h3>补充信息</h3>
          </div>
        </div>

        <div class="notes-list">
          <article class="note-item">
            <strong>行情</strong>
            <p>默认并行使用东方财富、腾讯和新浪行情；实时源异常时优先回退到最近成功缓存，最后才退内置值。</p>
          </article>
          <article class="note-item">
            <strong>口径</strong>
            <p>持仓输入采用基准日当天的原始数量与成本价；目标市值输入使用万亿元，未来推演按总市值计算。</p>
          </article>
          <article class="note-item">
            <strong>公司行动</strong>
            <p>推演只应用基准日后已实施的分红送转，不假设未来未公告的公司行动；配股需要额外出资，不自动按已认购计算。</p>
          </article>
          <article class="note-item">
            <strong>税费</strong>
            <p>现金分红按所选持股期限档位自动扣减红利税（超1年免税、1个月-1年10%、不足1个月20%）；推演未计入印花税与佣金。</p>
          </article>
          <article class="note-item">
            <strong>账号</strong>
            <p>已接入轻量用户名体系；未登录输入会保存在当前浏览器，登录后可同步到账号下。密码不支持找回，请妥善保管。</p>
          </article>
          <article class="note-item">
            <strong>免责</strong>
            <p>本工具所有数据与推演结果仅供个人估算参考，不构成任何投资建议；行情来自公开接口，可能存在延迟或误差。</p>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>
