import { DETAIL_FIELDS, DETAIL_FIELD_KEYS, type DetailField } from '@defect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Checkbox, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { qk } from '../../api/hooks';
import type { ProjectDetail } from '../../api/types';

const GROUPS: { area: 'main' | 'attr' | 'side'; title: string }[] = [
  { area: 'main', title: '正文' },
  { area: 'attr', title: '属性' },
  { area: 'side', title: '侧栏卡片' },
];

/**
 * 字段显示：管理员勾选缺陷详情页（以及新建表单）显示哪些字段，保存后所有人生效。
 * 只影响网页展示，接口与 Claude Code（MCP）仍能拿到完整信息。
 */
export function FieldSettings({
  project,
  editable,
}: {
  project: ProjectDetail;
  editable: boolean;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [hidden, setHidden] = useState<string[]>(project.hiddenFields);
  useEffect(() => setHidden(project.hiddenFields), [project.hiddenFields]);
  const dirty = [...hidden].sort().join() !== [...project.hiddenFields].sort().join();

  const save = useMutation({
    mutationFn: () =>
      api(`/projects/${project.key}`, { method: 'PATCH', body: { hiddenFields: hidden } }),
    onSuccess: () => {
      message.success('字段显示已保存');
      void qc.invalidateQueries({ queryKey: qk.project(project.key) });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const toggle = (f: DetailField, visible: boolean) =>
    setHidden((h) => (visible ? h.filter((x) => x !== f) : [...h, f]));

  return (
    <Card
      title="字段显示"
      extra={
        <Typography.Text type="secondary">
          勾选的字段在缺陷详情和新建缺陷中显示；标题、状态、评论始终显示
        </Typography.Text>
      }
    >
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        {GROUPS.map((g) => (
          <div key={g.area}>
            <div className="section-label">{g.title}</div>
            <div className="field-grid">
              {DETAIL_FIELD_KEYS.filter((f) => DETAIL_FIELDS[f].area === g.area).map((f) => {
                const def: { label: string; hint?: string } = DETAIL_FIELDS[f];
                return (
                  <Checkbox
                    key={f}
                    disabled={!editable}
                    checked={!hidden.includes(f)}
                    onChange={(e) => toggle(f, e.target.checked)}
                  >
                    {def.label}
                    {def.hint && (
                      <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                        {def.hint}
                      </Typography.Text>
                    )}
                  </Checkbox>
                );
              })}
            </div>
          </div>
        ))}
        {editable && (
          <Space>
            <Button
              type="primary"
              disabled={!dirty}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              保存
            </Button>
            <Button disabled={!dirty} onClick={() => setHidden(project.hiddenFields)}>
              撤销修改
            </Button>
            <Button type="link" disabled={hidden.length === 0} onClick={() => setHidden([])}>
              全部显示
            </Button>
          </Space>
        )}
      </Space>
    </Card>
  );
}
