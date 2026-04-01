/**
 * Prompt 管理器
 *
 * 支持 Prompt 模板的存储、版本管理和参数化渲染。
 */

export interface PromptTemplate {
  name: string;
  version: string;
  template: string;
  description?: string;
  variables: string[];
  createdAt: number;
  updatedAt: number;
}

export class PromptManager {
  private templates = new Map<string, PromptTemplate>();
  private templateVersions = new Map<string, Map<string, PromptTemplate>>();

  /** 注册 Prompt 模板 */
  register(
    name: string,
    template: string,
    opts?: { description?: string; version?: string },
  ): PromptTemplate {
    const version = opts?.version ?? "1.0.0";
    const variables = extractVariables(template);
    const now = Date.now();

    const pt: PromptTemplate = {
      name,
      version,
      template,
      description: opts?.description,
      variables,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.set(name, pt);

    if (!this.templateVersions.has(name)) {
      this.templateVersions.set(name, new Map());
    }
    this.templateVersions.get(name)!.set(version, pt);

    return pt;
  }

  /** 渲染 Prompt（替换 {{variable}} 占位符） */
  render(name: string, variables: Record<string, string>): string {
    const pt = this.templates.get(name);
    if (!pt) throw new Error(`Prompt template not found: ${name}`);

    let result = pt.template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }

    // 检查未替换的变量
    const remaining = result.match(/\{\{(\w+)\}\}/g);
    if (remaining) {
      throw new Error(`Missing variables: ${remaining.join(", ")}`);
    }

    return result;
  }

  /** 获取模板 */
  get(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }

  /** 列出所有模板 */
  list(): PromptTemplate[] {
    return [...this.templates.values()];
  }

  /** 获取某模板的所有版本 */
  getVersions(name: string): string[] {
    const versions = this.templateVersions.get(name);
    return versions ? [...versions.keys()] : [];
  }

  /** 删除模板 */
  delete(name: string): boolean {
    this.templateVersions.delete(name);
    return this.templates.delete(name);
  }
}

function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  const vars = new Set<string>();
  for (const m of matches) {
    vars.add(m[1]);
  }
  return [...vars];
}
