import { uiText } from './i18n.mjs';
import React from 'react';
import { CalendarDays, CalendarPlus, CheckCheck, Circle, CircleCheck, Flag, Search, SlidersHorizontal, Tag, X } from 'lucide-react';
import { options, priorities } from './planner-fields.jsx';

export function PlannerTaskList({ s, set, open, refresh }) {
  const filtered = Boolean(s.query || s.list || s.priority);
  const groups = new Map();
  for (const task of s.items) {
    const group = s.view === 'today' ? task.classification.group : s.view === 'future' ? task.classification.future : '';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(task);
  }
  return <>
    <div className="planner-filters">
      <label className="planner-search"><Search size={17} aria-hidden="true" /><span className="planner-sr-only">{uiText('搜索')}</span><input placeholder={uiText('搜索任务')} value={s.query} onChange={(e) => set({ query: e.target.value })} /></label>
      <details className="planner-filter-options">
        <summary><SlidersHorizontal size={16} aria-hidden="true" />{uiText('筛选')}{filtered && <span className="planner-filter-dot" aria-hidden="true" />}</summary>
        <div className="planner-filter-fields">
          <label>{uiText('清单')}<input value={s.list} onChange={(e) => set({ list: e.target.value })} /></label>
          <label>{uiText('优先级')}<select value={s.priority} onChange={(e) => set({ priority: e.target.value })}>{options([['', uiText('全部优先级')], ...priorities()])}</select></label>
          <button onClick={() => set({ query: '', list: '', priority: '' })}><X size={14} aria-hidden="true" />{uiText('清空筛选')}</button>
        </div>
      </details>
    </div>
    <div className="planner-list-summary"><span>{uiText('{count} 项任务', { count: s.total })}</span>{filtered && <button onClick={() => set({ query: '', list: '', priority: '' })}>{uiText('清空筛选')}</button>}</div>
    {!s.items.length && <div className="planner-empty"><CheckCheck size={34} strokeWidth={1.3} aria-hidden="true" /><h2>{uiText(filtered ? '没有找到匹配的任务' : '这里还没有任务')}</h2><p>{uiText(filtered ? '试试其他关键词，或清空筛选。' : '记下一件要做的事，慢慢来。')}</p></div>}
    {[...groups].map(([group, items]) => <section className="planner-task-group" key={group || 'tasks'}>
      {group && <h2 className="planner-group-heading" data-overdue={group === '逾期截止' || undefined}>{uiText(group)}<small>{items.length}</small></h2>}
      <ul className="planner-task-rows" aria-label={uiText('待办列表')}>
        {items.map((task) => <li key={task.id} data-status={task.status} data-priority={task.priority} data-selected={s.editor?.item?.id === task.id || undefined}>
          <button className="planner-task-open" aria-label={task.title} onClick={() => open('task', task)}>
            <span className="planner-task-circle" aria-hidden="true">{task.status === 'done' ? <CircleCheck size={20} strokeWidth={1.5} /> : <Circle size={20} strokeWidth={1.4} />}</span>
            <span className="planner-task-copy"><span className="planner-task-title">{task.title}</span>
              {task.body && <span className="planner-task-preview">{task.body.split('\n')[0].slice(0, 100)}</span>}
              {(task.list || task.plannedDate || task.due || task.priority !== 'normal') && <span className="planner-task-meta">
                {task.list && <span><Tag size={12} aria-hidden="true" />{task.list}</span>}
                {task.plannedDate && <span><CalendarDays size={12} aria-hidden="true" />{task.plannedDate}</span>}
                {task.due && <span data-overdue={task.classification.overdue || undefined}>{uiText('截止')} {task.due.date ?? task.due.at}</span>}
                {task.priority !== 'normal' && <span className="planner-priority"><Flag size={12} aria-hidden="true" />{uiText(task.priority === 'urgent' ? '紧急' : '高')}</span>}
              </span>}
            </span>
          </button>
          <button className="planner-schedule-button" aria-label={uiText('安排时间')} title={uiText('安排时间')} onClick={() => open('event', null, { title: task.title, taskId: task.id })}><CalendarPlus size={17} aria-hidden="true" /><span>{uiText('安排时间')}</span></button>
        </li>)}
      </ul>
    </section>)}
    {s.cursor && <button className="planner-load-more" onClick={() => refresh(true)}>{uiText('加载更多任务')}</button>}
  </>;
}
