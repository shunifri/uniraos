import React from "react";
import { Upload, Button, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const FileUploader: React.FC<FieldRendererProps> = ({
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
  const maxSize = uiProps.maxSize || 10 * 1024 * 1024;
  const accept = uiProps.accept || "*";
  const maxCount = uiProps.maxCount || 1;

  const fileList = React.useMemo(() => {
    if (!value) return [];
    const urls = Array.isArray(value) ? value : [value];
    return urls.map((url: string, index: number) => ({
      uid: `-${index}`,
      name: url.split("/").pop() || `file-${index}`,
      status: "done" as const,
      url,
    }));
  }, [value]);

  const handleChange = (info: any) => {
    if (info.file.status === "done") {
      const url =
        info.file.response?.url || info.file.response?.data?.url;
      if (url) {
        if (maxCount === 1) {
          onChange(url);
        } else {
          const current = Array.isArray(value)
            ? value
            : value
            ? [value]
            : [];
          onChange([...current, url]);
        }
        message.success(`${info.file.name} 上传成功`);
      }
    } else if (info.file.status === "error") {
      message.error(`${info.file.name} 上传失败`);
    }
  };

  const beforeUpload = (file: File) => {
    if (file.size > maxSize) {
      message.error(
        `文件大小不能超过 ${(maxSize / 1024 / 1024).toFixed(0)}MB`
      );
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  return (
    <Upload
      id={name}
      name="file"
      action="/api/upload"
      fileList={fileList}
      onChange={handleChange}
      beforeUpload={beforeUpload}
      accept={accept}
      maxCount={maxCount}
      disabled={fieldState.disabled}
      multiple={maxCount > 1}
      {...uiProps}
      {...rest}
    >
      <Button icon={<UploadOutlined />} disabled={fieldState.disabled}>
        {uiProps.uploadText || "点击上传"}
      </Button>
    </Upload>
  );
};
