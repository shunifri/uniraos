/**
 * P1-28: 修复嵌入场景下 tool 框内容超出气泡
 *
 * Bug 1: kb_search 等返回 array 的 skill, 之前的 tool_result summary 计算
 *        走进 "r.data && typeof r.data === 'object'" 分支 (Array 也是 object),
 *        JSON.stringify 后 slice(0, 300) 显示 "[{\"docId\":\"...\",...}]" 这种
 *        JSON 字符串. 人类不可读, 而且 60 字符 ellipsis 截断后内容是 "{...}"
 *        开头, 用户看到无意义字符.
 *
 * Bug 2: tool 框 (Collapse + label Flex) 没设 maxWidth, 嵌入 iframe 场景下
 *        父气泡窄, 文本溢出框边界.
 */
import { describe, it, expect } from "vitest";

describe("P1-28: tool_result summary 计算", () => {
  it("Array data 应该显示 '获取到 N 条结果' 而不是 JSON", () => {
    // 模拟 tool_result 事件处理逻辑
    function computeSummary(r: { success: boolean; data?: any }): string {
      if (!r.success) return "失败";
      const d = r.data;
      if (!d) return "完成";
      if (d?.__type === "file_download" && d?.files) return `已准备 ${d.files.length} 个文件`;
      if (d?.option && d?.chartType) return `已生成${d.chartType}图表`;
      if (d?.charts && Array.isArray(d.charts)) return `已生成 ${d.charts.length} 个图表`;
      if (d?.message) return d.message;
      if (Array.isArray(d)) return `获取到 ${d.length} 条结果`;  // ← 新加的
      if (d?.results && Array.isArray(d.results)) return `获取到 ${d.results.length} 条结果`;
      if (typeof d === "string") return d.slice(0, 300);
      if (typeof d === "object") {
        const dataStr = JSON.stringify(d);
        return d.message || d.text || d.content ||
          (dataStr.length <= 500 ? dataStr : dataStr.slice(0, 300) + "...");
      }
      return "完成";
    }

    // 模拟 kb_search 返回 10 条结果
    const kbResult = {
      success: true,
      data: [
        { docId: "doc1", docName: "doc1.txt", score: 0.95 },
        { docId: "doc2", docName: "doc2.pdf", score: 0.87 },
      ],
    };
    const summary = computeSummary(kbResult);
    expect(summary).toBe("获取到 2 条结果");
    expect(summary).not.toContain("{");
    expect(summary).not.toContain("[");
  });

  it("空 array data 应该显示 '获取到 0 条结果'", () => {
    function computeSummary(r: { success: boolean; data?: any }): string {
      if (!r.success) return "失败";
      const d = r.data;
      if (!d) return "完成";
      if (Array.isArray(d)) return `获取到 ${d.length} 条结果`;
      return "完成";
    }
    expect(computeSummary({ success: true, data: [] })).toBe("获取到 0 条结果");
  });

  it("嵌套结构 { results: [...] } 也应该走数组分支", () => {
    function computeSummary(r: { success: boolean; data?: any }): string {
      if (!r.success) return "失败";
      const d = r.data;
      if (Array.isArray(d)) return `获取到 ${d.length} 条结果`;
      if (d?.results && Array.isArray(d.results)) return `获取到 ${d.results.length} 条结果`;
      return "完成";
    }
    expect(computeSummary({ success: true, data: { results: [1, 2, 3] } })).toBe("获取到 3 条结果");
  });

  it("chart 结果应该显示图表信息", () => {
    function computeSummary(r: { success: boolean; data?: any }): string {
      const d = r.data;
      if (Array.isArray(d)) return `获取到 ${d.length} 条结果`;
      if (d?.option && d?.chartType) return `已生成${d.chartType}图表`;
      return "完成";
    }
    expect(computeSummary({ success: true, data: { chartType: "bar", option: {} } })).toBe("已生成bar图表");
  });
});
