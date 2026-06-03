/**
 * 文档解析队列 - 支持 Document Mind 流式解析
 * 
 * 特性：
 * - 异步队列管理
 * - 流式进度轮询
 * - 增量结果处理
 * - SSE/WebSocket 进度推送
 * - 边解析边索引
 */

import { EventEmitter } from "events";
import type { DocMindParser, DocMindLayout, DocMindSegment, ProgressCallback, ParseOptions } from "./docmind-parser.js";
import { downloadFile, detectMediaType } from "./docmind-parser.js";
import type { KnowledgeBase } from "../skills/knowledge-skills.js";
import type { UserSessionManager } from "../user/user-session.js";
import type { PageResult, VisionModelConfig } from "./doc-parser.js";
import { parseDocument } from "./doc-parser.js";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { cwd } from "process";
import { saveImages, extractDocumentImages, describeImages } from "../utils/image-extractor.js";
import type { ImageWithDescription } from "../utils/image-extractor.js";
import type { KnowledgeGraphManager } from "../memory/knowledge-graph/index.js";
import type { LLMProvider } from "../llm/types.js";
import { ingestQueue } from "../utils/ingest-queue.js";

/** 工作空间根目录 */
const WORKSPACE_BASE = resolve(cwd(), ".raos", "workspace");

/**
 * 清理 PDF/Document Mind 解析后的文本空格
 * 解析后的文本往往会在字符之间添加空格，需要清理：
 * 1. 中文字符之间的空格
 * 2. 连续的单个英文字母之间的空格（如 S k i l l -> Skill）
 * 3. 中文标点与文字之间的空格
 */
function cleanParsedText(text: string): string {
  if (!text) return text;
  
  let cleaned = text;
  
  // 1. 处理中文字符之间的空格（执行多次以处理连续空格）
  for (let i = 0; i < 3; i++) {
    cleaned = cleaned.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2");
  }
  
  // 2. 处理连续的单个英文字母之间的空格（如 S k i l l -> Skill）
  cleaned = cleaned.replace(/([a-zA-Z])\s+(?=[a-zA-Z])/g, "$1");
  
  // 2.1 处理下划线周围的空格（如 navigation _planner -> navigation_planner）
  cleaned = cleaned.replace(/([a-zA-Z0-9])\s+_/g, "$1_");
  cleaned = cleaned.replace(/_\s+([a-zA-Z0-9])/g, "_$1");
  
  // 2.2 处理数字和标点之间的空格（如 1 . -> 1.）
  cleaned = cleaned.replace(/(\d)\s+([.])/g, "$1$2");
  cleaned = cleaned.replace(/([.])\s+(\d)/g, "$1$2");
  
  // 3. 处理中文标点与文字之间的空格
  cleaned = cleaned.replace(/([\u4e00-\u9fff])\s*([，。、；：？！""''（）【】《》])/g, "$1$2");
  cleaned = cleaned.replace(/([，。、；：？！""''（）【】《》])\s*([\u4e00-\u9fff])/g, "$1$2");
  
  // 4. 规范中英文/数字之间的空格（保留单个空格）
  cleaned = cleaned.replace(/([\u4e00-\u9fff])\s+([a-zA-Z0-9])/g, "$1 $2");
  cleaned = cleaned.replace(/([a-zA-Z0-9])\s+([\u4e00-\u9fff])/g, "$1 $2");
  
  // 5. 清理多余的连续空格（保留最多一个）
  cleaned = cleaned.replace(/ {2,}/g, " ");
  
  return cleaned;
}

/** 解析任务 */
export interface ParsingTask {
  docId: string;
  docName: string;
  filePath: string;
  owner: string;
  mediaType: 'document' | 'video' | 'audio' | 'text';
  tags: string[];
  taskId?: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  progress: number;
  processedSegments: number;
  totalSegments: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** 进度更新 */
export interface ParsingUpdate {
  docId: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  progress: number;
  processedSegments: number;
  totalSegments: number;
  currentSegment?: {
    index: number;
    preview?: string;
  };
  canPreview: boolean;
  canSearch: boolean;
  error?: string;
}

/** 解析队列配置 */
export interface ParsingQueueConfig {
  maxConcurrent: number;
  pollingIntervalMs: number;
  maxPollingTimeMs: number;
  enableIncrementalIndex: boolean;
  kbImagesDir: string;
}

const DEFAULT_CONFIG: ParsingQueueConfig = {
  maxConcurrent: 3,
  pollingIntervalMs: 3000,
  maxPollingTimeMs: 30 * 60 * 1000,  // 30分钟
  enableIncrementalIndex: true,
  kbImagesDir: resolve(cwd(), ".raos/kb_images"),
};

/** 从数据库取回的版面数据结构（可能比 DocMindLayout 更宽松） */
interface StoredLayout {
  id?: string;
  uniqueId?: string;
  page?: number;
  pageNum?: number | number[];
  type?: string;
  subType?: string;
  content?: string;
  text?: string;
  imageUrl?: string;
}

/** 从数据库取回的音视频切片数据结构 */
interface StoredSegment {
  index?: number;
  startTime?: number;
  endTime?: number;
  synopsis?: string;
  searchableText?: string;
}

/** 带 _skipQueue 的 ingest 选项 */
interface IngestWithSkipQueue {
  source: string;
  tags: string[];
  _placeholderDocId: string;
  _skipQueue: boolean;
}

/** 带图片的 ingest 选项 */
interface IngestWithImages {
  source: string;
  tags: string[];
  skipEmbedding: boolean;
  _placeholderDocId: string;
  _skipQueue: boolean;
  images: Array<{ id: string; description: string; page?: number; url: string }>;
}

/**
 * 解析队列管理器
 */
export class ParsingQueue extends EventEmitter {
  private parser: DocMindParser;
  private config: ParsingQueueConfig;
  private tasks = new Map<string, ParsingTask>();
  private processing = new Set<string>();
  private subscribers = new Map<string, Set<(update: ParsingUpdate) => void>>();
  private getKnowledgeBase: (owner: string) => KnowledgeBase;
  private sessionManager?: UserSessionManager;
  private visionConfig: VisionModelConfig | null;

