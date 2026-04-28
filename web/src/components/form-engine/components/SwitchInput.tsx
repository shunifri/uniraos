import React from "react";
import { Switch } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const SwitchInput: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  fieldState,
  readOnly,
  disabled,
}) => {
  const uiProps = schema["ui:props"] || {};

  return (
    <Switch
      checked={!!value}
      onChange={(checked) => onChange(checked)}
      disabled={fieldState.disabled || disabled || readOnly}
      checkedChildren={uiProps.checkedChildren}
      unCheckedChildren={uiProps.unCheckedChildren}
    />
  );
};
