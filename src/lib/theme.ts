import { ref } from 'vue'

type Theme = 'light' | 'dark'
const THEME_STORAGE_KEY = 'zhuanduoshao_theme'
const theme = ref<Theme>('light')

export function initializeTheme() {
  const initialized = document.documentElement.dataset.theme
  if (initialized === 'light' || initialized === 'dark') {
    theme.value = initialized
  } else {
    theme.value = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme.value
  }
}

export function useTheme() {
  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme.value
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme.value)
    } catch {
      // A blocked/full browser store must not prevent switching appearance.
    }
  }

  return { theme, toggleTheme }
}
