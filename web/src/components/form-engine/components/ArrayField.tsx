import React from "react";
import { Button, Space, Card } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import type { FieldRendererProps } from "../registry/componentRegistry";
import FormRenderer from "../core/FormRenderer";

const ArrayField: React.FC<FieldRendererProps> = ({ schema, value, onChange, readOnly, disabled }) => {
  const items = Array.isArray(value) ? value : [];
  const itemSchema = schema.items || { type: "string", title: "Item" };

  const handleAdd = () => {
    const newItem = itemSchema.type === "object" ? {} : "";
    onChange([...items, newItem]);
  };

  const handleRemove = (index: number) => {
    const next = items.filter((_: any, i: number) => i !== index);
    onChange(next);
  };

  const handleItemChange = (index: number, itemValue: any) => {
    const next = [...items];
    next[index] = itemValue;
    onChange(next);
  };

  return (
    <div>
      {items.map((item: any, index: number) => (
        <Card
          key={index}
          size="small"
          style={{ marginBottom: 8 }}
          extra={
            !readOnly && !disabled ? (
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => handleRemove(index)}
              />
            ) : null
          }
        >
          {itemSchema.type === "object" ? (
            <FormRenderer
              schema={{ type: "object", properties: itemSchema.properties || {} }}
              initialData={item}
              onChange={(data) => handleItemChange(index, data)}
            />
          ) : (
            <Space>
              <span>#{index + 1}</span>
              <input
                type="text"
                value={item || ""}
                onChange={(e) => handleItemChange(index, e.target.value)}
                disabled={readOnly || disabled}
                style={{ border: "1px solid #d9d9d9", borderRadius: 4, padding: "4px 8px" }}
              />
            </Space>
          )}
        </Card>
      ))}
      {!readOnly && !disabled && (
        <Button type="dashed" block icon={<PlusOutlined />} onClick={handleAdd}>
          Add Item
        </Button>
      )}
    </div>
  );
};

export { ArrayField };
