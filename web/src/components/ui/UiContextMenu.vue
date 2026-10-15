<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AssetIcon from '../AssetIcon.vue'

const props = defineProps({ canGoBack: { type: Boolean, default: false } })
const emit = defineEmits(['back', 'sync'])
const open = ref(false), menu = ref(null), target = ref(null), selectedText = ref(''), editable = ref(false), readOnly = ref(false), notice = ref(''), menuStyle = ref({})
const hasSelection = computed(() => !!selectedText.value)
const entries = computed(() => {
  const items = []
  if (editable.value) items.push(
    { id: 'cut', label: '剪切', disabled: readOnly.value || !hasSelection.value, shortcut: 'Ctrl + X' },
    { id: 'copy', label: '复制', disabled: !hasSelection.value, shortcut: 'Ctrl + C' },
    { id: 'paste', label: '粘贴', disabled: readOnly.value, shortcut: 'Ctrl + V' },
    { id: 'selectAll', label: '全选', shortcut: 'Ctrl + A' },
    { separator: true },
  )
  else if (hasSelection.value) items.push({ id: 'copy', label: '复制', shortcut: 'Ctrl + C' }, { id: 'selectAll', label: '全选', shortcut: 'Ctrl + A' }, { separator: true })
  items.push({ id: 'sync', label: '同步任务数据', icon: '刷新' })
  if (props.canGoBack) items.push({ id: 'back', label: '返回模块目录', icon: '箭头-左' })
  return items
})

function currentSelection(element) {
  if (element && typeof element.selectionStart === 'number' && typeof element.selectionEnd === 'number') return element.value.slice(element.selectionStart, element.selectionEnd)
  return window.getSelection()?.toString() || ''
}
function openAt(event) {
  if (!event.target.closest?.('.app-shell')) return
  event.preventDefault()
  target.value = event.target.closest('input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="tel"], input[type="email"], input[type="password"], textarea, [contenteditable="true"]')
  editable.value = !!target.value
  readOnly.value = !!(target.value?.readOnly || target.value?.disabled || target.value?.getAttribute('aria-readonly') === 'true')
  selectedText.value = currentSelection(target.value)
  notice.value = ''
  const estimatedHeight = entries.value.length * 34 + 12
  menuStyle.value = { left: `${Math.max(8, Math.min(event.clientX, window.innerWidth - 224))}px`, top: `${Math.max(8, Math.min(event.clientY, window.innerHeight - estimatedHeight - 8))}px` }
  open.value = true
  nextTick(() => menu.value?.querySelector('button:not(:disabled)')?.focus())
}
function close() { open.value = false; target.value = null }
function fallbackCopy(text) {
  const helper = document.createElement('textarea'); helper.value = text; helper.setAttribute('readonly', ''); helper.style.position = 'fixed'; helper.style.opacity = '0'; document.body.append(helper); helper.select()
  const ok = document.execCommand('copy'); helper.remove(); return ok
}
async function copyText(text) {
  if (!text) return false
  try { if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable'); await navigator.clipboard.writeText(text); return true }
  catch { return fallbackCopy(text) }
}
function replaceText(element, text) {
  element.focus()
  if (typeof element.setRangeText === 'function') { const start = element.selectionStart ?? element.value.length, end = element.selectionEnd ?? start; element.setRangeText(text, start, end, 'end'); element.dispatchEvent(new Event('input', { bubbles: true })) }
  else { document.execCommand('insertText', false, text) }
}
async function run(id) {
  const element = target.value
  if (id === 'sync') emit('sync')
  if (id === 'back') emit('back')
  if (id === 'copy' || id === 'cut') {
    const ok = await copyText(selectedText.value)
    if (!ok) notice.value = '复制失败，请使用键盘快捷键。'
    else if (id === 'cut' && element) {
      if (typeof element.setRangeText === 'function') { element.setRangeText('', element.selectionStart, element.selectionEnd, 'start'); element.dispatchEvent(new Event('input', { bubbles: true })) }
      else window.getSelection()?.deleteFromDocument()
    }
  }
  if (id === 'paste') {
    try { const text = await navigator.clipboard.readText(); if (element) replaceText(element, text) }
    catch { notice.value = '浏览器未允许读取剪贴板，可使用 Ctrl + V。' }
  }
  if (id === 'selectAll') {
    const range = document.createRange()
    if (element) {
      element.focus()
      if (typeof element.select === 'function') element.select()
      else { range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range) }
    } else { range.selectNodeContents(document.body); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range) }
  }
  if (notice.value) return
  close()
}
function onKeydown(event) {
  const buttons = [...menu.value.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement)
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); return }
  if (event.key === 'Home') { event.preventDefault(); buttons[0]?.focus() }
  if (event.key === 'End') { event.preventDefault(); buttons.at(-1)?.focus() }
}
function dismiss(event) { if (event.target === event.currentTarget) close() }
onMounted(() => document.addEventListener('contextmenu', openAt))
onBeforeUnmount(() => document.removeEventListener('contextmenu', openAt))
</script>

<template>
  <Teleport to="body"><div v-if="open" class="ui-context-backdrop" @pointerdown="dismiss" @contextmenu.prevent="openAt">
    <div ref="menu" class="ui-context-menu" role="menu" tabindex="-1" :style="menuStyle" @keydown="onKeydown">
      <template v-for="item in entries" :key="item.id || `separator-${entries.indexOf(item)}`">
        <div v-if="item.separator" class="ui-context-separator" role="separator" />
        <button v-else type="button" role="menuitem" :disabled="item.disabled" :data-menu-action="item.id" @click="run(item.id)"><span class="ui-context-label"><AssetIcon v-if="item.icon" :name="item.icon" :size="14" />{{ item.label }}</span><small v-if="item.shortcut">{{ item.shortcut }}</small></button>
      </template>
      <p v-if="notice" class="ui-context-notice" role="status">{{ notice }}</p>
    </div>
  </div></Teleport>
</template>

<style scoped>
.ui-context-backdrop { position: fixed; inset: 0; z-index: 1200; background: transparent; }
.ui-context-menu { position: fixed; width: 216px; padding: 5px; border: 1px solid #3a3c43; border-radius: 9px; background: #202125; box-shadow: 0 14px 38px #000a; outline: 0; }
.ui-context-menu button { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; padding: 6px 9px; border: 0; border-radius: 5px; background: transparent; color: #d1d4da; text-align: left; font-size: 11px; }
.ui-context-menu button:hover:not(:disabled), .ui-context-menu button:focus-visible { background: #303239; outline: 0; }
.ui-context-menu button:disabled { color: #656b75; cursor: default; opacity: .65; }
.ui-context-menu button small { flex: 0 0 auto; color: #777e89; font-size: 9px; }
.ui-context-label { display: inline-flex; align-items: center; gap: 8px; }
.ui-context-label :deep(.asset-icon) { color: #8fa5b0; }
.ui-context-separator { height: 1px; margin: 4px 5px; background: #36383e; }
.ui-context-notice { margin: 3px 8px 6px; color: #d4b68b; font-size: 10px; line-height: 1.5; }
</style>
