import React from "react";
import { Select } from "antd";
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

  return (
    <Select
      value={value}
      onChange={(val) => onChange(val)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"] || formT("placeholder.select")}
      disabled={fieldState.disabled}
      options={options.map((opt) => ({
        label: opt.label,
        value: opt.value,
        disabled: opt.disabled,
      }))}
      loading={fieldState.loading}
      mode={uiProps.multiple ? "multiple" : undefined}
      showSearch={uiProps.showSearch}
      allowClear={uiProps.allowClear}
      status={fieldState.errors?.length ? "error" : undefined}
      style={{ width: "100%" }}
      {...uiProps}
      {...rest}
    />
  );
};
