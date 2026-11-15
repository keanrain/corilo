import { uiText } from './i18n.mjs';
import React from "react";
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
