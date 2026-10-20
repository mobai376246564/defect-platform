import {
  DownloadOutlined,
  FileTextOutlined,
  FileZipOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { useQueries } from '@tanstack/react-query';
import { Button, Empty, Image, Modal, Space, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { api } from '../api/client';
import type { Attachment } from '../api/types';

const KIND_LABEL: Record<string, string> = {
  image: '截图',
  video: '录屏',
  log: '日志',
  other: '文件',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 附件列表：每个附件一行（缩略图 / 图标、文件名、类型与大小），需要时再查看——
 * 截图点缩略图放大，录屏点“播放”在弹窗里播放并跳到标记的问题时间点，日志等直接下载。
 * 下载地址为 10 分钟有效的签名链接。
 */
export function AttachmentGallery({
  projectKey,
  attachments,
}: {
  projectKey: string;
  attachments: Attachment[];
}) {
  const [playing, setPlaying] = useState<{ attachment: Attachment; url: string } | null>(null);
  const urls = useQueries({
    queries: attachments.map((a) => ({
      queryKey: ['attachment-url', a.id],
      queryFn: () =>
        api<{ url: string; thumbUrl?: string }>(`/projects/${projectKey}/attachments/${a.id}/url`),
      staleTime: 8 * 60_000,
    })),
  });
  if (attachments.length === 0)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有附件" />;
  const urlOf = (i: number) => urls[i]?.data?.url;
  const thumbOf = (i: number) => urls[i]?.data?.thumbUrl ?? urlOf(i);

  return (
    <>
      <Image.PreviewGroup>
        <div className="attach-list">
          {attachments.map((a, i) => {
            const url = urlOf(i);
            const marked =
              a.kind === 'video' && a.markedAtMs != null
                ? `问题时间点 ${(a.markedAtMs / 1000).toFixed(1)} 秒`
                : null;
            return (
              <div key={a.id} className="attach-item">
                <div className="attach-thumb">
                  {a.kind === 'image' ? (
                    // 列表里显示服务端生成的小缩略图，点开预览时才加载原图
                    <Image
                      src={thumbOf(i)}
                      alt={a.fileName}
                      width={40}
                      height={40}
                      loading="lazy"
                      style={{ objectFit: 'cover' }}
                      preview={{ mask: '查看', src: url }}
                    />
                  ) : a.kind === 'video' ? (
                    <PlayCircleOutlined />
                  ) : /\.(zip|gz)$/i.test(a.fileName) ? (
                    <FileZipOutlined />
                  ) : (
                    <FileTextOutlined />
                  )}
                </div>
                <div className="attach-meta">
                  <Typography.Text ellipsis={{ tooltip: a.fileName }}>{a.fileName}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {KIND_LABEL[a.kind] ?? '文件'} · {formatSize(a.size)}
                    {marked ? ` · ${marked}` : ''}
                  </Typography.Text>
                </div>
                {a.kind === 'video' ? (
                  <Button
                    size="small"
                    type="text"
                    icon={<PlayCircleOutlined />}
                    disabled={!url}
                    onClick={() => url && setPlaying({ attachment: a, url })}
                  >
                    播放
                  </Button>
                ) : (
                  a.kind !== 'image' && (
                    <Tooltip title="下载">
                      <Button
                        size="small"
                        type="text"
                        icon={<DownloadOutlined />}
                        href={url}
                        target="_blank"
                        disabled={!url}
                        aria-label={`下载 ${a.fileName}`}
                      />
                    </Tooltip>
                  )
                )}
              </div>
            );
          })}
        </div>
      </Image.PreviewGroup>

      <Modal
        open={!!playing}
        title={playing?.attachment.fileName}
        footer={null}
        width={860}
        destroyOnHidden
        onCancel={() => setPlaying(null)}
      >
        {playing && (
          <Space direction="vertical" style={{ width: '100%' }}>
            {playing.attachment.markedAtMs != null && (
              <Typography.Text type="secondary">
                已跳到测试标记的问题时间点（{(playing.attachment.markedAtMs / 1000).toFixed(1)} 秒）
              </Typography.Text>
            )}
            <video
              controls
              autoPlay
              preload="metadata"
              src={
                playing.attachment.markedAtMs != null
                  ? `${playing.url}#t=${playing.attachment.markedAtMs / 1000}`
                  : playing.url
              }
              style={{ display: 'block', width: '100%', maxHeight: '70vh', background: '#000' }}
            />
          </Space>
        )}
      </Modal>
    </>
  );
}
