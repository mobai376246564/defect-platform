/**
 * 复制文字到剪贴板，返回是否成功。
 * 浏览器只在 https 或 localhost 下开放 navigator.clipboard；内网用 http://IP:端口 访问时它不存在，
 * 这时退回到“临时文本框 + execCommand('copy')”的老办法，http 下也能复制。
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒等情况，继续走下面的兼容方式
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  // 放在当前获得焦点的元素旁边：在抽屉、弹窗里点复制时，焦点不会被移出它们
  const host = document.activeElement?.parentElement ?? document.body;
  const previous = document.activeElement as HTMLElement | null;
  host.appendChild(el);
  try {
    el.focus();
    el.select();
    el.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    el.remove();
    previous?.focus?.();
  }
}
