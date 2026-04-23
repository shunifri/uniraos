import React from "react";
import { Select, Segmented } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";
import { formT } from "../i18n/form-i18n";

export const SelectInput: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  onBlur,
  formData,
  fieldState,
  readOnly,
  disabled,
  ...rest
}) => {
  const uiProps = schema["ui:props"] || {};
  const options = fieldState.options || schema["x-dataSource"]?.options || [];
  const variant = uiProps.variant || "default";
  const isMultiple = uiProps.multiple;

  const mappedOptions = options.map((opt) => ({
    label: opt.label,
    value: opt.value,
    disabled: opt.disabled,
  }));

  // 单选 + variant=segmented 时使用 Segmented 分段控制器
  if (!isMultiple && variant === "segmented") {
    return (
      <Segmented
        value={value}
        onChange={(val) => onChange(val)}
        disabled={fieldState.disabled}
        options={mappedOptions}
      />
    );
  }

  return (
    <Select
      value={value}
      onChange={(val) => onChange(val)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"] || formT("placeholder.select")}
      disabled={fieldState.disabled}
      options={mappedOptions}
      loading={fieldState.loading}
      mode={isMultiple ? "multiple" : undefined}
      showSearch={uiProps.showSearch}
      allowClear={uiProps.allowClear}
      status={fieldState.errors?.length ? "error" : undefined}
      style={{ width: "100%" }}
      {...uiProps}
      {...rest}
    />
  );
};
