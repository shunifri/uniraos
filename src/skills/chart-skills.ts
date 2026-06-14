/**
 * 数据可视化 Skill
 *
 * 根据结构化数据自动推荐并生成最适合的 ECharts 图表配置。
 * 智能体可以分析数据特征，自动选择图表类型，生成可直接渲染的 ECharts option。
 */
import { defineSystemSkill } from "../types/index.js";
import type { SkillRegistry } from "../registry/index.js";

// ===== 图表类型推荐引擎 =====

interface DataProfile {
  columns: Array<{
    name: string;
    type: "number" | "string" | "date" | "boolean";
    uniqueCount: number;
    sample: unknown[];
  }>;
  rowCount: number;
  numericColumns: string[];
  categoryColumns: string[];
  dateColumns: string[];
}

function profileData(rows: Record<string, unknown>[]): DataProfile {
  if (rows.length === 0) {
    return { columns: [], rowCount: 0, numericColumns: [], categoryColumns: [], dateColumns: [] };
  }

  const columnNames = Object.keys(rows[0]);
  const columns: DataProfile["columns"] = [];
  const numericColumns: string[] = [];
  const categoryColumns: string[] = [];
  const dateColumns: string[] = [];

  for (const name of columnNames) {
    const values = rows.map((r) => r[name]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== "");
    const uniqueCount = new Set(nonNull.map(String)).size;

    // 类型推断
    let type: "number" | "string" | "date" | "boolean" = "string";
    if (nonNull.length > 0) {
      const sample = nonNull.slice(0, 20);
      const allNumbers = sample.every((v) => typeof v === "number" || (typeof v === "string" && !isNaN(Number(v)) && v.trim() !== ""));
      const allDates = sample.every((v) => typeof v === "string" && !isNaN(Date.parse(v as string)) && (v as string).length >= 8);
      const allBooleans = sample.every((v) => typeof v === "boolean" || v === "true" || v === "false" || v === 0 || v === 1);

      if (allBooleans && uniqueCount <= 2) type = "boolean";
      else if (allNumbers) type = "number";
      else if (allDates) type = "date";
    }

    columns.push({
      name,
      type,
      uniqueCount,
      sample: nonNull.slice(0, 5),
    });

    if (type === "number") numericColumns.push(name);
    else if (type === "date") dateColumns.push(name);
    else categoryColumns.push(name);
  }

  return { columns, rowCount: rows.length, numericColumns, categoryColumns, dateColumns };
}

interface ChartRecommendation {
  chartType: string;
  reason: string;
  score: number;
}

function recommendChartType(profile: DataProfile): ChartRecommendation[] {
  const recommendations: ChartRecommendation[] = [];
  const { numericColumns, categoryColumns, dateColumns, rowCount } = profile;
  const numNumeric = numericColumns.length;
  const numCategory = categoryColumns.length;
  const numDate = dateColumns.length;

  // 时间序列 → 折线图
  if (numDate >= 1 && numNumeric >= 1) {
    recommendations.push({
      chartType: "line",
      reason: `有时间列(${dateColumns[0]})和数值列，适合展示趋势变化`,
      score: 95,
    });
  }

  // 分类 + 单数值 → 柱状图 / 饼图
  if (numCategory >= 1 && numNumeric >= 1) {
    const catCol = profile.columns.find((c) => categoryColumns.includes(c.name))!;

    if (catCol.uniqueCount <= 10) {
      recommendations.push({
        chartType: "pie",
        reason: `分类数量少(${catCol.uniqueCount}个)，适合展示占比`,
        score: 80,
      });
    }

    recommendations.push({
      chartType: "bar",
      reason: `分类列(${catCol.name}) + 数值列，适合对比`,
      score: catCol.uniqueCount > 10 ? 90 : 85,
    });
  }

  // 两个数值列 → 散点图
  if (numNumeric >= 2) {
    recommendations.push({
      chartType: "scatter",
      reason: `有多个数值列，适合展示相关性`,
      score: 70,
    });
  }

  // 多个数值列 → 雷达图
  if (numNumeric >= 3 && rowCount <= 10) {
    recommendations.push({
      chartType: "radar",
      reason: `多个指标维度(${numNumeric}个)，适合多维对比`,
      score: 75,
    });
  }

  // 大量数据 → 热力图
  if (numCategory >= 2 && numNumeric >= 1 && rowCount > 50) {
    recommendations.push({
      chartType: "heatmap",
      reason: `大量交叉数据，适合展示密度分布`,
      score: 65,
    });
  }

  // 层级数据 → 旭日图/树图
  if (numCategory >= 2 && numNumeric >= 1 && rowCount <= 100) {
    recommendations.push({
      chartType: "sunburst",
      reason: `多级分类数据，适合展示层级结构`,
      score: 60,
    });
  }

  // 默认保底
  if (recommendations.length === 0) {
    recommendations.push({
      chartType: "bar",
      reason: "通用的数据展示方式",
      score: 50,
    });
  }

  return recommendations.sort((a, b) => b.score - a.score);
}

