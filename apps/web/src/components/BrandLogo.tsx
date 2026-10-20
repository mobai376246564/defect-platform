/**
 * 平台标志：紫底上带两只小角的白色圆脑袋（public/logo.png，由设计原图按中心等比例裁成正方形）。
 * 顶栏、登录注册页共用；浏览器标签页图标是同一张图的 64px 圆角版（public/favicon.png）。
 */
export function BrandLogo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <img
      className={className}
      src="/logo.png"
      width={size}
      height={size}
      alt="缺陷管理平台"
      draggable={false}
      style={{ borderRadius: Math.round(size * 0.24) }}
    />
  );
}
