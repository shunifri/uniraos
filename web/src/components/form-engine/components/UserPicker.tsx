import React, { useState, useEffect } from "react";
import { Select } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";
import { formT } from "../i18n/form-i18n";

export const UserPicker: React.FC<FieldRendererProps> = ({
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
  const [options, setOptions] = useState<
    Array<{ label: string; value: string; avatar?: string }>
  >([]);

  useEffect(() => {
    if (fieldState.options) {
      setOptions(fieldState.options);
      return;
    }

    const staticOptions = schema["x-dataSource"]?.options;
    if (staticOptions) {
      setOptions(staticOptions);
      return;
    }

    setOptions([]);
  }, [fieldState.options, schema["x-dataSource"]]);

  return (
    <Select
      id={name}
      value={value}
      onChange={(val) => onChange(val)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"] || formT("placeholder.user")}
      disabled={fieldState.disabled}
      options={options}
      loading={fieldState.loading}
      mode={uiProps.multiple ? "multiple" : undefined}
      showSearch
      allowClear
      status={fieldState.errors?.length ? "error" : undefined}
      style={{ width: "100%" }}
      {...uiProps}
      {...rest}
    />
  );
};
