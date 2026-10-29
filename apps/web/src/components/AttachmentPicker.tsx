import { DeleteOutlined, InboxOutlined, UploadOutlined } from '@ant-design/icons';
import { ATTACHMENT_EXTENSIONS, attachmentKindOf } from '@defect/shared';
import { App, Button, InputNumber, List, Space, Tag, Typography, Upload } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { PendingFile } from '../api/upload';
import { addFiles, namePasted } from './attachment-files';

const ACCEPT = ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(',');

/**
 * 选择要上传的截图 / 录屏 / 日志；录屏可标记“问题出现的时间点”（方案 7.3）。
 * variant=dragger：大拖拽框（新建缺陷）；button：一个小按钮（缺陷详情里补传，不占地方）。
 * paste=true 时监听整个页面的 Ctrl+V：剪贴板里的图片（截图工具、浏览器“复制图片”）或复制的文件加入附件；
 * 光标在输入框里且剪贴板带文字时照常粘贴文字。
 */
export function AttachmentPicker({
  value,
  onChange,
  variant = 'dragger',
  paste = false,
}: {
  value: PendingFile[];
  onChange: (files: PendingFile[]) => void;
  variant?: 'dragger' | 'button';
  paste?: boolean;
}) {
  const { message } = App.useApp();
  // 粘贴监听只注册一次，读最新的列表与回调
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  const add = (incoming: File[], how: string) => {
    const { files, rejected } = addFiles(latest.current.value, incoming);
    const added = files.length - latest.current.value.length;
    latest.current.onChange(files);
    if (rejected.length) message.warning(`以下文件没有加入：${rejected.join('、')}`);
    else if (how && added) message.success(`已${how} ${added} 个附件`);
  };

  useEffect(() => {
    if (!paste) return;
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      const files = [...(data?.files ?? [])].filter((f) => f.size > 0);
      if (!files.length) return;
      const target = e.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, [contenteditable="true"]');
      if (typing && data?.getData('text/plain')) return;
      e.preventDefault();
      add(namePasted(files), '粘贴');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // add 通过 ref 读最新的列表与回调，不需要随渲染重新注册
  }, [paste]);

  const props = {
    multiple: true,
    accept: ACCEPT,
    showUploadList: false,
    beforeUpload: (file: File, fileList: File[]) => {
      // 一次多选时只在第一个文件处理整批，避免重复追加
      if (file === fileList[0]) add(fileList, '');
      return false;
    },
  };
  return (
    <div>
      {variant === 'button' ? (
        <Upload {...props}>
          <Button size="small" icon={<UploadOutlined />}>
            上传附件
          </Button>
        </Upload>
      ) : (
        <Upload.Dragger {...props} className="attachment-dragger">
          {/* 图标放在文字左边，拖拽框只占两行字的高度 */}
          <div className="attachment-drop">
            <InboxOutlined className="attachment-drop-icon" />
            <div>
              <p className="ant-upload-text">
                点击、拖拽{paste ? '或 Ctrl+V 粘贴' : ''}上传截图、录屏、日志
              </p>
              <p className="ant-upload-hint">
                单个文件不超过 200 MB，最多 10 个；录屏建议标记问题出现的时间点
              </p>
            </div>
          </div>
        </Upload.Dragger>
      )}
      {value.length > 0 && (
        <List
          size="small"
          style={{ marginTop: 8 }}
          dataSource={value}
          renderItem={(item, index) => {
            const kind = attachmentKindOf(item.file.name);
            return (
              <List.Item
                actions={[
                  <Button
                    key="remove"
                    type="text"
                    icon={<DeleteOutlined />}
                    aria-label={`移除 ${item.file.name}`}
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                  />,
                ]}
              >
                <Space wrap>
                  {kind === 'image' ? (
                    <ImageThumb file={item.file} />
                  ) : (
                    <Tag>{kind === 'video' ? '录屏' : kind === 'log' ? '日志' : '文件'}</Tag>
                  )}
                  <Typography.Text>{item.file.name}</Typography.Text>
                  <Typography.Text type="secondary">
                    {(item.file.size / 1024 / 1024).toFixed(2)} MB
                  </Typography.Text>
                  {kind === 'video' && (
                    <Space size={4}>
                      <Typography.Text type="secondary">问题时间点</Typography.Text>
                      <InputNumber
                        size="small"
                        min={0}
                        step={0.5}
                        addonAfter="秒"
                        style={{ width: 120 }}
                        value={item.markedAtMs != null ? item.markedAtMs / 1000 : null}
                        onChange={(sec) =>
                          onChange(
                            value.map((v, i) =>
                              i === index
                                ? {
                                    ...v,
                                    markedAtMs: sec == null ? undefined : Math.round(sec * 1000),
                                  }
                                : v,
                            ),
                          )
                        }
                      />
                    </Space>
                  )}
                </Space>
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );
}

/** 待上传图片的小预览，粘贴后一眼能看出贴进来的是哪张 */
function ImageThumb({ file }: { file: File }) {
  // 地址在 effect 里创建、卸载时释放（开发模式下 effect 会先执行一次清理，不能复用已释放的地址）
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <img className="attachment-thumb" src={url} alt={file.name} /> : null;
}
