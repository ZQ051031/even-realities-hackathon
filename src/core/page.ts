/** Renderer-agnostic description of one glasses page, mirroring Even Hub container limits. */

export const SCREEN_W = 576
export const SCREEN_H = 288

export interface TextBox {
  id: number
  name: string
  x: number
  y: number
  w: number
  h: number
  content: string
  border?: number
  radius?: number
  padding?: number
  /** 0 (dim) .. 4 (brightest) */
  color?: number
  capture?: boolean
}

export interface ListBox {
  id: number
  name: string
  x: number
  y: number
  w: number
  h: number
  items: string[]
  border?: number
  padding?: number
  capture?: boolean
}

export interface MenuItem {
  id: number
  name: string
}

export interface Page {
  /** pages with the same layout key differ only in text content and can be updated in place */
  layout: string
  texts: TextBox[]
  list?: ListBox
  menu: MenuItem[]
}

const utf8Len = (s: string) => new TextEncoder().encode(s).length

/** Returns human-readable violations of the documented Even Hub limits (empty = valid). */
export function validatePage(page: Page): string[] {
  const errs: string[] = []
  const boxes = [...page.texts, ...(page.list ? [page.list] : [])]
  if (boxes.length > 8) errs.push(`too many containers: ${boxes.length}`)
  const captures = boxes.filter(b => b.capture).length
  if (captures !== 1) errs.push(`exactly one capture container required, got ${captures}`)
  const ids = new Set<number>()
  const names = new Set<string>()
  for (const b of boxes) {
    if (ids.has(b.id)) errs.push(`duplicate id ${b.id}`)
    if (names.has(b.name)) errs.push(`duplicate name ${b.name}`)
    ids.add(b.id)
    names.add(b.name)
    if (b.name.length > 16) errs.push(`name too long: ${b.name}`)
    if (b.x < 0 || b.y < 0 || b.x + b.w > SCREEN_W || b.y + b.h > SCREEN_H) errs.push(`${b.name} out of bounds`)
  }
  for (const t of page.texts) {
    if (t.content.length > 1000) errs.push(`${t.name} content too long: ${t.content.length}`)
  }
  if (page.list) {
    if (page.list.items.length < 1 || page.list.items.length > 20) errs.push(`list items: ${page.list.items.length}`)
    for (const it of page.list.items) if (it.length > 64) errs.push(`list item too long: ${it}`)
  }
  if (page.menu.length > 10) errs.push(`too many menu items: ${page.menu.length}`)
  for (const m of page.menu) {
    if (m.id <= 0) errs.push(`menu id must be > 0: ${m.name}`)
    if (utf8Len(m.name) > 32) errs.push(`menu label > 32 bytes: ${m.name}`)
  }
  return errs
}

/** Glyphs the G2 firmware font is documented to render, plus printable ASCII. */
const SAFE_GLYPHS = new Set([...'━─█▇▆▅▄▃▂▁▲△▶▷▼▽◀◁●○■□★☆╭╮╯╰│·'])

export function unsafeGlyphs(page: Page): string[] {
  const text = [...page.texts.map(t => t.content), ...(page.list?.items ?? []), ...page.menu.map(m => m.name)].join('')
  const bad = new Set<string>()
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x20 && c < 0x7f) || ch === '\n' || SAFE_GLYPHS.has(ch)) continue
    bad.add(ch)
  }
  return [...bad]
}
