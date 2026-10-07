<script setup lang="ts">
import { computed } from 'vue'
import type { StockCode, StockQuote } from '../../shared/stocks'
import {
  formatCurrency,
  formatMarketCapFromYuan,
  formatPercent,
  profitClass,
} from '../utils/financial-formatters'

const props = defineProps<{
  stocks: StockQuote[]
  selectedCode: StockCode
  timeText: string
  sessionText: string
  pending: boolean
  error: string
  isFallback: boolean
  statusText: string
}>()

const activeStock = computed(() => props.stocks.find(stock => stock.code === props.selectedCode))

defineEmits<{
  refresh: []
  select: [code: StockCode]
}>()
</script>

<template>
  <section class="hero-card panel">
    <div class="stock-header">
        <span class="header-time">{{ sessionText }} · {{ timeText }}</span>
        <button class="text-button" type="button" :disabled="pending" @click="$emit('refresh')">
          {{ pending ? '刷新中...' : '刷新行情' }}
        </button>
    </div>

    <p :class="['status-text', 'quote-status', { 'is-negative': error, 'is-fallback': isFallback }]">{{ statusText }}</p>

    <div class="stock-grid" role="group" aria-label="选择股票">
      <button
        v-for="stock in stocks"
        :key="stock.code"
        type="button"
        :class="['stock-card', { 'is-active': stock.code === selectedCode }]"
        :aria-pressed="stock.code === selectedCode"
        @click="$emit('select', stock.code)"
      >
        <strong class="stock-card-name">{{ stock.name }}</strong>
        <span class="stock-card-code">{{ stock.code }}</span>
      </button>
    </div>
    <div v-if="activeStock" class="active-quote">
      <div>
        <h2>{{ activeStock.name }}</h2>
        <span class="stock-card-code">{{ activeStock.code }} · 深交所</span>
      </div>
      <div class="quote-price-block">
        <strong class="quote-price">{{ formatCurrency(activeStock.latestPrice) }}</strong>
        <span :class="['stock-change', profitClass(activeStock.priceChangePct)]">{{ formatPercent(activeStock.priceChangePct / 100) }}</span>
        <span class="quote-market-cap">总市值 {{ formatMarketCapFromYuan(activeStock.totalMarketCap) }}</span>
      </div>
    </div>
  </section>
</template>
