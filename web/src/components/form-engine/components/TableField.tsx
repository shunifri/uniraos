import React, { useState } from "react";
import { Table, Button, Input, InputNumber, Select, Switch, Space } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import type { FieldRendererProps } from "../registry/componentRegistry";
import { formT } from "../i18n/form-i18n";

const TableField: React.FC<FieldRendererProps> = ({ schema, value, onChange, readOnly, disabled }) => {
  const rows = Array.isArray(value) ? value : [];
  const itemSchema = schema.items;
  const columnsSchema = itemSchema?.properties || {};
  const [editingKey, setEditingKey] = useState<number | null>(null);

  const handleAdd = () => {
    const newRow: Record<string, any> = {};
    Object.keys(columnsSchema).forEach((k) => {
      newRow[k] = columnsSchema[k].default ?? "";
    });
    onChange([...rows, newRow]);
    setEditingKey(rows.length);
  };

  const handleDelete = (index: number) => {
    onChange(rows.filter((_: any, i: number) => i !== index));
  };

  const handleCellChange = (rowIndex: number, field: string, fieldValue: any) => {
    const next = rows.map((row: any, i: number) =>
      i === rowIndex ? { ...row, [field]: fieldValue } : row
    );
    onChange(next);
  };

  const renderCellEditor = (colSchema: any, rowIndex: number, key: string, cellValue: any) => {
    if (colSchema.enum) {
      return (
        <Select
          value={cellValue}
          options={colSchema.enum.map((v: string) => ({ label: v, value: v }))}
          onChange={(v) => handleCellChange(rowIndex, key, v)}
          style={{ width: "100%" }}
          size="small"
        />
      );
    }

    if (colSchema.type === "boolean") {
      return (
        <Switch
          checked={!!cellValue}
          onChange={(v) => handleCellChange(rowIndex, key, v)}
          size="small"
        />
      );
    }

    if (colSchema.type === "number" || colSchema.type === "integer") {
      return (
        <InputNumber
          value={cellValue}
          onChange={(v) => handleCellChange(rowIndex, key, v)}
          style={{ width: "100%" }}
          size="small"
        />
      );
    }

    return (
      <Input
        value={cellValue}
        onChange={(e) => handleCellChange(rowIndex, key, e.target.value)}
        size="small"
      />
    );
  };

  const columns = [
    ...Object.entries(columnsSchema).map(([key, colSchema]: [string, any]) => ({
      title: colSchema.title || key,
      dataIndex: key,
      key,
      render: (_: any, record: any, rowIndex: number) => {
        const isEditing = editingKey === rowIndex && !readOnly && !disabled;
        const cellValue = record[key];
        return isEditing ? renderCellEditor(colSchema, rowIndex, key, cellValue) : (cellValue ?? "-");
      },
    })),
    {
      title: "Action",
      key: "action",
      width: 80,
      render: (_: any, __: any, rowIndex: number) => (
        <Space>
          {!readOnly && !disabled && (
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(rowIndex)}
            />
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Table
        dataSource={rows.map((row: any, i: number) => ({ ...row, key: i }))}
        columns={columns as any}
        pagination={false}
        size="small"
        onRow={(_, rowIndex) => ({
          onClick: () => !readOnly && !disabled && setEditingKey(rowIndex ?? null),
        })}
      />
      {!readOnly && !disabled && (
        <Button type="dashed" block icon={<PlusOutlined />} onClick={handleAdd} style={{ marginTop: 8 }}>
          {formT("table.addRow")}
        </Button>
      )}
    </div>
  );
};

export { TableField };
