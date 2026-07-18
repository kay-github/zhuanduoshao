<script setup lang="ts">
import type { StockCode, StockQuote } from '../../shared/stocks'
import {
  formatCurrency,
  formatMarketCapFromYuan,
  formatPercent,
  profitClass,
} from '../utils/financial-formatters'

defineProps<{
  stocks: StockQuote[]
  selectedCode: StockCode
  timeText: string
  sessionText: string
  pending: boolean
  error: string
  isFallback: boolean
  statusText: string
}>()

defineEmits<{
  refresh: []
  select: [code: StockCode]
}>()
</script>

<template>
  <section class="hero-card panel">
    <div class="card-header stock-header">
      <div>
        <h3>行情</h3>
      </div>

      <div class="header-actions">
        <span class="header-time">{{ sessionText }} · {{ timeText }}</span>
        <button class="text-button" type="button" :disabled="pending" @click="$emit('refresh')">
          {{ pending ? '刷新中...' : '刷新行情' }}
        </button>
      </div>
    </div>

    <p :class="['status-text', { 'is-negative': error || isFallback }]">{{ statusText }}</p>

    <div class="stock-grid">
      <button
        v-for="stock in stocks"
        :key="stock.code"
        type="button"
        :class="['stock-card', { 'is-active': stock.code === selectedCode }]"
        @click="$emit('select', stock.code)"
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
</template>
