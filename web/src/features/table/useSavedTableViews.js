import { computed, ref } from 'vue'

function clone(value) { return JSON.parse(JSON.stringify(value)) }

function readSaved(storageKey, initialConfig) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (saved && Array.isArray(saved.views)) {
      const views = saved.views.filter((view) => view && typeof view.id === 'string' && typeof view.name === 'string' && view.config && typeof view.config === 'object')
      const hasDefault = views.some((view) => view.id === 'default')
      return {
        views: hasDefault ? views : [{ id: 'default', name: '默认视图', config: clone(initialConfig) }, ...views],
        activeId: views.some((view) => view.id === saved.activeId) ? saved.activeId : 'default',
      }
    }
  } catch {}
  return { views: [{ id: 'default', name: '默认视图', config: clone(initialConfig) }], activeId: 'default' }
}

export function useSavedTableViews({ storageKey, initialConfig, getConfig, applyConfig }) {
  const saved = readSaved(storageKey, initialConfig)
  const views = ref(saved.views)
  const activeId = ref(saved.activeId)
  const activeView = computed(() => views.value.find((view) => view.id === activeId.value) || views.value[0])
  const dirty = computed(() => JSON.stringify(getConfig()) !== JSON.stringify(activeView.value?.config || initialConfig))

  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({ views: views.value, activeId: activeId.value })) } catch {}
  }
  function applyView(view) {
    applyConfig(clone(view?.config || initialConfig))
    if (!view) return
    // Runtime config may acquire newly added fields/defaults while old saved views
    // still have the previous schema. Rebase once so this migration isn't treated
    // as a user edit that needs saving.
    const normalized = clone(getConfig())
    if (JSON.stringify(view.config) !== JSON.stringify(normalized)) {
      view.config = normalized
      persist()
    }
  }
  function select(id) {
    const view = views.value.find((item) => item.id === id)
    if (!view) return
    activeId.value = id
    applyView(view)
    persist()
  }
  function save(name) {
    const title = String(name || '').trim().slice(0, 32)
    if (!title) return false
    const id = `view-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    views.value.push({ id, name: title, config: clone(getConfig()) })
    activeId.value = id
    persist()
    return true
  }
  function overwriteCurrent() {
    const current = activeView.value
    if (!current || current.id === 'default') return false
    current.config = clone(getConfig())
    persist()
    return true
  }
  function rename(id, name) {
    const view = views.value.find((item) => item.id === id)
    const title = String(name || '').trim().slice(0, 32)
    if (!view || view.id === 'default' || !title) return false
    view.name = title
    persist()
    return true
  }
  function remove(id) {
    if (id === 'default') return
    views.value = views.value.filter((view) => view.id !== id)
    if (activeId.value === id) select('default')
    persist()
  }

  applyView(activeView.value)
  return { views, activeId, activeView, dirty, select, save, overwriteCurrent, rename, remove }
}
