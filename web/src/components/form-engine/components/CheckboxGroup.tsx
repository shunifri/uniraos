import React from "react";
import { Checkbox } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const CheckboxGroup: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  fieldState,
}) => {
  const options = fieldState.options || schema["x-dataSource"]?.options || [];

  return (
    <Checkbox.Group
      value={value || []}
      onChange={(val) => onChange(val)}
      disabled={fieldState.disabled}
      options={options.map((opt) => ({
        label: opt.label,
        value: opt.value,
        disabled: opt.disabled,
      }))}
    />
  );
};
