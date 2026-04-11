/**
 * 阿里云 Document Mind API 封装
 * 支持文档解析（大模型版）和音视频解析
 * 提供流式进度查询和增量结果获取
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { promisify } from "util";

/** Document Mind 配置 */
export interface DocMindConfig {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint?: string;  // 默认 docmind-api.cn-hangzhou.aliyuncs.com
  regionId?: string;  // 默认 cn-hangzhou
}

/** 版面元素类型 */
export type LayoutType = 
  | 'title' | 'text' | 'figure' | 'table' | 'formula'
  | 'multicolumn' | 'table_name' | 'table_note'
  | 'foot_image' | 'head_image' | 'foot' | 'head'
  | 'corner_note' | 'end_note' | 'side';

/** 版面数据结构 */
export interface DocMindLayout {
  uniqueId: string;
  type: LayoutType;
  subType: string;
  pageNum: number;
  pos: Array<{ x: number; y: number }>;  // 多边形顶点坐标
  text: string;
  markdownContent: string;
  llmResult?: string;        // 大模型增强结果
  layoutConf: number;        // 置信度 0-1
  firstLinesChars?: number;
  level?: number;            // 层级（标题层级）
  alignment?: string;
  lineHeight?: number;
  blocks?: Array<{ text: string }>;
  cells?: Array<any>;        // 表格单元格
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

/** 解析任务状态 */
export type ParsingStatus = 'Init' | 'Processing' | 'success' | 'Fail';

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
  outputFormatResult?: Array<any>;
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
 * Document Mind 解析器
 */
export class DocMindParser {
  private config: Required<DocMindConfig>;
  private pollingInterval = 3000;  // 轮询间隔 ms

  constructor(config: DocMindConfig) {
    this.config = {
      endpoint: 'docmind-api.cn-hangzhou.aliyuncs.com',
      regionId: 'cn-hangzhou',
      ...config,
    };
  }

