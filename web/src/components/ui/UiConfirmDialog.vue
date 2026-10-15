<script setup>
import { nextTick, ref, watch } from 'vue'

const props = defineProps({ open: Boolean, title: { type: String, default: '确认操作' }, message: { type: String, default: '' }, confirmLabel: { type: String, default: '确认' }, cancelLabel: { type: String, default: '取消' }, tone: { type: String, default: 'danger' } })
const emit = defineEmits(['confirm', 'cancel'])
const cancelButton = ref(null), previousFocus = ref(null)
watch(() => props.open, async (open) => {
  if (open) { previousFocus.value = document.activeElement; await nextTick(); cancelButton.value?.focus() }
  else await nextTick(() => previousFocus.value?.focus?.())
})
function cancel() { emit('cancel') }
function keydown(event) { if (event.key === 'Escape') { event.preventDefault(); cancel() } }
</script>

<template>
  <Teleport to="body"><div v-if="open" class="ui-confirm-backdrop" @pointerdown.self="cancel" @keydown="keydown">
    <section class="ui-confirm-dialog" role="alertdialog" aria-modal="true" :aria-label="title" @contextmenu.prevent>
      <h2>{{ title }}</h2><p>{{ message }}</p>
      <div class="ui-confirm-actions"><button ref="cancelButton" type="button" @click="cancel">{{ cancelLabel }}</button><button type="button" :class="['ui-confirm-submit', `tone-${tone}`]" @click="$emit('confirm')">{{ confirmLabel }}</button></div>
    </section>
  </div></Teleport>
</template>

<style scoped>
.ui-confirm-backdrop { position: fixed; inset: 0; z-index: 1100; display: grid; place-items: center; padding: 20px; background: #08090bc9; backdrop-filter: blur(3px); }
.ui-confirm-dialog { width: min(390px, 100%); padding: 21px; border: 1px solid #393b42; border-radius: 12px; background: #1d1f23; box-shadow: 0 20px 70px #000a; }
.ui-confirm-dialog h2 { margin: 0 0 9px; font-size: 16px; }
.ui-confirm-dialog p { color: #9da3ad; font-size: 12px; line-height: 1.7; }
.ui-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 22px; }
.ui-confirm-actions button { min-width: 72px; font-size: 11px; }
.ui-confirm-actions .tone-danger { border-color: #914e49; background: #773e3a; color: #fff0ed; }
.ui-confirm-actions .tone-danger:hover { background: #8b4842; }
</style>
