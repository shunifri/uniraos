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
import type { DocMindParser, DocMindLayout, DocMindSegment, ProgressCallback } from "./docmind-parser.js";
import { downloadFile, detectMediaType } from "./docmind-parser.js";
import type { KnowledgeBase } from "../skills/knowledge-skills.js";
import { mkdirSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";

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
  kbImagesDir: ".raos/kb_images",
};

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

  constructor(
    parser: DocMindParser,
    getKnowledgeBase: (owner: string) => KnowledgeBase,
    config?: Partial<ParsingQueueConfig>
  ) {
    super();
    this.parser = parser;
    this.getKnowledgeBase = getKnowledgeBase;
    this.config = { ...DEFAULT_CONFIG, ...config };
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
    kb.updateParsingStatus(docId, {
      parsingStatus: 'pending',
      parsingProgress: 0,
      mediaType,
    });

    // 尝试开始处理
    this.processNext();
    
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
      
      // 直接入库
      await kb.ingest(docName, content, {
        source: filePath,
        tags,
      });

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
    } catch (error) {
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
    if (this.processing.size >= this.config.maxConcurrent) {
      return;
    }

    // 找到 pending 状态的任务
    const pendingTask = Array.from(this.tasks.values()).find(t => t.status === 'pending');
    if (!pendingTask) {
      return;
    }

    this.processing.add(pendingTask.docId);
    pendingTask.status = 'processing';
    pendingTask.updatedAt = Date.now();

    // 更新数据库状态
    const kb = this.getKnowledgeBase(pendingTask.owner);
    kb.updateParsingStatus(pendingTask.docId, {
      parsingStatus: 'processing',
      parsingProgress: 0,
    });

    // 开始处理
    this.processTask(pendingTask).catch(error => {
      console.error(`[ParsingQueue] Task ${pendingTask.docId} failed:`, error);
      pendingTask.status = 'failed';
      pendingTask.error = error instanceof Error ? error.message : String(error);
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
      this.processNext();  // 继续处理下一个
    });
  }

  /**
   * 处理单个任务
   */
  private async processTask(task: ParsingTask): Promise<void> {
    const isVideoAudio = task.mediaType === 'video' || task.mediaType === 'audio';
    
    // 1. 提交 Document Mind 任务
    const submitResult = await this.parser.submitJob(
      task.filePath,
      task.docName,
      {
        llmEnhancement: true,
        enhancementMode: 'VLM',
        outputFormat: ['markdown', 'visualLayoutInfo'],
        option: isVideoAudio ? 'advance' : undefined,
      }
    );

    task.taskId = submitResult.taskId;
    
    // 更新数据库中的 taskId
    const kb = this.getKnowledgeBase(task.owner);
    kb.updateParsingStatus(task.docId, {
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
        kb.saveLayouts(task.docId, batch.layouts, true);
        
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
        kb.saveSegments(task.docId, batch.segments, true);
        
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

    // 更新数据库状态
    kb.updateParsingStatus(task.docId, {
      parsingStatus: 'success',
      parsingProgress: 100,
    });

    // 最终索引（如果没有启用增量索引）
    if (!this.config.enableIncrementalIndex) {
      if (allLayouts.length > 0) {
        await this.finalIndexLayouts(task, allLayouts);
      }
      if (allSegments.length > 0) {
        await this.finalIndexSegments(task, allSegments);
      }
    }

    this.emit('completed', task);
  }

  /**
   * 增量索引版面数据
   */
  private async incrementalIndexLayouts(
    task: ParsingTask,
    layouts: DocMindLayout[]
  ): Promise<void> {
    const kb = this.getKnowledgeBase(task.owner);
    
    // 将版面转换为 chunks
    const chunks = this.layoutsToChunks(layouts);
    
    // 向量化并入库
    const embeddingProvider = kb.getEmbeddingProvider();
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const [vector] = await embeddingProvider.embed([chunk.content]);
      
      // 这里需要访问私有方法，可能需要调整 KnowledgeBase 类
      // 简化处理：直接插入
      const row = kb['db'].prepare(
        `INSERT INTO kb_chunks 
         (doc_id, chunk_index, content, tokens, vector, page_number, bbox_data) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        task.docId,
        chunk.index,
        chunk.content,
        chunk.tokens,
        vector ? Buffer.from(new Float32Array(vector).buffer) : null,
        chunk.pageNumber,
        JSON.stringify(chunk.bboxes)
      );

      // 提取关键词
      const keywords = this.extractKeywords(chunk.content);
      for (const [keyword, tf] of keywords) {
        kb['db'].prepare(
          "INSERT OR REPLACE INTO kb_keywords (keyword, chunk_id, tf) VALUES (?, ?, ?)"
        ).run(keyword, row.lastInsertRowid, tf);
      }
    }

    // 更新文档 chunk 数量
    kb['db'].prepare(
      "UPDATE kb_documents SET chunk_count = chunk_count + ? WHERE doc_id = ?"
    ).run(chunks.length, task.docId);
  }

  /**
   * 增量索引音视频切片
   */
  private async incrementalIndexSegments(
    task: ParsingTask,
    segments: DocMindSegment[]
  ): Promise<void> {
    const kb = this.getKnowledgeBase(task.owner);
    
    for (const segment of segments) {
      // 合并可搜索文本
      const searchableText = this.combineSegmentText(segment);
      
      const [vector] = await kb.getEmbeddingProvider().embed([searchableText]);
      
      // 获取关键帧路径
      const frameUrl = this.getFramePath(task, segment.index);
      
      // 获取 ASR 文本
      const asrText = segment.audioFrames.map(f => f.asrInfo).join('\n');
      
      kb.insertMediaChunk(
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

    // 更新文档 chunk 数量
    kb['db'].prepare(
      "UPDATE kb_documents SET chunk_count = chunk_count + ? WHERE doc_id = ?"
    ).run(segments.length, task.docId);
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
    const content = layouts.map(l => l.markdownContent).join('\n');
    await kb.ingest(task.docName, content, {
      source: task.filePath,
      tags: task.tags,
    });
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
      const text = layout.markdownContent || layout.text;
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
      currentPage = layout.pageNum;
      
      // 转换 pos 到 bbox
      if (layout.pos && layout.pos.length >= 4) {
        const xs = layout.pos.map(p => p.x);
        const ys = layout.pos.map(p => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        currentBboxes.push({
          page: layout.pageNum,
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
   * 下载版面图片
   */
  private async downloadLayoutImages(
    task: ParsingTask,
    layouts: DocMindLayout[]
  ): Promise<void> {
    // Document Mind 不直接返回图片 URL，需要通过 visualLayoutInfo 获取
    // 这里预留接口，实际实现需要根据 API 返回调整
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
            downloadFile(frame.fileUrl, destPath).catch(err => {
              console.error(`[ParsingQueue] Failed to download frame: ${err.message}`);
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
        } catch (err) {
          console.error('[ParsingQueue] Subscriber error:', err);
        }
      }
    }
    
    // 同时 emit 事件
    this.emit('progress', update);
  }
}

/** 全局队列实例 */
let globalParsingQueue: ParsingQueue | null = null;

export function initParsingQueue(
  parser: DocMindParser,
  getKnowledgeBase: (owner: string) => KnowledgeBase,
  config?: Partial<ParsingQueueConfig>
): ParsingQueue {
  globalParsingQueue = new ParsingQueue(parser, getKnowledgeBase, config);
  return globalParsingQueue;
}

export function getParsingQueue(): ParsingQueue | null {
  return globalParsingQueue;
}
