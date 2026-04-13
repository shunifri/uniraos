/**
 * 阿里云 Document Mind API 封装（使用官方 SDK）
 * 支持文档解析（大模型版）和音视频解析
 * 提供流式进度查询和增量结果获取
 * 
 * 依赖: @alicloud/docmind-api20220711 @alicloud/tea-util
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, createReadStream } from "fs";
import { dirname, resolve } from "path";
import type { Readable } from "stream";

// 阿里云 SDK
let Client: any;
let models: any;
let RuntimeOptions: any;
let Credential: any;
let sdkInitialized = false;

async function initSdk() {
  if (sdkInitialized) return;
  try {
    const clientModule = await import('@alicloud/docmind-api20220711');
    // CJS 模块导出：default 就是 Client 类
    Client = (clientModule as any).default;
    models = clientModule;  // 所有请求类都在模块顶级导出
    const utilModule = await import('@alicloud/tea-util');
    RuntimeOptions = (utilModule as any).RuntimeOptions;
    const credModule = await import('@alicloud/credentials');
    Credential = (credModule as any).default;
    sdkInitialized = true;
    console.log('[DocMindParser] 阿里云 SDK 加载成功');
  } catch (e) {
    console.warn('[DocMindParser] 阿里云 SDK 未安装，Document Mind 功能不可用:', e);
  }
}

// 立即启动 SDK 初始化
const sdkInitPromise = initSdk();

/** Document Mind 配置 */
export interface DocMindConfig {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint?: string;  // 默认 docmind-api.cn-hangzhou.aliyuncs.com
  regionId?: string;  // 默认 cn-hangzhou
}

/** 版面元素类型（新版 DocParser API） */
export type LayoutType =
  | 'title'      // 标题
  | 'text'       // 正文文本
  | 'table'      // 表格
  | 'formula'    // 公式
  | 'figure_name' // 图片/图表标题
  // 保留旧版类型以便兼容
  | 'figure' | 'multicolumn' | 'table_name' | 'table_note'
  | 'foot_image' | 'head_image' | 'foot' | 'head'
  | 'corner_note' | 'end_note' | 'side';

/** 版面数据结构 */
export interface DocMindLayout {
  uniqueId: string;
  type: LayoutType;
  subType: string;
  pageNum: number | number[];  // 文档解析返回数组 [0]，版面分析返回数字
  pos: Array<{ x: number; y: number }>;  // 多边形顶点坐标
  text: string;
  markdownContent: string;
  llmResult?: string;        // 大模型增强结果
  layoutConf?: number;       // 置信度 0-1（可选）
  firstLinesChars?: number;
  level?: number;            // 层级（标题层级）
  alignment?: string;
  lineHeight?: number;
  blocks?: Array<{
    text: string;
    pos?: any;
    styleId?: number;
    style?: {
      fontName?: string;
      charScale?: number;
      color?: string;
      underline?: boolean;
      deleteLine?: boolean;
      fontSize?: number;
      bold?: boolean;
      italic?: boolean;
    };
  }>;
  cells?: Array<any>;        // 表格单元格
  index?: number;            // 在文档中的索引位置
}

/** 音视频切片结构 */
export interface DocMindSegment {
  index: number;
  startTime: number;         // 毫秒
  endTime: number;           // 毫秒
  videoFrames: Array<{
    startTime: number;
    endTime: number;
    fileUrl: string;         // 临时URL（24小时有效）
    textInfo: string;        // 大模型对帧的描述
  }>;
  audioFrames: Array<{
    startTime: number;
    endTime: number;
    fileUrl: string;         // 临时URL
    asrInfo: string;         // ASR转录结果
  }>;
  synopsisResult?: string;   // 剧情摘要（advance模式）
}

/** 解析任务状态 - 统一使用小写以保持一致性 */
export type ParsingStatus = 'init' | 'processing' | 'success' | 'failed';

/** 状态查询结果 */
export interface StatusResult {
  status: ParsingStatus;
  numberOfSuccessfulParsing: number;  // 已处理的块数
  tokens: number;                     // 字数
  paragraphCount: number;
  tableCount?: number;
  imageCount?: number;
  pageCountEstimate: number;          // 当前处理页数/片数
  processing: number;                 // 进度百分比 0-100
}

/** 提交任务响应 */
export interface SubmitResult {
  taskId: string;
  requestId: string;
}

