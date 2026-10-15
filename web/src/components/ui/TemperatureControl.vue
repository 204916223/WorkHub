<script setup>
import AssetIcon from '../AssetIcon.vue'

const props = defineProps({ modelValue: { type: Number, default: 0.2 } })
const emit = defineEmits(['update:modelValue'])
function setValue(delta) {
  const next = Math.min(2, Math.max(0, Math.round((Number(props.modelValue) + delta) * 10) / 10))
  emit('update:modelValue', next)
}
function clearPointerFocus(event) {
  // Keep mouse clicks from leaving a persistent focused/selected-looking button;
  // keyboard users can still tab to the controls and receive focus-visible styling.
  event.preventDefault()
  document.activeElement?.blur?.()
}
</script>

<template>
  <div class="temperature-control">
    <button type="button" aria-label="降低温度" :disabled="modelValue <= 0" @pointerdown="clearPointerFocus" @click="setValue(-0.1)">
      <AssetIcon name="箭头-左" />
    </button>
    <output aria-live="polite">{{ Number(modelValue).toFixed(1) }}</output>
    <button type="button" aria-label="提高温度" :disabled="modelValue >= 2" @pointerdown="clearPointerFocus" @click="setValue(0.1)">
      <AssetIcon name="箭头-右" />
    </button>
  </div>
</template>

<style scoped>
.temperature-control { display: grid; grid-template-columns: 40px minmax(0, 1fr) 40px; align-items: center; width: 100%; height: 40px; overflow: hidden; border: 1px solid #393a40; border-radius: 6px; background: #242529; }
.temperature-control output { color: #dedfe2; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
.temperature-control button { display: grid; place-items: center; width: 40px; height: 38px; padding: 0; border: 0; border-radius: 0; outline: 0; background: transparent; color: #92949b; cursor: pointer; transition: background .15s, color .15s; }
.temperature-control button:hover:not(:disabled) { border: 0; outline: 0; background: #303136; color: #d8d9dc; }
.temperature-control button:focus-visible { border: 0; outline: 0; background: transparent; color: #d8d9dc; box-shadow: inset 0 0 0 2px #3487a4; }
.temperature-control button:disabled { opacity: .4; cursor: default; }
.temperature-control :deep(.asset-icon), .temperature-control :deep(svg) { width: 14px; height: 14px; }
</style>
