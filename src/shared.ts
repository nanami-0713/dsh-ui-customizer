/**
 * @dsh-external/dsh-ui-customizer — 共享配置模型（host 与 client 共用）。
 *
 * 配置不进入 DSH settings 白名单体系，而是由 host 半通过本地 HTTP API
 * 持久化到 ~/.dsh/plugins/dsh-ui-customizer/config.json。这里只放纯函数，
 * 不引用任何 DSH 运行时，保证两端都能安全打包。
 */

export const PLUGIN_ID = '@dsh-external/dsh-ui-customizer'

/** 本地配置 API（同源路径，由 host 半注册在 webserver 上）。 */
export const CONFIG_API_PATH = '/api/dsh-ui-customizer/config'

export const CONFIG_VERSION = 1

export type BackgroundMode = 'color' | 'gradient' | 'image'
export type ImageSize = 'cover' | 'contain' | 'auto'
export type ImageRepeat = 'no-repeat' | 'repeat'

export interface BackgroundColorConfig {
  light: string
  dark: string
}

export interface BackgroundGradientConfig {
  /** 渐变方向，单位 deg。 */
  angle: number
  lightStart: string
  lightEnd: string
  darkStart: string
  darkEnd: string
}

export interface BackgroundImageConfig {
  /** 图片 URL；支持 http(s)/相对路径/data URL，留空表示该模式下不显示图片。 */
  light: string
  dark: string
  size: ImageSize
  position: string
  repeat: ImageRepeat
  /** 背景模糊，0–40 px。 */
  blur: number
  /** 背景不透明度，0.05–1。 */
  opacity: number
}

export interface BackgroundConfig {
  mode: BackgroundMode
  color: BackgroundColorConfig
  gradient: BackgroundGradientConfig
  image: BackgroundImageConfig
  /** 让侧边栏底色透明，与背景融合。 */
  sidebarBlend: boolean
}

export interface FontConfig {
  /** 界面字体（覆盖 --dsw-font-family）；留空表示不覆盖。 */
  family: string
  /** 代码字体（覆盖 --ds-font-family-code）；留空表示不覆盖。 */
  codeFamily: string
}

export interface LayoutConfig {
  /** 是否启用本插件的布局宽度覆盖。 */
  enabled: boolean
  /** 侧边栏宽度 px（264–420）。 */
  sidebarWidth: number
  /** 详情栏宽度 px（300–520）。 */
  detailsWidth: number
}

export interface CustomizerConfig {
  version: number
  background: BackgroundConfig
  font: FontConfig
  layout: LayoutConfig
  /** 用户自定义 CSS，注入在插件基础样式之后。 */
  customCss: string
}

export const DEFAULT_CONFIG: CustomizerConfig = Object.freeze({
  version: CONFIG_VERSION,
  background: Object.freeze({
    mode: 'color' as const,
    color: Object.freeze({ light: '#FFFFFF', dark: '#151517' }),
    gradient: Object.freeze({
      angle: 135,
      lightStart: '#EEF2FF',
      lightEnd: '#DBEAFE',
      darkStart: '#1E293B',
      darkEnd: '#0F172A',
    }),
    image: Object.freeze({
      light: '',
      dark: '',
      size: 'cover' as const,
      position: 'center',
      repeat: 'no-repeat' as const,
      blur: 0,
      opacity: 1,
    }),
    sidebarBlend: false,
  }),
  font: Object.freeze({
    family: '',
    codeFamily: '',
  }),
  layout: Object.freeze({
    enabled: false,
    sidebarWidth: 280,
    detailsWidth: 360,
  }),
  customCss: '',
})

/** 一键主题预设：只覆盖背景与字体，布局和自定义 CSS 保持用户当前设置。 */
export interface ThemePreset {
  id: string
  name: string
  description: string
  background: Partial<BackgroundConfig> & { mode: BackgroundMode }
  font: Partial<FontConfig>
}

const SYSTEM_UI_FONT =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const PINGFANG_FONT =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif'
const SERIF_FONT =
  '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", Georgia, serif'
const JETBRAINS_CODE_FONT =
  "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'"

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'dsh-default',
    name: '默认 DSH',
    description: '回到 DSH 原生浅色 / 深色配色',
    background: { mode: 'color', color: { light: '#FFFFFF', dark: '#151517' }, sidebarBlend: false },
    font: { family: '', codeFamily: '' },
  },
  {
    id: 'deep-sea',
    name: '深海蓝调',
    description: '从浅蓝到深海的渐变，侧边栏融入背景',
    background: {
      mode: 'gradient',
      gradient: { angle: 150, lightStart: '#E0F2FE', lightEnd: '#BFDBFE', darkStart: '#0F172A', darkEnd: '#1E3A8A' },
      sidebarBlend: true,
    },
    font: { family: SYSTEM_UI_FONT },
  },
  {
    id: 'forest',
    name: '护眼森林',
    description: '低饱和绿色，长时间阅读更舒服',
    background: { mode: 'color', color: { light: '#F0FDF4', dark: '#0A1F14' }, sidebarBlend: false },
    font: { family: SYSTEM_UI_FONT },
  },
  {
    id: 'sakura',
    name: '樱花粉',
    description: '浅粉渐变，深色模式转为暗红粉',
    background: {
      mode: 'gradient',
      gradient: { angle: 135, lightStart: '#FFF1F2', lightEnd: '#FCE7F3', darkStart: '#2B0B1B', darkEnd: '#4A1030' },
      sidebarBlend: true,
    },
    font: { family: PINGFANG_FONT },
  },
  {
    id: 'paper',
    name: '纸张暖黄',
    description: '暖纸色 + 宋体系衬线字体',
    background: { mode: 'color', color: { light: '#FAF6EE', dark: '#1C1917' }, sidebarBlend: false },
    font: { family: SERIF_FONT },
  },
  {
    id: 'cyber',
    name: '赛博紫',
    description: '紫色渐变 + JetBrains Mono 代码字体',
    background: {
      mode: 'gradient',
      gradient: { angle: 140, lightStart: '#F5F3FF', lightEnd: '#EDE9FE', darkStart: '#1E1B4B', darkEnd: '#4C1D95' },
      sidebarBlend: true,
    },
    font: { family: SYSTEM_UI_FONT, codeFamily: JETBRAINS_CODE_FONT },
  },
  {
    id: 'midnight-oled',
    name: '午夜 OLED',
    description: '纯黑深色背景，浅色模式保持柔和灰白',
    background: { mode: 'color', color: { light: '#FAFAFA', dark: '#000000' }, sidebarBlend: false },
    font: { family: SYSTEM_UI_FONT },
  },
]