/** 解析选项 */
export interface ParseOptions {
  llmEnhancement?: boolean;      // 启用大模型增强
  enhancementMode?: 'VLM';       // VLM多模态分析
  formulaEnhancement?: boolean;  // 公式识别增强
  outputHtmlTable?: boolean;     // 返回HTML表格
  pageIndex?: string;            // 页码范围 "1-5"
  outputFormat?: Array<'markdown' | 'visualLayoutInfo'>;
  // 音视频特有
  option?: 'base' | 'advance';   // base=基本识别, advance=剧情解析
  multimediaParameters?: {
    vlParsePrompt?: string;
  };
}

/** 解析结果 */
export interface ParseResult {
  layouts?: DocMindLayout[];      // 文档版面
  segments?: DocMindSegment[];    // 音视频切片
  pageCount: number;
  tokenCount: number;
  isComplete: boolean;            // 是否完整结果
}

/** 进度回调 */
export interface ProgressCallback {
  onProgress?: (progress: number, processed: number, total: number) => void;
  onLayoutReceived?: (layouts: DocMindLayout[]) => void;
  onSegmentReceived?: (segments: DocMindSegment[]) => void;
}

/**
 * Document Mind 解析器（使用阿里云官方 SDK）
 */
export class DocMindParser {
  private config: Required<DocMindConfig>;
  private pollingInterval = 3000;  // 轮询间隔 ms
  private client: any = null;      // 阿里云 SDK Client

  constructor(config: DocMindConfig) {
    this.config = {
      endpoint: 'docmind-api.cn-hangzhou.aliyuncs.com',
      regionId: 'cn-hangzhou',
      ...config,
    };
    
    // SDK 初始化是异步的，但构造函数不能是 async
    // 在第一次使用 client 时会等待 SDK 加载完成
    this.initClientAsync();
  }

  /**
   * 异步初始化阿里云 SDK Client
   */
  private async initClientAsync(): Promise<void> {
    // 等待 SDK 初始化完成
    await sdkInitPromise;
    this.initClient();
  }

  /**
   * 初始化阿里云 SDK Client
   */
  private initClient(): void {
    if (!Client || !Credential) {
      throw new Error('阿里云 SDK 未安装，请运行: npm install @alicloud/docmind-api20220711 @alicloud/credentials @alicloud/tea-util');
    }

    // 参考官方 demo：创建 Credential 实例，再传给 Client
    const cred = new Credential({
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      type: 'access_key',
    });

    this.client = new Client({
      endpoint: this.config.endpoint,
      credential: cred,
      regionId: this.config.regionId,
      // 大文件解析超时设置
      connectTimeout: 60000,
      readTimeout: 60000,
    });
  }

  /**
   * 确保 client 已初始化
   */
  private async ensureClient(): Promise<void> {
    await sdkInitPromise;
    if (!this.client) {
      this.initClient();
    }
  }

