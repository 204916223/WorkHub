<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  views: { type: Array, default: () => [] },
  activeId: { type: String, default: 'default' },
})
const emit = defineEmits(['select', 'rename', 'delete'])
const tabs = ref(null), menu = ref(null), renameInput = ref(null)
const contextView = ref(null), menuStyle = ref({}), renaming = ref(false), confirmingDelete = ref(false), newName = ref('')

function positionMenu(x, y) {
  const width = 210, height = renaming.value || confirmingDelete.value ? 124 : 90, margin = 8
  menuStyle.value = {
    left: `${Math.max(margin, Math.min(x, window.innerWidth - width - margin))}px`,
    top: `${Math.max(margin, Math.min(y, window.innerHeight - height - margin))}px`,
    width: `${width}px`,
  }
}
function openMenu(view, event) {
  event.preventDefault()
  event.stopPropagation()
  if (view.id === 'default') return
  contextView.value = view; newName.value = view.name; renaming.value = false; confirmingDelete.value = false
  positionMenu(event.clientX, event.clientY)
}
function selectView(id) { emit('select', id); closeMenu() }
function closeMenu() { contextView.value = null; renaming.value = false; confirmingDelete.value = false }
async function beginRename() { renaming.value = true; confirmingDelete.value = false; positionMenu(Number.parseFloat(menuStyle.value.left), Number.parseFloat(menuStyle.value.top)); await nextTick(); renameInput.value?.focus(); renameInput.value?.select() }
function saveRename() {
  const name = newName.value.trim().slice(0, 32)
  if (!name || !contextView.value) return
  emit('rename', contextView.value.id, name); closeMenu()
}
function confirmDelete() { confirmingDelete.value = true; renaming.value = false; positionMenu(Number.parseFloat(menuStyle.value.left), Number.parseFloat(menuStyle.value.top)) }
function deleteView() { if (contextView.value?.id !== 'default') emit('delete', contextView.value.id); closeMenu() }
function onPointerDown(event) { if (contextView.value && !menu.value?.contains(event.target) && !tabs.value?.contains(event.target)) closeMenu() }
function onKeydown(event) { if (event.key === 'Escape' && contextView.value) { event.preventDefault(); closeMenu() } }
function onResize() { if (contextView.value && menu.value) positionMenu(Number.parseFloat(menuStyle.value.left), Number.parseFloat(menuStyle.value.top)) }
document.addEventListener('pointerdown', onPointerDown)
document.addEventListener('keydown', onKeydown)
window.addEventListener('resize', onResize)
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeydown); window.removeEventListener('resize', onResize) })
</script>

<template>
  <nav ref="tabs" class="ui-saved-view-tabs" aria-label="表格视图">
    <button v-for="view in props.views" :key="view.id" type="button" :class="{ active: props.activeId === view.id }" :aria-pressed="props.activeId === view.id" @click="selectView(view.id)" @contextmenu="openMenu(view, $event)">{{ view.name }}</button>
    <section v-if="contextView" ref="menu" class="ui-saved-view-menu" :style="menuStyle" role="menu" aria-label="视图操作" @pointerdown.stop>
      <template v-if="renaming">
        <strong class="ui-saved-view-menu-title">重命名视图</strong>
        <input ref="renameInput" v-model="newName" maxlength="32" type="text" aria-label="视图名称" @keydown.enter.prevent="saveRename" />
        <div class="ui-saved-view-menu-actions"><button type="button" @click="closeMenu">取消</button><button type="button" class="primary" :disabled="!newName.trim()" @click="saveRename">保存</button></div>
      </template>
      <template v-else-if="confirmingDelete">
        <strong class="ui-saved-view-menu-title">删除“{{ contextView.name }}”？</strong>
        <p>删除后无法恢复。</p>
        <div class="ui-saved-view-menu-actions"><button type="button" @click="closeMenu">取消</button><button type="button" class="danger" @click="deleteView">删除</button></div>
      </template>
      <template v-else>
        <button type="button" role="menuitem" @click="beginRename">重命名</button>
        <button type="button" role="menuitem" class="danger-text" @click="confirmDelete">删除视图</button>
      </template>
    </section>
  </nav>
</template>

<style scoped>
.ui-saved-view-tabs { position: relative; display: flex; flex: 0 1 auto; align-items: center; gap: 3px; min-height: 34px; max-width: 100%; overflow-x: auto; padding: 2px; border: 1px solid #34373d; border-radius: 6px; background: #1d1f22; scrollbar-width: thin; }
.ui-saved-view-tabs > button { flex: 0 0 auto; min-height: 28px; padding: 0 11px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: #929ba7; font-size: 11px; white-space: nowrap; cursor: pointer; }
.ui-saved-view-tabs > button:hover { color: #d5d9df; }
.ui-saved-view-tabs > button.active { border-color: #3a3d43; background: #2a2c31; color: #e0e3e8; box-shadow: 0 1px 3px #0005; }
.ui-saved-view-menu { position: fixed; z-index: 70; display: grid; gap: 3px; padding: 5px; border: 1px solid #3b3e44; border-radius: 7px; background: #202226; box-shadow: 0 12px 32px #0009; color: #c9cdd4; }
.ui-saved-view-menu > button { min-height: 31px; padding: 0 9px; border: 0; border-radius: 4px; background: transparent; color: #c9cdd4; text-align: left; font: inherit; font-size: 11px; cursor: pointer; }
.ui-saved-view-menu > button:hover { background: #303238; }
.ui-saved-view-menu-title { padding: 5px 7px 3px; color: #dce0e6; font-size: 11px; font-weight: 550; }
.ui-saved-view-menu input { height: 31px; padding: 0 8px; border: 1px solid #41454d; border-radius: 4px; outline: none; background: #191b1f; color: #e0e3e8; font: inherit; font-size: 11px; }
.ui-saved-view-menu input:focus { border-color: #548aa0; }
.ui-saved-view-menu p { padding: 0 7px; color: #838d9b; font-size: 10px; }
.ui-saved-view-menu-actions { display: flex; justify-content: flex-end; gap: 5px; padding-top: 3px; }
.ui-saved-view-menu-actions button { min-height: 27px; padding: 0 9px; border: 1px solid #393e46; border-radius: 4px; background: #25282d; color: #bfc6d0; font-size: 10px; cursor: pointer; }
.ui-saved-view-menu-actions button.primary { border-color: #3d6677; background: #2b414a; color: #c1d6df; }
.ui-saved-view-menu-actions button.danger, .ui-saved-view-menu > button.danger-text { color: #d39b91; }
.ui-saved-view-menu-actions button:disabled { opacity: .45; cursor: default; }
</style>
