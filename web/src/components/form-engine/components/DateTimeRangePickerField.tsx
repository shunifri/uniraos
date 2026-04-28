import React from "react";
import { DatePicker } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type { FieldRendererProps } from "../registry/componentRegistry.js";
import { formT } from "../i18n/form-i18n";

export const DateTimeRangePickerField: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  onBlur,
  fieldState,
  readOnly,
  disabled,
}) => {
  const rangeValue: [Dayjs, Dayjs] | null =
    Array.isArray(value) && value.length === 2
      ? [dayjs(value[0]), dayjs(value[1])]
      : null;

  const format = (schema["ui:props"] as any)?.format || "YYYY-MM-DD HH:mm:ss";

  return (
    <DatePicker.RangePicker
      showTime
      value={rangeValue}
      onChange={(dates) => {
        if (dates && dates[0] && dates[1]) {
          onChange([
            dates[0].format(format),
            dates[1].format(format),
          ]);
        } else {
          onChange(null);
        }
      }}
      onBlur={onBlur}
      disabled={fieldState.disabled || disabled}
      readOnly={fieldState.readonly || readOnly}
      status={fieldState.errors?.length ? "error" : undefined}
      style={{ width: "100%" }}
      {...(schema["ui:props"] || {})}
    />
  );
};
