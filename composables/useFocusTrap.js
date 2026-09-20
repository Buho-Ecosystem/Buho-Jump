/**
 * Focus trap composable — traps keyboard focus inside a container element.
 *
 * When active, Tab/Shift+Tab cycles through focusable children instead of
 * escaping to elements behind a modal. Escape key fires the onEscape callback.
 *
 * Usage:
 *   const containerRef = ref(null)
 *   useFocusTrap(containerRef, { onEscape: () => emit('close') })
 */

import { watch, onBeforeUnmount } from 'vue'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'textarea:not([disabled])', 'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// Only the topmost sheet handles keys when a confirmation covers a flow.
const trapStack = []

/**
 * @param {import('vue').Ref<HTMLElement|null>} containerRef — ref to the trap container
 * @param {object} [options]
 * @param {Function} [options.onEscape] — called when Escape is pressed
 * @param {import('vue').Ref<boolean>|boolean} [options.active] — controls when trap is active (default: true when containerRef is set)
 */
export function useFocusTrap(containerRef, options = {}) {
  let previouslyFocused = null
  const token = Symbol('focus-trap')

  function getFocusable() {
    if (!containerRef.value) return []
    return [...containerRef.value.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length > 0)
  }

  function handleKeydown(e) {
    if (trapStack.at(-1) !== token) return
    if (e.key === 'Escape' && options.onEscape) {
      e.preventDefault()
      options.onEscape()
      return
    }

    if (e.key !== 'Tab') return

    const focusable = getFocusable()
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (e.shiftKey) {
      if (document.activeElement === first || !containerRef.value?.contains(document.activeElement)) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last || !containerRef.value?.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  function activate() {
    if (trapStack.includes(token)) return
    trapStack.push(token)
    previouslyFocused = document.activeElement
    document.addEventListener('keydown', handleKeydown, true)
    // Focus first focusable element after a tick
    requestAnimationFrame(() => {
      if (trapStack.at(-1) !== token) return
      const focusable = getFocusable()
      if (focusable.length > 0) focusable[0].focus()
    })
  }

  function deactivate() {
    document.removeEventListener('keydown', handleKeydown, true)
    const index = trapStack.indexOf(token)
    const wasTop = index >= 0 && index === trapStack.length - 1
    if (index >= 0) trapStack.splice(index, 1)
    if (wasTop && previouslyFocused?.isConnected && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus()
    }
    previouslyFocused = null
  }

  watch(containerRef, (el, oldEl) => {
    if (oldEl && !el) deactivate()
    if (el) activate()
  })

  onBeforeUnmount(deactivate)
}
