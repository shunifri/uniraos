import React, { useState, useEffect } from "react";
import { TreeSelect } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";
import { formT } from "../i18n/form-i18n";

export const DeptPicker: React.FC<FieldRendererProps> = ({
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
  const [treeData, setTreeData] = useState<any[]>([]);

  useEffect(() => {
    const staticOptions = schema["x-dataSource"]?.options;
    if (staticOptions) {
      const convertToTree = (options: any[]): any[] => {
        return options.map((opt) => ({
          title: opt.label,
          value: opt.value,
          children: opt.children ? convertToTree(opt.children) : undefined,
        }));
      };
      setTreeData(convertToTree(staticOptions));
    } else {
      setTreeData([]);
    }
  }, [schema["x-dataSource"]]);

  return (
    <TreeSelect
      id={name}
      value={value}
      onChange={(val) => onChange(val)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"] || formT("placeholder.dept")}
      disabled={fieldState.disabled || disabled || readOnly}
      treeData={treeData}
      loading={fieldState.loading}
      showSearch
      allowClear
      treeDefaultExpandAll={uiProps.treeDefaultExpandAll !== false}
      status={fieldState.errors?.length ? "error" : undefined}
      style={{ width: "100%" }}
      {...uiProps}
      {...rest}
    />
  );
};
