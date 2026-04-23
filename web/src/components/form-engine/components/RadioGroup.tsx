import React from "react";
import { Radio, Segmented } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const RadioGroup: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  fieldState,
}) => {
  const options = fieldState.options || schema["x-dataSource"]?.options || [];
  const variant = schema["ui:props"]?.variant || "default";

  const mappedOptions = options.map((opt) => ({
    label: opt.label,
    value: opt.value,
    disabled: opt.disabled,
  }));

  if (variant === "segmented") {
    return (
      <Segmented
        value={value}
        onChange={(val) => onChange(val)}
        disabled={fieldState.disabled}
        options={mappedOptions.map((opt) => ({
          label: opt.label,
          value: opt.value,
          disabled: opt.disabled,
        }))}
      />
    );
  }

  if (variant === "button") {
    return (
      <Radio.Group
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={fieldState.disabled}
        optionType="button"
        options={mappedOptions}
      />
    );
  }

  return (
    <Radio.Group
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={fieldState.disabled}
      options={mappedOptions}
    />
  );
};
