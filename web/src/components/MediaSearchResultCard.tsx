import React, { useMemo } from 'react';
import { Card, Tag, Typography, Space, Flex } from 'antd';
import {
  VideoCameraOutlined,
  AudioOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { videoFrameUrl } from '@/api';

const { Text } = Typography;

export interface MediaSearchResultCardProps {
  docId: string;
  docName: string;
  mediaType: 'video' | 'audio';
  frameUrl?: string | null;
  timeRange: { start: number; end: number };
  asrText?: string | null;
  content: string;
  score: number;
  query?: string;
  onTimeClick?: (time: number) => void;
  onDocClick?: (docId: string, docName: string) => void;
}

/**
 * 格式化时间戳为 mm:ss 或 hh:mm:ss
 */
function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 高亮文本中的匹配关键词
 */
function highlightText(text: string, query?: string): React.ReactNode {
  if (!query || !text) return text;
  
  const keywords = query.split(/\s+/).filter(k => k.length > 1);
  if (keywords.length === 0) return text;
  
  // 构建正则表达式，匹配任意关键词
  const pattern = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    if (keywords.some(k => part.toLowerCase() === k.toLowerCase())) {
      return <mark key={i} style={{ background: '#ffe58f', padding: '0 2px', borderRadius: 2 }}>{part}</mark>;
    }
    return part;
  });
}

export const MediaSearchResultCard: React.FC<MediaSearchResultCardProps> = ({
  docId,
  docName,
  mediaType,
  frameUrl,
  timeRange,
  asrText,
  content,
  score,
  query,
  onTimeClick,
  onDocClick,
}) => {
  const isVideo = mediaType === 'video';
  
  // 生成视频帧图片完整 URL
  const frameImageUrl = useMemo(() => {
    if (!frameUrl) return null;
    // 如果 frameUrl 已经是完整 URL，直接返回
    if (frameUrl.startsWith('http') || frameUrl.startsWith('/')) {
      return frameUrl;
    }
    // 否则使用 api 工具函数生成
    return videoFrameUrl(docId, frameUrl);
  }, [docId, frameUrl]);
  
  // 显示的文本内容：优先使用 ASR 文本，否则使用 content
  const displayText = asrText || content;
  
  // 截断文本到合适长度
  const truncatedText = displayText.length > 150 
    ? displayText.slice(0, 150) + '...' 
    : displayText;

  return (
    <Card
      size="small"
      className="glass-card media-search-result"
      style={{ 
        marginBottom: 8,
        transition: 'all 0.2s',
      }}
      styles={{
        body: { padding: 12 }
      }}
    >
      {/* 顶部：文档名称 + 媒体类型标签 + 分数 */}
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <Flex align="center" gap={8}>
          <Text
            strong
            style={{ 
              fontSize: 13, 
              cursor: onDocClick ? 'pointer' : 'default', 
              color: onDocClick ? '#1677ff' : undefined 
            }}
            onClick={() => onDocClick?.(docId, docName)}
          >
            {isVideo ? <VideoCameraOutlined style={{ marginRight: 6 }} /> : <AudioOutlined style={{ marginRight: 6 }} />}
            {docName}
          </Text>
          <Tag color={isVideo ? 'blue' : 'purple'}>
            {isVideo ? '视频' : '音频'}
          </Tag>
        </Flex>
        <Tag color="green">{(score * 100).toFixed(0)}%</Tag>
      </Flex>

      {/* 主体内容区 */}
      <Flex gap={12}>
        {/* 左侧：媒体缩略图/图标 */}
        <div
          style={{
            width: 120,
            height: 68,
            borderRadius: 6,
            overflow: 'hidden',
            background: '#f0f0f0',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {isVideo && frameImageUrl ? (
            <img
              src={frameImageUrl}
              alt="视频帧"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                color: '#bfbfbf',
              }}
            >
              {isVideo ? (
                <VideoCameraOutlined style={{ fontSize: 28 }} />
              ) : (
                <AudioOutlined style={{ fontSize: 28 }} />
              )}
            </div>
          )}
          
          {/* 播放按钮遮罩 */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.2)',
              opacity: 0,
              transition: 'opacity 0.2s',
              cursor: 'pointer',
            }}
            className="play-overlay"
            onClick={() => onTimeClick?.(timeRange.start)}
          >
            <PlayCircleOutlined style={{ fontSize: 32, color: '#fff' }} />
          </div>
        </div>

        {/* 右侧：时间戳 + 文本 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 时间戳标签 */}
          <Space size={4} style={{ marginBottom: 6 }}>
            <Tag
              color="orange"
              style={{ cursor: onTimeClick ? 'pointer' : 'default' }}
              onClick={() => onTimeClick?.(timeRange.start)}
            >
              {formatTime(timeRange.start)} - {formatTime(timeRange.end)}
            </Tag>
          </Space>
          
          {/* ASR/匹配文本 */}
          <Text
            type="secondary"
            style={{
              fontSize: 12,
              display: 'block',
              lineHeight: 1.6,
            }}
          >
            {highlightText(truncatedText, query)}
          </Text>
        </div>
      </Flex>
    </Card>
  );
};

export default MediaSearchResultCard;
