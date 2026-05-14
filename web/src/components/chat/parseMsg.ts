import type { ChatMsg } from "./types";

export function parseMsg(m: any): ChatMsg {
  if (m.role === "assistant" && m.extra) {
    // debug: console.log("[parseMsg] assistant extra:", JSON.stringify(m.extra).slice(0, 200));
  }
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    skillName: m.skill_name || undefined,
    status: m.status || undefined,
    isError: !!m.is_error,
    chartOptions: m.extra?.chartOptions || undefined,
    fileDownload: m.extra?.fileDownload || undefined,
    kbReferences: m.extra?.kbReferences || undefined,
    webReferences: m.extra?.webReferences || undefined,
    resultData: (m.extra && typeof m.extra === 'object' && !m.extra.chartOptions && !m.extra.fileDownload) ? m.extra as Record<string, unknown> : undefined,
  };
}
