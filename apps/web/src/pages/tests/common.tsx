import { TEST_RESULT } from '@defect/shared';
import { Tag } from 'antd';
import { errorMessage, tokenStore } from '../../api/client';
import type { TestResultKey } from '../../api/types';

/** 测试结果的颜色（列表进度、表格单元格共用） */
export const RESULT_COLOR: Record<TestResultKey, string> = {
  pending: 'default',
  passed: 'green',
  failed: 'red',
  doubtful: 'orange',
  blocked: 'magenta',
  na: 'default',
};

/** 汇总标签的显示顺序：先看问题，再看进度 */
const STATS_ORDER: TestResultKey[] = ['failed', 'doubtful', 'blocked', 'passed', 'na', 'pending'];

/** 各测试结果的条数，0 条的不显示 */
export function ResultStats({ stats }: { stats: Partial<Record<TestResultKey, number>> }) {
  return (
    <>
      {STATS_ORDER.filter((k) => stats[k]).map((k) => (
        <Tag key={k} color={RESULT_COLOR[k]} bordered={false}>
          {TEST_RESULT[k]} {stats[k]}
        </Tag>
      ))}
    </>
  );
}

const authHeader = (): Record<string, string> => {
  const token = tokenStore.get();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** 下载用例文件为 Excel（接口要登录，不能用普通链接，取回后在本地触发保存） */
export async function downloadSuiteExcel(projectKey: string, id: string, name: string) {
  const res = await fetch(`/api/v1/projects/${projectKey}/tests/suites/${id}/export`, {
    headers: authHeader(),
  });
  if (!res.ok) throw new Error(`下载失败（${res.status}）`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 上传团队格式的 .xlsx，导入为新的用例文件 */
export async function uploadSuiteExcel(projectKey: string, file: File) {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`/api/v1/projects/${projectKey}/tests/suites/import`, {
    method: 'POST',
    headers: authHeader(),
    body,
  });
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(errorMessage(data, `导入失败（${res.status}）`));
  return data as { id: string; name: string; total: number };
}
