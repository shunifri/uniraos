import React from "react";
import { Radio } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const RadioGroup: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  fieldState,
}) => {
  const options = fieldState.options || schema["x-dataSource"]?.options || [];

  return (
    <Radio.Group
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={fieldState.disabled}
      options={options.map((opt) => ({
        label: opt.label,
        value: opt.value,
        disabled: opt.disabled,
      }))}
    />
  );
};
