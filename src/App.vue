<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { STOCKS, getFallbackQuote, isStockCode, type StockCode, type StockQuote } from '../shared/stocks'

interface PositionDraft {
  quantity: number
  costPrice: number
  basisDate: string
}

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
}

interface PositionPayload {
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
  selectedCode?: string
  customMarketCap?: string
  selectedScenarioTargets?: number[]
  positionDrafts?: Partial<Record<StockCode, Partial<PositionDraft>>>
}

type AuthMode = 'login' | 'register'

const presetMarketCaps = [10_000, 12_000, 13_000, 15_000, 18_000, 20_000]
const defaultSelectedScenarioTargets = [12_000, 15_000, 20_000]
const LOCAL_STATE_KEY = 'zhuanduoshao_app_state_v1'
const defaultPosition = {
  quantity: 2000,
  costPrice: 84.5,
  basisDate: todayDateValue(),
}

const selectedCode = ref<StockCode>('300502')
const customMarketCap = ref('23000')
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

let localStateReady = false

const stockOptions = computed(() => STOCKS.map((stock) => quoteMap[stock.code]))
const activeStock = computed(() => quoteMap[selectedCode.value])
const activeDividend = computed(() => dividendMap[selectedCode.value])
const activePosition = computed(() => positionDrafts[selectedCode.value])
const quoteUpdatedAt = computed(() => activeStock.value.updatedAt)
const adjustedPosition = computed(() => adjustPositionForCorporateActions(activePosition.value, activeDividend.value.records))

const costAmount = computed(() => adjustedPosition.value.originalCostAmount)
const currentValue = computed(() => adjustedPosition.value.quantity * activeStock.value.latestPrice)
const currentProfit = computed(() => currentValue.value + adjustedPosition.value.cashDividendAmount - costAmount.value)
const currentProfitPct = computed(() =>
  costAmount.value > 0 ? currentProfit.value / costAmount.value : 0,
)

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
    const targetCap = target * 100_000_000
    const targetPrice =
      activeStock.value.totalMarketCap > 0
        ? activeStock.value.latestPrice * (targetCap / activeStock.value.totalMarketCap)
        : 0

    const targetValue = adjustedPosition.value.quantity * targetPrice
    const totalProfit = targetValue + adjustedPosition.value.cashDividendAmount - costAmount.value
    const additionalProfit = targetValue - currentValue.value
    const totalProfitPct = costAmount.value > 0 ? totalProfit / costAmount.value : 0

    return {
      targetLabel: formatYiUnit(target),
      targetPrice,
      targetValue,
      totalProfit,
      additionalProfit,
      totalProfitPct,
    }
  }),
)

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

  if (positionMessage.value) {
    return positionMessage.value
  }

  if (user.value) {
    return `当前账号：${user.value.username}`
  }

  return '未登录时仅在当前页面暂存输入'
})

const customTargetSummary = computed(() => {
  const customValue = Number(customMarketCap.value)

  if (!Number.isFinite(customValue) || customValue <= 0) {
    return '未设置'
  }

  return formatYiUnit(customValue)
})

const positionSummaryText = computed(
  () =>
    `当前按 ${activePosition.value.quantity} 股、成本 ${formatCurrency(activePosition.value.costPrice)}、自定义目标 ${customTargetSummary.value} 推演`,
)

const positionAutoSummaryText = computed(
  () =>
    `${positionSummaryText.value}；基准日 ${activePosition.value.basisDate}，送转后按 ${formatShareQuantity(adjustedPosition.value.quantity)} 股推演`,
)

const corporateActionSummaryText = computed(() => {
  if (adjustedPosition.value.appliedActions.length === 0) {
    return '暂无需要自动应用的已实施分红送转'
  }

  return `${adjustedPosition.value.appliedActions.length} 次已实施分红送转，累计现金 ${formatCurrency(
    adjustedPosition.value.cashDividendAmount,
  )}`
})

watch(selectedCode, () => {
  positionMessage.value = ''
  positionError.value = ''
  persistLocalState()
})

watch(customMarketCap, () => {
  persistLocalState()
})

watch(selectedScenarioTargets, () => {
  persistLocalState()
})

