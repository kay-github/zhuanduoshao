<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { STOCKS, getFallbackQuote, isStockCode, type StockCode, type StockQuote } from '../shared/stocks'

interface PositionDraft {
  quantity: number
  costPrice: number
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
}

type AuthMode = 'login' | 'register'

const presetMarketCaps = [10_000, 12_000, 13_000, 15_000, 18_000, 20_000]
const defaultPosition = {
  quantity: 2000,
  costPrice: 84.5,
}

const selectedCode = ref<StockCode>('300502')
const customMarketCap = ref('23000')
const authMode = ref<AuthMode>('login')
const authDialogOpen = ref(false)
const user = ref<UserSummary | null>(null)
const quotesPending = ref(false)
const quotesError = ref('')
const positionsPending = ref(false)
const positionSavePending = ref(false)
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
const positionDrafts = reactive(createPositionDrafts())

const stockOptions = computed(() => STOCKS.map((stock) => quoteMap[stock.code]))
const activeStock = computed(() => quoteMap[selectedCode.value])
const activePosition = computed(() => positionDrafts[selectedCode.value])
const quoteUpdatedAt = computed(() => activeStock.value.updatedAt)

const costAmount = computed(() => activePosition.value.quantity * activePosition.value.costPrice)
const currentValue = computed(() => activePosition.value.quantity * activeStock.value.latestPrice)
const currentProfit = computed(() => currentValue.value - costAmount.value)
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

const scenarioRows = computed(() =>
  targetMarketCaps.value.map((target) => {
    const targetCap = target * 100_000_000
    const targetPrice =
      activeStock.value.totalMarketCap > 0
        ? activeStock.value.latestPrice * (targetCap / activeStock.value.totalMarketCap)
        : 0

    const targetValue = activePosition.value.quantity * targetPrice
    const totalProfit = targetValue - costAmount.value
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
    return '正在刷新公共行情'
  }

  if (quotesError.value) {
    return quotesError.value
  }

  return '已接入公共行情接口'
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

watch(selectedCode, () => {
  positionMessage.value = ''
  positionError.value = ''
})

onMounted(() => {
  void loadQuotes()
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
    positionDrafts[stock.code] = { ...defaultPosition }
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

    const payload = (await readJsonResponse(response)) as { quotes?: QuotePayload[] } | null

    if (!response.ok) {
      throw new Error(readApiError(payload, '行情接口暂时不可用'))
    }

    for (const quote of payload?.quotes ?? []) {
      const normalizedQuote = normalizeQuote(quote)

      if (normalizedQuote) {
        quoteMap[normalizedQuote.code] = normalizedQuote
      }
    }
  } catch (error) {
    quotesError.value = `${readUnknownError(error, '行情刷新失败')}，当前展示回退数据`
  } finally {
    quotesPending.value = false
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
      return
    }

    if (!response.ok || !payload?.user) {
      throw new Error(readApiError(payload, '登录状态恢复失败'))
    }

    user.value = payload.user
    await loadPositions()
  } catch {
    user.value = null
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
    const response = await fetch('/api/positions', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        stockCode: selectedCode.value,
        quantity: activePosition.value.quantity,
        costPrice: activePosition.value.costPrice,
      }),
    })

    const payload = await readJsonResponse(response)

    if (response.status === 401) {
      user.value = null
      throw new Error('登录状态已失效，请重新登录')
    }

    if (!response.ok) {
      throw new Error(readApiError(payload, '持仓保存失败'))
    }

    positionMessage.value = `${activeStock.value.name} 持仓已保存`
  } catch (error) {
    positionError.value = readUnknownError(error, '持仓保存失败')
  } finally {
    positionSavePending.value = false
  }
}

function formatCurrency(value: number, withUnit = true) {
  const result = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

  return withUnit ? `¥${result}` : result
}

function formatYiFromYuan(value: number) {
  return formatYiUnit(value / 100_000_000)
}

