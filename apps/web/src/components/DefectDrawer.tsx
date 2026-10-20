import { ExportOutlined } from '@ant-design/icons';
import { Button, Drawer, Grid, Tooltip } from 'antd';
import { useEffect, useRef } from 'react';
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

/**
 * 点在这些元素里不关闭抽屉：抽屉本身、抽屉里弹出的下拉 / 弹窗 / 图片预览等（挂在 body 下），
 * 以及列表里用来打开缺陷的编号和标题（点它们是切换到另一个缺陷）。
 */
const KEEP_OPEN = [
  '.ant-drawer',
  '.ant-select-dropdown',
  '.ant-picker-dropdown',
  '.ant-dropdown',
  '.ant-popover',
  '.ant-tooltip',
  '.ant-modal-root',
  '.ant-modal-wrap',
  '.ant-message',
  '.ant-notification',
  '[class*="ant-image-preview"]',
  '.ant-mentions-dropdown',
  '[data-open-defect]',
].join(',');

/** 正在展开的弹出层：此时按 Esc 只收起它，不关闭抽屉 */
const POPUP_OPEN = [
  // 正在收起（带 -leave 动画类）的不算
  '.ant-select-dropdown:not(.ant-select-dropdown-hidden):not([class*="-leave"])',
  '.ant-mentions-dropdown:not(.ant-mentions-dropdown-hidden):not([class*="-leave"])',
  '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden):not([class*="-leave"])',
  '.ant-dropdown:not(.ant-dropdown-hidden):not([class*="-leave"])',
  '.ant-modal-wrap:not([style*="display: none"])',
  '.ant-image-preview-wrap',
].join(',');

export function DefectDrawer({ code, onClose }: { code?: string; onClose: () => void }) {
  const screens = Grid.useBreakpoint();
  const projectKey = code ? projectKeyOf(code) : '';

  // 没有遮罩，点抽屉外的地方（列表空白处等）自动关闭；字段修改都是即时保存的，评论草稿会保留
  // onClose 每次渲染都是新函数：放进 ref，全局监听只在抽屉打开 / 关闭时绑定一次
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!code) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (e.button !== 0 || !target?.isConnected || target.closest(KEEP_OPEN)) return;
      close.current();
    };
    // Esc 关闭抽屉；抽屉里有展开的下拉框、弹窗或图片预览时，Esc 只关它们
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector(POPUP_OPEN)) return;
      close.current();
    };
    // 捕获阶段：下拉选项点击后会立即从页面移除，冒泡阶段就判断不出它属于抽屉了；
    // Esc 也要在下拉框自己收起之前判断
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [code]);

  return (
    <Drawer
      open={!!code}
      onClose={onClose}
      keyboard={false}
      width={screens.xl ? '66.6%' : screens.md ? '85%' : '100%'}
      rootClassName="defect-drawer"
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
