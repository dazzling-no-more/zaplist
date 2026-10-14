import type { Aspect } from '../data/prefs'

/** The <video> class for each picture mode (styles.css). */
export const ASPECT_CLASS: Record<Aspect, string> = { fit: 'fit', zoom: 'zoom', fill: 'fill', '16:9': 'ratio-16-9', '4:3': 'ratio-4-3' }
