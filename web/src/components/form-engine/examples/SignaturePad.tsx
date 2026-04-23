import React from "react";
import { Button } from "antd";
import { ClearOutlined } from "@ant-design/icons";
import type { FieldRendererProps } from "../registry/componentRegistry";

const SignaturePad: React.FC<FieldRendererProps> = ({ value, onChange, readOnly, disabled }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const isDrawing = React.useRef(false);

  React.useEffect(() => {
    if (value && canvasRef.current) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef.current!.getContext("2d");
        if (ctx) ctx.drawImage(img, 0, 0);
      };
      img.src = value;
    }
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (readOnly || disabled) return;
    isDrawing.current = true;
    const { x, y } = getPos(e);
    const ctx = canvasRef.current!.getContext("2d");
    if (ctx) { ctx.beginPath(); ctx.moveTo(x, y); }
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || readOnly || disabled) return;
    const { x, y } = getPos(e);
    const ctx = canvasRef.current!.getContext("2d");
    if (ctx) { ctx.lineTo(x, y); ctx.stroke(); }
  };

  const endDraw = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    if (canvasRef.current) onChange(canvasRef.current.toDataURL());
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(undefined);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={400}
        height={150}
        style={{
          border: "1px solid #d9d9d9",
          borderRadius: 4,
          cursor: readOnly || disabled ? "not-allowed" : "crosshair",
          background: readOnly || disabled ? "#f5f5f5" : "#fff",
        }}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={endDraw}
        onMouseLeave={endDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={endDraw}
      />
      {!readOnly && !disabled && (
        <Button icon={<ClearOutlined />} size="small" onClick={clear} style={{ marginTop: 8 }}>
          Clear
        </Button>
      )}
    </div>
  );
};

export default SignaturePad;

export const meta = {
  name: "signaturePad",
  displayName: "Signature Pad",
  description: "Hand-drawn signature capture canvas",
  category: "custom",
};
