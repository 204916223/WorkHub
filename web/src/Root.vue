<script setup>
import { onMounted, onBeforeUnmount, provide, ref } from 'vue'
import App from './App.vue'
import McpLogin from './components/McpLogin.vue'
import { identityState, restoreIdentity, logoutIdentity, forgetIdentity } from './features/auth/useIdentity.js'
const loading = ref(true), error = ref('')
provide('identity', { state: identityState, logout: logoutIdentity })
function expired() { forgetIdentity(); error.value = '登录已失效或用户已切换，请重新验证身份。' }
onMounted(async () => {
  window.addEventListener('workhub:unauthorized', expired)
  try { await restoreIdentity() } catch (reason) { forgetIdentity(); error.value = reason.message }
  finally { loading.value = false }
})
onBeforeUnmount(() => window.removeEventListener('workhub:unauthorized', expired))
</script>
<template><div v-if="loading" class="boot-screen">正在加载个人工作区…</div><App v-else-if="identityState.owner" :owner="identityState.owner" /><McpLogin v-else :error="error" /></template>
<style scoped>.boot-screen { min-height: 100dvh; display: grid; place-items: center; color: #8796a9; font-size: 13px; }</style>
