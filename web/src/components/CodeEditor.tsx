import { Input } from "antd";

interface Props {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}

export default function CodeEditor({ value, onChange, rows = 4, placeholder }: Props) {
  return (
    <Input.TextArea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder || '{"key": "value"}'}
      style={{ fontFamily: "monospace", fontSize: 12 }}
    />
  );
}