  constructor(
    parser: DocMindParser,
    getKnowledgeBase: (owner: string) => KnowledgeBase,
    config?: Partial<ParsingQueueConfig>,
    sessionManager?: UserSessionManager,
    visionConfig?: VisionModelConfig | null
  ) {
    super();
    this.parser = parser;
    this.getKnowledgeBase = getKnowledgeBase;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionManager = sessionManager;
    this.visionConfig = visionConfig ?? null;
  }

  /**
   * 添加解析任务
   */
  async addTask(
    docId: string,
    docName: string,
    filePath: string,
    owner: string,
    options: {
      tags?: string[];
      mediaType?: 'document' | 'video' | 'audio' | 'text';
    } = {}
  ): Promise<ParsingTask> {
    const mediaType = options.mediaType || detectMediaType(docName);
    
    // 文本文件直接处理，不进入队列
    if (mediaType === 'text') {
      return this.processTextFile(docId, docName, filePath, owner, options.tags || []);
    }

    const task: ParsingTask = {
      docId,
      docName,
      filePath,
      owner,
      mediaType,
      tags: options.tags || [],
      status: 'pending',
      progress: 0,
      processedSegments: 0,
      totalSegments: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(docId, task);
    
    // 更新数据库状态
    const kb = this.getKnowledgeBase(owner);
    await kb.updateParsingStatus(docId, {
      parsingStatus: 'pending',
      parsingProgress: 0,
      mediaType,
    });

    // 尝试开始处理
    void this.processNext();
    
    return task;
  }

  /**
   * 获取任务状态
   */
  getTask(docId: string): ParsingTask | undefined {
    return this.tasks.get(docId);
  }

  /**
   * 订阅任务进度更新
   */
  subscribe(docId: string, callback: (update: ParsingUpdate) => void): () => void {
    if (!this.subscribers.has(docId)) {
      this.subscribers.set(docId, new Set());
    }
    this.subscribers.get(docId)!.add(callback);

    // 返回取消订阅函数
    return () => {
      this.subscribers.get(docId)?.delete(callback);
    };
  }

  /**
   * 处理文本文件（直接读取，不调用 API）
   */
  private async processTextFile(
    docId: string,
    docName: string,
    filePath: string,
    owner: string,
    tags: string[]
  ): Promise<ParsingTask> {
    const kb = this.getKnowledgeBase(owner);
    
    try {
      // 读取文件内容
      const content = readFileSync(filePath, 'utf-8');
      
      // 直接入库（跳过 embedding，向量化工序统一进全局队列）
      const ingestResult = await kb.ingest(docName, content, {
        source: filePath,
        tags,
        skipEmbedding: true,
      });

      // 向量化加入全局队列
      ingestQueue.enqueue(
        async () => { await kb.vectorizeDoc(ingestResult.docId); },
        { id: `vectorize_${ingestResult.docId}`, docId: ingestResult.docId, userId: owner, name: docName }
      );

      const task: ParsingTask = {
        docId,
        docName,
        filePath,
        owner,
        mediaType: 'text',
        tags,
        status: 'success',
        progress: 100,
        processedSegments: 1,
        totalSegments: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.emit('completed', task);
      return task;
    } catch (error: unknown) {
      const task: ParsingTask = {
        docId,
        docName,
        filePath,
        owner,
        mediaType: 'text',
        tags,
        status: 'failed',
        progress: 0,
        processedSegments: 0,
        totalSegments: 0,
        error: error instanceof Error ? error.message : String(error),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.emit('failed', task);
      return task;
    }
  }

  /**
   * 处理队列中的下一个任务
   */
  private async processNext(): Promise<void> {
    console.log(`[ParsingQueue] 检查是否可以处理下一个任务，当前处理中: ${this.processing.size}/${this.config.maxConcurrent}`);
    if (this.processing.size >= this.config.maxConcurrent) {
      console.log(`[ParsingQueue] 队列已达到最大并发，等待其他任务完成`);
      return;
    }

    // 找到 pending 状态的任务
    const pendingTask = Array.from(this.tasks.values()).find(t => t.status === 'pending');
    if (!pendingTask) {
      console.log(`[ParsingQueue] 队列中无待处理任务`);
      return;
    }

    this.processing.add(pendingTask.docId);
    pendingTask.status = 'processing';
    pendingTask.updatedAt = Date.now();

    // 更新数据库状态
    const kb = this.getKnowledgeBase(pendingTask.owner);
    await kb.updateParsingStatus(pendingTask.docId, {
      parsingStatus: 'processing',
      parsingProgress: 0,
    });

    // 开始处理
    this.processTask(pendingTask).catch(async (error) => {
      console.error(`[ParsingQueue] Task ${pendingTask.docId} failed:`, error);
      pendingTask.status = 'failed';
      pendingTask.error = error instanceof Error ? error.message : String(error);
      // 更新数据库中的失败状态
      await kb.updateParsingStatus(pendingTask.docId, {
        parsingStatus: 'failed',
        parsingProgress: pendingTask.progress,
      });
      this.notifySubscribers(pendingTask.docId, {
        docId: pendingTask.docId,
        status: 'failed',
        progress: pendingTask.progress,
        processedSegments: pendingTask.processedSegments,
        totalSegments: pendingTask.totalSegments,
        canPreview: false,
        canSearch: false,
        error: pendingTask.error,
      });
      this.emit('failed', pendingTask);
    }).finally(() => {
      this.processing.delete(pendingTask.docId);
      // P1 修复：任务完成后清理 subscribers，防止内存泄漏
      this.subscribers.delete(pendingTask.docId);
      void this.processNext();  // 继续处理下一个
    });
  }

  /**
   * 处理单个任务
   */
  private async processTask(task: ParsingTask): Promise<void> {
    console.log(`[ParsingQueue] 开始处理任务: docId=${task.docId}, docName=${task.docName}`);
    const isVideoAudio = task.mediaType === 'video' || task.mediaType === 'audio';

    // 1. 提交 Document Mind 任务
    let submitResult;
    try {
      // 启用增强模式
      const parseOptions: ParseOptions = {
        llmEnhancement: true, // 启用 LLM 增强，提升复杂表格/公式/版式理解精度
        enhancementMode: 'VLM', // 启用 VLM 多模态分析
        formulaEnhancement: true, // 启用公式识别增强
        outputHtmlTable: true, // 输出 HTML 表格以保留结构
      };

      submitResult = await this.parser.submitJob(
        task.filePath,
        task.docName,
        parseOptions
      );
    } catch (docMindError: unknown) {
      // Document Mind 失败，降级到本地解析
      console.warn(`[ParsingQueue] Document Mind failed for ${task.docId}: ${docMindError instanceof Error ? docMindError.message : String(docMindError)}`);
      console.warn(`[ParsingQueue] Falling back to local parsing...`);
      await this.fallbackToLocalParsing(task);
      return;
    }

    task.taskId = submitResult.taskId;
    console.log(`[ParsingQueue] Document Mind 任务提交成功，taskId=${submitResult.taskId}`);

    // 更新数据库中的 taskId
    const kb = this.getKnowledgeBase(task.owner);
    await kb.updateParsingStatus(task.docId, {
      docMindTaskId: submitResult.taskId,
    });

    // 2. 流式轮询并处理增量结果
    let allLayouts: DocMindLayout[] = [];
    let allSegments: DocMindSegment[] = [];
    let lastProcessedCount = 0;

    const startTime = Date.now();

    for await (const batch of this.parser.streamResults(submitResult.taskId, 50)) {
      // 检查超时
      if (Date.now() - startTime > this.config.maxPollingTimeMs) {
        throw new Error('解析超时');
      }

      task.progress = batch.progress;

      if (batch.layouts && batch.layouts.length > 0) {
        allLayouts.push(...batch.layouts);
        
        // 增量保存版面数据
        await kb.saveLayouts(task.docId, batch.layouts, true);
        
        // 下载图片（如果是文档）
        await this.downloadLayoutImages(task, batch.layouts);
        
        // 边解析边索引
        if (this.config.enableIncrementalIndex) {
          await this.incrementalIndexLayouts(task, batch.layouts);
        }

        task.processedSegments = allLayouts.length;
        lastProcessedCount = allLayouts.length;
      }

      if (batch.segments && batch.segments.length > 0) {
        allSegments.push(...batch.segments);
        
        // 增量保存切片数据
        await kb.saveSegments(task.docId, batch.segments, true);
        
        // 下载关键帧
        await this.downloadSegmentFrames(task, batch.segments);
        
        // 边解析边索引
        if (this.config.enableIncrementalIndex) {
          await this.incrementalIndexSegments(task, batch.segments);
        }

        task.processedSegments = allSegments.length;
        lastProcessedCount = allSegments.length;
      }

      // 通知订阅者
      this.notifySubscribers(task.docId, {
        docId: task.docId,
        status: 'processing',
        progress: task.progress,
        processedSegments: task.processedSegments,
        totalSegments: task.totalSegments || lastProcessedCount + 10, // 估算
        canPreview: task.processedSegments > 0,
        canSearch: task.processedSegments > 0,
      });

      task.updatedAt = Date.now();
    }

     // 3. 最终处理
     task.status = 'success';
     task.progress = 100;
     task.totalSegments = task.processedSegments;
     console.log(`[ParsingQueue] Document Mind 流式轮询完成，处理版面数: ${allLayouts.length}, 切片数: ${allSegments.length}`);

     // 如果 Document Mind 解析完成后没有得到任何内容，标记为失败（不降级）
     if (task.processedSegments === 0) {
       console.warn(`[ParsingQueue] Document Mind 返回 0 版面，标记为失败: ${task.docId}`);
       throw new Error('Document Mind 解析返回空内容');
     }

     // 最终索引（如果没有启用增量索引）
    if (!this.config.enableIncrementalIndex) {
      console.log(`[ParsingQueue] 执行最终索引（非增量）: ${task.docId}`);
      if (allLayouts.length > 0) {
        await this.finalIndexLayouts(task, allLayouts);
      }
      if (allSegments.length > 0) {
        await this.finalIndexSegments(task, allSegments);
      }
    }

    // Document Mind 解析完成后，收集完整内容提取标签
    const allContent = allLayouts.map(l => cleanParsedText(l.markdownContent || l.text)).join('\n');
    console.log(`[ParsingQueue] 开始标签提取，内容长度: ${allContent.length}`);
    if (allContent.length > 100) {
      let currentTags = [...task.tags];
      try {
        const { extractTags } = await import("./doc-parser.js");
        if (this.visionConfig) {
          const extractedTags = await extractTags(allContent, this.visionConfig);
          if (extractedTags && extractedTags.length > 0) {
            currentTags = [...new Set([...currentTags, ...extractedTags])];
            // 更新文档的 tags
            await kb.updateTags(task.docId, currentTags);
            console.log(`[ParsingQueue] 标签提取完成，提取了 ${extractedTags.length} 个标签: ${JSON.stringify(extractedTags)}`);
          } else {
            console.log(`[ParsingQueue] 没有提取到新标签`);
          }
        } else {
          console.log(`[ParsingQueue] 跳过标签提取，无视觉模型配置`);
        }
      } catch (err: unknown) {
        console.warn(`[ParsingQueue] 标签提取失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 同步文档到知识图谱（非致命，失败不影响主流程）
    console.log(`[ParsingQueue] 开始同步知识图谱: ${task.docId}`);
    if (this.sessionManager && task.docId) {
      try {
        const session = this.sessionManager.getOrCreate(task.owner);
        const sessionWithGraph = session as unknown as { graphManager?: KnowledgeGraphManager; llmProvider?: LLMProvider };
        const graphManager = sessionWithGraph.graphManager;
        const llmProvider = sessionWithGraph.llmProvider;
        if (graphManager) {
          // 1. 添加文档主节点
          await graphManager.onFactStored({
            id: `kb_doc_${task.docId}`,
            key: `kb:${task.docName}`,
            value: `Knowledge base document: ${task.docName}`,
            tags: ['kb_document', (task.docName.split('.').pop() || 'doc'), ...task.tags].filter(Boolean),
            type: "kb_document",
          });

          // 2. 添加版面节点
          const layouts = await kb.getLayouts(task.docId) as StoredLayout[];
          if (layouts && Array.isArray(layouts) && layouts.length > 0) {
            for (const layout of layouts.slice(0, 20)) {  // 最多同步 20 个版面
              await graphManager.onFactStored({
                id: `kb_layout_${layout.id || layout.uniqueId}`,
                key: `kb:${task.docName}:p${layout.page || layout.pageNum}:${layout.type}`,
                value: ((layout.content || layout.text) || '').slice(0, 200),
                tags: ['kb_layout', layout.type, layout.subType, ...task.tags].filter((t): t is string => typeof t === 'string'),
                relation: `kb:${task.docName}`,
                type: "entity",
              });
            }
          }

          // 3. 添加音视频切片节点
          const segments = await kb.getSegments(task.docId) as StoredSegment[];
          if (segments && Array.isArray(segments) && segments.length > 0) {
            for (const segment of segments.slice(0, 10)) {  // 最多同步 10 个切片
              await graphManager.onFactStored({
                id: `kb_seg_${task.docId}_${segment.index}`,
                key: `kb:${task.docName}:t${segment.startTime}-${segment.endTime}`,
                value: ((segment.synopsis || segment.searchableText) || '').slice(0, 200),
                tags: ['kb_segment', task.mediaType, ...task.tags].filter(Boolean),
                relation: `kb:${task.docName}`,
                type: "entity",
              });
            }
          }

          // 4. LLM 关系抽取 — KG v2 阶段 2：入队异步执行
          const docContent = await kb.getDocumentContent(task.docId);
          if (llmProvider && docContent && docContent.length > 100 && this.sessionManager) {
            const { kgExtractionQueue } = await import("../services/kg-extraction-queue.js");
            const taskId = kgExtractionQueue.enqueue(
              {
                docId: task.docId,
                docName: task.docName,
                userId: task.owner,
                content: docContent,
                chunkSize: 3000,
                overlap: 500,
                maxRelationsPerChunk: 30,
                createDocAnchor: false, // ParsingQueue Document Mind 路径不创建 doc anchor
                callerTag: "ParsingQueue",
              },
              this.sessionManager
            );
            console.log(`[ParsingQueue] KG 抽取任务已入队: ${taskId}`);
          }
          console.log(`[ParsingQueue] Knowledge graph sync completed for ${task.docId}`);
        }
      } catch (err: unknown) {
        console.warn("[ParsingQueue] Graph sync/relation extraction failed, ignoring:", err);
        // 图谱同步失败不影响主流程
      }
    }

    // Document Mind 解析完成后，也提取文档内嵌图片（流程图、架构图、操作说明截图等）
    let imageChunkCount = 0;
    try {
      console.log(`[ParsingQueue] Document Mind 解析完成，开始提取内嵌图片: ${task.docId}`);
      const extracted = await extractDocumentImages(task.filePath);
      if (extracted.length > 0 && this.visionConfig) {
        console.log(`[ParsingQueue] 提取到 ${extracted.length} 张图片，生成描述...`);
        const described = await describeImages(extracted, this.visionConfig);
        const imageDir = resolve(cwd(), ".raos", "knowledge", task.owner, "doc-images", task.docId);
        const savedImages = saveImages(described, imageDir);
        console.log(`[ParsingQueue] 已保存 ${savedImages.length} 张图片到 ${imageDir}`);

        // 为每张图片创建 chunk
        for (let i = 0; i < described.length; i++) {
          const img = described[i];
          const imgContent = `![${img.description}](/api/knowledge/documents/${task.docId}/images/${img.id})\n\n图片描述：${img.description}`;
          const tokens = imgContent.length; // 简单估算
          await kb.insertChunkDirect(
            task.docId,
            task.processedSegments + i,
            imgContent,
            tokens,
            null, // 图片 chunk 暂时不向量化（后续可优化）
            img.page ?? null,
            "[]"
          );
        }

        imageChunkCount = described.length;
        await kb.incrementChunkCount(task.docId, imageChunkCount, described.reduce((sum, img) => sum + img.description.length, 0));
        console.log(`[ParsingQueue] 已插入 ${imageChunkCount} 个图片 chunks`);
      }
    } catch (err: unknown) {
      console.error(`[ParsingQueue] 图片提取失败（不影响主流程）: ${err instanceof Error ? err.message : String(err)}`);
    }

     // 更新数据库状态 - 在所有处理完成后更新
     // 收集完整内容用于显示
     const fullContent = allLayouts.map(l => cleanParsedText(l.markdownContent || l.text)).join('\n\n');
     await kb.updateParsingStatus(task.docId, {
       parsingStatus: 'success',
       parsingProgress: 100,
       chunkCount: task.processedSegments + imageChunkCount,
       parsedContent: fullContent.slice(0, 50000), // 限制大小避免过大
     });

    this.emit('completed', task);
  }

  /**
   * 增量索引版面数据（使用事务）
   * 先清除旧 chunks，再插入 Document Mind 解析的新 chunks，避免本地解析和异步解析的 chunk 重复
   */
  private async incrementalIndexLayouts(
    task: ParsingTask,
    layouts: DocMindLayout[]
  ): Promise<void> {
    const kb = this.getKnowledgeBase(task.owner);
    
    // 检查文档是否仍然存在（可能已经被删除）
    const doc = await kb.getDocument(task.docId);
    if (!doc) {
      console.warn(`[ParsingQueue] Document ${task.docId} not found, skipping incremental indexing (may have been deleted)`);
      task.status = 'failed';
      task.error = '文档已被删除';
      return;
    }
    
    // 将版面转换为 chunks
    const chunks = this.layoutsToChunks(layouts);
    if (chunks.length === 0) {
      console.warn(`[ParsingQueue] No chunks generated from layouts for ${task.docId}`);
      return;
    }
    
    // 先清除旧 chunks 和 keywords（避免本地解析和 Document Mind 解析的 chunk 重复）
    try {
      await kb.clearDocChunks(task.docId);
      console.log(`[ParsingQueue] Cleared old chunks for ${task.docId}`);
    } catch (err: unknown) {
      console.error(`[ParsingQueue] Failed to clear old chunks for ${task.docId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    // 跟踪成功插入的 chunk 数量和 token 数量
    let successfulChunks = 0;
    let totalTokens = 0;
    
    // 向量化并入库
    const embeddingProvider = kb.getEmbeddingProvider();
    
    for (let i = 0; i < chunks.length; i++) {
      try {
        const chunk = chunks[i];
        const [vector] = await embeddingProvider.embed([chunk.content]);
        
        // 插入 chunk 并获取真实 chunkId
        const chunkId = await kb.insertChunkDirect(
          task.docId,
          chunk.index,
          chunk.content,
          chunk.tokens,
          vector,
          chunk.pageNumber,
          JSON.stringify(chunk.bboxes)
        );
        
        successfulChunks++;
        totalTokens += chunk.tokens;

        // 提取关键词
        const keywords = this.extractKeywords(chunk.content);
        for (const [keyword, tf] of keywords) {
          // 使用真实插入后的 chunkId
          await kb.insertKeyword(keyword, chunkId, tf);
        }
      } catch (err: unknown) {
        console.error(`[ParsingQueue] Failed to index chunk ${i}: ${err instanceof Error ? err.message : String(err)}`);
        // 继续处理其他 chunks，不中断整个流程
      }
    }

    // 重置 chunk_count 和 total_tokens（因为已经清除了旧 chunks）
    if (successfulChunks > 0) {
      await kb.setChunkCount(task.docId, successfulChunks, totalTokens);
    }
  }

  /**
   * 增量索引音视频切片
   */
  private async incrementalIndexSegments(
    task: ParsingTask,
    segments: DocMindSegment[]
  ): Promise<void> {
    const kb = this.getKnowledgeBase(task.owner);
    let totalTokens = 0;
    
    for (const segment of segments) {
      // 合并可搜索文本
      const searchableText = this.combineSegmentText(segment);
      const tokens = Math.ceil(searchableText.length / 4);
      totalTokens += tokens;
      
      const [vector] = await kb.getEmbeddingProvider().embed([searchableText]);
      
      // 获取关键帧路径
      const frameUrl = this.getFramePath(task, segment.index);
      
      // 获取 ASR 文本
      const asrText = segment.audioFrames.map(f => f.asrInfo).join('\n');
      
      await kb.insertMediaChunk(
        task.docId,
        segment.index,
        searchableText,
        vector,
        {
          segmentIndex: segment.index,
          timeRange: { start: segment.startTime, end: segment.endTime },
          frameUrl: existsSync(frameUrl) ? frameUrl : undefined,
          asrText,
          contentType: task.mediaType === 'video' ? 'video_segment' : 'audio_segment',
        }
      );
    }

    // 更新文档 chunk 和 token 数量
    await kb.incrementChunkCount(task.docId, segments.length, totalTokens);
  }

  /**
   * 最终索引版面数据
   */
  private async finalIndexLayouts(
    task: ParsingTask,
    layouts: DocMindLayout[]
  ): Promise<void> {
    const kb = this.getKnowledgeBase(task.owner);
    const chunks = this.layoutsToChunks(layouts);

    // 使用 KnowledgeBase 的 ingest 方法
    // 清理文本空格后再入库
    const content = layouts.map(l => cleanParsedText(l.markdownContent || l.text)).join('\n');

    // Document Mind 解析完成后，也需要自动提取标签
    // 只有当用户没有传入标签时才自动提取
    let finalTags = [...task.tags];
    if (finalTags.length === 0 && content.length > 100) {
      try {
        const { extractTags } = await import("./doc-parser.js");
        if (this.visionConfig) {
          const extractedTags = await extractTags(content, this.visionConfig);
          if (extractedTags && extractedTags.length > 0) {
            finalTags = [...new Set([...finalTags, ...extractedTags])];
          }
        }
      } catch (err: unknown) {
        console.warn(`[ParsingQueue] Failed to extract tags for ${task.docId}:`, err);
      }
    }

    // 计算相对于 workspace 的路径，而不是使用绝对路径
    const relativePath = task.filePath.startsWith(WORKSPACE_BASE)
      ? task.filePath.slice(WORKSPACE_BASE.length + 1)
      : task.filePath;

    const ingestResult = await kb.ingest(task.docName, content, {
      source: relativePath,
      tags: finalTags,
      skipEmbedding: true,
      _placeholderDocId: task.docId,
      _skipQueue: true,
    } as unknown as IngestWithSkipQueue);

    // 向量化加入全局队列
    ingestQueue.enqueue(
      async () => { await kb.vectorizeDoc(ingestResult.docId); },
      { id: `vectorize_${ingestResult.docId}`, docId: ingestResult.docId, userId: task.owner, name: task.docName }
    );
  }

  /**
   * 最终索引音视频切片
   */
  private async finalIndexSegments(
    task: ParsingTask,
    segments: DocMindSegment[]
  ): Promise<void> {
    // 已经在增量索引中处理
  }

  /**
   * 版面转 chunks
   */
  private layoutsToChunks(layouts: DocMindLayout[]): Array<{
    index: number;
    content: string;
    tokens: number;
    pageNumber: number;
    bboxes: Array<{ page: number; bbox: [number, number, number, number] }>;
  }> {
    const chunks: Array<{
      index: number;
      content: string;
      tokens: number;
      pageNumber: number;
      bboxes: Array<{ page: number; bbox: [number, number, number, number] }>;
    }> = [];
    
    let currentContent = '';
    let currentTokens = 0;
    let currentPage = 0;
    let currentBboxes: Array<{ page: number; bbox: [number, number, number, number] }> = [];
    const MAX_TOKENS = 500;

    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[i];
      const rawText = layout.markdownContent || layout.text;
      const text = cleanParsedText(rawText);
      const tokens = Math.ceil(text.length / 4); // 简化估算

      if (currentTokens + tokens > MAX_TOKENS && currentContent) {
        chunks.push({
          index: chunks.length,
          content: currentContent,
          tokens: currentTokens,
          pageNumber: currentPage,
          bboxes: [...currentBboxes],
        });
        currentContent = '';
        currentTokens = 0;
        currentBboxes = [];
      }

      currentContent += '\n' + text;
      currentTokens += tokens;
      // pageNum 可能是数组，Document Mind 返回 0-based，转为 1-based 与本地解析一致
      const rawPageNum = Array.isArray(layout.pageNum) ? layout.pageNum[0] : layout.pageNum;
      const pageNum = (rawPageNum ?? 0) + 1;
      currentPage = pageNum;
      
      // 转换 pos 到 bbox
      if (layout.pos && layout.pos.length >= 4) {
        const xs = layout.pos.map(p => p.x);
        const ys = layout.pos.map(p => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        currentBboxes.push({
          page: pageNum,
          bbox: [minX, minY, maxX - minX, maxY - minY] as [number, number, number, number],
        });
      }
    }

    if (currentContent) {
      chunks.push({
        index: chunks.length,
        content: currentContent,
        tokens: currentTokens,
        pageNumber: currentPage,
        bboxes: currentBboxes,
      });
    }

    return chunks;
  }

  /**
   * 合并切片文本
   */
  private combineSegmentText(segment: DocMindSegment): string {
    const parts: string[] = [];
    
    // ASR 文本
    const asrText = segment.audioFrames.map(f => f.asrInfo).join('\n');
    if (asrText) parts.push(asrText);
    
    // 帧描述
    const frameDesc = segment.videoFrames.map(f => f.textInfo).join('\n');
    if (frameDesc) parts.push(frameDesc);
    
    // 剧情摘要
    if (segment.synopsisResult) {
      parts.push(segment.synopsisResult);
    }
    
    return parts.join('\n\n');
  }

  /**
   * 提取关键词（简化版 TF）
   */
  private extractKeywords(text: string): Map<string, number> {
    const words = text.toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);
    
    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) || 0) + 1);
    }
    
    // 归一化
    const maxFreq = Math.max(...freq.values(), 1);
    for (const [word, count] of freq) {
      freq.set(word, count / maxFreq);
    }
    
    return freq;
  }

  /**
   * 下载版面图片到磁盘，用于前端双视图预览
   * 使用 1-based 页码，与 saveKBPageImages / getKBPageImagePath 保持一致
   */
  private async downloadLayoutImages(
    task: ParsingTask,
    layouts: DocMindLayout[]
  ): Promise<void> {
    const downloadPromises: Promise<void>[] = [];
    const savedPages = new Set<number>();

    for (const layout of layouts) {
      // Document Mind 新版API中，如果layout有图片URL，下载它
      const imageUrl = (layout as StoredLayout).imageUrl;
      if (typeof imageUrl === 'string' && imageUrl) {
        // Document Mind pageNum 是 0-based，转为 1-based 与本地解析一致
        const rawPageNum = Array.isArray(layout.pageNum) ? layout.pageNum[0] : layout.pageNum;
        const pageNum = (rawPageNum ?? 0) + 1;
        const destPath = this.getLayoutImagePath(task, pageNum);
        
        if (!existsSync(destPath)) {
          mkdirSync(dirname(destPath), { recursive: true });
          downloadPromises.push(
            downloadFile(imageUrl, destPath).then(() => { savedPages.add(pageNum); }).catch((err: unknown) => {
              console.error(`[ParsingQueue] Failed to download layout image for page ${pageNum}: ${err instanceof Error ? err.message : String(err)}`);
            })
          );
        } else {
          savedPages.add(pageNum);
        }
      }
    }
    
    await Promise.all(downloadPromises);

    // 更新 pages.json 索引，确保 getKBPageImageList 能返回正确的页码列表
    if (savedPages.size > 0) {
      try {
        const indexFile = join(process.cwd(), ".raos", "knowledge", task.owner, "page-images", task.docId, "pages.json");
        let existingPages: number[] = [];
        if (existsSync(indexFile)) {
          try { existingPages = JSON.parse(readFileSync(indexFile, "utf-8")); } catch { /* ignore */ }
        }
        const merged = [...new Set([...existingPages, ...savedPages])].sort((a, b) => a - b);
        writeFileSync(indexFile, JSON.stringify(merged));
      } catch (err: unknown) {
        console.error(`[ParsingQueue] Failed to update pages.json for ${task.docId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * 获取版面图片存储路径
   * 使用与 saveKBPageImages 一致的路径结构，确保 getKBPageImagePath 能查找到
   */
  private getLayoutImagePath(task: ParsingTask, pageNumber: number): string {
    return join(
      process.cwd(),
      ".raos",
      "knowledge",
      task.owner,
      "page-images",
      task.docId,
      `page-${pageNumber}.png`
    );
  }

  /**
   * 下载切片关键帧
   */
  private async downloadSegmentFrames(
    task: ParsingTask,
    segments: DocMindSegment[]
  ): Promise<void> {
    const downloadPromises: Promise<void>[] = [];
    
    for (const segment of segments) {
      if (segment.videoFrames.length > 0) {
        const frame = segment.videoFrames[0];
        const destPath = this.getFramePath(task, segment.index);
        
        if (!existsSync(destPath)) {
          mkdirSync(dirname(destPath), { recursive: true });
          downloadPromises.push(
            downloadFile(frame.fileUrl, destPath).catch((err: unknown) => {
              console.error(`[ParsingQueue] Failed to download frame: ${err instanceof Error ? err.message : String(err)}`);
            })
          );
        }
      }
    }
    
    await Promise.all(downloadPromises);
  }

  /**
   * 获取关键帧存储路径
   */
  private getFramePath(task: ParsingTask, segmentIndex: number): string {
    return join(
      this.config.kbImagesDir,
      task.owner,
      task.docId,
      `segment_${segmentIndex}_frame.png`
    );
  }

  /**
   * 通知订阅者
   */
  private notifySubscribers(docId: string, update: ParsingUpdate): void {
    const callbacks = this.subscribers.get(docId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(update);
        } catch (err: unknown) {
          console.error('[ParsingQueue] Subscriber error:', err);
        }
      }
    }
    
    // 同时 emit 事件
    this.emit('progress', update);
  }

  /**
   * 降级到本地解析（Document Mind 失败时使用）
   */
   private async fallbackToLocalParsing(task: ParsingTask): Promise<void> {
     console.log(`[ParsingQueue] 开始本地解析: docId=${task.docId}`);

     // 音视频文档必须启用 Document Mind，不允许本地解析
     const mediaExts = ['mp3', 'wav', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4a', 'aac', 'ogg'];
     const fileExt = task.docName.split('.').pop()?.toLowerCase() || '';
     if (mediaExts.includes(fileExt)) {
       console.error(`[ParsingQueue] 音视频文档必须启用 Document Mind: ${task.docName}`);
       throw new Error('音视频文档解析需要启用 Document Mind');
     }

     task.status = 'processing';
     task.progress = 10;
     this.notifySubscribers(task.docId, {
       docId: task.docId,
       status: 'processing',
       progress: 10,
       processedSegments: 0,
       totalSegments: 1,
       currentSegment: { index: 0, preview: '本地解析中...' },
       canPreview: false,
       canSearch: false,
       error: 'Document Mind 服务暂时不可用，已降级到本地解析',
     });

     try {
       // Check if file still exists
       if (!existsSync(task.filePath)) {
         throw new Error(`源文件不存在: ${task.filePath}，可能上传时保存失败`);
       }
       console.log(`[ParsingQueue] 文件存在，开始调用本地解析器: ${task.filePath}`);

       // 使用本地 doc-parser 解析
       // 传递视觉模型配置，以便支持 VLM 模式（如扫描件 OCR）
       console.log(`[ParsingQueue] 调用 parseDocument，视觉模型配置: ${!!this.visionConfig}`);
       const parseResult = await parseDocument(task.filePath, this.visionConfig);
       
       if (!parseResult.success) {
         throw new Error(`本地解析失败: ${parseResult.error}`);
       }
       console.log(`[ParsingQueue] 本地解析成功，内容长度: ${parseResult.content.length}`);

      const kb = this.getKnowledgeBase(task.owner);

      // 使用 kb.ingest 保存解析后的内容
      // 注意：这会创建一个新的文档记录，需要先删除占位符
      const content = parseResult.content;
      
      // 更新进度
      task.progress = 50;
      this.notifySubscribers(task.docId, {
        docId: task.docId,
        status: 'processing',
        progress: 50,
        processedSegments: 1,
        totalSegments: 2,
        canPreview: true,
        canSearch: false,
      });

        // 重新调用 ingest 来保存内容（会触发分块和向量化）
        // 传入 task.docId 作为占位符ID，避免重复创建文档
        // 添加 _skipQueue = true 强制不走 Document Mind 队列，直接本地解析（避免递归）
        console.log(`[ParsingQueue] 开始调用知识库 ingest，文档名: ${task.docName}`);
        // 保存文档内嵌图片到磁盘
        let savedImages: Array<{ id: string; path: string; description: string; page?: number }> = [];
        if (parseResult.images && parseResult.images.length > 0) {
          const imageDir = resolve(cwd(), ".raos", "knowledge", task.owner, "doc-images", task.docId);
          savedImages = saveImages(parseResult.images, imageDir);
          console.log(`[ParsingQueue] 已保存 ${savedImages.length} 张内嵌图片到 ${imageDir}`);
        }

        const result = await kb.ingest(task.docName, content, {
          source: task.filePath,
          tags: task.tags,
          skipEmbedding: true,
          _placeholderDocId: task.docId,
          _skipQueue: true,
          images: savedImages.map((img) => ({
            id: img.id,
            description: img.description,
            page: img.page,
            url: `/api/knowledge/documents/${task.docId}/images/${img.id}`,
          })),
        } as unknown as IngestWithImages);
        console.log(`[ParsingQueue] 知识库 ingest 完成，docId: ${result.docId}, chunkCount: ${result.chunkCount}`);

        // 向量化加入全局队列
        ingestQueue.enqueue(
          async () => { await kb.vectorizeDoc(result.docId); },
          { id: `vectorize_${result.docId}`, docId: result.docId, userId: task.owner, name: task.docName }
        );

       task.progress = 100;
       task.processedSegments = result.chunkCount;
       task.totalSegments = result.chunkCount;
       task.status = 'success';

       this.notifySubscribers(task.docId, {
         docId: task.docId,
         status: 'success',
         progress: 100,
         processedSegments: task.processedSegments,
         totalSegments: task.totalSegments,
         canPreview: true,
         canSearch: true,
       });

       console.log(`[ParsingQueue] 本地解析完成: ${task.docId}, chunks: ${result.chunkCount}`);

      // 更新数据库状态为成功
      await kb.updateParsingStatus(task.docId, {
        parsingStatus: 'success',
        parsingProgress: 100,
        chunkCount: result.chunkCount,
        parsedContent: content.slice(0, 50000),
      });

      // 同步文档到知识图谱（非致命，失败不影响主流程）
      if (this.sessionManager && task.docId) {
        try {
          const session = this.sessionManager.getOrCreate(task.owner);
          const sessionWithGraph = session as unknown as { graphManager?: KnowledgeGraphManager; llmProvider?: LLMProvider };
          const graphManager = sessionWithGraph.graphManager;
          const llmProvider = sessionWithGraph.llmProvider;
          if (graphManager) {
            // 1. 添加文档主节点
            await graphManager.onFactStored({
              id: `kb_doc_${task.docId}`,
              key: `kb:${task.docName}`,
              value: `Knowledge base document: ${task.docName}`,
              tags: ['kb_document', (task.docName.split('.').pop() || 'doc'), ...task.tags].filter(Boolean),
              type: "kb_document",
            });

            // 2. LLM 关系抽取 — KG v2 阶段 2：入队异步执行
            const savedContent = await kb.getDocumentContent(task.docId);
            if (llmProvider && savedContent && savedContent.length > 100 && this.sessionManager) {
              const { kgExtractionQueue } = await import("../services/kg-extraction-queue.js");
              const taskId = kgExtractionQueue.enqueue(
                {
                  docId: task.docId,
                  docName: task.docName,
                  userId: task.owner,
                  content: savedContent,
                  chunkSize: 3000,
                  overlap: 500,
                  maxRelationsPerChunk: 30,
                  createDocAnchor: false, // ParsingQueue 本地解析路径不创建 doc anchor
                  callerTag: "ParsingQueueLocal",
                },
                this.sessionManager
              );
              console.log(`[ParsingQueue] KG 抽取任务已入队: ${taskId}`);
            }
            console.log(`[ParsingQueue] Knowledge graph sync completed for ${task.docId} (local parsing)`);
          }
        } catch (err: unknown) {
          console.warn("[ParsingQueue] Graph sync/relation extraction failed, ignoring:", err);
          // 图谱同步失败不影响主流程
        }
      }

    } catch (error: unknown) {
      console.error(`[ParsingQueue] Local parsing failed for ${task.docId}:`, error);
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);

      // 更新数据库中的失败状态
      const kb = this.getKnowledgeBase(task.owner);
      await kb.updateParsingStatus(task.docId, {
        parsingStatus: 'failed',
        parsingProgress: 0,
      });

      this.notifySubscribers(task.docId, {
        docId: task.docId,
        status: 'failed',
        progress: 0,
        processedSegments: 0,
        totalSegments: 0,
        canPreview: false,
        canSearch: false,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }
}

/** 全局队列实例 */
let globalParsingQueue: ParsingQueue | null = null;

export function initParsingQueue(
  parser: DocMindParser,
  getKnowledgeBase: (owner: string) => KnowledgeBase,
  config?: Partial<ParsingQueueConfig>,
  sessionManager?: UserSessionManager,
  visionConfig?: VisionModelConfig | null
): ParsingQueue {
  globalParsingQueue = new ParsingQueue(parser, getKnowledgeBase, config, sessionManager, visionConfig);
  return globalParsingQueue;
}

export function getParsingQueue(): ParsingQueue | null {
  return globalParsingQueue;
}