/** 把预设叠加到当前配置上：保留布局与自定义 CSS，只替换背景与字体。 */
export function applyThemePreset(current: CustomizerConfig, preset: ThemePreset): CustomizerConfig {
  return normalizeConfig({ ...current, background: preset.background, font: preset.font })
}

/** 背景 + 字体的稳定指纹，用于判断当前配置匹配哪个预设。 */
export function themeFingerprint(config: CustomizerConfig): string {
  return JSON.stringify({ background: config.background, font: config.font })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function stringValue(value: unknown, fallback: string, maxLength = 256): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, maxLength)
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  if (typeof value === 'string' && (options as readonly string[]).includes(value)) return value as T
  return fallback
}

export function normalizeConfig(input: unknown): CustomizerConfig {
  const root = isRecord(input) ? input : {}
  const background = isRecord(root.background) ? root.background : {}
  const color = isRecord(background.color) ? background.color : {}
  const gradient = isRecord(background.gradient) ? background.gradient : {}
  const image = isRecord(background.image) ? background.image : {}
  const font = isRecord(root.font) ? root.font : {}
  const layout = isRecord(root.layout) ? root.layout : {}

  return {
    version: CONFIG_VERSION,
    background: {
      mode: oneOf<BackgroundMode>(background.mode, ['color', 'gradient', 'image'], DEFAULT_CONFIG.background.mode),
      color: {
        light: stringValue(color.light, DEFAULT_CONFIG.background.color.light, 128),
        dark: stringValue(color.dark, DEFAULT_CONFIG.background.color.dark, 128),
      },
      gradient: {
        angle: Math.round(clampNumber(gradient.angle, 0, 360, DEFAULT_CONFIG.background.gradient.angle)),
        lightStart: stringValue(gradient.lightStart, DEFAULT_CONFIG.background.gradient.lightStart, 128),
        lightEnd: stringValue(gradient.lightEnd, DEFAULT_CONFIG.background.gradient.lightEnd, 128),
        darkStart: stringValue(gradient.darkStart, DEFAULT_CONFIG.background.gradient.darkStart, 128),
        darkEnd: stringValue(gradient.darkEnd, DEFAULT_CONFIG.background.gradient.darkEnd, 128),
      },
      image: {
        light: stringValue(image.light, '', 4096),
        dark: stringValue(image.dark, '', 4096),
        size: oneOf<ImageSize>(image.size, ['cover', 'contain', 'auto'], DEFAULT_CONFIG.background.image.size),
        position: stringValue(image.position, DEFAULT_CONFIG.background.image.position, 64),
        repeat: oneOf<ImageRepeat>(image.repeat, ['no-repeat', 'repeat'], DEFAULT_CONFIG.background.image.repeat),
        blur: clampNumber(image.blur, 0, 40, 0),
        opacity: clampNumber(image.opacity, 0.05, 1, 1),
      },
      sidebarBlend:
        typeof background.sidebarBlend === 'boolean' ? background.sidebarBlend : DEFAULT_CONFIG.background.sidebarBlend,
    },
    font: {
      family: stringValue(font.family, '', 512),
      codeFamily: stringValue(font.codeFamily, '', 512),
    },
    layout: {
      enabled: typeof layout.enabled === 'boolean' ? layout.enabled : DEFAULT_CONFIG.layout.enabled,
      sidebarWidth: Math.round(clampNumber(layout.sidebarWidth, 264, 420, DEFAULT_CONFIG.layout.sidebarWidth)),
      detailsWidth: Math.round(clampNumber(layout.detailsWidth, 300, 520, DEFAULT_CONFIG.layout.detailsWidth)),
    },
    customCss: typeof root.customCss === 'string' ? root.customCss.slice(0, 64 * 1024) : '',
  }
}

/** 把 CSS url() 里的引号与反斜杠安全转义。 */
export function cssUrl(url: string): string {
  return `url("${url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
}

/** 把非 #rrggbb 的值兜底成可被 <input type="color"> 接受的值。 */
export function safeHex(value: string, fallback = '#FFFFFF'): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}
