const WIDTH = 1920
const HEIGHT = 1080

/**
 * The UI is laid out for the TV's 1920×1080 screen. In a browser window of another size (desktop
 * development), scale and center that stage to fit; on the TV the scale is 1 and nothing changes.
 */
export function fitToWindow(): void {
  const fit = () => {
    const scale = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT)
    const x = (window.innerWidth - WIDTH * scale) / 2
    const y = (window.innerHeight - HEIGHT * scale) / 2
    document.body.style.transform = Math.abs(scale - 1) < 0.001 ? '' : `translate(${x}px, ${y}px) scale(${scale})`
  }
  fit()
  window.addEventListener('resize', fit)
}
