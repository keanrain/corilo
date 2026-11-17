import { uiText, useTodosLocale } from './i18n.mjs';
import React from 'react';
import { Archive, Bell, CalendarDays, CalendarRange, CheckCheck, CircleCheck, Clock3, Download, Inbox, ListTodo, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Temporal } from './planner-dates.mjs';
import { usePlanner } from './use-planner.mjs';
import { PlannerTaskList } from './planner-task-list.jsx';
import { PlannerCalendar } from './planner-calendar.jsx';
import { PlannerReminders } from './planner-reminders.jsx';
import { PlannerEditor } from './planner-editor.jsx';

const views = {
  inbox: ['收集箱', Inbox], today: ['今天', CalendarDays], future: ['未来', CalendarRange], all: ['全部', ListTodo],
  done: ['已完成', CircleCheck], cancelled: ['已取消', Trash2], calendar: ['日历', CalendarDays], reminders: ['提醒', Bell],
};
const descriptions = {
  inbox: '先记下来，稍后再安排。', today: '专注眼前，一件一件完成。', future: '给接下来的日子留出空间。', all: '每一件要做的事，都在这里。',
  done: '回看已经完成的事。', cancelled: '暂时放下的事，也有去处。', calendar: '把时间留给重要的事。', reminders: '需要留意的事，集中在这里。',
};
export function Planner({ identity }) {
  const language = useTodosLocale();
  const planner = usePlanner(identity);
  const { s, set, open, refresh, call } = planner;
  let date;
  try { date = new Intl.DateTimeFormat(language, { month: 'long', day: 'numeric', weekday: 'long', timeZone: s.zone }).format(new Date()); }
  catch { date = ''; }
  async function exportData() {
    try {
      const value = await call('export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'corilo-schedule.json'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { set({ error: e.message }); }
  }
  return (
    <section className={`corilo-planner${s.editor ? ' is-editing' : ''}`} aria-label={uiText('任务与日历')}>
      <aside className="planner-sidebar">
        <div className="planner-brand"><CheckCheck size={19} strokeWidth={1.7} aria-hidden="true" /><span>{uiText('任务与日历')}</span></div>
        <button className="planner-primary planner-add" disabled={!s.confirmed} onClick={() => open('task')}><Plus size={17} aria-hidden="true" />{uiText('新建任务')}</button>
        <nav aria-label={uiText('任务视图')}>
          {Object.entries(views).map(([key, [label, Icon]]) => (
            <button key={key} aria-pressed={s.view === key} onClick={() => set({ view: key })}>
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" /><span>{uiText(label)}</span>
              {s.confirmed && s.view === key && !['calendar', 'reminders'].includes(key) && <small aria-hidden="true">{s.total}</small>}
            </button>
          ))}
        </nav>
        <details className="planner-timezone" open={!s.confirmed || undefined}>
          <summary><Clock3 size={15} aria-hidden="true" /><span>{s.confirmed ? s.zone : uiText('显示时区')}</span></summary>
          <div className="planner-timezone-fields">
            <label>{uiText('显示时区')}<input value={s.zone} onChange={(e) => set({ zone: e.target.value, confirmed: false })} /></label>
            <button onClick={() => {
              try { Temporal.Now.zonedDateTimeISO(s.zone); set({ confirmed: true, error: '' }); }
              catch { set({ error: '请选择有效时区' }); }
            }}>{s.confirmed ? uiText('时区已确认') : uiText('确认时区')}</button>
          </div>
        </details>
      </aside>
      <div className="planner-main">
        <div className={`planner-content${s.view === 'calendar' ? ' is-calendar' : ''}`}>
          <header className="planner-heading">
            <div><p className="planner-eyebrow">{s.view === 'today' ? date : uiText('任务与日历')}</p><h1>{uiText(views[s.view][0])}</h1><p className="planner-description">{uiText(descriptions[s.view])}</p></div>
            {s.confirmed && <div className="planner-toolbar">
              <button className="planner-icon-button" aria-label={uiText('刷新')} title={uiText('刷新')} onClick={() => refresh()}><RefreshCw size={17} aria-hidden="true" /></button>
              <button className="planner-icon-button" aria-label={uiText('导出')} title={uiText('导出')} onClick={exportData}><Download size={17} aria-hidden="true" /></button>
              <button className="planner-event-add" aria-label={uiText('新建日程')} title={uiText('新建日程')} onClick={() => open('event')}><Plus size={16} aria-hidden="true" /><span>{uiText('新建日程')}</span></button>
            </div>}
          </header>
          {!s.editor && s.error && <p className="planner-alert" role="alert">{uiText(s.error)}</p>}
          {!s.editor && s.notice && <p className="planner-notice" role="status">{uiText(s.notice)}</p>}
          {s.confirmed ? <>
            {!['calendar', 'reminders'].includes(s.view) && <PlannerTaskList {...planner} />}
            {s.view === 'calendar' && <PlannerCalendar {...planner} />}
            {s.view === 'reminders' && <PlannerReminders {...planner} />}
          </> : <div className="planner-welcome"><Archive size={32} strokeWidth={1.2} aria-hidden="true" /><h2>{uiText('按你的时区，安排每一天。')}</h2><p>{uiText('确认显示时区后，即可查看任务与日历。')}</p></div>}
        </div>
      </div>
      {s.editor && <PlannerEditor {...planner} />}
    </section>
  );
}
