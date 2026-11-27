import { uiText, useTodosLocale } from './i18n.mjs';
import React from 'react';
import { CalendarDays, Clock3, Menu, Plus } from 'lucide-react';
import { validZone, saveZone, deviceZone } from './planner-zone.mjs';
import { usePlanner } from './use-planner.mjs';
import { PlannerTaskList } from './planner-task-list.jsx';
import { PlannerCalendar } from './planner-calendar.jsx';
import { PlannerReminders } from './planner-reminders.jsx';
import { PlannerEditor } from './planner-editor.jsx';
import { PlannerSidebar, plannerViews } from './planner-sidebar.jsx';
import { eventViews } from './planner-form.mjs';

const zones = [...new Set(['UTC', ...(Intl.supportedValuesOf?.('timeZone') ?? [])])];
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
  const title = s.view === 'all' && s.list ? s.list : uiText(plannerViews[s.view][0]);
  const timezone = <details className="planner-timezone" open={!s.confirmed || undefined}>
    <summary title={`${uiText('显示时区')}: ${s.zone}`}><Clock3 size={15} aria-hidden="true" /><span>{s.zone}</span></summary>
    <div className="planner-timezone-fields"><label>{uiText('显示时区')}<input list="corilo-planner-zones" value={s.zoneDraft ?? s.zone} onChange={(e) => set({ zoneDraft: e.target.value })} /></label><button disabled={s.busy || Boolean(s.pending) || Boolean(s.editor)} onClick={(e) => {
      const zone = s.zoneDraft ?? s.zone;
      if (!validZone(zone)) { set({ error: '请选择有效时区' }); return; }
      saveZone(zone); set({ zone, zoneDraft: null, confirmed: true, error: '' });
      e.currentTarget.closest('details')?.removeAttribute('open');
    }}>{uiText('使用此时区')}</button>{s.zone !== deviceZone() && <p className="planner-timezone-hint">{uiText('此设备时区为 {zone}', { zone: deviceZone() })}</p>}</div>
  </details>;
  return <section className={`corilo-planner${s.editor ? ' is-editing' : ''}`} aria-label={uiText('任务与日历')}>
    <datalist id="corilo-planner-zones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist>
    <div className="planner-layout">
    <PlannerSidebar s={s} set={set} refresh={refresh} exportData={exportData}>{timezone}</PlannerSidebar>
    <div className="planner-body"><div className="planner-main"><div className={`planner-content${s.view === 'calendar' ? ' is-calendar' : ''}`}>
      <header className="planner-heading">
        <button className="planner-icon-button planner-drawer-toggle" aria-label={uiText('打开清单栏')} aria-expanded={s.drawer} onClick={() => set({ drawer: !s.drawer })}><Menu size={18} aria-hidden="true" /></button>
        <div className="planner-heading-title"><h1>{title}</h1>{taskView && <p className="planner-heading-meta">{s.view === 'today' ? date : ''}{s.confirmed && <span>{uiText('{count} 项任务', { count: s.total })}</span>}</p>}</div>
        <div className="planner-toolbar">
          {s.confirmed && eventViews.includes(s.view) && <button className="planner-event-add" disabled={s.busy || Boolean(s.pending)} onClick={() => open('event')}><CalendarDays size={15} aria-hidden="true" /><span>{uiText('新建日程')}</span></button>}
          <button className="planner-primary planner-add" disabled={!s.confirmed || s.busy || Boolean(s.pending)} onClick={() => open('task')}><Plus size={16} aria-hidden="true" /><span>{uiText('新建任务')}</span></button>
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
    </div>
  </section>;
}
