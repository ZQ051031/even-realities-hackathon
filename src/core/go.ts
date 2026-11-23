import type { AgendaEvent } from './types'
import { MIN, hhmm } from './time'

export interface GoStep {
  text: string
  detail?: string
}

/** Heads-up route cards for an event: explicit "GO:" steps from the event, or a generic leave-by plan. */
export function goSteps(ev: AgendaEvent, walkMinutes = 10): GoStep[] {
  if (ev.steps?.length) {
    return ev.steps.map(s => {
      const [text, detail] = s.split('|').map(p => p.trim())
      return { text, detail: detail || undefined }
    })
  }
  const steps: GoStep[] = [{ text: `Leave by ${hhmm(ev.start - walkMinutes * MIN)}`, detail: `${walkMinutes} min buffer` }]
  if (ev.location) steps.push({ text: `Head to ${ev.location}` })
  steps.push({ text: `${ev.title} starts ${hhmm(ev.start)}`, detail: 'arrive' })
  return steps
}
