/**
 * 运行时配置管理（带文件持久化）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { LLMProviderConfig } from "../llm/types.js";
import type { OpenAIMultimodalConfig } from "../llm/openai-multimodal-provider.js";
import type { EngineConfig } from "../engine/index.js";

export interface MultimodalConfig {
  enabled: boolean;
  /** 默认复用 LLM 的 apiKey，也可单独配置 */
  apiKey?: string;
  /** 默认复用 LLM 的 baseUrl */
  baseUrl?: string;
  imageModel?: string;
  visionModel?: string;
  ttsModel?: string;
  whisperModel?: string;
}

export interface FederationConfig {
  /** 本实例 ID */
  instanceId: string;
  /** 联邦认证密钥 */
  federationKey: string;
  /** 对等实例列表 [{endpoint, name}] */
  peers: Array<{ endpoint: string; name?: string }>;
  /** 心跳间隔（ms） */
  heartbeatIntervalMs: number;
  /** 指标同步间隔（ms） */
  syncIntervalMs: number;
}

export interface EvolutionConfig {
  /** 是否自动执行进化动作 */
  autoExecute: boolean;
  /** 进化循环间隔（ms） */
  cycleIntervalMs: number;
  /** 每轮最多执行动作数 */
  maxActionsPerCycle: number;
  /** 是否跳过需要审批的动作 */
  skipApprovalRequired: boolean;
  /** 成功率低于此值视为瓶颈 */
  successRateThreshold: number;
  /** P95延迟高于此值视为瓶颈（ms） */
  latencyThresholdMs: number;
  /** 不活跃天数超过此值视为可淘汰 */
  inactiveDays: number;
  /** 联邦推荐最低置信度 */
  minFederationConfidence: number;
}

export interface ModelCardConfig {
  type?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** embedding 专用：API 模式（openai 标准 / volcengine-multimodal 火山多模态） */
  embeddingMode?: "openai" | "volcengine-multimodal";
}

export type ModelCardType = 'llm' | 'vision' | 'imageGen' | 'tts' | 'stt' | 'embedding';

export interface MemoryConfig {
  backend: 'file' | 'enhanced';
}

/** Document Mind 配置 */
export interface DocMindConfig {
  enabled?: boolean;
  accessKeyId?: string;
  accessKeySecret?: string;
  endpoint?: string;
  regionId?: string;
  /** 最大轮询时间（分钟） */
  maxPollingMinutes?: number;
  /** 轮询间隔（秒） */
  pollingIntervalSeconds?: number;
  /** 音视频解析模式: base(基本) / advance(剧情解析) */
  multimediaMode?: 'base' | 'advance';
}

export interface RAOSConfig {
  llm: LLMProviderConfig | null;
  multimodal: MultimodalConfig;
  engine: EngineConfig;
  agent: {
    maxIterations: number;
    systemPrompt: string;
    includeTrace: boolean;
  };
  federation: FederationConfig;
  evolution: EvolutionConfig;
  memory: MemoryConfig;
  modelCards?: Partial<Record<ModelCardType, ModelCardConfig>>;
  docMind?: DocMindConfig;
}

const DEFAULT_CONFIG: RAOSConfig = {
  llm: null,
  multimodal: {
    enabled: false,
  },
  engine: {
    maxDepth: 50,
    callBudget: 200,
  },
  agent: {
    maxIterations: 10,
    systemPrompt: "",
    includeTrace: false,
  },
  federation: {
    instanceId: "",
    federationKey: "",
    peers: [],
    heartbeatIntervalMs: 60000,
    syncIntervalMs: 300000,
  },
  evolution: {
    autoExecute: false,
    cycleIntervalMs: 3600000,
    maxActionsPerCycle: 5,
    skipApprovalRequired: true,
    successRateThreshold: 0.8,
    latencyThresholdMs: 5000,
    inactiveDays: 30,
    minFederationConfidence: 0.7,
  },
  memory: {
    backend: 'file',
  },
  modelCards: {},
  docMind: {
    enabled: false,
    accessKeyId: '',
    accessKeySecret: '',
    endpoint: 'docmind-api.cn-hangzhou.aliyuncs.com',
    regionId: 'cn-hangzhou',
    maxPollingMinutes: 30,
    pollingIntervalSeconds: 3,
    multimediaMode: 'advance',
  },
};

export class ConfigManager {
  private config: RAOSConfig;
  private configPath: string;

  constructor(configDir?: string) {
    const dir = configDir ?? join(process.cwd(), ".raos");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.configPath = join(dir, "config.json");
    this.config = this.load();
  }

