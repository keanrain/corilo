import { uiText, useTodosLocale } from './i18n.mjs';
import React from 'react';
import { Bell, CalendarDays, CalendarRange, CheckCheck, CircleCheck, Clock3, Download, Inbox, ListTodo, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { validZone, saveZone, deviceZone } from './planner-zone.mjs';
import { usePlanner } from './use-planner.mjs';
import { PlannerTaskList } from './planner-task-list.jsx';
import { PlannerCalendar } from './planner-calendar.jsx';
import { PlannerReminders } from './planner-reminders.jsx';
import { PlannerEditor } from './planner-editor.jsx';

const zones = [...new Set(['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])])];
const views = {
  inbox: ['收集箱', Inbox], today: ['今天', CalendarDays], future: ['未来', CalendarRange], all: ['全部', ListTodo],
  done: ['已完成', CircleCheck], cancelled: ['已取消', Trash2], calendar: ['日历', CalendarDays], reminders: ['提醒', Bell],
};
export function Planner({ identity }) {
  const language = useTodosLocale();
  const planner = usePlanner(identity);
  const { s, set, open, refresh, call, reconcile, submit } = planner;
  const taskView = !['calendar', 'reminders'].includes(s.view);
  let date = '';
  try { date = new Intl.DateTimeFormat(language, { month: 'long', day: 'numeric', weekday: 'long', timeZone: s.zone }).format(new Date()); } catch {}
  async function exportData() {
    try {
      const value = await call('export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'corilo-schedule.json'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { set({ error: e.message }); }
  }
  return <section className={`corilo-planner${s.editor ? ' is-editing' : ''}`} aria-label={uiText('任务与日历')}>
    <datalist id="corilo-planner-zones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist>
    <header className="planner-shell">
      <div className="planner-brand"><CheckCheck size={19} strokeWidth={1.7} aria-hidden="true" /><span>{uiText('待办')}</span></div>
      <div className="planner-shell-actions">
        {s.confirmed && <>
          <button className="planner-icon-button" aria-label={uiText('刷新')} title={uiText('刷新')} onClick={() => refresh()}><RefreshCw size={16} aria-hidden="true" /></button>
          <button className="planner-icon-button" aria-label={uiText('导出')} title={uiText('导出')} onClick={exportData}><Download size={16} aria-hidden="true" /></button>
        </>}
        <button className="planner-primary planner-add" disabled={!s.confirmed || s.busy || Boolean(s.pending)} onClick={() => open('task')}><Plus size={16} aria-hidden="true" />{uiText('新建任务')}</button>
      </div>
    </header>
    <nav className="planner-navigation" aria-label={uiText('任务视图')}>
      {Object.entries(views).map(([key, [label, Icon]]) => <button key={key} aria-pressed={s.view === key} onClick={() => set({ view: key })}><Icon size={16} strokeWidth={1.7} aria-hidden="true" /><span>{uiText(label)}</span></button>)}
    </nav>
    <div className="planner-body"><div className="planner-main"><div className={`planner-content${s.view === 'calendar' ? ' is-calendar' : ''}`}>
      <header className="planner-heading">
        <div><h1>{uiText(views[s.view][0])}</h1>{taskView && <p className="planner-heading-meta">{s.view === 'today' ? date : ''}{s.confirmed && <span>{uiText('{count} 项任务', { count: s.total })}</span>}</p>}</div>
        <div className="planner-toolbar">
          {s.confirmed && <button className="planner-event-add" disabled={s.busy || Boolean(s.pending)} onClick={() => open('event')}><CalendarDays size={15} aria-hidden="true" /><span>{uiText('新建日程')}</span></button>}
          <details className="planner-timezone" open={!s.confirmed || undefined}>
            <summary title={uiText('显示时区')}><Clock3 size={15} aria-hidden="true" /><span>{s.zone}</span></summary>
            <div className="planner-timezone-fields"><label>{uiText('显示时区')}<input list="corilo-planner-zones" value={s.zoneDraft ?? s.zone} onChange={(e) => set({ zoneDraft: e.target.value })} /></label><button disabled={s.busy || Boolean(s.pending) || Boolean(s.editor)} onClick={(e) => {
              const zone = s.zoneDraft ?? s.zone;
              if (!validZone(zone)) { set({ error: '请选择有效时区' }); return; }
              saveZone(zone); set({ zone, zoneDraft: null, confirmed: true, error: '' });
              e.currentTarget.closest('details')?.removeAttribute('open');
            }}>{uiText('使用此时区')}</button>{s.zone !== deviceZone() && <p className="planner-timezone-hint">{uiText('此设备时区为 {zone}', { zone: deviceZone() })}</p>}</div>
          </details>
        </div>
      </header>
      {!s.editor && s.error && <p className="planner-alert" role="alert">{uiText(s.error)}</p>}
      {!s.editor && s.notice && <p className="planner-notice" role="status">{uiText(s.notice)}</p>}
      {!s.editor && s.pending && <div className="planner-resolution"><button disabled={s.busy} onClick={reconcile}>{uiText('核对操作')}</button>{s.notice === '未找到回执，可重试原请求' && <button disabled={s.busy} onClick={() => submit(s.pending)}>{uiText('重试原请求')}</button>}</div>}
      {s.confirmed ? <>
        {taskView && <PlannerTaskList {...planner} />}
        {s.view === 'calendar' && <PlannerCalendar {...planner} />}
        {s.view === 'reminders' && <PlannerReminders {...planner} />}
      </> : <div className="planner-empty"><Clock3 size={28} strokeWidth={1.3} aria-hidden="true" /><h2>{uiText('确认显示时区')}</h2><p>{uiText('日期、日历和提醒将使用这个时区。')}</p></div>}
    </div></div>
    {s.editor && <PlannerEditor {...planner} />}
    </div>
  </section>;
}