watch(
  targetMarketCaps,
  (nextTargets, previousTargets) => {
    const nextTargetSet = new Set(nextTargets)
    let nextSelectedTargets = selectedScenarioTargets.value.filter((target) => nextTargetSet.has(target))
    const previousCustomTarget = previousTargets?.find((target) => !presetMarketCaps.includes(target))
    const nextCustomTarget = nextTargets.find((target) => !presetMarketCaps.includes(target))

    if (
      previousCustomTarget &&
      nextCustomTarget &&
      previousCustomTarget !== nextCustomTarget &&
      selectedScenarioTargets.value.includes(previousCustomTarget) &&
      !nextSelectedTargets.includes(nextCustomTarget)
    ) {
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
  void loadQuotes()
  void loadDividends()
  void restoreSession()
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

function resetPositionDrafts() {
  for (const stock of STOCKS) {
    positionDrafts[stock.code] = { ...defaultPosition, basisDate: todayDateValue() }
  }
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

function todayDateValue() {
  const now = new Date()
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

function normalizeDateValue(value: unknown, fallbackValue = todayDateValue()) {
  if (typeof value !== 'string') {
    return fallbackValue
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallbackValue
}

function dateFromIsoValue(value: unknown, fallbackValue = todayDateValue()) {
  if (typeof value !== 'string') {
    return fallbackValue
  }

  return normalizeDateValue(value.slice(0, 10), fallbackValue)
}

function normalizeDraftValue(value: unknown, fallbackValue: number) {
  const numericValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallbackValue
  }

  return numericValue
}

function roundCalculatedValue(value: number, precision = 6) {
  const scale = 10 ** precision
  return Math.round((value + Number.EPSILON) * scale) / scale
}

function restoreLocalState() {
  const rawState = window.localStorage.getItem(LOCAL_STATE_KEY)

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

    if (Array.isArray(parsedState.selectedScenarioTargets)) {
      selectedScenarioTargets.value = parsedState.selectedScenarioTargets.filter(
        (target): target is number => Number.isFinite(target) && target > 0,
      )
    }

    if (parsedState.positionDrafts) {
      for (const stock of STOCKS) {
        const savedDraft = parsedState.positionDrafts[stock.code]

        if (!savedDraft) {
          continue
        }

        positionDrafts[stock.code] = {
          quantity: Math.trunc(normalizeDraftValue(savedDraft.quantity, defaultPosition.quantity)),
          costPrice: normalizeDraftValue(savedDraft.costPrice, defaultPosition.costPrice),
          basisDate: normalizeDateValue(savedDraft.basisDate, defaultPosition.basisDate),
        }
      }
    }
  } catch {
    window.localStorage.removeItem(LOCAL_STATE_KEY)
  }
}

function persistLocalState() {
  if (!localStateReady) {
    return
  }

  const nextState: PersistedAppState = {
    selectedCode: selectedCode.value,
    customMarketCap: customMarketCap.value,
    selectedScenarioTargets: selectedScenarioTargets.value,
    positionDrafts: STOCKS.reduce(
      (all, stock) => {
        all[stock.code] = {
          quantity: positionDrafts[stock.code].quantity,
          costPrice: positionDrafts[stock.code].costPrice,
          basisDate: positionDrafts[stock.code].basisDate,
        }
        return all
      },
      {} as Partial<Record<StockCode, Partial<PositionDraft>>>,
    ),
  }

  window.localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(nextState))
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

function adjustPositionForCorporateActions(position: PositionDraft, records: DividendRecordPayload[]) {
  const today = todayDateValue()
  const originalCostAmount = position.quantity * position.costPrice
  let quantity = position.quantity
  let cashDividendAmount = 0
  const appliedActions: DividendRecordPayload[] = []

  for (const record of [...records].sort((a, b) => a.exDate.localeCompare(b.exDate))) {
    if (!record.exDate || record.exDate > today || record.exDate <= position.basisDate) {
      continue
    }

    if (record.planProgress && !record.planProgress.includes('实施')) {
      continue
    }

    const beforeQuantity = quantity
    const shareRatio = ((record.sendRatio ?? 0) + (record.transferRatio ?? 0)) / 10
    const cashRatio = (record.cashDividendRatio ?? 0) / 10

    if (shareRatio <= 0 && cashRatio <= 0) {
      continue
    }

    cashDividendAmount = roundCalculatedValue(cashDividendAmount + beforeQuantity * cashRatio)
    quantity = roundCalculatedValue(beforeQuantity * (1 + shareRatio))
    appliedActions.push(record)
  }

  const adjustedCostAmount = Math.max(originalCostAmount - cashDividendAmount, 0)

  return {
    quantity,
    originalCostAmount,
    cashDividendAmount,
    adjustedCostAmount,
    adjustedCostPrice: quantity > 0 ? adjustedCostAmount / quantity : 0,
    appliedActions,
  }
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
  try {
    const response = await fetch('/api/auth/me', {
      headers: {
        Accept: 'application/json',
      },
      credentials: 'same-origin',
    })

    const payload = (await readJsonResponse(response)) as { user?: UserSummary } | null

    if (response.status === 401) {
      user.value = null
      authError.value = ''
      return
    }

    if (!response.ok || !payload?.user) {
      throw new Error(readApiError(payload, '登录状态恢复失败'))
    }

    user.value = payload.user
    authError.value = ''
    await loadPositions()
  } catch (error) {
    user.value = null
    authError.value = readUnknownError(error, '登录状态恢复失败')
  }
}

async function loadPositions() {
  if (!user.value) {
    return
  }

  positionsPending.value = true
  positionError.value = ''

  try {
    const response = await fetch('/api/positions', {
      headers: {
        Accept: 'application/json',
      },
      credentials: 'same-origin',
    })

    const payload = (await readJsonResponse(response)) as { positions?: PositionPayload[] } | null

    if (response.status === 401) {
      user.value = null
      resetPositionDrafts()
      positionMessage.value = ''
      positionError.value = '登录状态已失效，请重新登录'
      return
    }

    if (!response.ok) {
      throw new Error(readApiError(payload, '持仓加载失败'))
    }

    resetPositionDrafts()

    for (const savedPosition of payload?.positions ?? []) {
      if (!isStockCode(savedPosition.stockCode)) {
        continue
      }

      positionDrafts[savedPosition.stockCode] = {
        quantity: savedPosition.quantity,
        costPrice: savedPosition.costPrice,
        basisDate: normalizeDateValue(savedPosition.basisDate, dateFromIsoValue(savedPosition.updatedAt)),
      }
    }

    positionMessage.value = '已同步账号持仓'
  } catch (error) {
    positionError.value = readUnknownError(error, '持仓加载失败')
  } finally {
    positionsPending.value = false
  }
}

async function submitAuth() {
  authPending.value = true
  authError.value = ''

  try {
    const response = await fetch(authMode.value === 'login' ? '/api/auth/login' : '/api/auth/register', {
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

    if (!response.ok || !payload?.user) {
      throw new Error(readApiError(payload, '登录失败'))
    }

    user.value = payload.user
    closeAuthDialog()
    await loadPositions()
    positionMessage.value = authMode.value === 'register' ? '注册成功，已自动登录' : '登录成功，已同步持仓'
  } catch (error) {
    authError.value = readUnknownError(error, '提交失败')
  } finally {
    authPending.value = false
  }
}

async function logout() {
  logoutPending.value = true
  authError.value = ''

  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      credentials: 'same-origin',
    })

    const payload = await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(readApiError(payload, '退出登录失败'))
    }

    user.value = null
    resetPositionDrafts()
    positionMessage.value = '已退出登录'
    positionError.value = ''
  } catch (error) {
    authError.value = readUnknownError(error, '退出登录失败')
  } finally {
    logoutPending.value = false
  }
}

async function saveActivePosition() {
  if (!user.value) {
    openAuth('login')
    return
  }

  positionSavePending.value = true
  positionError.value = ''

  try {
    await savePosition(selectedCode.value)

    positionMessage.value = `${activeStock.value.name} 持仓已保存`
    positionEditorOpen.value = false
  } catch (error) {
    positionError.value = readUnknownError(error, '持仓保存失败')
  } finally {
    positionSavePending.value = false
  }
}

async function saveAllPositions() {
  if (!user.value) {
    openAuth('login')
    return
  }

  saveAllPending.value = true
  positionError.value = ''

  try {
    for (const stock of STOCKS) {
      await savePosition(stock.code)
    }

    positionMessage.value = '两只股票持仓已全部保存'
    positionEditorOpen.value = false
  } catch (error) {
    positionError.value = readUnknownError(error, '批量保存失败')
  } finally {
    saveAllPending.value = false
  }
}

async function savePosition(stockCode: StockCode) {
  const draft = positionDrafts[stockCode]
  const response = await fetch('/api/positions', {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify({
      stockCode,
      quantity: draft.quantity,
      costPrice: draft.costPrice,
      basisDate: draft.basisDate,
    }),
  })

  const payload = (await readJsonResponse(response)) as { position?: PositionPayload } | null

  if (response.status === 401) {
    user.value = null
    throw new Error('登录状态已失效，请重新登录')
  }

  if (!response.ok) {
    throw new Error(readApiError(payload, '持仓保存失败'))
  }
  if (payload?.position && isStockCode(payload.position.stockCode)) {
    positionDrafts[payload.position.stockCode] = {
      quantity: payload.position.quantity,
      costPrice: payload.position.costPrice,
      basisDate: normalizeDateValue(payload.position.basisDate, dateFromIsoValue(payload.position.updatedAt)),
    }
  }
}

function formatCurrency(value: number, withUnit = true) {
  const result = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

  return withUnit ? `¥${result}` : result
}

function formatShareQuantity(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatYiFromYuan(value: number) {
  return formatYiUnit(value / 100_000_000)
}

function formatMarketCapFromYuan(value: number) {
  return formatYiFromYuan(value)
}

function formatYiUnit(value: number) {
  const usesWanYi = value >= 10_000
  const displayValue = usesWanYi ? value / 10_000 : value
  const maximumFractionDigits = usesWanYi ? 2 : Number.isInteger(value) ? 0 : 1

  return `${new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(displayValue)}${usesWanYi ? '万亿' : '亿'}`
}

function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

function profitClass(value: number) {
  return value >= 0 ? 'is-positive' : 'is-negative'
}
</script>

<template>
  <div class="app-shell">
    <div class="bg-orb bg-orb-left"></div>
    <div class="bg-orb bg-orb-right"></div>

    <header class="topbar panel">
      <div class="brand-block">
        <div class="brand-mark">赚</div>
        <div>
          <h1>赚多少</h1>
          <p class="brand-subtitle">持仓收益推演</p>
        </div>
      </div>

      <div class="topbar-side">
        <template v-if="user">
          <div class="topbar-account-row">
            <div class="session-pill">
              <span class="session-label">账号</span>
              <strong>{{ user.username }}</strong>
            </div>

            <button class="text-button session-action" type="button" :disabled="logoutPending" @click="logout">
              {{ logoutPending ? '退出中...' : '退出' }}
            </button>
          </div>
        </template>

        <div v-else class="topbar-buttons">
          <button class="ghost-button" type="button" @click="openAuth('login')">登录</button>
          <button class="primary-button" type="button" @click="openAuth('register')">注册</button>
        </div>
      </div>

      <form v-if="authDialogOpen && !user" class="auth-card" @submit.prevent="submitAuth">
        <div class="auth-card-header">
          <div>
            <p class="section-kicker">账号</p>
            <h3>{{ authMode === 'login' ? '登录账号' : '注册账号' }}</h3>
          </div>
          <button class="text-button" type="button" @click="closeAuthDialog">关闭</button>
        </div>

        <div class="auth-form-grid">
          <label>
            <span>用户名</span>
            <input v-model.trim="authForm.username" type="text" minlength="3" maxlength="24" />
          </label>

          <label>
            <span>密码</span>
            <input v-model="authForm.password" type="password" minlength="6" maxlength="72" />
          </label>
        </div>

        <p :class="['status-text', { 'is-negative': authError }]">
          {{ authError || (authMode === 'login' ? '登录后可同步并保存你的持仓' : '注册后会自动登录并创建独立持仓记录') }}
        </p>

        <div class="auth-card-footer">
          <button class="primary-button" type="submit" :disabled="authPending || logoutPending">
            {{ authPending ? '提交中...' : authMode === 'login' ? '登录' : '注册并登录' }}
          </button>

          <button
            class="text-button"
            type="button"
            @click="switchAuthMode(authMode === 'login' ? 'register' : 'login')"
          >
            {{ authMode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
          </button>
        </div>
      </form>

      <p v-if="user || authError" :class="['status-text', 'topbar-status', { 'is-negative': authError }]">
        {{ authError || '持仓数据按账号隔离保存' }}
      </p>
    </header>

    <main class="dashboard-grid">
      <section class="hero-card panel">
        <div class="card-header stock-header">
          <div>
            <h3>行情</h3>
          </div>

          <div class="header-actions">
            <span class="header-time">更新时间 {{ quoteUpdatedAt }}</span>
            <button class="text-button" type="button" :disabled="quotesPending" @click="loadQuotes">
              {{ quotesPending ? '刷新中...' : '刷新行情' }}
            </button>
          </div>
        </div>

        <p :class="['status-text', { 'is-negative': quotesError || quoteFreshness === 'fallback' }]">{{ quoteStatusText }}</p>

        <div class="stock-grid">
          <button
            v-for="stock in stockOptions"
            :key="stock.code"
            type="button"
            :class="['stock-card', { 'is-active': stock.code === selectedCode }]"
            @click="selectedCode = stock.code"
          >
            <div class="stock-card-top">
              <div>
                <strong class="stock-card-name">{{ stock.name }}</strong>
                <span class="stock-card-code">{{ stock.code }}</span>
              </div>
              <span :class="['stock-change', profitClass(stock.priceChangePct)]">
                {{ formatPercent(stock.priceChangePct / 100) }}
              </span>
            </div>

            <div class="stock-card-metrics">
              <article>
                <span>最新价</span>
                <strong :class="['compact-number', profitClass(stock.priceChangePct)]">
                  {{ formatCurrency(stock.latestPrice) }}
                </strong>
              </article>
              <article>
                <span>总市值</span>
                <strong class="compact-number">{{ formatMarketCapFromYuan(stock.totalMarketCap) }}</strong>
              </article>
            </div>

            <div class="stock-card-footer">
              <span v-if="stock.code === selectedCode" class="stock-card-state">当前</span>
            </div>
          </button>
        </div>
      </section>

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
            @click="togglePositionEditor"
          >
            {{ positionEditorOpen ? '收起持仓录入' : '录入 / 修改持仓' }}
          </button>
        </div>

        <p :class="['status-text', 'position-status', { 'is-negative': positionError }]">{{ positionStatusText }}</p>

        <div class="corporate-action-summary">
          <p :class="['status-text', { 'is-negative': dividendsError || dividendFreshness === 'fallback' }]">
            {{ dividendStatusText }}
          </p>
          <strong>{{ corporateActionSummaryText }}</strong>
        </div>

        <div v-if="positionEditorOpen" class="position-editor-panel">
          <div class="form-grid">
            <label>
              <span>持仓数量</span>
              <input
                v-model.number="positionDrafts[selectedCode].quantity"
                type="number"
                min="0"
                step="100"
                @input="clearPositionFeedback"
              />
            </label>

            <label>
              <span>成本价</span>
              <input
                v-model.number="positionDrafts[selectedCode].costPrice"
                type="number"
                min="0"
                step="0.01"
                @input="clearPositionFeedback"
              />
            </label>

            <label>
              <span>持仓基准日</span>
              <input
                v-model="positionDrafts[selectedCode].basisDate"
                type="date"
                @input="clearPositionFeedback"
              />
            </label>

            <label>
              <span>自定义目标市值</span>
              <div class="input-suffix">
                <input v-model="customMarketCap" type="number" min="0" step="100" />
                <em>亿</em>
              </div>
            </label>
          </div>

          <div class="form-actions">
            <button
              v-if="user"
              class="primary-button"
              type="button"
              :disabled="positionsPending || positionSavePending || saveAllPending"
              @click="saveActivePosition"
            >
              {{ positionSavePending ? '保存中...' : `保存 ${activeStock.name} 持仓` }}
            </button>

            <button
              v-if="user"
              class="ghost-button"
              type="button"
              :disabled="positionsPending || positionSavePending || saveAllPending"
              @click="saveAllPositions"
            >
              {{ saveAllPending ? '批量保存中...' : '保存全部持仓' }}
            </button>

            <button v-else class="ghost-button" type="button" @click="openAuth('login')">登录后保存</button>
          </div>
        </div>
      </section>

      <section class="panel scenario-card">
        <div class="card-header">
          <div>
            <p class="section-kicker">市值推演</p>
            <h3>{{ activeStock.name }}</h3>
          </div>
        </div>

        <div class="scenario-selector">
          <div class="scenario-control-row">
            <label class="scenario-custom-input">
              <span>自定义目标</span>
              <div class="input-suffix scenario-input-suffix">
                <input v-model="customMarketCap" type="number" min="0" step="100" />
                <em>亿</em>
              </div>
            </label>
          </div>

          <div class="scenario-tags">
            <button
              v-for="target in targetMarketCaps"
              :key="target"
              type="button"
              :class="['scenario-tag-button', { 'is-active': selectedScenarioTargets.includes(target) }]"
              :aria-pressed="selectedScenarioTargets.includes(target)"
              @click="toggleScenarioTarget(target)"
            >
              {{ formatYiUnit(target) }}
            </button>
          </div>
        </div>

        <div class="scenario-mobile-list">
          <article v-for="row in scenarioRows" :key="`${row.targetLabel}-mobile`" class="scenario-mobile-card">
            <div class="scenario-mobile-header">
              <div>
                <span>目标市值</span>
                <strong>{{ row.targetLabel }}</strong>
              </div>
              <span :class="['scenario-mobile-chip', profitClass(row.additionalProfit)]">
                新增 {{ formatCurrency(row.additionalProfit) }}
              </span>
            </div>

            <div class="scenario-mobile-main">
              <article>
                <span>对应股价</span>
                <strong :class="profitClass(row.additionalProfit)">{{ formatCurrency(row.targetPrice) }}</strong>
              </article>
              <article>
                <span>总收益率</span>
                <strong :class="profitClass(row.totalProfit)">{{ formatPercent(row.totalProfitPct) }}</strong>
              </article>
            </div>

            <div class="scenario-mobile-grid">
              <article>
                <span>持仓市值</span>
                <strong>{{ formatCurrency(row.targetValue) }}</strong>
              </article>
              <article>
                <span>总收益</span>
                <strong :class="profitClass(row.totalProfit)">{{ formatCurrency(row.totalProfit) }}</strong>
              </article>
            </div>
          </article>
        </div>

        <div class="table-wrap scenario-table">
          <table>
            <thead>
              <tr>
                <th>目标总市值</th>
                <th>对应股价</th>
                <th>持仓市值</th>
                <th>相对成本总收益</th>
                <th>总收益率</th>
                <th>新增收益</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in scenarioRows" :key="row.targetLabel">
                <td>{{ row.targetLabel }}</td>
                <td>{{ formatCurrency(row.targetPrice) }}</td>
                <td>{{ formatCurrency(row.targetValue) }}</td>
                <td :class="profitClass(row.totalProfit)">{{ formatCurrency(row.totalProfit) }}</td>
                <td :class="profitClass(row.totalProfit)">{{ formatPercent(row.totalProfitPct) }}</td>
                <td :class="profitClass(row.additionalProfit)">{{ formatCurrency(row.additionalProfit) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

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
            <p>默认并行使用东方财富与腾讯行情；实时源异常时优先回退到最近成功缓存，最后才退内置值。</p>
          </article>
          <article class="note-item">
            <strong>口径</strong>
            <p>市值输入仍按亿元，展示会在亿元和万亿元之间自动切换，未来推演按总市值计算。</p>
          </article>
          <article class="note-item">
            <strong>账号</strong>
            <p>已接入轻量用户名体系；未登录输入会保存在当前浏览器，登录后可同步到账号下。</p>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>
