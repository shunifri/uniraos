import React from "react";
import { TimePicker } from "antd";
import dayjs from "dayjs";
import type { FieldRendererProps } from "../registry/componentRegistry.js";
import { formT } from "../i18n/form-i18n";

export const TimePickerField: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  onBlur,
  fieldState,
  readOnly,
  disabled,
}) => {
  return (
    <TimePicker
      value={value ? dayjs(value, "HH:mm:ss") : null}
      onChange={(time) => onChange(time ? time.format("HH:mm:ss") : null)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"] || formT("placeholder.time")}
      disabled={fieldState.disabled || disabled}
      readOnly={fieldState.readonly || readOnly}
      status={fieldState.errors?.length ? "error" : undefined}
      style={{ width: "100%" }}
      {...(schema["ui:props"] || {})}
    />
  );
};
