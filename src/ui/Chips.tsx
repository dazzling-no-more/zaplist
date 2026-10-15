import { Icon } from './Icon'

/** Year, length, genre and rating as tags under the title. */
export function Chips({ facts, rating }: { facts: (string | undefined)[]; rating?: number }) {
  if (!facts.length && rating === undefined) return null
  return (
    <div className="chips">
      {facts.map((fact, i) => (
        <span key={i} className="chip">
          {fact}
        </span>
      ))}
      {rating !== undefined && (
        <span className="chip">
          <Icon name="star" />
          {rating}
        </span>
      )}
    </div>
  )
}
