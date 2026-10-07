import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { initializeTheme } from './lib/theme'

initializeTheme()
createApp(App).mount('#app')
