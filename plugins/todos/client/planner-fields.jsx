import React from "react";
export const priorities = [
  ["normal", "普通"],
  ["high", "高"],
  ["urgent", "紧急"],
];
export const options = (values) =>
  values.map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