// ===== ECharts 配置生成器 =====

function generateEChartsOption(
  rows: Record<string, unknown>[],
  profile: DataProfile,
  chartType: string,
  title?: string,
  customConfig?: Record<string, unknown>,
): Record<string, unknown> {
  const baseOption: Record<string, unknown> = {
    title: {
      text: title ?? "数据图表",
      left: "center",
    },
    tooltip: { trigger: chartType === "pie" ? "item" : "axis" },
    toolbox: {
      feature: {
        saveAsImage: {},
        dataView: { readOnly: false },
        magicType: { type: ["line", "bar"] },
      },
    },
  };

  switch (chartType) {
    case "bar":
    case "line":
      return generateAxisChart(rows, profile, chartType, baseOption);
    case "pie":
      return generatePieChart(rows, profile, baseOption);
    case "scatter":
      return generateScatterChart(rows, profile, baseOption);
    case "radar":
      return generateRadarChart(rows, profile, baseOption);
    case "heatmap":
      return generateHeatmapChart(rows, profile, baseOption);
    default:
      return generateAxisChart(rows, profile, "bar", baseOption);
  }
}

function generateAxisChart(
  rows: Record<string, unknown>[],
  profile: DataProfile,
  type: string,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const categoryCol = profile.dateColumns[0] ?? profile.categoryColumns[0] ?? profile.columns[0]?.name;
  const valueColumns = profile.numericColumns.slice(0, 5); // 最多 5 个系列

  if (!categoryCol || valueColumns.length === 0) {
    // 回退：用索引作为 x 轴
    const firstNumeric = profile.numericColumns[0] ?? profile.columns[0]?.name;
    return {
      ...base,
      xAxis: { type: "category", data: rows.map((_, i) => `${i + 1}`) },
      yAxis: { type: "value" },
      series: [{ type, data: rows.map((r) => Number(r[firstNumeric]) || 0), smooth: type === "line" }],
    };
  }

  const xData = rows.map((r) => String(r[categoryCol] ?? ""));
  const series = valueColumns.map((col) => ({
    name: col,
    type,
    data: rows.map((r) => Number(r[col]) || 0),
    smooth: type === "line",
  }));

  return {
    ...base,
    legend: valueColumns.length > 1 ? { data: valueColumns, bottom: 0 } : undefined,
    xAxis: {
      type: "category",
      data: xData,
      axisLabel: { rotate: xData.length > 10 ? 45 : 0 },
    },
    yAxis: { type: "value" },
    series,
  };
}

function generatePieChart(
  rows: Record<string, unknown>[],
  profile: DataProfile,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const categoryCol = profile.categoryColumns[0] ?? profile.columns[0]?.name;
  const valueCol = profile.numericColumns[0];

  if (!categoryCol) {
    return { ...base, series: [{ type: "pie", data: [] }] };
  }

  let data: Array<{ name: string; value: number }>;
  if (valueCol) {
    data = rows.map((r) => ({
      name: String(r[categoryCol] ?? ""),
      value: Number(r[valueCol]) || 0,
    }));
  } else {
    // 没有数值列时按分类计数
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = String(r[categoryCol] ?? "");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    data = [...counts.entries()].map(([name, value]) => ({ name, value }));
  }

  return {
    ...base,
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    series: [{
      type: "pie",
      radius: ["40%", "70%"],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 10, borderColor: "#fff", borderWidth: 2 },
      label: { show: true, formatter: "{b}: {d}%" },
      data: data.slice(0, 20), // 最多 20 个扇区
    }],
  };
}

function generateScatterChart(
  rows: Record<string, unknown>[],
  profile: DataProfile,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const xCol = profile.numericColumns[0];
  const yCol = profile.numericColumns[1];
  const sizeCol = profile.numericColumns[2];

  if (!xCol || !yCol) {
    return { ...base, series: [{ type: "scatter", data: [] }] };
  }

  const data = rows.map((r) => {
    const point: number[] = [Number(r[xCol]) || 0, Number(r[yCol]) || 0];
    if (sizeCol) point.push(Number(r[sizeCol]) || 0);
    return point;
  });

  return {
    ...base,
    xAxis: { type: "value", name: xCol },
    yAxis: { type: "value", name: yCol },
    series: [{
      type: "scatter",
      symbolSize: sizeCol ? (val: number[]) => Math.min(Math.max(val[2] / 10, 5), 50) : 10,
      data,
    }],
  };
}

function generateRadarChart(
  rows: Record<string, unknown>[],
  profile: DataProfile,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const indicators = profile.numericColumns.slice(0, 8).map((col) => {
    const values = rows.map((r) => Number(r[col]) || 0);
    return { name: col, max: Math.max(...values) * 1.2 || 100 };
  });

  const categoryCol = profile.categoryColumns[0];
  const series = rows.slice(0, 5).map((r) => ({
    name: categoryCol ? String(r[categoryCol]) : `数据`,
    value: profile.numericColumns.slice(0, 8).map((col) => Number(r[col]) || 0),
  }));

  return {
    ...base,
    legend: { data: series.map((s) => s.name), bottom: 0 },
    radar: { indicator: indicators },
    series: [{
      type: "radar",
      data: series,
    }],
  };
}