  /** 从文件加载配置，不存在则用默认值 */
  private load(): RAOSConfig {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, "utf-8");
        const saved = JSON.parse(raw) as Partial<RAOSConfig>;
        return {
          llm: saved.llm ?? DEFAULT_CONFIG.llm,
          multimodal: { ...DEFAULT_CONFIG.multimodal, ...saved.multimodal },
          engine: { ...DEFAULT_CONFIG.engine, ...saved.engine },
          agent: { ...DEFAULT_CONFIG.agent, ...saved.agent },
          federation: { ...DEFAULT_CONFIG.federation, ...(saved as any).federation },
          evolution: { ...DEFAULT_CONFIG.evolution, ...(saved as any).evolution },
          memory: { ...DEFAULT_CONFIG.memory, ...(saved as any).memory },
          modelCards: (saved as any).modelCards ?? {},
          docMind: { ...DEFAULT_CONFIG.docMind, ...(saved as any).docMind },
        };
      }
    } catch {
      // 文件损坏则用默认值
    }
    return { ...DEFAULT_CONFIG };
  }

  /** 持久化到文件 */
  private save(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save config:", err);
    }
  }

  get(): RAOSConfig {
    return { ...this.config };
  }

  getLLM(): LLMProviderConfig | null {
    return this.config.llm;
  }

  setLLM(config: LLMProviderConfig): void {
    this.config.llm = { ...config };
    this.save();
  }

  setEngine(config: Partial<EngineConfig>): void {
    this.config.engine = { ...this.config.engine, ...config };
    this.save();
  }

  setAgent(config: Partial<RAOSConfig["agent"]>): void {
    this.config.agent = { ...this.config.agent, ...config };
    this.save();
  }

  /** 检查 LLM 是否已配置 */
  isLLMConfigured(): boolean {
    return this.config.llm !== null && this.config.llm.apiKey.length > 0;
  }

  getMultimodal(): MultimodalConfig {
    return { ...this.config.multimodal };
  }

  setMultimodal(config: Partial<MultimodalConfig>): void {
    this.config.multimodal = { ...this.config.multimodal, ...config };
    this.save();
  }

  /** 检查多模态是否可用（需要 enabled + apiKey） */
  isMultimodalConfigured(): boolean {
    if (!this.config.multimodal.enabled) return false;
    // 有自己的 key 或者 LLM 已配置（复用 key）
    return !!(this.config.multimodal.apiKey || this.isLLMConfigured());
  }

  // ===== 联邦配置 =====

  getFederation(): FederationConfig {
    return { ...this.config.federation, peers: [...this.config.federation.peers] };
  }

  setFederation(config: Partial<FederationConfig>): void {
    this.config.federation = { ...this.config.federation, ...config };
    if (config.peers) {
      this.config.federation.peers = [...config.peers];
    }
    this.save();
  }

  addFederationPeer(peer: { endpoint: string; name?: string }): void {
    const exists = this.config.federation.peers.some((p) => p.endpoint === peer.endpoint);
    if (!exists) {
      this.config.federation.peers.push(peer);
      this.save();
    }
  }

  removeFederationPeer(endpoint: string): void {
    this.config.federation.peers = this.config.federation.peers.filter((p) => p.endpoint !== endpoint);
    this.save();
  }

  // ===== 进化配置 =====

  getEvolution(): EvolutionConfig {
    return { ...this.config.evolution };
  }

  setEvolution(config: Partial<EvolutionConfig>): void {
    this.config.evolution = { ...this.config.evolution, ...config };
    this.save();
  }

  // ===== 模型卡片配置 =====

  getModelCards(): Partial<Record<ModelCardType, ModelCardConfig>> {
    return { ...(this.config.modelCards ?? {}) };
  }

  setModelCard(type: ModelCardType, config: ModelCardConfig): void {
    if (!this.config.modelCards) this.config.modelCards = {};
    this.config.modelCards[type] = { ...config };

    // 向后兼容：同步更新 legacy multimodal 字段
    if (type === "vision" && config.model) {
      this.config.multimodal.visionModel = config.model;
    } else if (type === "imageGen" && config.model) {
      this.config.multimodal.imageModel = config.model;
    } else if (type === "tts" && config.model) {
      this.config.multimodal.ttsModel = config.model;
    } else if (type === "stt" && config.model) {
      this.config.multimodal.whisperModel = config.model;
    }

    this.save();
  }

  /** 获取某类型模型的最终配置（非 LLM 卡片自动回退到 LLM 的 apiKey/baseUrl） */
  getResolvedModelConfig(type: ModelCardType): ModelCardConfig {
    const card = this.config.modelCards?.[type] ?? {};
    if (type === "llm") return { ...card };

    const llm = this.config.llm;
    return {
      ...card,
      apiKey: card.apiKey || llm?.apiKey || "",
      baseUrl: card.baseUrl || llm?.baseUrl || "",
    };
  }

  /** 获取多模态实际使用的 OpenAI 配置（合并 LLM 的 key/baseUrl） */
  getMultimodalResolved(): OpenAIMultimodalConfig | null {
    if (!this.isMultimodalConfigured()) return null;
    const mm = this.config.multimodal;
    const llm = this.config.llm;
    return {
      apiKey: mm.apiKey || llm?.apiKey || "",
      baseUrl: mm.baseUrl || llm?.baseUrl,
      imageModel: mm.imageModel,
      visionModel: mm.visionModel,
      ttsModel: mm.ttsModel,
      whisperModel: mm.whisperModel,
    };
  }

  // ===== 记忆后端配置 =====

  getMemory(): MemoryConfig {
    return { ...this.config.memory };
  }

  setMemory(config: Partial<MemoryConfig>): void {
    this.config.memory = { ...this.config.memory, ...config };
    this.save();
  }

  // ===== Document Mind 配置 =====

  getDocMind(): DocMindConfig {
    return { ...DEFAULT_CONFIG.docMind, ...this.config.docMind };
  }

  setDocMind(config: Partial<DocMindConfig>): void {
    this.config.docMind = { ...DEFAULT_CONFIG.docMind, ...this.config.docMind, ...config };
    this.save();
  }

  /** 检查 Document Mind 是否已配置 */
  isDocMindConfigured(): boolean {
    // 检查是否启用了 Document Mind 且配置了必要的凭证
    const docMindConfig = this.config.docMind;
    return !!(
      docMindConfig?.enabled &&
      docMindConfig?.accessKeyId &&
      docMindConfig?.accessKeyId.trim().length > 0 &&
      docMindConfig?.accessKeySecret &&
      docMindConfig?.accessKeySecret.trim().length > 0
    );
  }
}

/** ConfigManager 单例实例 */
export const configManager = new ConfigManager();
