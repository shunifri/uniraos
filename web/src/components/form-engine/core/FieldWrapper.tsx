import React from "react";
import { Col, Form } from "antd";
import { getComponent, getComponentAsync, hasComponent } from "../registry/componentRegistry";
import type { RaosFieldSchema, FieldState } from "../types";

interface FieldWrapperProps {
  name: string;
  fieldSchema: RaosFieldSchema;
  fieldState: FieldState;
  value: any;
  errors: string[];
  formData: Record<string, any>;
  readOnly: boolean;
  onChange: (name: string, value: any) => void;
  onBlur: (name: string) => void;
  asyncComponents: Map<string, React.FC<any>>;
  loadingAsync: Set<string>;
  onLoadAsync: (name: string) => void;
}

const FieldWrapper: React.FC<FieldWrapperProps> = React.memo(
  ({ name, fieldSchema, fieldState, value, errors, formData, readOnly, onChange, onBlur, asyncComponents, loadingAsync, onLoadAsync }) => {
    const widgetName = fieldSchema["ui:widget"] || "input";

    let Component: React.FC<any> | undefined;
    try {
      Component = getComponent(widgetName);
    } catch {
      Component = asyncComponents.get(widgetName);
      if (!Component && hasComponent(widgetName) && !loadingAsync.has(widgetName)) {
        onLoadAsync(widgetName);
        return (
          <Col key={name} span={fieldSchema["ui:colSpan"] || 24}>
            <Form.Item label={fieldSchema.title}>
              <div style={{ color: "#999", padding: "8px 0" }}>Loading component...</div>
            </Form.Item>
          </Col>
        );
      }
    }

    if (!Component) {
      return (
        <Col key={name} span={fieldSchema["ui:colSpan"] || 24}>
          <Form.Item label={fieldSchema.title} validateStatus="error" help={`Component "${widgetName}" not found`}>
            <div style={{ color: "red" }}>Unknown component: {widgetName}</div>
          </Form.Item>
        </Col>
      );
    }

    return (
      <Col key={name} span={fieldSchema["ui:colSpan"] || 24}>
        <Form.Item
          htmlFor={name}
          label={fieldSchema.title}
          required={fieldState.required}
          validateStatus={errors.length > 0 ? "error" : undefined}
          help={errors[0] || fieldSchema["ui:help"]}
        >
          <Component
            schema={fieldSchema}
            name={name}
            value={value}
            onChange={(val: any) => onChange(name, val)}
            onBlur={() => onBlur(name)}
            formData={formData}
            fieldState={fieldState}
            readOnly={readOnly}
            disabled={fieldState.disabled || readOnly}
            id={name}
          />
        </Form.Item>
      </Col>
    );
  },
  (prev, next) => {
    return (
      prev.value === next.value &&
      prev.errors.length === next.errors.length &&
      prev.errors.every((e, i) => e === next.errors[i]) &&
      prev.fieldState.visible === next.fieldState.visible &&
      prev.fieldState.disabled === next.fieldState.disabled &&
      prev.fieldState.readonly === next.fieldState.readonly &&
      prev.fieldState.required === next.fieldState.required &&
      prev.fieldState.loading === next.fieldState.loading &&
      prev.readOnly === next.readOnly &&
      prev.asyncComponents === next.asyncComponents
    );
  }
);

FieldWrapper.displayName = "FieldWrapper";

export { FieldWrapper };