function formatYiUnit(value: number) {
  const maximumFractionDigits = Number.isInteger(value) ? 0 : 1

  return `${new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value)} 亿`
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
        <div v-if="user" class="session-pill">账号 {{ user.username }}</div>

        <div class="topbar-buttons">
          <template v-if="user">
            <button class="ghost-button" type="button" :disabled="logoutPending" @click="logout">
              {{ logoutPending ? '退出中...' : '退出' }}
            </button>
          </template>

          <template v-else>
            <button class="ghost-button" type="button" @click="openAuth('login')">登录</button>
            <button class="primary-button" type="button" @click="openAuth('register')">注册</button>
          </template>
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
            <p class="section-kicker">股票</p>
            <h3>标的行情</h3>
          </div>

          <div class="header-actions">
            <span class="header-time">更新时间 {{ quoteUpdatedAt }}</span>
            <button class="text-button" type="button" :disabled="quotesPending" @click="loadQuotes">
              {{ quotesPending ? '刷新中...' : '刷新行情' }}
            </button>
          </div>
        </div>

        <p :class="['status-text', { 'is-negative': quotesError }]">{{ quoteStatusText }}</p>

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

            <p class="stock-card-label">{{ stock.label }}</p>

            <div class="stock-card-metrics">
              <article>
                <span>最新价</span>
                <strong>{{ formatCurrency(stock.latestPrice) }}</strong>
              </article>
              <article>
                <span>总市值</span>
                <strong>{{ formatYiFromYuan(stock.totalMarketCap) }}</strong>
              </article>
            </div>

            <div v-if="stock.code === selectedCode" class="stock-card-footer">
              <span class="stock-card-state">当前</span>
            </div>
          </button>
        </div>
      </section>

      <section class="panel position-card">
        <div class="card-header">
          <div>
            <p class="section-kicker">持仓录入</p>
            <h3>{{ activeStock.name }} 持仓</h3>
          </div>
          <div class="position-header-meta">
            <span class="header-note">{{ activeStock.code }}</span>
            <span class="status-text">{{ user ? '已登录' : '未登录' }}</span>
          </div>
        </div>

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
            <span>自定义目标市值</span>
            <div class="input-suffix">
              <input v-model="customMarketCap" type="number" min="0" step="100" />
              <em>亿</em>
            </div>
          </label>
        </div>

        <div class="form-actions">
          <p :class="['status-text', { 'is-negative': positionError }]">{{ positionStatusText }}</p>

          <button
            v-if="user"
            class="primary-button"
            type="button"
            :disabled="positionsPending || positionSavePending"
            @click="saveActivePosition"
          >
            {{ positionSavePending ? '保存中...' : `保存 ${activeStock.name} 持仓` }}
          </button>

          <button v-else class="ghost-button" type="button" @click="openAuth('login')">登录后保存</button>
        </div>

        <div class="metric-strip">
          <article>
            <span>成本总额</span>
            <strong>{{ formatCurrency(costAmount) }}</strong>
          </article>
          <article>
            <span>当前市值</span>
            <strong>{{ formatCurrency(currentValue) }}</strong>
          </article>
          <article>
            <span>当前收益</span>
            <strong :class="profitClass(currentProfit)">{{ formatCurrency(currentProfit) }}</strong>
          </article>
          <article>
            <span>当前收益率</span>
            <strong :class="profitClass(currentProfit)">{{ formatPercent(currentProfitPct) }}</strong>
          </article>
        </div>
      </section>

      <section class="panel scenario-card">
        <div class="card-header">
          <div>
            <p class="section-kicker">市值推演</p>
            <h3>{{ activeStock.name }}</h3>
          </div>
          <div class="scenario-tags">
            <span v-for="target in targetMarketCaps" :key="target">{{ formatYiUnit(target) }}</span>
          </div>
        </div>

        <div class="scenario-mobile-list">
          <article v-for="row in scenarioRows" :key="`${row.targetLabel}-mobile`" class="scenario-mobile-card">
            <div class="scenario-mobile-header">
              <div>
                <strong>{{ row.targetLabel }}</strong>
              </div>
              <span :class="['scenario-mobile-chip', profitClass(row.additionalProfit)]">
                新增 {{ formatCurrency(row.additionalProfit) }}
              </span>
            </div>

            <div class="scenario-mobile-grid">
              <article>
                <span>对应股价</span>
                <strong>{{ formatCurrency(row.targetPrice) }}</strong>
              </article>
              <article>
                <span>持仓市值</span>
                <strong>{{ formatCurrency(row.targetValue) }}</strong>
              </article>
              <article>
                <span>相对成本总收益</span>
                <strong :class="profitClass(row.totalProfit)">{{ formatCurrency(row.totalProfit) }}</strong>
              </article>
              <article>
                <span>总收益率</span>
                <strong :class="profitClass(row.totalProfit)">{{ formatPercent(row.totalProfitPct) }}</strong>
              </article>
              <article>
                <span>新增收益</span>
                <strong :class="profitClass(row.additionalProfit)">{{ formatCurrency(row.additionalProfit) }}</strong>
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
            <p>默认调用东方财富公共行情接口，接口异常时会回退到内置示例数据。</p>
          </article>
          <article class="note-item">
            <strong>口径</strong>
            <p>当前所有市值展示和输入统一使用亿元，未来推演按总市值计算。</p>
          </article>
          <article class="note-item">
            <strong>账号</strong>
            <p>已接入用户名注册登录与持仓保存；本地联调接口时建议使用 vercel dev。</p>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>
