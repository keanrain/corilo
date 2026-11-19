import React from "react";
import { uiText } from "./i18n.mjs";
import { priorities } from "./planner-fields.jsx";
import { exactLabel } from "./planner-time.mjs";

// Include every editable field, including cleared values and original time zones.
// User text remains verbatim; only labels and enum values are translated.
export function PlannerLatest({ kind, value, linkedTaskLabel, zone }) {
  const field = (label, text) => (
    <div>
      <dt>{uiText(label)}</dt>
      <dd>{text === null || text === undefined || text === "" ? uiText("未设置") : text}</dd>
    </div>
  );
  return (
    <dl className="planner-latest-content">
      {field("标题", value.title)}
      {field("说明", value.body)}
      {field("状态", uiText(({ open: "未完成", done: "完成", active: "有效", cancelled: "取消" })[value.status]))}
      {kind === "task" ? <>
        {field("计划日期", value.plannedDate)}
        {field("清单", value.list)}
        {field("优先级", priorities().find(([key]) => key === value.priority)?.[1])}
        {field("截止类型", uiText(value.due ? value.due.kind === "date" ? "日期" : "精确时间" : "无截止"))}
        {field("截止", value.due?.date ?? exactLabel(value.due?.at, value.due?.timeZone))}
        {field("截止时区", value.due?.timeZone)}
      </> : <>
        {field("全天", uiText(value.allDay ? "是" : "否"))}
        {field("开始", value.allDay ? value.start : exactLabel(value.start, value.timeZone))}
        {field(value.allDay ? "结束（全天结束日期不含当天）" : "结束", value.allDay ? value.end : exactLabel(value.end, value.timeZone))}
        {field("日程原时区", value.timeZone)}
        {field("地点", value.location)}
        {field("关联任务", linkedTaskLabel)}
      </>}
      {field("提醒", exactLabel(value.reminderAt, zone))}
    </dl>
  );
}
