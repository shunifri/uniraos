/**
 * PPTX 风格提取器
 *
 * 从 PPTX 文件的 theme XML 中提取配色方案和字体信息，
 * 用于保存为自定义主题，后续生成 PPT 时复用。
 */

export interface ExtractedPptxStyle {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    scheme: string[];
  };
  fonts: {
    heading: string;
    body: string;
  };
  sourceFile: string;
}

/** 从 srgbClr 或 sysClr 中提取颜色值 */
function extractColor(xml: string, tagName: string): string | null {
  // <a:dk1><a:srgbClr val="000000"/></a:dk1>
  const tagRegex = new RegExp(`<a:${tagName}[^>]*>([\\s\\S]*?)</a:${tagName}>`, "i");
  const tagMatch = xml.match(tagRegex);
  if (!tagMatch) return null;

  const inner = tagMatch[1];
  // srgbClr
  const srgb = inner.match(/<a:srgbClr\s+val="([A-Fa-f0-9]{6})"/i);
  if (srgb) return srgb[1].toUpperCase();

  // sysClr lastClr
  const sys = inner.match(/<a:sysClr[^>]+lastClr="([A-Fa-f0-9]{6})"/i);
  if (sys) return sys[1].toUpperCase();

  return null;
}

/** 从 theme XML 提取配色方案 */
function extractColorScheme(themeXml: string): ExtractedPptxStyle["colors"] | null {
  const schemeMatch = themeXml.match(/<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/i);
  if (!schemeMatch) return null;

  const schemeXml = schemeMatch[1];

  const colorNames = ["dk1", "dk2", "lt1", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  const scheme: string[] = [];
  const colorMap: Record<string, string> = {};

  for (const name of colorNames) {
    const color = extractColor(schemeXml, name);
    if (color) {
      scheme.push(color);
      colorMap[name] = color;
    }
  }

  if (scheme.length === 0) return null;

  return {
    primary: colorMap["dk1"] || colorMap["dk2"] || "333333",
    secondary: colorMap["accent1"] || colorMap["accent2"] || "4472C4",
    accent: colorMap["accent2"] || colorMap["accent1"] || "ED7D31",
    background: colorMap["lt1"] || "FFFFFF",
    text: colorMap["dk1"] || "000000",
    scheme,
  };
}

/** 从 theme XML 提取字体 */
function extractFonts(themeXml: string): ExtractedPptxStyle["fonts"] {
  const defaultFonts = { heading: "Microsoft YaHei", body: "Microsoft YaHei" };

  const majorMatch = themeXml.match(/<a:majorFont[\s\S]*?<a:latin\s+typeface="([^"]+)"/i);
  const minorMatch = themeXml.match(/<a:minorFont[\s\S]*?<a:latin\s+typeface="([^"]+)"/i);

  return {
    heading: majorMatch?.[1] || defaultFonts.heading,
    body: minorMatch?.[1] || defaultFonts.body,
  };
}

/** 从 slideMaster XML 中提取内联颜色（fallback） */
function extractColorsFromSlideMaster(masterXml: string): ExtractedPptxStyle["colors"] | null {
  // 尝试从 slideMaster 的 clrMap 或内联 srgbClr 提取
  const colors: string[] = [];
  const regex = /<a:srgbClr\s+val="([A-Fa-f0-9]{6})"/gi;
  let match;
  while ((match = regex.exec(masterXml)) !== null) {
    const c = match[1].toUpperCase();
    if (!colors.includes(c)) colors.push(c);
  }

  if (colors.length < 2) return null;

  return {
    primary: colors[0],
    secondary: colors[1],
    accent: colors[2] || colors[1],
    background: colors.find((c) => ["FFFFFF", "FAFAFA", "F5F5F5"].includes(c)) || "FFFFFF",
    text: colors[0],
    scheme: colors.slice(0, 12),
  };
}

/**
 * 从 PPTX Buffer 中提取风格信息
 */
export async function extractPptxStyle(buffer: Buffer, sourceFile: string, name?: string): Promise<ExtractedPptxStyle> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  let colors: ExtractedPptxStyle["colors"] | null = null;
  let fonts: ExtractedPptxStyle["fonts"] = { heading: "Microsoft YaHei", body: "Microsoft YaHei" };

  // 尝试从 theme1.xml 提取
  const themeFile = zip.files["ppt/theme/theme1.xml"];
  if (themeFile) {
    const themeXml = await themeFile.async("text");
    colors = extractColorScheme(themeXml);
    fonts = extractFonts(themeXml);
  }

  // fallback: 尝试 slideMaster1.xml
  if (!colors) {
    const masterFile = zip.files["ppt/slideMasters/slideMaster1.xml"];
    if (masterFile) {
      const masterXml = await masterFile.async("text");
      colors = extractColorsFromSlideMaster(masterXml);
    }
  }

  // 最终 fallback
  if (!colors) {
    colors = {
      primary: "333333",
      secondary: "4472C4",
      accent: "ED7D31",
      background: "FFFFFF",
      text: "333333",
      scheme: ["333333", "4472C4", "ED7D31", "FFFFFF"],
    };
  }

  const displayName = name || sourceFile.replace(/\.pptx$/i, "");

  return {
    name: displayName,
    colors,
    fonts,
    sourceFile,
  };
}
