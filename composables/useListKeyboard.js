/**
 * List keyboard navigation composable — adds arrow key support to dropdowns.
 *
 * Handles ArrowUp, ArrowDown, Home, End, and Enter on a list container.
 * Manages a highlighted index and scrolls the active item into view.
 *
 * Usage:
 *   const { highlightedIndex, onKeydown, resetHighlight } = useListKeyboard({
 *     itemCount: () => items.value.length,
 *     onSelect: (index) => selectItem(items.value[index]),
 *   })
 *
 * Bind `@keydown="onKeydown"` on the container and use `highlightedIndex`
 * to apply an active class to the highlighted item.
 */

import { ref } from 'vue'

/**
 * @param {object} options
 * @param {() => number} options.itemCount — returns the current number of items
 * @param {(index: number) => void} options.onSelect — called when Enter is pressed on highlighted item
 */
export function useListKeyboard({ itemCount, onSelect }) {
  const highlightedIndex = ref(-1)

  function onKeydown(e) {
    const count = itemCount()
    if (count === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        highlightedIndex.value = (highlightedIndex.value + 1) % count
        scrollIntoView()
        break
      case 'ArrowUp':
        e.preventDefault()
        highlightedIndex.value = highlightedIndex.value <= 0 ? count - 1 : highlightedIndex.value - 1
        scrollIntoView()
        break
      case 'Home':
        e.preventDefault()
        highlightedIndex.value = 0
        scrollIntoView()
        break
      case 'End':
        e.preventDefault()
        highlightedIndex.value = count - 1
        scrollIntoView()
        break
      case 'Enter':
        if (highlightedIndex.value >= 0) {
          e.preventDefault()
          onSelect(highlightedIndex.value)
        }
        break
    }
  }

  function scrollIntoView() {
    requestAnimationFrame(() => {
      const active = document.querySelector('[data-list-active="true"]')
      active?.scrollIntoView?.({ block: 'nearest' })
    })
  }

  function resetHighlight() {
    highlightedIndex.value = -1
  }

  return { highlightedIndex, onKeydown, resetHighlight }
}