  /**
   * 提交文档解析任务（本地文件）
   * 使用新版 DocParser API (SubmitDocParserJobAdvance)
   * 注意：必须使用 fs.createReadStream() 而不是 fs.readFileSync()，
   * 否则 OSS 上传会损坏文件内容，导致解析结果出现 [object Object] 错误
   */
  async submitJob(
    filePath: string,
    fileName: string,
    options: ParseOptions = {}
  ): Promise<SubmitResult> {
    await this.ensureClient();
    
    if (!existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const fileStream = createReadStream(filePath);

    try {
      // 使用新版 SubmitDocParserJobAdvance API
      // 使用逐个设置属性的方式（与官方 demo 保持一致），避免构造函数传参可能导致的问题
      const advanceRequest = new models.SubmitDocParserJobAdvanceRequest();
      advanceRequest.fileUrlObject = fileStream as Readable;
      advanceRequest.fileName = fileName;
      advanceRequest.fileNameExtension = ext;

      // LLM 增强默认关闭，避免不必要的费用和失败
      advanceRequest.llmEnhancement = options.llmEnhancement ?? false;

      // 新版 API 使用 enhancementMode 控制输出格式
      // 注意：VLM 模式需要额外配置，默认不使用，避免失败
      if (options.enhancementMode) {
        advanceRequest.enhancementMode = options.enhancementMode;
      }
      if (options.formulaEnhancement) {
        advanceRequest.formulaEnhancement = options.formulaEnhancement;
      }

      // 设置 outputFormat（新版 API 可能仍然需要）
      if (options.outputFormat && options.outputFormat.length > 0) {
        advanceRequest.outputFormat = options.outputFormat.join(',');
      }

      const runtimeObject = new RuntimeOptions({});
      const response = await this.client.submitDocParserJobAdvance(advanceRequest, runtimeObject);

      return {
        taskId: response.body?.data?.id,
        requestId: response.body?.requestId,
      };
    } finally {
      // 确保关闭文件流
      fileStream.destroy();
    }
  }

  /**
   * 提交文档解析任务（URL）
   */
  async submitJobByUrl(
    fileUrl: string,
    fileName: string,
    options: ParseOptions = {}
  ): Promise<SubmitResult> {
    await this.ensureClient();
    
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

     const request = new models.SubmitDocStructureJobRequest({
       fileUrl: fileUrl,
       fileName: fileName,
       fileNameExtension: ext,
       llmEnhancement: options.llmEnhancement ?? true,
       outputFormat: options.outputFormat?.join(',') ?? 'markdown,visualLayoutInfo',
     });

    if (options.enhancementMode) {
      request.enhancementMode = options.enhancementMode;
    }
    if (options.formulaEnhancement) {
      request.formulaEnhancement = options.formulaEnhancement;
    }
    if (options.option) {
      request.option = options.option;
    }
    if (options.multimediaParameters) {
      request.multimediaParameters = options.multimediaParameters;
    }

    const response = await this.client.submitDocStructureJob(request);

    return {
      taskId: response.body?.data?.id,
      requestId: response.body?.requestId,
    };
  }

  /**
   * 查询任务状态
   * 使用新版 QueryDocParserStatus API
   */
  async queryStatus(taskId: string): Promise<StatusResult> {
    await this.ensureClient();
    
    const request = new models.QueryDocParserStatusRequest();
    request.id = taskId;

    const response = await this.client.queryDocParserStatus(request);
    const body = response.body;
    
    // 新版 API 返回的数据结构不同
    const data = body.data;
    
    // 新版 API 状态映射
    const statusMap: Record<string, ParsingStatus> = {
      'init': 'init',
      'processing': 'processing',
      'success': 'success',
      'fail': 'failed',
    };

    // 新版 API 状态在 data.status（小写）
    const rawStatus = data?.status || 'init';
    const status = statusMap[rawStatus] || 'processing';

    return {
      status,
      numberOfSuccessfulParsing: data?.numberOfSuccessfulParsing || 0,
      tokens: data?.tokens || 0,
      paragraphCount: data?.paragraphCount || 0,
      tableCount: data?.tableCount,
      imageCount: data?.imageCount,
      pageCountEstimate: data?.numberOfPagesTotal || 0,
      processing: data?.numberOfPagesTotal && data?.numberOfSuccessfulParsing
        ? Math.round((data.numberOfSuccessfulParsing / data.numberOfPagesTotal) * 100)
        : 0,
    };
  }

  /**
   * 获取解析结果（分页）
   * 使用新版 GetDocParserResult API
   */
  async getResult(
    taskId: string,
    layoutNum: number = 0,
    layoutStepSize: number = 100
  ): Promise<ParseResult> {
    await this.ensureClient();
    
    const request = new models.GetDocParserResultRequest();
    request.id = taskId;
    request.layoutNum = layoutNum;
    request.layoutStepSize = layoutStepSize;

    const response = await this.client.getDocParserResult(request);
    const body = response.body;

    // 新版 API 数据在 data.layouts（小写）
    const data = body.data;

    // 文档结果 - 从 data.layouts 中提取
    const rawLayouts = data?.layouts;
    const layouts = rawLayouts ? this.parseLayouts(rawLayouts) : [];

    // 判断是否还有更多结果
    const isComplete = layouts.length < layoutStepSize;

    return {
      layouts,
      pageCount: this.countPages(layouts),
      tokenCount: data?.tokens || this.estimateTokens(layouts),
      isComplete,
    };
  }

  /**
   * 等待任务完成（轮询）
   */
  async waitForCompletion(
    taskId: string,
    callbacks?: ProgressCallback,
    timeoutMs: number = 30 * 60 * 1000  // 默认30分钟超时
  ): Promise<ParseResult> {
    const startTime = Date.now();
    let allLayouts: DocMindLayout[] = [];
    let allSegments: DocMindSegment[] = [];
    let lastLayoutNum = 0;
    const stepSize = 50;

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.queryStatus(taskId);
      
      // 进度回调
      if (callbacks?.onProgress) {
        callbacks.onProgress(
          status.processing,
          status.numberOfSuccessfulParsing,
          status.numberOfSuccessfulParsing + 10 // 估算总数
        );
      }

      // 处理中或成功状态都可以获取增量结果
      if (status.status === 'processing' || status.status === 'success') {
        // 增量获取结果
        if (status.numberOfSuccessfulParsing > lastLayoutNum) {
          const result = await this.getResult(taskId, lastLayoutNum, stepSize);
          
          if (result.layouts && result.layouts.length > 0) {
            allLayouts.push(...result.layouts);
            lastLayoutNum += result.layouts.length;
            
            if (callbacks?.onLayoutReceived) {
              callbacks.onLayoutReceived(result.layouts);
            }
          }
          
          if (result.segments && result.segments.length > 0) {
            allSegments.push(...result.segments);
            
            if (callbacks?.onSegmentReceived) {
              callbacks.onSegmentReceived(result.segments);
            }
          }
        }
      }

      // 任务成功完成
      if (status.status === 'success') {
        return {
          layouts: allLayouts,
          segments: allSegments.length > 0 ? allSegments : undefined,
          pageCount: this.countPages(allLayouts),
          tokenCount: status.tokens,
          isComplete: true,
        };
      }

      // 任务失败
      if (status.status === 'failed') {
        throw new Error(`Document Mind 解析失败: ${status.status}`);
      }

      // 等待后继续轮询
      await this.sleep(this.pollingInterval);
    }

    throw new Error('Document Mind 解析超时');
  }

