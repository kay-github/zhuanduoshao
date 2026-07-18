<script setup lang="ts">
interface UserSummary {
  id: string
  username: string
}

type AuthMode = 'login' | 'register'

defineProps<{
  user: UserSummary | null
  authDialogOpen: boolean
  authMode: AuthMode
  username: string
  password: string
  authPending: boolean
  logoutPending: boolean
  authError: string
}>()

defineEmits<{
  openAuth: [mode: AuthMode]
  closeAuth: []
  switchAuthMode: [mode: AuthMode]
  submitAuth: []
  logout: []
  'update:username': [value: string]
  'update:password': [value: string]
}>()
</script>

<template>
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

          <button class="text-button session-action" type="button" :disabled="logoutPending" @click="$emit('logout')">
            {{ logoutPending ? '退出中...' : '退出' }}
          </button>
        </div>
      </template>

      <div v-else class="topbar-buttons">
        <button class="ghost-button" type="button" @click="$emit('openAuth', 'login')">登录</button>
        <button class="primary-button" type="button" @click="$emit('openAuth', 'register')">注册</button>
      </div>
    </div>

    <form v-if="authDialogOpen && !user" class="auth-card" @submit.prevent="$emit('submitAuth')">
      <div class="auth-card-header">
        <div>
          <p class="section-kicker">账号</p>
          <h3>{{ authMode === 'login' ? '登录账号' : '注册账号' }}</h3>
        </div>
        <button class="text-button" type="button" @click="$emit('closeAuth')">关闭</button>
      </div>

      <div class="auth-form-grid">
        <label>
          <span>用户名</span>
          <input
            :value="username"
            type="text"
            minlength="3"
            maxlength="24"
            @input="$emit('update:username', ($event.target as HTMLInputElement).value.trim())"
          />
        </label>

        <label>
          <span>密码</span>
          <input
            :value="password"
            type="password"
            minlength="6"
            maxlength="72"
            @input="$emit('update:password', ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>

      <p :class="['status-text', { 'is-negative': authError }]">
        {{ authError || (authMode === 'login' ? '登录后可同步并保存你的持仓' : '注册后会自动登录并创建独立持仓记录；密码不支持找回，请牢记') }}
      </p>

      <div class="auth-card-footer">
        <button class="primary-button" type="submit" :disabled="authPending || logoutPending">
          {{ authPending ? '提交中...' : authMode === 'login' ? '登录' : '注册并登录' }}
        </button>

        <button
          class="text-button"
          type="button"
          @click="$emit('switchAuthMode', authMode === 'login' ? 'register' : 'login')"
        >
          {{ authMode === 'login' ? '没有账号？去注册' : '已有账号？去登录' }}
        </button>
      </div>
    </form>

    <p v-if="user || authError" :class="['status-text', 'topbar-status', { 'is-negative': authError }]">
      {{ authError || '持仓数据按账号隔离保存' }}
    </p>
  </header>
</template>
