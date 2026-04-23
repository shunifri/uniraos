import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("Business Components", () => {
  it("should render UserPicker", async () => {
    const { UserPicker } = await import(
      "../../web/src/components/form-engine/components/UserPicker"
    );
    render(
      <UserPicker
        schema={{ type: "string", title: "User", "ui:widget": "userPicker" }}
        name="user"
        value={undefined}
        onChange={() => {}}
        onBlur={() => {}}
        formData={{}}
        fieldState={{ visible: true, disabled: false, readonly: false, required: false }}
      />
    );
    expect(screen.getByText("请选择用户")).toBeInTheDocument();
  });

  it("should render DeptPicker", async () => {
    const { DeptPicker } = await import(
      "../../web/src/components/form-engine/components/DeptPicker"
    );
    render(
      <DeptPicker
        schema={{
          type: "string",
          title: "Dept",
          "ui:widget": "deptPicker",
          "x-dataSource": {
            type: "static",
            options: [
              {
                label: "研发部",
                value: "rd",
                children: [{ label: "前端组", value: "fe" }],
              },
            ],
          },
        }}
        name="dept"
        value={undefined}
        onChange={() => {}}
        onBlur={() => {}}
        formData={{}}
        fieldState={{ visible: true, disabled: false, readonly: false, required: false }}
      />
    );
    expect(screen.getByText("请选择部门")).toBeInTheDocument();
  });

  it("should render FileUploader", async () => {
    const { FileUploader } = await import(
      "../../web/src/components/form-engine/components/FileUploader"
    );
    render(
      <FileUploader
        schema={{ type: "string", title: "File", "ui:widget": "fileUploader" }}
        name="file"
        value={undefined}
        onChange={() => {}}
        onBlur={() => {}}
        formData={{}}
        fieldState={{ visible: true, disabled: false, readonly: false, required: false }}
      />
    );
    expect(screen.getByText("点击上传")).toBeInTheDocument();
  });
});
