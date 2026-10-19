import { DownloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { useQueries } from '@tanstack/react-query';
import { Button, Empty, Image, Space, Typography } from 'antd';
import { api } from '../api/client';
import type { Attachment } from '../api/types';

/** 附件预览：截图可放大，录屏可播放，日志等提供下载。下载地址为 10 分钟有效的签名链接。 */
export function AttachmentGallery({
  projectKey,
  attachments,
}: {
  projectKey: string;
  attachments: Attachment[];
}) {
  const urls = useQueries({
    queries: attachments.map((a) => ({
      queryKey: ['attachment-url', a.id],
      queryFn: () => api<{ url: string }>(`/projects/${projectKey}/attachments/${a.id}/url`),
      staleTime: 8 * 60_000,
    })),
  });
  if (attachments.length === 0)
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有附件" />;
  const urlOf = (i: number) => urls[i]?.data?.url;

  const images = attachments.map((a, i) => ({ a, i })).filter(({ a }) => a.kind === 'image');
  const videos = attachments.map((a, i) => ({ a, i })).filter(({ a }) => a.kind === 'video');
  const others = attachments
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.kind !== 'image' && a.kind !== 'video');

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {images.length > 0 && (
        <Image.PreviewGroup>
          <Space wrap>
            {images.map(({ a, i }) => (
              <Image
                key={a.id}
                src={urlOf(i)}
                alt={a.fileName}
                width={160}
                height={110}
                style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #f0f0f0' }}
              />
            ))}
          </Space>
        </Image.PreviewGroup>
      )}
      {videos.map(({ a, i }) => (
        <div key={a.id}>
          <Typography.Text type="secondary">
            {a.fileName}
            {a.markedAtMs != null && `（问题时间点 ${(a.markedAtMs / 1000).toFixed(1)} 秒）`}
          </Typography.Text>
          {urlOf(i) && (
            <video
              controls
              preload="metadata"
              src={a.markedAtMs != null ? `${urlOf(i)}#t=${a.markedAtMs / 1000}` : urlOf(i)}
              style={{
                display: 'block',
                width: '100%',
                maxWidth: 560,
                marginTop: 4,
                borderRadius: 6,
                background: '#000',
              }}
            />
          )}
        </div>
      ))}
      {others.map(({ a, i }) => (
        <Space key={a.id}>
          <FileTextOutlined />
          <Typography.Text>{a.fileName}</Typography.Text>
          <Typography.Text type="secondary">{(a.size / 1024).toFixed(1)} KB</Typography.Text>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            href={urlOf(i)}
            target="_blank"
            disabled={!urlOf(i)}
          >
            下载
          </Button>
        </Space>
      ))}
    </Space>
  );
}
