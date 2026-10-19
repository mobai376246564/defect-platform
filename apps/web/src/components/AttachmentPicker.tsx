import { DeleteOutlined, InboxOutlined } from '@ant-design/icons';
import { attachmentKindOf } from '@defect/shared';
import { Button, InputNumber, List, Space, Tag, Typography, Upload } from 'antd';
import type { PendingFile } from '../api/upload';

const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm,.log,.txt,.zip,.gz,.json';
const MAX_BYTES = 200 * 1024 * 1024;

/** 选择要上传的截图 / 录屏 / 日志；录屏可标记“问题出现的时间点”（方案 7.3）。 */
export function AttachmentPicker({
  value,
  onChange,
}: {
  value: PendingFile[];
  onChange: (files: PendingFile[]) => void;
}) {
  return (
    <div>
      <Upload.Dragger
        multiple
        accept={ACCEPT}
        showUploadList={false}
        beforeUpload={(file, fileList) => {
          // 一次多选时只在第一个文件处理整批，避免重复追加
          if (file !== fileList[0]) return false;
          const ok = fileList.filter((f) => f.size <= MAX_BYTES);
          onChange([...value, ...ok.map((f) => ({ file: f as File }))].slice(0, 10));
          return false;
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽上传截图、录屏、日志</p>
        <p className="ant-upload-hint">
          单个文件不超过 200 MB，最多 10 个；录屏建议标记问题出现的时间点
        </p>
      </Upload.Dragger>
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
                  <Tag>
                    {kind === 'image'
                      ? '截图'
                      : kind === 'video'
                        ? '录屏'
                        : kind === 'log'
                          ? '日志'
                          : '文件'}
                  </Tag>
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
