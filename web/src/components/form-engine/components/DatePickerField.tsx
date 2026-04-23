import React from "react";
import { DatePicker } from "antd";
import dayjs from "dayjs";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

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
      placeholder={schema["ui:placeholder"] || "请选择日期"}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors?.length ? "error" : undefined}
      style={{ width: "100%" }}
      {...(schema["ui:props"] || {})}
    />
  );
};