  /**
   * 提交文档解析任务（本地文件）
   */
  async submitJob(
    filePath: string,
    fileName: string,
    options: ParseOptions = {}
  ): Promise<SubmitResult> {
    if (!existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    const fileContent = readFileSync(filePath);
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    // 构建请求参数
    const params: Record<string, any> = {
      FileName: fileName,
      FileNameExtension: ext,
      LlmEnhancement: options.llmEnhancement ?? true,
      OutputFormat: options.outputFormat ?? ['markdown', 'visualLayoutInfo'],
    };

    if (options.enhancementMode) {
      params.EnhancementMode = options.enhancementMode;
    }
    if (options.formulaEnhancement) {
      params.FormulaEnhancement = options.formulaEnhancement;
    }
    if (options.outputHtmlTable) {
      params.OutputHtmlTable = options.outputHtmlTable;
    }
    if (options.pageIndex) {
      params.PageIndex = options.pageIndex;
    }
    if (options.option) {
      params.Option = options.option;
    }
    if (options.multimediaParameters) {
      params.MultimediaParameters = options.multimediaParameters;
    }

    // 调用 SubmitDocParserJobAdvance
    const result = await this.callAPI('SubmitDocParserJobAdvance', params, fileContent);
    
    return {
      taskId: result.Data?.Id || result.data?.id,
      requestId: result.RequestId || result.requestId,
    };
  }

  /**
   * 提交文档解析任务（URL）
   */
  async submitJobByUrl(
    fileUrl: string,
    fileName: string,
    options: ParseOptions = {}
  ): Promise<SubmitResult> {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    const params: Record<string, any> = {
      FileUrl: fileUrl,
      FileName: fileName,
      FileNameExtension: ext,
      LlmEnhancement: options.llmEnhancement ?? true,
      OutputFormat: options.outputFormat ?? ['markdown', 'visualLayoutInfo'],
    };

    if (options.enhancementMode) {
      params.EnhancementMode = options.enhancementMode;
    }
    if (options.formulaEnhancement) {
      params.FormulaEnhancement = options.formulaEnhancement;
    }
    if (options.option) {
      params.Option = options.option;
    }
    if (options.multimediaParameters) {
      params.MultimediaParameters = options.multimediaParameters;
    }

    const result = await this.callAPI('SubmitDocParserJob', params);
    
    return {
      taskId: result.Data?.Id || result.data?.id,
      requestId: result.RequestId || result.requestId,
    };
  }

  /**
   * 查询任务状态
   */
  async queryStatus(taskId: string): Promise<StatusResult> {
    const result = await this.callAPI('QueryDocParserStatus', { Id: taskId });
    const data = result.Data || result.data;
    
    return {
      status: (data.Status || data.status) as ParsingStatus,
      numberOfSuccessfulParsing: data.NumberOfSuccessfulParsing || data.numberOfSuccessfulParsing || 0,
      tokens: data.Tokens || data.tokens || 0,
      paragraphCount: data.ParagraphCount || data.paragraphCount || 0,
      tableCount: data.TableCount || data.tableCount,
      imageCount: data.ImageCount || data.imageCount,
      pageCountEstimate: data.PageCountEstimate || data.pageCountEstimate || 0,
      processing: data.Processing || data.processing || 0,
      outputFormatResult: data.OutputFormatResult || data.outputFormatResult,
    };
  }

  /**
   * 获取解析结果（分页）
   */
  async getResult(
    taskId: string,
    layoutNum: number = 0,
    layoutStepSize: number = 100
  ): Promise<ParseResult> {
    const result = await this.callAPI('GetDocParserResult', {
      Id: taskId,
      LayoutNum: layoutNum,
      LayoutStepSize: layoutStepSize,
    });

    const data = result.Data || result.data;
    
    // 判断是文档还是音视频
    if (data.segments || data.Segments) {
      // 音视频结果
      const segments = this.parseSegments(data.segments || data.Segments || []);
      return {
        segments,
        pageCount: segments.length,
        tokenCount: this.estimateMediaTokens(segments),
        isComplete: true,
      };
    } else {
      // 文档结果
      const layouts = this.parseLayouts(data.layouts || data.Layouts || []);
      return {
        layouts,
        pageCount: this.countPages(layouts),
        tokenCount: data.tokens || data.Tokens || this.estimateTokens(layouts),
        isComplete: layouts.length < layoutStepSize,  // 如果返回数量小于请求数，说明已完成
      };
    }
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
      callbacks?.onProgress?.(
        status.processing,
        status.numberOfSuccessfulParsing,
        status.pageCountEstimate
      );

      // 处理中或成功状态都可以获取增量结果
      if (status.status === 'Processing' || status.status === 'success') {
        // 增量获取结果
        if (status.numberOfSuccessfulParsing > lastLayoutNum) {
          const result = await this.getResult(taskId, lastLayoutNum, stepSize);
          
          if (result.layouts && result.layouts.length > 0) {
            allLayouts.push(...result.layouts);
            callbacks?.onLayoutReceived?.(result.layouts);
            lastLayoutNum += result.layouts.length;
          }
          
          if (result.segments && result.segments.length > 0) {
            allSegments.push(...result.segments);
            callbacks?.onSegmentReceived?.(result.segments);
            lastLayoutNum += result.segments.length;
          }
        }
      }

      // 任务完成
      if (status.status === 'success') {
        return {
          layouts: allLayouts.length > 0 ? allLayouts : undefined,
          segments: allSegments.length > 0 ? allSegments : undefined,
          pageCount: status.pageCountEstimate,
          tokenCount: status.tokens,
          isComplete: true,
        };
      }

      // 任务失败
      if (status.status === 'Fail') {
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

    while (!isComplete) {
      const status = await this.queryStatus(taskId);

      if (status.status === 'Fail') {
        throw new Error('Document Mind 解析失败');
      }

      if (status.status === 'Processing' || status.status === 'success') {
        if (status.numberOfSuccessfulParsing > lastLayoutNum) {
          const result = await this.getResult(taskId, lastLayoutNum, stepSize);
          
          if ((result.layouts && result.layouts.length > 0) || 
              (result.segments && result.segments.length > 0)) {
            yield {
              layouts: result.layouts,
              segments: result.segments,
              progress: status.processing,
            };
            lastLayoutNum += (result.layouts?.length || 0) + (result.segments?.length || 0);
          }
        }

        if (status.status === 'success') {
          isComplete = true;
        }
      }

      if (!isComplete) {
        await this.sleep(this.pollingInterval);
      }
    }
  }

  /**
   * 调用阿里云 API
   */
  private async callAPI(
    action: string,
    params: Record<string, any>,
    fileContent?: Buffer
  ): Promise<any> {
    // 使用阿里云 OpenAPI SDK 风格调用
    // 这里使用简单的 HTTP 实现，实际可以使用 @alicloud/docmind-api20220711
    
    const url = `https://${this.config.endpoint}/?Action=${action}&Version=2022-07-11`;
    
    // 构建签名（简化版，实际应使用阿里云签名机制）
    const headers: Record<string, string> = {
      'Content-Type': fileContent ? 'multipart/form-data' : 'application/json',
      'x-acs-action': action,
      'x-acs-version': '2022-07-11',
    };

    // 添加认证头
    headers['Authorization'] = `Bearer ${this.config.accessKeyId}:${this.config.accessKeySecret}`;

    let body: BodyInit | undefined;
    if (fileContent) {
      // 构建 multipart/form-data
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      
      const parts: Buffer[] = [];
      for (const [key, value] of Object.entries(params)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
      }
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${params.FileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
      parts.push(fileContent);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
      
      body = Buffer.concat(parts);
    } else {
      body = JSON.stringify(params);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 调用失败: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * 解析版面数据
   */
  private parseLayouts(rawLayouts: any[]): DocMindLayout[] {
    return rawLayouts.map((raw) => ({
      uniqueId: raw.uniqueId || raw.UniqueId || '',
      type: (raw.type || raw.Type || 'text') as LayoutType,
      subType: raw.subType || raw.SubType || '',
      pageNum: raw.pageNum || raw.PageNum || 0,
      pos: raw.pos || raw.Pos || [],
      text: raw.text || raw.Text || '',
      markdownContent: raw.markdownContent || raw.MarkdownContent || '',
      llmResult: raw.llmResult || raw.LlmResult,
      layoutConf: raw.layoutConf || raw.LayoutConf || 0,
      firstLinesChars: raw.firstLinesChars || raw.FirstLinesChars,
      level: raw.level || raw.Level,
      alignment: raw.alignment || raw.Alignment,
      lineHeight: raw.lineHeight || raw.LineHeight,
      blocks: raw.blocks || raw.Blocks,
      cells: raw.cells || raw.Cells,
    }));
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
        asrInfo: f.ASR_info || f.AsrInfo || f.asr_info || '',
      })),
      synopsisResult: raw.synopsis_result || raw.SynopsisResult,
    }));
  }

