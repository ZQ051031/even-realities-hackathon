import type { AgendaEvent, Reminder } from './types'
import { MIN } from './time'

const round5 = (ms: number) => Math.round(ms / (5 * MIN)) * 5 * MIN

/** Clearly-labelled sample day, laid out relative to "now" so a demo always has something coming up. */
export function demoEvents(now: number): AgendaEvent[] {
  const t = round5(now)
  const ev = (id: string, title: string, startMin: number, lenMin: number, location?: string, steps?: string[]): AgendaEvent => ({
    id: `demo-${id}`,
    title,
    start: t + startMin * MIN,
    end: t + (startMin + lenMin) * MIN,
    location,
    steps,
  })
  return [
    ev('standup', 'Team standup', -90, 15, 'Zoom'),
    ev('review', 'Design review', 20, 45, 'Room 4B, Level 3', [
      'Take the lift to Level 3 | 1 min',
      'Exit lift, turn right | 20 m',
      'Pass the kitchen | 15 m',
      'Room 4B, 2nd door on left | arrive',
    ]),
    ev('lunch', 'Lunch with Sam', 135, 60, "Noodle Bar, Queen's Rd", [
      "Exit lobby onto Queen's Rd | 0 m",
      'Turn left, walk 2 blocks | 300 m',
      'Cross at the lights | 30 m',
      'Noodle Bar is on the right | arrive',
    ]),
    ev('alex', '1:1 with Alex', 240, 30, 'Phone call'),
    ev('gym', 'Gym', 360, 60, 'FitHub, Level 2'),
  ]
}

export function demoReminders(now: number): Reminder[] {
  return [
    { id: 'demo-r1', text: 'Stretch & drink water', due: now + 1 * MIN },
    { id: 'demo-r2', text: 'Send slides to Sam', due: round5(now + 45 * MIN) },
    { id: 'demo-r3', text: 'Call the pharmacy', due: round5(now + 3 * 60 * MIN) },
  ]
}
