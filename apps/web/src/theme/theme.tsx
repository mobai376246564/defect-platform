import { ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * 全站主题：偏工程工具的冷色调，深色为默认，可在顶栏切换浅色。
 * 原则：低饱和底色 + 单一蓝色强调色，细边框、小圆角，编号与数字用等宽字体，不用渐变和装饰性阴影。
 */
export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'defect.theme';

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";
const MONO_FONT =
  "'JetBrains Mono', 'SFMono-Regular', 'Cascadia Mono', Consolas, 'Liberation Mono', Menlo, monospace";

/** 两种模式共用的外框颜色：顶栏始终是深色，保持工具感 */
/** 顶栏高度；与 global.css 里的 --header-h 保持一致 */
export const HEADER_H = 64;

export const CHROME = {
  headerBg: '#0b0f17',
  headerBorder: '#1f2733',
  headerText: '#c9d1d9',
  headerTextStrong: '#f0f6fc',
  accent: '#3b82f6',
};

const PALETTE = {
  dark: {
    layout: '#0d1117',
    container: '#141a22',
    elevated: '#1a212b',
    border: '#2a3340',
    borderSecondary: '#202833',
    text: '#e6edf3',
    textSecondary: '#8b98a7',
    primary: '#3b82f6',
    rowHover: '#18202a',
    headerCell: '#11171f',
    siderBg: '#0f141b',
  },
  light: {
    layout: '#f3f5f8',
    container: '#ffffff',
    elevated: '#ffffff',
    border: '#d9dee6',
    borderSecondary: '#e7eaf0',
    text: '#1b2430',
    textSecondary: '#5b6878',
    primary: '#2563eb',
    rowHover: '#f5f8fc',
    headerCell: '#f7f9fb',
    siderBg: '#ffffff',
  },
};

export function themeConfig(mode: ThemeMode): ThemeConfig {
  const p = PALETTE[mode];
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: p.primary,
      colorInfo: p.primary,
      colorSuccess: mode === 'dark' ? '#3fb950' : '#1a7f37',
      colorWarning: mode === 'dark' ? '#d29922' : '#bf8700',
      colorError: mode === 'dark' ? '#f85149' : '#cf222e',
      colorBgLayout: p.layout,
      colorBgContainer: p.container,
      colorBgElevated: p.elevated,
      colorBorder: p.border,
      colorBorderSecondary: p.borderSecondary,
      colorText: p.text,
      colorTextSecondary: p.textSecondary,
      fontFamily: FONT,
      fontFamilyCode: MONO_FONT,
      fontSize: 14,
      borderRadius: 4,
      borderRadiusLG: 6,
      borderRadiusSM: 3,
      controlHeight: 32,
      boxShadow: 'none',
      boxShadowSecondary:
        mode === 'dark' ? '0 8px 24px rgba(1, 4, 9, 0.6)' : '0 8px 24px rgba(27, 36, 48, 0.12)',
      wireframe: false,
    },
    components: {
      Layout: {
        headerBg: CHROME.headerBg,
        headerHeight: HEADER_H,
        headerPadding: '0 20px',
        siderBg: p.siderBg,
        bodyBg: p.layout,
      },
      Menu: {
        itemBg: 'transparent',
        itemBorderRadius: 4,
        itemHeight: 36,
        itemMarginInline: 8,
        activeBarBorderWidth: 0,
        itemSelectedBg: mode === 'dark' ? 'rgba(59, 130, 246, 0.16)' : 'rgba(37, 99, 235, 0.08)',
        itemSelectedColor: p.primary,
      },
      Table: {
        headerBg: p.headerCell,
        headerColor: p.textSecondary,
        headerSplitColor: 'transparent',
        rowHoverBg: p.rowHover,
        cellPaddingBlock: 10,
        cellPaddingBlockSM: 6,
        borderColor: p.borderSecondary,
      },
      Card: {
        headerFontSize: 15,
        headerHeight: 48,
        paddingLG: 20,
      },
      Tabs: { horizontalItemGutter: 24, titleFontSizeSM: 13 },
      Tag: { defaultBg: mode === 'dark' ? '#1f2732' : '#f0f3f7' },
      Statistic: { contentFontSize: 26 },
      Modal: { titleFontSize: 15 },
      Collapse: { headerBg: p.headerCell, contentBg: p.container },
    },
  };
}

interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState>({ mode: 'dark', toggle: () => undefined });

export const useThemeMode = () => useContext(ThemeContext);

function readMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // 隐私模式下 localStorage 不可用，使用默认深色
  }
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 忽略：只是记住偏好
    }
  }, [mode]);
  const state = useMemo(
    () => ({ mode, toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')) }),
    [mode],
  );
  return (
    <ThemeContext.Provider value={state}>
      <ConfigProvider locale={zhCN} theme={themeConfig(mode)}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