  /**
   * 流式获取结果（异步生成器）
   */
  async *streamResults(
    taskId: string,
    stepSize: number = 50
  ): AsyncGenerator<{ layouts?: DocMindLayout[]; segments?: DocMindSegment[]; progress: number }> {
    let lastLayoutNum = 0;
    let isComplete = false;
    let pollCount = 0;
    const MAX_POLLS = 60 * 24; // 最多轮询 24 小时（3秒一次 × 60 × 24 = 24小时）

    while (!isComplete && pollCount < MAX_POLLS) {
      const status = await this.queryStatus(taskId);
      pollCount++;

      if (status.status === 'failed') {
        throw new Error('Document Mind 解析失败');
      }

      if (status.status === 'processing' || status.status === 'success') {
        if (status.numberOfSuccessfulParsing > lastLayoutNum) {
          const result = await this.getResult(taskId, lastLayoutNum, stepSize);
          
          isComplete = result.isComplete || status.status === 'success';
          lastLayoutNum += result.layouts?.length || result.segments?.length || 0;

          yield {
            layouts: result.layouts,
            segments: result.segments,
            progress: status.processing,
          };
        }
      }

      if (!isComplete) {
        await this.sleep(this.pollingInterval);
      }
    }

    if (!isComplete && pollCount >= MAX_POLLS) {
      throw new Error(`Document Mind 轮询超过最大次数 ${MAX_POLLS}，强制终止`);
    }
  }

  /**
   * 解析版面数据（新版 DocParser API 格式）
   * 
   * 数据格式示例：
   * {
   *   firstLinesChars: 0,
   *   level: 0,
   *   blocks: [{ style: {...}, text: "内容" }],
   *   markdownContent: "# 标题  \n\n",
   *   index: 2,
   *   subType: "doc_title", // 或其他: "none", "para"
   *   lineHeight: 0,
   *   text: "标题内容\n",
   *   alignment: "left",
   *   type: "title", // title, text, formula, table, figure_name
   *   pageNum: 0,    // 0-based 页码
   *   uniqueId: "xxx"
   * }
   */
  private parseLayouts(rawLayouts: any[]): DocMindLayout[] {
    return rawLayouts.map((raw) => {
      // 新版 API 字段都是小写 camelCase
      // pageNum 是数字（0-based），不需要处理数组
      const pageNum = typeof raw.pageNum === 'number' ? raw.pageNum : 0;

      // 解析 blocks，提取文本和样式信息
      const blocks = (raw.blocks || []).map((block: any) => ({
        text: block.text || '',
        style: block.style || null,
        styleId: block.styleId,
      }));

      // 如果 text 为空，尝试从 blocks 中合并文本
      let text = raw.text || '';
      if (!text && blocks.length > 0) {
        text = blocks.map((b: any) => b.text).join(' ');
      }
      
      // 如果 markdownContent 为空，使用 text
      let markdownContent = raw.markdownContent || text || '';

      return {
        uniqueId: raw.uniqueId || '',
        type: (raw.type || 'text') as LayoutType,
        subType: raw.subType || '',
        pageNum,
        pos: raw.pos || [],  // 新版 API 可能没有 pos 字段
        text,
        markdownContent,
        llmResult: raw.llmResult,
        layoutConf: raw.layoutConf,
        firstLinesChars: raw.firstLinesChars,
        level: raw.level,
        alignment: raw.alignment,
        lineHeight: raw.lineHeight,
        blocks: blocks.length > 0 ? blocks : undefined,
        cells: raw.cells,
        index: typeof raw.index === 'number' ? raw.index : 0,
      };
    });
  }

