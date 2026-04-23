import React from "react";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import type { FieldRendererProps } from "../registry/componentRegistry.js";
import { formT } from "../i18n/form-i18n";

export const DatePickerField: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  onBlur,
  fieldState,
}) => {
  return (
    <DatePicker
      value={value ? dayjs(value) : null}
      onChange={(date) => onChange(date ? date.format("YYYY-MM-DD") : null)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"] || formT("placeholder.date")}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors?.length ? "error" : undefined}
      style={{ width: "100%" }}
      {...(schema["ui:props"] || {})}
    />
  );
};
