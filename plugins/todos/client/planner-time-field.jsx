import React, { useEffect, useId, useState } from "react";
import { uiText } from "./i18n.mjs";
import { isPast, resolveLocal, splitInstant } from "./planner-time.mjs";

// A wall-clock date + time in `zone`, stored as an exact instant. Partial
// input stays local until both parts are present; a gap or overlap time asks
// the person to pick one of the explicit offsets instead of guessing.
export function PlannerTimeField({ label, value, zone, onChange, clearable = false, warnPast = false, children }) {
  const id = useId();
  const [draft, setDraft] = useState(() => splitInstant(value, zone));
  const [choice, setChoice] = useState(null);
  useEffect(() => {
    const shown = resolveLocal(draft.date, draft.time, zone);
    if (shown.instant !== value) { setDraft(splitInstant(value, zone)); setChoice(null); }
    // Only an outside change (or zone change) resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, zone]);
  function update(next) {
    setDraft(next);
    if (!next.date && !next.time) { setChoice(null); if (clearable) onChange(null); return; }
    const result = resolveLocal(next.date, next.time, zone);
    if (result.kind === "exact") { setChoice(null); onChange(result.instant); }
    else setChoice(result.kind === "ambiguous" || result.kind === "missing" ? result : null);
  }
  const past = warnPast && value && isPast(value);
  return (
    <fieldset className="planner-time-field" aria-describedby={`${id}-zone`}>
      <legend>{label}</legend>
      <div className="planner-time-inputs">
        <input type="date" aria-label={uiText("{label}日期", { label })} value={draft.date}
          onChange={(e) => update({ ...draft, date: e.target.value })} />
        <input type="time" aria-label={uiText("{label}时间", { label })} value={draft.time}
          onChange={(e) => update({ ...draft, time: e.target.value })} />
        {clearable && (draft.date || draft.time) && (
          <button type="button" className="planner-time-clear" onClick={() => update({ date: "", time: "" })}>{uiText("清除")}</button>
        )}
      </div>
      <p id={`${id}-zone`} className="planner-time-zone">{zone}</p>
      {choice && (
        <div className="planner-time-choice" aria-live="polite">
          <p>{uiText(choice.kind === "ambiguous" ? "这个时间在 {zone} 出现两次，请选择一个：" : "这个时间在 {zone} 不存在（夏令时调整），请选择一个：", { zone })}</p>
          {choice.candidates.map((c) => (
            <button key={c.instant} type="button" onClick={() => { setChoice(null); onChange(c.instant); setDraft(splitInstant(c.instant, zone)); }}>{c.label}</button>
          ))}
        </div>
      )}
      {past && <p className="planner-time-past" aria-live="polite">{uiText("这个时间已过，不会提醒")}</p>}
      {children}
    </fieldset>
  );
}
