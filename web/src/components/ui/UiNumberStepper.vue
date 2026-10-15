<script setup>
import { computed, ref, watch } from 'vue'
import AssetIcon from '../AssetIcon.vue'

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: undefined },
  max: { type: Number, default: undefined },
  step: { type: Number, default: 1 },
  disabled: { type: Boolean, default: false },
  id: { type: String, default: undefined },
  ariaLabel: { type: String, default: '数值' },
  suffix: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'change'])
const input = ref(null)
const draft = ref(String(props.modelValue))
const precision = computed(() => Math.min(10, (String(props.step).split('.')[1] || '').length))
const scale = computed(() => 10 ** precision.value)

watch(() => props.modelValue, value => {
  if (document.activeElement !== input.value) draft.value = String(value)
})

function clamp(value) {
  let result = value
  if (Number.isFinite(props.min)) result = Math.max(props.min, result)
  if (Number.isFinite(props.max)) result = Math.min(props.max, result)
  return Math.round(result * scale.value) / scale.value
}

function updateDraft() {
  if (draft.value === '' || draft.value === '-' || draft.value === '.') return
  const value = Number(draft.value)
  if (Number.isFinite(value)) emit('update:modelValue', clamp(value))
}

function commit() {
  const value = Number(draft.value)
  const result = Number.isFinite(value) ? clamp(value) : clamp(Number(props.modelValue) || 0)
  draft.value = String(result)
  emit('update:modelValue', result)
  emit('change', result)
}

function adjust(direction) {
  const value = Number(draft.value)
  const current = Number.isFinite(value) ? value : Number(props.modelValue) || 0
  const result = clamp(Math.round((current + direction * props.step) * scale.value) / scale.value)
  draft.value = String(result)
  emit('update:modelValue', result)
  emit('change', result)
  input.value?.focus()
}

function canAdjust(direction) {
  const value = Number(draft.value)
  const current = Number.isFinite(value) ? value : Number(props.modelValue) || 0
  return !props.disabled && !(direction < 0 && current <= props.min) && !(direction > 0 && current >= props.max)
}
</script>

<template>
  <div class="ui-number-stepper" :class="{ 'is-disabled': disabled }">
    <button type="button" class="stepper-button" :aria-label="`${ariaLabel}减小`" :disabled="!canAdjust(-1)" @click="adjust(-1)">
      <AssetIcon name="箭头-左" />
    </button>
    <input
      :id="id"
      ref="input"
      v-model="draft"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :aria-label="ariaLabel"
      @input="updateDraft"
      @blur="commit"
      @change="commit"
    />
    <span v-if="suffix" class="stepper-suffix">{{ suffix }}</span>
    <button type="button" class="stepper-button" :aria-label="`${ariaLabel}增加`" :disabled="!canAdjust(1)" @click="adjust(1)">
      <AssetIcon name="箭头-右" />
    </button>
  </div>
</template>

<style scoped>
.ui-number-stepper { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto 40px; align-items: center; min-width: 0; height: 40px; overflow: hidden; border: 1px solid var(--border); border-radius: 7px; background: #232428; transition: border-color .15s, box-shadow .15s; }
.ui-number-stepper:focus-within { border-color: var(--accent); }
.ui-number-stepper:has(input:focus-visible) { box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent); }
.ui-number-stepper input { width: 100%; min-width: 0; height: 100%; padding: 0 4px; border: 0; outline: 0; background: transparent; color: var(--text); text-align: center; font: inherit; font-size: 13px; appearance: textfield; }
.ui-number-stepper input::-webkit-inner-spin-button, .ui-number-stepper input::-webkit-outer-spin-button { margin: 0; appearance: none; }
.stepper-button { display: grid; place-items: center; align-self: stretch; padding: 0; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.stepper-button:hover:not(:disabled) { background: #303136; color: var(--text); }
.stepper-button:focus { position: relative; z-index: 1; outline: 2px solid var(--accent); outline-offset: -3px; background: #303136; color: var(--text); }
.stepper-button:disabled { opacity: .35; cursor: default; }
.stepper-button :deep(svg) { width: 14px; height: 14px; }
.stepper-suffix { padding: 0 2px; color: var(--muted); font-size: 12px; white-space: nowrap; }
.is-disabled { opacity: .6; }
</style>
