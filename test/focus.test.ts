import { describe, expect, it } from 'vitest'
import * as F from '../src/core/focus'

const MIN = 60_000

describe('focus timer', () => {
  it('runs, pauses and resumes', () => {
    let f = F.newFocus(25, 5)
    f = F.toggle(f, 0)
    expect(F.remaining(f, 10 * MIN)).toBe(15 * MIN)
    f = F.toggle(f, 10 * MIN)
    expect(F.isRunning(f)).toBe(false)
    expect(F.remaining(f, 99 * MIN)).toBe(15 * MIN)
    f = F.toggle(f, 100 * MIN)
    expect(F.remaining(f, 105 * MIN)).toBe(10 * MIN)
  })

  it('auto-starts the break and counts sessions', () => {
    let f = F.toggle(F.newFocus(25, 5), 0)
    expect(F.isFinished(f, 25 * MIN)).toBe(true)
    f = F.nextPhase(f, 25 * MIN)
    expect(f.phase).toBe('break')
    expect(f.completed).toBe(1)
    expect(F.isRunning(f)).toBe(true)
    f = F.nextPhase(f, 30 * MIN)
    expect(f.phase).toBe('focus')
    expect(F.isRunning(f)).toBe(false)
    expect(f.completed).toBe(1)
  })

  it('adjusts within bounds and resets', () => {
    let f = F.adjust(F.newFocus(25, 5), -30, 0)
    expect(F.remaining(f, 0)).toBe(MIN)
    f = F.reset(f)
    expect(F.remaining(f, 0)).toBe(25 * MIN)
  })
})
