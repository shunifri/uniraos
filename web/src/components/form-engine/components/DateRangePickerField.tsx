import React from "react";
import { DatePicker } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const DateRangePickerField: React.FC<FieldRendererProps> = ({
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

  return (
    <DatePicker.RangePicker
      value={rangeValue}
      onChange={(dates) => {
        if (dates && dates[0] && dates[1]) {
          onChange([
            dates[0].format("YYYY-MM-DD"),
            dates[1].format("YYYY-MM-DD"),
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
