<script setup>
import { computed, nextTick, ref, useId } from 'vue'
import AssetIcon from '../AssetIcon.vue'

const props = defineProps({
  modelValue: { type: [String, Number, Boolean], default: '' },
  options: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: '选择选项' },
  placeholder: { type: String, default: '' },
  size: { type: String, default: 'normal' },
})
const emit = defineEmits(['update:modelValue', 'change'])
const trigger = ref(null), open = ref(false), activeIndex = ref(0), panelStyle = ref({})
const uid = useId(), listId = `ui-select-list-${uid}`
const selected = computed(() => props.options.find((option) => option.value === props.modelValue))
const selectedLabel = computed(() => selected.value?.label ?? props.placeholder)
function positionPanel() {
  if (!trigger.value) return
  const rect = trigger.value.getBoundingClientRect(), height = Math.min(240, props.options.length * 38 + 12)
  const below = window.innerHeight - rect.bottom
  const top = below >= height + 8 ? rect.bottom + 5 : Math.max(8, rect.top - height - 5)
  panelStyle.value = { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`, top: `${top}px`, width: `${rect.width}px` }
}
async function show(index = props.options.findIndex((option) => option.value === props.modelValue)) {
  if (props.disabled || !props.options.length) return
  activeIndex.value = Math.max(0, index)
  positionPanel(); open.value = true
  await nextTick()
  document.getElementById(optionId(activeIndex.value))?.focus()
}
function close({ restoreFocus = false } = {}) { open.value = false; if (restoreFocus) nextTick(() => trigger.value?.focus()) }
function optionId(index) { return `${listId}-option-${index}` }
function choose(option) { emit('update:modelValue', option.value); emit('change', option.value); close({ restoreFocus: true }) }
function onTriggerKey(event) {
  if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(event.key === 'ArrowUp' ? props.options.length - 1 : undefined) }
}
function onOptionKey(event, index) {
  let next = index
  if (event.key === 'ArrowDown') next = (index + 1) % props.options.length
  else if (event.key === 'ArrowUp') next = (index - 1 + props.options.length) % props.options.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = props.options.length - 1
  else if (event.key === 'Escape') { event.preventDefault(); close({ restoreFocus: true }); return }
  else if (event.key === 'Tab') { close(); return }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(props.options[index]); return }
  else return
  event.preventDefault(); activeIndex.value = next; nextTick(() => document.getElementById(optionId(next))?.focus())
}
function outsidePointer(event) { if (open.value && !event.target.closest('.ui-select-panel') && !trigger.value?.contains(event.target)) close() }
function reposition() { if (open.value) positionPanel() }
import { onBeforeUnmount, onMounted } from 'vue'
onMounted(() => { document.addEventListener('pointerdown', outsidePointer); window.addEventListener('resize', reposition) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outsidePointer); window.removeEventListener('resize', reposition) })
</script>

<template>
  <button ref="trigger" class="ui-select-trigger" :class="`ui-select-trigger-${size}`" type="button" role="combobox" :aria-label="ariaLabel" :aria-expanded="open" :aria-controls="listId" :disabled="disabled" @click="open ? close() : show()" @keydown="onTriggerKey">
    <span :class="{ placeholder: !selected }">{{ selectedLabel }}</span><AssetIcon name="箭头-下" :size="14" />
  </button>
  <Teleport to="body"><div v-if="open" class="ui-select-backdrop" @pointerdown.self="close" @contextmenu.prevent>
    <div :id="listId" class="ui-select-panel" role="listbox" :aria-label="ariaLabel" :style="panelStyle">
      <button v-for="(option, index) in options" :id="optionId(index)" :key="String(option.value)" class="ui-select-option" type="button" role="option" :aria-selected="option.value === modelValue" :class="{ highlighted: index === activeIndex }" @mouseenter="activeIndex = index" @keydown="onOptionKey($event, index)" @click="choose(option)"><span>{{ option.label }}</span><span v-if="option.value === modelValue" class="ui-select-check" aria-hidden="true">✓</span></button>
    </div>
  </div></Teleport>
</template>

<style scoped>
.ui-select-trigger { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; text-align: left; background: #242529; border: 1px solid #393a40; border-radius: 6px; color: #dedfe2; }
.ui-select-trigger-small { min-height: 32px; padding: 5px 8px; border-radius: 5px; font-size: 10px; }
.ui-select-trigger:hover:not(:disabled) { background: #292a2f; border-color: #4a4d55; }
.ui-select-trigger :deep(.asset-icon) { color: #9399a3; }
.placeholder { color: #777a82; }
.ui-select-backdrop { position: fixed; inset: 0; z-index: 1000; background: transparent; }
.ui-select-panel { position: fixed; z-index: 1; max-height: min(240px, calc(100dvh - 16px)); overflow: auto; padding: 5px; border: 1px solid #3b3d44; border-radius: 8px; background: #202125; box-shadow: 0 12px 32px #0009; }
.ui-select-option { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border: 0; border-radius: 5px; background: transparent; color: #cdd0d6; text-align: left; font-size: 12px; }
.ui-select-option:hover, .ui-select-option.highlighted { background: #303239; }
.ui-select-option[aria-selected="true"] { color: #91c9da; }
.ui-select-check { color: #91a2b5; font-size: 11px; }
</style>
