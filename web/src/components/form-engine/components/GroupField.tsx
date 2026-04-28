import React from "react";
import { Card, theme } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry";
import FormRenderer from "../core/FormRenderer";

const GroupField: React.FC<FieldRendererProps> = ({ schema, value, onChange, readOnly, disabled }) => {
  const { token } = theme.useToken();
  const groupValue = typeof value === "object" && value !== null ? value : {};
  const properties = schema.properties || {};

  return (
    <Card
      size="small"
      title={schema.title}
      style={{ marginBottom: 8, background: token.colorFillTertiary }}
      styles={{ body: { padding: 16 } }}
    >
      <FormRenderer
        schema={{ type: "object", properties }}
        initialData={groupValue}
        onChange={onChange}
        readOnly={readOnly}
      />
    </Card>
  );
};

export { GroupField };
