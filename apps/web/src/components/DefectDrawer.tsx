import { ExportOutlined } from '@ant-design/icons';
import { Button, Drawer, Grid, Tooltip } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { DefectPanel } from '../pages/defects/DefectDetailPage';

const PARAM = 'defect';

/** 缺陷编号形如 APP-12，项目 key 是最后一个“-”之前的部分 */
export const projectKeyOf = (code: string) => code.slice(0, code.lastIndexOf('-'));

/**
 * 列表右侧的半屏缺陷详情：打开的缺陷记在地址参数 defect 里，
 * 列表本身不卸载，关闭后筛选、分页和滚动位置都还在；浏览器后退也会关闭抽屉。
 */
export function useDefectDrawer() {
  const [params, setParams] = useSearchParams();
  const code = params.get(PARAM) ?? undefined;
  const open = (next: string) => {
    if (next === code) return;
    const p = new URLSearchParams(params);
    p.set(PARAM, next);
    setParams(p);
  };
  const close = () => {
    const p = new URLSearchParams(params);
    p.delete(PARAM);
    setParams(p);
  };
  return { code, open, close };
}

export function DefectDrawer({ code, onClose }: { code?: string; onClose: () => void }) {
  const screens = Grid.useBreakpoint();
  const projectKey = code ? projectKeyOf(code) : '';
  return (
    <Drawer
      open={!!code}
      onClose={onClose}
      width={screens.xl ? '50%' : screens.md ? '75%' : '100%'}
      destroyOnHidden
      // 不加遮罩：抽屉开着时仍可点列表里的其他缺陷直接切换
      mask={false}
      title={<span className="mono">{code}</span>}
      extra={
        code && (
          <Tooltip title="在新标签页打开完整页面">
            <Button
              type="text"
              size="small"
              icon={<ExportOutlined />}
              aria-label="新标签页打开"
              href={`/p/${projectKey}/bugs/${code}`}
              target="_blank"
            />
          </Tooltip>
        )
      }
      styles={{ header: { padding: '10px 20px' }, body: { padding: 0 } }}
    >
      {code && <DefectPanel key={code} projectKey={projectKey} code={code} inDrawer />}
    </Drawer>
  );
}
