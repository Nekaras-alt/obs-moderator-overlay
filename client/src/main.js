import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router.js'
import './styles/main.css'
import { useI18n } from './i18n/index.js'

const { locale } = useI18n()
document.documentElement.lang = locale.value

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Remove the loading placeholder once Vue has mounted.
const loading = document.getElementById('loading')
if (loading) loading.remove()
