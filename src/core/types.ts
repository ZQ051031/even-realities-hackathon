export interface AgendaEvent {
  id: string
  title: string
  /** epoch ms */
  start: number
  end: number
  allDay?: boolean
  location?: string
  notes?: string
  /** explicit heads-up route steps ("GO:" lines in the event description) */
  steps?: string[]
}

export interface Reminder {
  id: string
  text: string
  /** epoch ms */
  due: number
  done?: boolean
}

export type AgendaSource = 'calendar' | 'demo'

export interface Agenda {
  source: AgendaSource
  events: AgendaEvent[]
  fetchedAt: number
  error?: string
}

/** Device-agnostic input, mapped from Even Hub events or from the browser mock. */
export type Input =
  | { kind: 'tap' }
  | { kind: 'double' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'long' }
  | { kind: 'menu'; id: number }
  | { kind: 'select'; index: number }
