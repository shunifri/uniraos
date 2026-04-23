import React from "react";
import { TimePicker } from "antd";
import dayjs from "dayjs";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const TimePickerField: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  onBlur,
  fieldState,
}) => {
  return (
    <TimePicker
      value={value ? dayjs(value, "HH:mm:ss") : null}
      onChange={(time) => onChange(time ? time.format("HH:mm:ss") : null)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"] || "请选择时间"}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors?.length ? "error" : undefined}
      style={{ width: "100%" }}
      {...(schema["ui:props"] || {})}
    />
  );
};
