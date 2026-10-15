<script setup>
import AssetIcon from './AssetIcon.vue'

defineProps({ name: String, size: { type: Number, default: 22 } })

// Compatibility names are mapped to the SVG assets supplied with WorkHub.
const assets = {
  chat: '人-单人',
  close: '关闭',
  grid: '全部',
  info: '信息-圈',
  search: '筛选',
}
</script>

<template><AssetIcon :name="assets[name] || '信息-圈'" :size="size" /></template>
