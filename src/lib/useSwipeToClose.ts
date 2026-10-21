import { useEffect, useRef } from 'react'

/**
 * Feuille qui se ferme en la tirant vers le bas, quand elle est déjà tout en haut.
 *
 * Sans cela, sur Android, ce geste tire la page entière et Chrome la recharge
 * (« tirer pour actualiser »). Tant qu'une feuille est ouverte, on coupe donc ce
 * comportement sur toute la page, et on suit le doigt pour faire descendre la feuille.
 */
export function useSwipeToClose<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    root.classList.add('sheet-open')

    let startY = 0
    let startTime = 0
    let dy = 0
    let tracking = false // le doigt est parti du haut de la feuille
    let dragging = false // la feuille suit le doigt

    const start = (e: TouchEvent) => {
      // Les fenêtres ouvertes par-dessus la feuille (confirmation, diagnostic) gardent leurs gestes.
      const inDialog = (e.target as Element | null)?.closest?.('.dialog-backdrop')
      tracking = e.touches.length === 1 && !inDialog && el.scrollTop <= 0
      dragging = false
      dy = 0
      startY = e.touches[0]?.clientY ?? 0
      startTime = Date.now()
    }

    const move = (e: TouchEvent) => {
      if (!tracking) return
      dy = e.touches[0].clientY - startY
      if (!dragging) {
        if (dy < -6) {
          tracking = false // vers le haut : défilement normal de la feuille
          return
        }
        if (dy < 6) return
        dragging = true
      }
      e.preventDefault()
      el.style.transition = 'none'
      // Un peu de résistance : la feuille descend moins vite que le doigt.
      el.style.transform = `translateY(${Math.max(0, dy * 0.85)}px)`
    }

    const end = () => {
      if (!dragging) {
        tracking = false
        return
      }
      tracking = dragging = false
      const speed = dy / Math.max(1, Date.now() - startTime) // px par ms
      if (dy > 120 || (dy > 40 && speed > 0.5)) {
        el.style.transition = 'transform 0.18s ease-in'
        el.style.transform = 'translateY(100%)'
        window.setTimeout(() => onCloseRef.current(), 170)
      } else {
        el.style.transition = 'transform 0.2s ease-out'
        el.style.transform = ''
      }
    }

    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      // Une seule feuille à la fois en pratique, mais on ne retire la classe que s'il n'en reste aucune.
      if (!document.querySelector('.sheet')) root.classList.remove('sheet-open')
    }
  }, [])

  return ref
}