  /**
   * 解析音视频切片数据
   */
  private parseSegments(rawSegments: any[]): DocMindSegment[] {
    return rawSegments.map((raw, index) => ({
      index: raw.index || raw.Index || index,
      startTime: raw.start_time || raw.StartTime || 0,
      endTime: raw.end_time || raw.EndTime || 0,
      videoFrames: (raw.video_frames || raw.VideoFrames || []).map((f: any) => ({
        startTime: f.start_time || f.StartTime || 0,
        endTime: f.end_time || f.EndTime || 0,
        fileUrl: f.file_url || f.FileUrl || '',
        textInfo: f.text_info || f.TextInfo || '',
      })),
      audioFrames: (raw.audio_frames || raw.AudioFrames || []).map((f: any) => ({
        startTime: f.start_time || f.StartTime || 0,
        endTime: f.end_time || f.EndTime || 0,
        fileUrl: f.file_url || f.FileUrl || '',
        asrInfo: f.asr_info || f.AsrInfo || '',
      })),
      synopsisResult: raw.synopsis_result || raw.SynopsisResult,
    }));
  }

  /**
   * 统计页数
   */
  private countPages(layouts: DocMindLayout[]): number {
    const pageSet = new Set<number>();
    layouts.forEach(layout => {
      const pageNum = layout.pageNum;
      if (pageNum !== undefined && pageNum !== null) {
        // pageNum 可能是数字或数字数组
        if (Array.isArray(pageNum)) {
          pageNum.forEach(p => pageSet.add(p));
        } else {
          pageSet.add(pageNum);
        }
      }
    });
    return pageSet.size || 1;
  }

  /**
   * 估算 token 数量
   */
  private estimateTokens(layouts: DocMindLayout[]): number {
    return layouts.reduce((sum, layout) => {
      return sum + (layout.text?.length || 0) / 2;
    }, 0);
  }

  /**
   * 估算音视频 token 数量
   */
  private estimateMediaTokens(segments: DocMindSegment[]): number {
    return segments.reduce((sum, seg) => {
      const videoText = seg.videoFrames?.reduce((s, f) => s + (f.textInfo?.length || 0), 0) || 0;
      const audioText = seg.audioFrames?.reduce((s, f) => s + (f.asrInfo?.length || 0), 0) || 0;
      return sum + videoText + audioText;
    }, 0);
  }

  /**
   * 延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 检测媒体类型
 */
export function detectMediaType(fileName: string): 'document' | 'video' | 'audio' | 'text' {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v'];
  const audioExts = ['mp3', 'wav', 'wma', 'aac', 'ogg', 'flac', 'm4a'];
  // 二进制文档格式
  const documentExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
  // 纯文本格式（包括 JSON，JSON 应该直接文本处理）
  const textExts = ['txt', 'md', 'html', 'htm', 'csv', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bat', 'py', 'js', 'ts', 'sql'];

  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  if (documentExts.includes(ext)) return 'document';
  if (textExts.includes(ext)) return 'text';

  // 默认当作文本文档处理
  return 'text';
}

/**
 * 下载文件到本地
 */
export async function downloadFile(
  url: string,
  destPath: string,
  timeoutMs: number = 60000
): Promise<void> {
  // 验证目标路径在允许的目录内（安全沙箱）
  const allowedBase = resolve(process.cwd(), ".raos");
  const resolvedDest = resolve(destPath);
  if (!resolvedDest.startsWith(allowedBase)) {
    throw new Error(`下载路径超出允许范围: ${destPath}`);
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${url}`);
  }

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, Buffer.from(await response.arrayBuffer()));
}