function generateHeatmapChart(
  rows: Record<string, unknown>[],
  profile: DataProfile,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const xCol = profile.categoryColumns[0];
  const yCol = profile.categoryColumns[1] ?? profile.dateColumns[0];
  const valueCol = profile.numericColumns[0];

  if (!xCol || !yCol || !valueCol) {
    return { ...base, series: [{ type: "heatmap", data: [] }] };
  }

  const xCategories = [...new Set(rows.map((r) => String(r[xCol])))];
  const yCategories = [...new Set(rows.map((r) => String(r[yCol])))];

  const data = rows.map((r) => [
    xCategories.indexOf(String(r[xCol])),
    yCategories.indexOf(String(r[yCol])),
    Number(r[valueCol]) || 0,
  ]);

  const values = data.map((d) => d[2]);

  return {
    ...base,
    grid: { top: 50, bottom: 60, left: 80 },
    xAxis: { type: "category", data: xCategories, splitArea: { show: true } },
    yAxis: { type: "category", data: yCategories, splitArea: { show: true } },
    visualMap: {
      min: Math.min(...values),
      max: Math.max(...values),
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
    },
    series: [{
      type: "heatmap",
      data,
      label: { show: data.length < 100 },
    }],
  };
}

// ===== 注册图表 Skills =====

export function createChartSkills(registry: SkillRegistry): void {
  registry.register(
    defineSystemSkill({
      name: "chart_recommend",
      description:
        "分析结构化数据，推荐最适合的图表类型。参数: data(array of objects, 数据行), maxRecommendations?(number, 最多返回几个推荐, 默认 3)",
      handler: async (params) => {
        const data = params.data as Record<string, unknown>[];
        if (!data || !Array.isArray(data) || data.length === 0) {
          return { success: false, error: new Error("data 参数必填且不能为空数组") };
        }

        const profile = profileData(data);
        const recommendations = recommendChartType(profile);
        const max = (params.maxRecommendations as number) ?? 3;

        return {
          success: true,
          data: {
            profile: {
              rowCount: profile.rowCount,
              columns: profile.columns.map((c) => ({ name: c.name, type: c.type, uniqueCount: c.uniqueCount })),
              numericColumns: profile.numericColumns,
              categoryColumns: profile.categoryColumns,
              dateColumns: profile.dateColumns,
            },
            recommendations: recommendations.slice(0, max),
          },
        };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "chart_generate",
      description:
        "根据数据生成 ECharts 图表配置。参数: data(array of objects), chartType?(string, 不指定则自动推荐), title?(string, 图表标题), config?(object, 自定义配置覆盖)",
      handler: async (params) => {
        const data = params.data as Record<string, unknown>[];
        if (!data || !Array.isArray(data) || data.length === 0) {
          return { success: false, error: new Error("data 参数必填且不能为空数组") };
        }

        const profile = profileData(data);
        let chartType = params.chartType as string;

        if (!chartType) {
          const recommendations = recommendChartType(profile);
          chartType = recommendations[0].chartType;
        }

        const title = params.title as string | undefined;
        const customConfig = params.config as Record<string, unknown> | undefined;

        const option = generateEChartsOption(data, profile, chartType, title, customConfig);

        // 合并自定义配置
        if (customConfig) {
          Object.assign(option, customConfig);
        }

        return {
          success: true,
          data: {
            chartType,
            option,
            dataProfile: {
              rowCount: profile.rowCount,
              numericColumns: profile.numericColumns,
              categoryColumns: profile.categoryColumns,
            },
          },
        };
      },
    }),
  );

  registry.register(
    defineSystemSkill({
      name: "chart_multi",
      description:
        "为同一组数据生成多种图表配置（仪表板视图）。参数: data(array of objects), title?(string), maxCharts?(number, 默认 3)",
      handler: async (params) => {
        const data = params.data as Record<string, unknown>[];
        if (!data || !Array.isArray(data) || data.length === 0) {
          return { success: false, error: new Error("data 参数必填且不能为空数组") };
        }

        const profile = profileData(data);
        const recommendations = recommendChartType(profile);
        const maxCharts = (params.maxCharts as number) ?? 3;
        const title = params.title as string;

        const charts = recommendations.slice(0, maxCharts).map((rec) => ({
          chartType: rec.chartType,
          reason: rec.reason,
          option: generateEChartsOption(data, profile, rec.chartType, title ? `${title} (${rec.chartType})` : undefined),
        }));

        return {
          success: true,
          data: { charts, total: charts.length },
        };
      },
    }),
  );

  console.log("   Chart skills registered (chart_recommend/chart_generate/chart_multi)");
}
