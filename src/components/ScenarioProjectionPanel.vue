<script setup lang="ts">
import { formatCurrency, formatPercent, formatYiUnit, profitClass } from '../utils/financial-formatters'

interface ScenarioRow {
  targetLabel: string
  targetMarketCapYi: number
  targetPrice: number
  targetValue: number
  totalProfit: number
  additionalProfit: number
  totalProfitPct: number
  distancePct: number
}

type CustomTargetMode = 'marketCap' | 'price'

interface ReverseProjectionView {
  achievable: boolean
  message?: string
  requiredPriceText?: string
  requiredMarketCapText?: string
  distanceText?: string
  distancePct?: number
}

defineProps<{
  stockName: string
  customTarget: string
  customTargetPrice: string
  customTargetMode: CustomTargetMode
  customTargetSummary: string
  targetProfitWan: string
  reverseProjection: ReverseProjectionView | null
  targetMarketCaps: number[]
  selectedTargets: number[]
  rows: ScenarioRow[]
  sharePendingTarget: number | null
  shareStatusText: string
}>()

defineEmits<{
  'update:customTarget': [value: string]
  'update:customTargetPrice': [value: string]
  'update:customTargetMode': [value: CustomTargetMode]
  'update:targetProfitWan': [value: string]
  toggleTarget: [target: number]
  share: [targetMarketCapYi: number]
}>()
</script>

<template>
  <section class="panel scenario-card">
    <div class="card-header">
      <div>
        <p class="section-kicker">市值推演</p>
        <h3>{{ stockName }}</h3>
      </div>
    </div>

    <div class="scenario-selector">
      <div class="scenario-control-row">
        <div class="scenario-custom-input">
          <div class="scenario-mode-row">
            <span>自定义目标</span>
            <div class="scenario-mode-switch" role="group" aria-label="自定义目标输入方式">
              <button
                type="button"
                :class="['scenario-mode-button', { 'is-active': customTargetMode === 'marketCap' }]"
                @click="$emit('update:customTargetMode', 'marketCap')"
              >
                按市值
              </button>
              <button
                type="button"
                :class="['scenario-mode-button', { 'is-active': customTargetMode === 'price' }]"
                @click="$emit('update:customTargetMode', 'price')"
              >
                按股价
              </button>
            </div>
          </div>

          <div v-if="customTargetMode === 'marketCap'" class="input-suffix scenario-input-suffix">
            <input
              :value="customTarget"
              type="number"
              min="0"
              step="0.1"
              @input="$emit('update:customTarget', ($event.target as HTMLInputElement).value)"
            />
            <em>万亿</em>
          </div>

          <div v-else class="input-suffix scenario-input-suffix">
            <input
              :value="customTargetPrice"
              type="number"
              min="0"
              step="1"
              @input="$emit('update:customTargetPrice', ($event.target as HTMLInputElement).value)"
            />
            <em>元/股</em>
          </div>

          <p class="status-text scenario-mode-note">{{ customTargetSummary }}</p>
        </div>
      </div>

      <div class="scenario-tags">
        <button
          v-for="target in targetMarketCaps"
          :key="target"
          type="button"
          :class="['scenario-tag-button', { 'is-active': selectedTargets.includes(target) }]"
          :aria-pressed="selectedTargets.includes(target)"
          @click="$emit('toggleTarget', target)"
        >
          {{ formatYiUnit(target) }}
        </button>
      </div>
    </div>

    <div class="scenario-selector reverse-projection">
      <div class="scenario-custom-input">
        <span>反向推演：想赚多少</span>
        <div class="input-suffix scenario-input-suffix">
          <input
            :value="targetProfitWan"
            type="number"
            min="0"
            step="1"
            placeholder="输入目标总收益"
            @input="$emit('update:targetProfitWan', ($event.target as HTMLInputElement).value)"
          />
          <em>万元</em>
        </div>
      </div>

      <template v-if="reverseProjection">
        <div v-if="reverseProjection.achievable" class="reverse-projection-result">
          <article>
            <span>所需股价</span>
            <strong>{{ reverseProjection.requiredPriceText }}</strong>
          </article>
          <article>
            <span>距离现价</span>
            <strong :class="profitClass(reverseProjection.distancePct ?? 0)">
              {{ reverseProjection.distanceText }}
            </strong>
          </article>
          <article>
            <span>对应总市值</span>
            <strong>{{ reverseProjection.requiredMarketCapText }}</strong>
          </article>
        </div>
        <p v-else class="status-text reverse-projection-note">{{ reverseProjection.message }}</p>
      </template>
    </div>

    <div class="scenario-mobile-list">
      <article v-for="row in rows" :key="`${row.targetLabel}-mobile`" class="scenario-mobile-card">
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
            <span>距离现价</span>
            <strong :class="profitClass(row.distancePct)">{{ formatPercent(row.distancePct) }}</strong>
          </article>
        </div>

        <div class="scenario-mobile-grid">
          <article>
            <span>总收益率</span>
            <strong :class="profitClass(row.totalProfit)">{{ formatPercent(row.totalProfitPct) }}</strong>
          </article>
          <article>
            <span>持仓市值</span>
            <strong>{{ formatCurrency(row.targetValue) }}</strong>
          </article>
          <article>
            <span>总收益</span>
            <strong :class="profitClass(row.totalProfit)">{{ formatCurrency(row.totalProfit) }}</strong>
          </article>
        </div>

        <button
          class="ghost-button scenario-share-button"
          type="button"
          :disabled="sharePendingTarget !== null"
          @click="$emit('share', row.targetMarketCapYi)"
        >
          {{ sharePendingTarget === row.targetMarketCapYi ? '生成中...' : '生成分享图' }}
        </button>
      </article>
    </div>

    <p v-if="shareStatusText" class="status-text scenario-share-status">{{ shareStatusText }}</p>

    <div class="table-wrap scenario-table">
      <table>
        <thead>
          <tr>
            <th>目标总市值</th>
            <th>对应股价</th>
            <th>距离现价</th>
            <th>持仓市值</th>
            <th>相对成本总收益</th>
            <th>总收益率</th>
            <th>新增收益</th>
            <th>分享</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.targetLabel">
            <td>{{ row.targetLabel }}</td>
            <td>{{ formatCurrency(row.targetPrice) }}</td>
            <td :class="profitClass(row.distancePct)">{{ formatPercent(row.distancePct) }}</td>
            <td>{{ formatCurrency(row.targetValue) }}</td>
            <td :class="profitClass(row.totalProfit)">{{ formatCurrency(row.totalProfit) }}</td>
            <td :class="profitClass(row.totalProfit)">{{ formatPercent(row.totalProfitPct) }}</td>
            <td :class="profitClass(row.additionalProfit)">{{ formatCurrency(row.additionalProfit) }}</td>
            <td>
              <button
                class="text-button"
                type="button"
                :disabled="sharePendingTarget !== null"
                @click="$emit('share', row.targetMarketCapYi)"
              >
                {{ sharePendingTarget === row.targetMarketCapYi ? '生成中' : '分享图' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