  /**
   * 统计页数
   */
  private countPages(layouts: DocMindLayout[]): number {
    const pages = new Set(layouts.map(l => l.pageNum));
    return pages.size;
  }

  /**
   * 估算文档 tokens
   */
  private estimateTokens(layouts: DocMindLayout[]): number {
    return layouts.reduce((sum, l) => sum + l.text.length, 0);
  }

  /**
   * 估算音视频 tokens
   */
  private estimateMediaTokens(segments: DocMindSegment[]): number {
    return segments.reduce((sum, s) => {
      const asrLength = s.audioFrames.reduce((a, f) => a + f.asrInfo.length, 0);
      const descLength = s.videoFrames.reduce((v, f) => v + f.textInfo.length, 0);
      return sum + asrLength + descLength;
    }, 0);
  }

  /**
   * 睡眠等待
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 下载远程文件到本地
 */
export async function downloadFile(
  url: string,
  destPath: string,
  timeoutMs: number = 60000
): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status} ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, buffer);
}

/**
 * 判断文件类型
 */
export function detectMediaType(fileName: string): 'document' | 'video' | 'audio' | 'text' {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm'];
  const audioExts = ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'wma'];
  const textExts = ['txt', 'md', 'json', 'csv', 'tsv'];
  
  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  if (textExts.includes(ext)) return 'text';
  return 'document';
}

/**
 * 获取文件格式（用于知识库格式筛选）
 */
export function getFileFormat(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || 'unknown';
}
