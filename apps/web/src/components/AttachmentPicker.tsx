import { DeleteOutlined, InboxOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { ATTACHMENT_EXTENSIONS, attachmentKindOf } from '@defect/shared';
import { App, Button, InputNumber, List, Popover, Space, Tag, Typography, Upload } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { PendingFile } from '../api/upload';
import { addFiles, namePasted } from './attachment-files';

const ACCEPT = ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(',');

/**
 * 选择要上传的截图 / 录屏 / 日志；录屏可标记“问题出现的时间点”（方案 7.3）。
 * variant=dragger（新建缺陷）：点击附件框，在框的下边缘弹出小窗，此时 Ctrl+V 粘贴剪贴板里的图片 / 文件，
 * 或“添加本地文件”；点小窗外面关闭。文件也可以直接拖到附件框上。
 * variant=button：一个小按钮（缺陷详情里补传，不占地方）。
 */
export function AttachmentPicker({
  value,
  onChange,
  variant = 'dragger',
}: {
  value: PendingFile[];
  onChange: (files: PendingFile[]) => void;
  variant?: 'dragger' | 'button';
}) {
  const { message } = App.useApp();
  const [picking, setPicking] = useState(false);
  const pasteZone = useRef<HTMLDivElement>(null);
  // 粘贴监听在小窗打开时注册一次，读最新的列表与回调
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  const add = (incoming: File[], how: string) => {
    const { files, rejected } = addFiles(latest.current.value, incoming);
    const added = files.length - latest.current.value.length;
    latest.current.onChange(files);
    if (rejected.length) message.warning(`以下文件没有加入：${rejected.join('、')}`);
    else if (how && added) message.success(`已${how} ${added} 个附件`);
    if (added) setPicking(false);
  };

  useEffect(() => {
    if (!picking) return;
    // 打开后把焦点放进小窗（等小窗挂载），Ctrl+V 不会落到别的输入框里
    const timer = setTimeout(() => pasteZone.current?.focus());
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.size > 0);
      if (!files.length) return;
      e.preventDefault();
      add(namePasted(files), '粘贴');
    };
    document.addEventListener('paste', onPaste);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('paste', onPaste);
    };
    // add 通过 ref 读最新的列表与回调，不需要随渲染重新注册
  }, [picking]);

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
  const picker = (
    <div className="attachment-pick">
      <Upload.Dragger {...props} openFileDialogOnClick={false} className="attachment-paste">
        <div ref={pasteZone} tabIndex={-1} className="attachment-paste-zone">
          粘贴或拖拽至这里上传
        </div>
      </Upload.Dragger>
      <Upload {...props}>
        <Button type="text" block icon={<PlusOutlined />}>
          添加本地文件
        </Button>
      </Upload>
    </div>
  );
  return (
    <div>
      {variant === 'button' ? (
        <Upload {...props}>
          <Button size="small" icon={<UploadOutlined />}>
            上传附件
          </Button>
        </Upload>
      ) : (
        <Popover
          trigger="click"
          placement="bottomLeft"
          arrow={false}
          open={picking}
          onOpenChange={setPicking}
          content={picker}
          styles={{ body: { padding: 8 } }}
        >
          <div>
            <Upload.Dragger {...props} openFileDialogOnClick={false} className="attachment-dragger">
              {/* 图标放在文字左边，拖拽框只占两行字的高度 */}
              <div className="attachment-drop">
                <InboxOutlined className="attachment-drop-icon" />
                <div>
                  <p className="ant-upload-text">点击后粘贴截图或添加本地文件，也可拖拽到这里</p>
                  <p className="ant-upload-hint">
                    单个文件不超过 200 MB，最多 10 个；录屏建议标记问题出现的时间点
                  </p>
                </div>
              </div>
            </Upload.Dragger>
          </div>
        </Popover>
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
