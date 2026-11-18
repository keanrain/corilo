import { uiText } from './i18n.mjs';
import React, { useEffect, useState } from "react";
import { PLANNER_READ_TIMEOUT_MS } from "./planner-api.mjs";

export function useLinkedTaskLabel(call, id, fallback) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    const signal = AbortSignal.timeout(PLANNER_READ_TIMEOUT_MS);
    call("tasks/read", { id }, signal).then(
      (task) => {
        if (active) setResult({ id, title: task.title });
      },
      () => {
        if (active) setResult({ id, title: null });
      },
    );
    return () => { active = false; };
  }, [call, id]);
  if (!id) return uiText("独立事件");
  if (result?.id === id) return result.title ?? fallback ?? uiText("无法读取关联任务");
  return fallback ?? uiText("读取中…");
}
export const priorities = () => [
  ["normal", uiText("普通")],
  ["high", uiText("高")],
  ["urgent", uiText("紧急")],
];
export const options = (values) =>
  values.map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
