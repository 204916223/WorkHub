import { onBeforeUnmount } from 'vue'
import { layout } from '../../state/settings.js'

export function usePanelResize() {
  let dragging = false
  function move(event) {
    if (!dragging) return
    if (event.clientX >= window.innerWidth - 48) { layout.aiVisible = false; end(); return }
    layout.aiWidth = Math.max(280, Math.min(600, window.innerWidth * 0.6, window.innerWidth - event.clientX - 10))
  }
  function end() { dragging = false; document.body.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
  function start(event) { event.preventDefault(); dragging = true; document.body.classList.add('resizing'); window.addEventListener('pointermove', move); window.addEventListener('pointerup', end) }
  onBeforeUnmount(end)
  return { start }
}
