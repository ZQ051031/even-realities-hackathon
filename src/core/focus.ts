import { MIN } from './time'

export type FocusPhase = 'focus' | 'break'

export interface FocusState {
  phase: FocusPhase
  /** total length of the current phase, ms */
  length: number
  /** ms remaining when paused / at last start */
  remaining: number
  /** epoch ms when the timer was (re)started; null when paused */
  startedAt: number | null
  completed: number
  focusMinutes: number
  breakMinutes: number
}

export function newFocus(focusMinutes = 25, breakMinutes = 5): FocusState {
  return {
    phase: 'focus',
    length: focusMinutes * MIN,
    remaining: focusMinutes * MIN,
    startedAt: null,
    completed: 0,
    focusMinutes,
    breakMinutes,
  }
}

export function remaining(f: FocusState, now: number): number {
  if (f.startedAt === null) return f.remaining
  return Math.max(0, f.remaining - (now - f.startedAt))
}

export const isRunning = (f: FocusState) => f.startedAt !== null

export function toggle(f: FocusState, now: number): FocusState {
  if (f.startedAt === null) return { ...f, startedAt: now }
  return { ...f, remaining: remaining(f, now), startedAt: null }
}

export function reset(f: FocusState): FocusState {
  const length = (f.phase === 'focus' ? f.focusMinutes : f.breakMinutes) * MIN
  return { ...f, length, remaining: length, startedAt: null }
}

export function adjust(f: FocusState, deltaMinutes: number, now: number): FocusState {
  const left = remaining(f, now)
  const next = Math.min(120 * MIN, Math.max(MIN, left + deltaMinutes * MIN))
  return {
    ...f,
    length: Math.max(f.length + (next - left), next),
    remaining: next,
    startedAt: f.startedAt === null ? null : now,
  }
}

/** Advance to the next phase; breaks start automatically so the user stays hands-free. */
export function nextPhase(f: FocusState, now: number): FocusState {
  const phase: FocusPhase = f.phase === 'focus' ? 'break' : 'focus'
  const length = (phase === 'focus' ? f.focusMinutes : f.breakMinutes) * MIN
  return {
    ...f,
    phase,
    length,
    remaining: length,
    startedAt: phase === 'break' ? now : null,
    completed: f.phase === 'focus' ? f.completed + 1 : f.completed,
  }
}

export const isFinished = (f: FocusState, now: number) => isRunning(f) && remaining(f, now) <= 0
