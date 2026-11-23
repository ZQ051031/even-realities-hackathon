import type { Glance } from './platform/controller'
import { pendingReminders } from './core/app'
import { hhmm, relative } from './core/time'

/** Phone-side settings screen (the WebView page) - also shown next to the browser mock. */
export function mountCompanion(host: HTMLElement, app: Glance) {
  host.innerHTML = `
    <h1>Glance <small>heads-up assistant</small></h1>
    <p class="status" data-status></p>
    <section>
      <h2>Reminders</h2>
      <form data-reminder>
        <input name="text" placeholder="Reminder text" maxlength="60" required>
        <select name="mins">
          <option value="1">in 1 min</option><option value="5">in 5 min</option>
          <option value="15">in 15 min</option><option value="30" selected>in 30 min</option>
          <option value="60">in 1 h</option><option value="120">in 2 h</option>
        </select>
        <button>Add</button>
      </form>
      <ul data-reminders></ul>
    </section>
    <section>
      <h2>Focus timer</h2>
      <form data-focus>
        <label>Focus <input name="focus" type="number" min="1" max="120"> min</label>
        <label>Break <input name="brk" type="number" min="1" max="120"> min</label>
        <button>Save</button>
      </form>
    </section>
    <section>
      <h2>Calendar</h2>
      <form data-agenda>
        <input name="url" placeholder="/api/agenda or https://.../calendar.ics">
        <button>Load</button>
      </form>
      <p class="hint">Default <code>/api/agenda</code> is the bundled proxy. Configure it with <code>GLANCE_ICS_URL</code> (e.g. your Google Calendar secret iCal address) - see README. Without it Glance shows a labelled demo day.</p>
    </section>
    <p><button data-reset>Reset demo reminders</button></p>`

  const $ = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)!
  const focusForm = $<HTMLFormElement>('[data-focus]')
  const agendaForm = $<HTMLFormElement>('[data-agenda]')
  ;(focusForm.elements.namedItem('focus') as HTMLInputElement).value = String(app.state.focus.focusMinutes)
  ;(focusForm.elements.namedItem('brk') as HTMLInputElement).value = String(app.state.focus.breakMinutes)
  ;(agendaForm.elements.namedItem('url') as HTMLInputElement).value = app.agendaUrl

  $<HTMLFormElement>('[data-reminder]').addEventListener('submit', e => {
    e.preventDefault()
    const f = e.target as HTMLFormElement
    const text = f.elements.namedItem('text') as HTMLInputElement
    app.addReminder(text.value, Number((f.elements.namedItem('mins') as HTMLSelectElement).value))
    text.value = ''
  })
  focusForm.addEventListener('submit', e => {
    e.preventDefault()
    app.setFocusLengths(
      Number((focusForm.elements.namedItem('focus') as HTMLInputElement).value),
      Number((focusForm.elements.namedItem('brk') as HTMLInputElement).value),
    )
  })
  agendaForm.addEventListener('submit', e => {
    e.preventDefault()
    void app.setAgendaUrl((agendaForm.elements.namedItem('url') as HTMLInputElement).value)
  })
  $('[data-reset]').addEventListener('click', () => app.resetDemo())
  const list = $('[data-reminders]')
  list.addEventListener('click', e => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-del]')?.dataset.del
    if (id) app.removeReminder(id)
  })

  let last = ''
  const refresh = () => {
    const s = app.state
    const now = Date.now()
    const a = s.agenda
    const status =
      `${app.renderer.kind === 'evenhub' ? 'Connected to Even Hub' : 'Browser mock display'} · ` +
      (a.source === 'calendar' ? `${a.events.length} calendar events today` : `DEMO agenda${a.error ? ` (${a.error})` : ''}`)
    const items = pendingReminders(s)
      .map(r => `<li>${hhmm(r.due)} · ${esc(r.text)} <small>${relative(r.due, now)}</small> <button data-del="${r.id}" aria-label="Delete">✕</button></li>`)
      .join('')
    const html = status + '|' + items
    if (html === last) return
    last = html
    $('[data-status]').textContent = status
    list.innerHTML = items || '<li><small>No pending reminders</small></li>'
  }
  app.subscribe(refresh)
  refresh()
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
