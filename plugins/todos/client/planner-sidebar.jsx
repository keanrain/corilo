import React from 'react';
import { Ban, Bell, CalendarDays, CalendarRange, CheckCheck, CircleCheck, Download, Inbox, List, ListTodo, RefreshCw, Sun } from 'lucide-react';
import { uiText } from './i18n.mjs';

export const plannerViews = {
  today: ['今天', Sun], future: ['未来', CalendarRange], inbox: ['收集箱', Inbox], all: ['全部', ListTodo],
  calendar: ['日历', CalendarDays], reminders: ['提醒', Bell],
  done: ['已完成', CircleCheck], cancelled: ['已取消', Ban],
};

// Left column: smart views with counts, the calendar, named lists, and the
// closed views. On narrow screens the same column slides in as a drawer.
export function PlannerSidebar({ s, set, refresh, exportData, children }) {
  const go = (change) => set({ query: '', priority: '', ...change, drawer: false });
  const count = (key) => s.summary?.views?.[key];
  const item = (key) => {
    const [label, Icon] = plannerViews[key];
    const active = s.view === key && !(key === 'all' && s.list);
    const n = count(key);
    return <button key={key} data-view={key} aria-pressed={active} onClick={() => go({ view: key, list: '' })}>
      <Icon size={17} strokeWidth={1.7} aria-hidden="true" /><span className="planner-side-label">{uiText(label)}</span>
      {n ? <span className="planner-side-count" aria-hidden="true">{n}</span> : null}
    </button>;
  };
  return <>
    {s.drawer && <button className="planner-scrim" aria-label={uiText('关闭清单栏')} onClick={() => set({ drawer: false })} />}
    <aside className={`planner-sidebar${s.drawer ? ' is-open' : ''}`} aria-label={uiText('任务视图')}>
      <div className="planner-brand">
        <CheckCheck size={19} strokeWidth={1.7} aria-hidden="true" /><span>{uiText('待办')}</span>
        <span className="planner-brand-actions">
          <button className="planner-icon-button" aria-label={uiText('刷新')} title={uiText('刷新')} onClick={() => refresh()}><RefreshCw size={15} aria-hidden="true" /></button>
          <button className="planner-icon-button" aria-label={uiText('导出')} title={uiText('导出')} onClick={exportData}><Download size={15} aria-hidden="true" /></button>
        </span>
      </div>
      <nav className="planner-side-nav">
        <div className="planner-side-group">{['today', 'future', 'inbox', 'all'].map(item)}</div>
        <div className="planner-side-group">{['calendar', 'reminders'].map(item)}</div>
        {s.summary?.lists?.length > 0 && <div className="planner-side-group">
          <h2 className="planner-side-heading">{uiText('清单')}</h2>
          {s.summary.lists.map((entry) => <button key={entry.name} data-list={entry.name} aria-pressed={s.view === 'all' && s.list === entry.name} onClick={() => go({ view: 'all', list: entry.name })}>
            <List size={17} strokeWidth={1.7} aria-hidden="true" /><span className="planner-side-label">{entry.name}</span>
            <span className="planner-side-count" aria-hidden="true">{entry.count}</span>
          </button>)}
        </div>}
        <div className="planner-side-group planner-side-closed">{['done', 'cancelled'].map(item)}</div>
      </nav>
      <div className="planner-side-footer">{children}</div>
    </aside>
  </>;
}
