/**
 * @dsh-external/dsh-ui-customizer — client half。
 *
 * 在左下角「设置」弹窗中注册 settings.section：「自定义背景」。
 * 页面包含四个页签：
 *   - 背景：纯色 / 渐变 / 图片（浅色与深色模式分别取值）
 *   - 字体：界面字体、代码字体
 *   - 布局：侧边栏 / 详情栏宽度覆盖
 *   - 高级 CSS：直接注入自定义样式
 *
 * 实时生效方式：
 *   - 颜色 / 字体走官方 ctx.theme.overrideTokens（--dsw-* token）
 *   - 图片 / 渐变走 body 底部的独立背景层（z-index:-1）
 *   - 布局宽度通过 :has() 选择器覆盖 AppFrame 的 grid-template-columns，
 *     拖动分隔条期间自动让位（[data-dragging]），松手后恢复配置值
 *   - 自定义 CSS 原样注入插件样式表
 *
 * 持久化由 host half 的同源 HTTP API 负责。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import {
  CONFIG_API_PATH,
  DEFAULT_CONFIG,
  IMAGE_API_PATH,
  MAX_IMAGE_BYTES,
  PLUGIN_ID,
  THEME_PRESETS,
  applyThemePreset,
  cssUrl,
  normalizeConfig,
  safeHex,
  themeFingerprint,
  type BackgroundConfig,
  type BackgroundGradientConfig,
  type BackgroundImageConfig,
  type CustomizerConfig,
  type FontConfig,
  type LayoutConfig,
} from '../shared'

/* ─────────────────────────── 配置读写 store ─────────────────────────── */

type StoreStatus = 'loading' | 'ready' | 'saving' | 'error'

interface StoreState {
  status: StoreStatus
  config: CustomizerConfig
  error?: string
}

class ConfigStore {
  private state: StoreState = { status: 'loading', config: DEFAULT_CONFIG }
  private listeners = new Set<() => void>()
  private tail: Promise<void> = Promise.resolve()

  getSnapshot = (): StoreState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setState(patch: Partial<StoreState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** 立即把草稿推给全局实时应用层（不等待网络）。 */
  preview(config: CustomizerConfig): void {
    this.setState({ config })
  }

  async load(): Promise<void> {
    try {
      const response = await fetch(CONFIG_API_PATH, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const config = normalizeConfig((await response.json()) as unknown)
      this.setState({ status: 'ready', config })
    } catch (error) {
      this.setState({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        config: normalizeConfig(DEFAULT_CONFIG),
      })
    }
  }

  save(config: CustomizerConfig): Promise<void> {
    this.setState({ status: 'saving', config })
    const task = this.tail
      .catch(() => undefined)
      .then(async () => {
        try {
          const response = await fetch(CONFIG_API_PATH, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(config),
          })
          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { message?: string } | null
            throw new Error(payload?.message ?? `HTTP ${response.status}`)
          }
          const saved = normalizeConfig((await response.json()) as unknown)
          this.setState({ status: 'ready', config: saved })
        } catch (error) {
          this.setState({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    this.tail = task
    return task
  }
}

/** 把本地图片文件上传到 host，返回同源 URL。 */
async function uploadLocalImage(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
  }
  const response = await fetch(IMAGE_API_PATH, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: await file.arrayBuffer(),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? `上传失败（HTTP ${response.status}）`)
  }
  const payload = (await response.json()) as { url?: string }
  if (!payload.url) throw new Error('上传响应缺少图片地址')
  return payload.url
}

/* ─────────────────────────── 全局注入样式 ─────────────────────────── */

const BASE_CSS = `
#duic-bg-layer{position:fixed;inset:0;z-index:-1;pointer-events:none;background-repeat:no-repeat;background-attachment:fixed;transition:background-color .25s var(--ds-ease-in-out)}
body.duic-layout-on div:has(> [data-shell-overlay="true"]):not([data-dragging]){grid-template-columns:var(--duic-sidebar,280px) minmax(0,1fr) var(--duic-details,0px)!important}
body.duic-layout-on div:has(> [data-shell-overlay="true"]):not([data-dragging]) > div[data-side="sidebar"]{left:var(--duic-sidebar,280px)!important}
body.duic-layout-on div:has(> [data-shell-overlay="true"]):not([data-dragging]) > div[data-side="details"]{left:calc(100% - var(--duic-details,0px))!important}
.duic-root{display:flex;flex-direction:column;gap:14px;max-width:660px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.duic-muted{color:var(--dsw-alias-label-secondary);font-size:12px}
.duic-error{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-secondary);background:var(--dsw-alias-state-error-tertiary);color:var(--dsw-alias-state-error-primary);font-size:12px}
.duic-btn{font:inherit;font-size:12px;line-height:18px;padding:5px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);cursor:pointer}
.duic-btn:hover{background:var(--dsw-alias-button-floating-hover)}
.duic-btn.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.duic-btn.primary:hover{background:var(--dsw-alias-button-primary-hover)}
.duic-btn.danger{color:var(--dsw-alias-state-error-primary)}
.duic-tabs{display:flex;gap:6px;flex-wrap:wrap}
.duic-tab{font:inherit;font-size:13px;padding:7px 14px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
.duic-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.duic-tab.active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active);border-color:var(--dsw-alias-border-l3)}
.duic-card{display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.duic-card h3{margin:0;font-size:13px;font-weight:600}
.duic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.duic-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.duic-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.duic-input{width:100%;box-sizing:border-box;font:inherit;font-size:12px;line-height:18px;padding:6px 9px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);outline:none}
.duic-input:focus{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color)}
.duic-select{width:100%;box-sizing:border-box;font:inherit;font-size:12px;line-height:18px;padding:6px 9px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);outline:none}
.duic-textarea{width:100%;box-sizing:border-box;font-family:var(--ds-font-family-code);font-size:12px;line-height:17px;padding:10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);resize:vertical;min-height:160px;outline:none}
.duic-check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}
.duic-check input{accent-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color)}
.duic-color-row{display:flex;align-items:center;gap:8px}
.duic-upload-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.duic-upload-error{color:var(--dsw-alias-state-error-primary);font-size:11px}
.duic-upload-ok{color:var(--dsw-alias-state-success-primary);font-size:11px}
.duic-color{width:36px;height:28px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-input-major);cursor:pointer}
.duic-range{width:100%;accent-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color)}
.duic-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.duic-value{min-width:56px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.duic-seg{display:flex;gap:0;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;overflow:hidden;width:fit-content}
.duic-seg button{font:inherit;font-size:12px;padding:7px 14px;border:none;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
.duic-seg button.active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.duic-preview{position:relative;height:150px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);overflow:hidden}
.duic-preview-sidebar{position:absolute;left:0;top:0;bottom:0;width:26%;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill)}
.duic-preview-center{position:absolute;inset:0;display:grid;place-items:center;font-size:12px;color:var(--dsw-alias-label-primary);background:transparent}
.duic-preview-tag{position:absolute;right:8px;top:8px;font-size:10px;padding:2px 8px;border-radius:99px;background:var(--dsw-alias-bg-mask-2);color:var(--dsw-alias-label-primary-foreground)}
.duic-status{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.duic-presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.duic-preset{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);cursor:pointer;text-align:left;font:inherit;color:inherit}
.duic-preset:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.duic-preset.active{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary-new-colorprimary-new-color) inset}
.duic-preset-preview{height:52px;border-radius:10px;overflow:hidden;display:flex;border:1px solid var(--dsw-alias-border-l2)}
.duic-preset-preview span{flex:1;display:block}
.duic-preset-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.duic-preset-desc{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary)}
@media (max-width:640px){.duic-grid{grid-template-columns:1fr}.duic-presets{grid-template-columns:1fr}}
`

/* ─────────────────────────── 小控件 ─────────────────────────── */

function ColorField(props: {
  label: string
  value: string
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <div className="duic-field">
      <span className="duic-label">{props.label}</span>
      <div className="duic-color-row">
        <input
          type="color"
          className="duic-color"
          value={safeHex(props.value)}
          onChange={(event) => props.onChange(event.target.value)}
          aria-label={props.label}
        />
        <input
          type="text"
          className="duic-input"
          value={props.value}
          spellCheck={false}
          onChange={(event) => props.onChange(event.target.value)}
        />
      </div>
    </div>
  )
}

function ImageUrlField(props: {
  label: string
  value: string
  onChange: (value: string) => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const pick = (): void => {
    inputRef.current?.click()
  }

  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    setOk(false)
    try {
      const url = await uploadLocalImage(file)
      props.onChange(url)
      setOk(true)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="duic-field">
      <span className="duic-label">{props.label}</span>
      <div className="duic-upload-row">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={(event) => {
            void onFile(event)
          }}
        />
        <button type="button" className="duic-btn" onClick={pick} disabled={busy}>
          {busy ? '上传中…' : '上传本地图片'}
        </button>
        {props.value && (
          <button type="button" className="duic-btn" onClick={() => props.onChange('')}>
            清除
          </button>
        )}
      </div>
      <input
        type="text"
        className="duic-input"
        placeholder="上传后自动填入；也可以直接粘贴图片 URL"
        value={props.value}
        spellCheck={false}
        onChange={(event) => {
          props.onChange(event.target.value)
          setError(null)
          setOk(false)
        }}
      />
      {ok && <span className="duic-upload-ok">已上传，正在使用本地图片</span>}
      {error && <span className="duic-upload-error">{error}</span>}
    </div>
  )
}

function RangeField(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}): JSX.Element {
  const step = props.step ?? 1
  return (
    <div className="duic-field">
      <div className="duic-row">
        <span className="duic-label">{props.label}</span>
        <span className="duic-value">
          {props.value}
          {props.suffix ?? ''}
        </span>
      </div>
      <input
        type="range"
        className="duic-range"
        min={props.min}
        max={props.max}
        step={step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </div>
  )
}

function Segmented<T extends string>(props: {
  options: ReadonlyArray<{ label: string; value: T }>
  value: T
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="duic-seg" role="tablist">
      {props.options.map((option) => (
        <button
          type="button"
          key={option.value}
          role="tab"
          aria-selected={option.value === props.value}
          className={option.value === props.value ? 'active' : undefined}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const BACKGROUND_MODES: ReadonlyArray<{ label: string; value: BackgroundConfig['mode'] }> = [
  { label: '纯色', value: 'color' },
  { label: '渐变', value: 'gradient' },
  { label: '图片', value: 'image' },
]

const IMAGE_SIZES: ReadonlyArray<{ label: string; value: BackgroundImageConfig['size'] }> = [
  { label: '覆盖', value: 'cover' },
  { label: '适应', value: 'contain' },
  { label: '原始大小', value: 'auto' },
]

const IMAGE_POSITIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: '居中', value: 'center' },
  { label: '顶部', value: 'top' },
  { label: '底部', value: 'bottom' },
  { label: '左侧', value: 'left' },
  { label: '右侧', value: 'right' },
  { label: '左上', value: 'top left' },
  { label: '右上', value: 'top right' },
  { label: '左下', value: 'bottom left' },
  { label: '右下', value: 'bottom right' },
]

const FONT_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: '不覆盖（跟随系统默认）', value: '' },
  {
    label: '系统 UI 字体',
    value:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  {
    label: '苹方 / 微软雅黑（DSH 默认同款）',
    value:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  {
    label: '圆润现代（PingFang 优先）',
    value:
      '"PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  },
  {
    label: '衬线（宋体 / 思源宋体）',
    value:
      '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", Georgia, serif',
  },
]

const CODE_FONT_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: '不覆盖（跟随系统默认）', value: '' },
  {
    label: 'SF Mono / JetBrains Mono（DSH 默认同款）',
    value:
      "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'",
  },
  {
    label: '等宽（通用）',
    value: "ui-monospace, 'SF Mono', 'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  },
]

/* ─────────────────────────── 设置页组件 ─────────────────────────── */

type TabId = 'presets' | 'background' | 'font' | 'layout' | 'advanced'

interface CustomizerSectionProps extends SettingsSectionOwnerProps {
  store: ConfigStore
}

function backgroundPreviewCss(config: BackgroundConfig, scheme: 'light' | 'dark'): CSSProperties {
  const base: CSSProperties = { backgroundRepeat: 'no-repeat' }
  if (config.mode === 'color') {
    return { ...base, backgroundColor: scheme === 'light' ? config.color.light : config.color.dark }
  }
  if (config.mode === 'gradient') {
    const g = config.gradient
    const start = scheme === 'light' ? g.lightStart : g.darkStart
    const end = scheme === 'light' ? g.lightEnd : g.darkEnd
    return { ...base, backgroundImage: `linear-gradient(${g.angle}deg, ${start}, ${end})` }
  }
  const image = config.image
  const url = scheme === 'light' ? image.light : image.dark
  return {
    ...base,
    backgroundColor: 'transparent',
    backgroundImage: url ? cssUrl(url) : 'none',
    backgroundSize: image.size,
    backgroundPosition: image.position,
  }
}

function CustomizerSection(props: CustomizerSectionProps): JSX.Element {
  const { store } = props
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [draft, setDraft] = useState<CustomizerConfig>(() => state.config)
  const [tab, setTab] = useState<TabId>('presets')
  const [previewScheme, setPreviewScheme] = useState<'light' | 'dark'>('light')

  const draftRef = useRef(draft)
  const dirtyRef = useRef(false)
  const initializedRef = useRef(false)

  // 首次加载完成后才允许把远端配置吸收进草稿。
  useEffect(() => {
    if (!initializedRef.current && state.status !== 'loading') {
      initializedRef.current = true
      draftRef.current = state.config
      setDraft(state.config)
    }
  }, [state.status, state.config])

  // 编辑 300ms 后自动保存；卸载时兜底保存一次。
  useEffect(() => {
    if (!initializedRef.current || !dirtyRef.current) return
    const timer = window.setTimeout(() => {
      void store.save(draftRef.current)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [draft, store])

  useEffect(
    () => () => {
      if (dirtyRef.current) void store.save(draftRef.current)
    },
    [store],
  )

  const commit = (mutator: (previous: CustomizerConfig) => CustomizerConfig): void => {
    const next = normalizeConfig(mutator(draftRef.current))
    draftRef.current = next
    dirtyRef.current = true
    store.preview(next)
    setDraft(next)
  }

  const setBackground = (patch: Partial<BackgroundConfig>): void => {
    commit((previous) => ({ ...previous, background: { ...previous.background, ...patch } }))
  }

  const setGradient = (patch: Partial<BackgroundGradientConfig>): void => {
    commit((previous) => ({
      ...previous,
      background: { ...previous.background, gradient: { ...previous.background.gradient, ...patch } },
    }))
  }

  const setImage = (patch: Partial<BackgroundImageConfig>): void => {
    commit((previous) => ({
      ...previous,
      background: { ...previous.background, image: { ...previous.background.image, ...patch } },
    }))
  }

  const setFont = (patch: Partial<FontConfig>): void => {
    commit((previous) => ({ ...previous, font: { ...previous.font, ...patch } }))
  }

  const setLayout = (patch: Partial<LayoutConfig>): void => {
    commit((previous) => ({ ...previous, layout: { ...previous.layout, ...patch } }))
  }

  const resetAll = (): void => {
    if (window.confirm('确定要恢复「自定义背景」的全部默认设置吗？')) {
      commit(() => normalizeConfig(DEFAULT_CONFIG))
    }
  }

  const retrySave = (): void => {
    void store.save(draftRef.current)
  }

  const statusText =
    state.status === 'saving' ? '保存中…' : state.status === 'error' ? '保存失败' : '修改后自动保存'

  return (
    <div className="duic-root">
      <div className="duic-status">
        <span className="duic-muted">
          配置保存在 ~/.dsh/plugins/dsh-ui-customizer/config.json，无需手工编辑
        </span>
        <span>{statusText}</span>
      </div>

      {state.status === 'error' && (
        <div className="duic-error">
          <span>保存失败：{state.error ?? '未知错误'}</span>
          <button type="button" className="duic-btn" onClick={retrySave}>
            重试
          </button>
        </div>
      )}

      <div className="duic-tabs" role="tablist" aria-label="自定义背景页签">
        {(
          [
            ['presets', '预设'],
            ['background', '背景'],
            ['font', '字体'],
            ['layout', '布局'],
            ['advanced', '高级 CSS'],
          ] as ReadonlyArray<[TabId, string]>
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'duic-tab active' : 'duic-tab'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'presets' && (
        <>
          <div className="duic-card">
            <h3>主题预设</h3>
            <p className="duic-muted">
              一键切换整套背景与字体（布局宽度和自定义 CSS 会保留）。当前：
              {THEME_PRESETS.find(
                (preset) => themeFingerprint(draft) === themeFingerprint(applyThemePreset(draft, preset)),
              )?.name ?? '自定义组合'}
            </p>
            <div className="duic-presets">
              {THEME_PRESETS.map((preset) => {
                const previewConfig = applyThemePreset(draft, preset)
                const active = themeFingerprint(draft) === themeFingerprint(previewConfig)
                return (
                  <button
                    type="button"
                    key={preset.id}
                    className={active ? 'duic-preset active' : 'duic-preset'}
                    onClick={() => commit((previous) => applyThemePreset(previous, preset))}
                  >
                    <span className="duic-preset-preview">
                      <span style={backgroundPreviewCss(previewConfig.background, 'light')} title="浅色预览" />
                      <span style={backgroundPreviewCss(previewConfig.background, 'dark')} title="深色预览" />
                    </span>
                    <span className="duic-preset-name">{preset.name}</span>
                    <span className="duic-preset-desc">{preset.description}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {tab === 'background' && (
        <>
          <div className="duic-card">
            <h3>背景类型</h3>
            <Segmented
              options={BACKGROUND_MODES}
              value={draft.background.mode}
              onChange={(mode) => setBackground({ mode })}
            />
          </div>

          {draft.background.mode === 'color' && (
            <div className="duic-card">
              <h3>背景颜色</h3>
              <div className="duic-grid">
                <ColorField
                  label="浅色模式"
                  value={draft.background.color.light}
                  onChange={(light) =>
                    setBackground({ color: { ...draft.background.color, light } })
                  }
                />
                <ColorField
                  label="深色模式"
                  value={draft.background.color.dark}
                  onChange={(dark) =>
                    setBackground({ color: { ...draft.background.color, dark } })
                  }
                />
              </div>
            </div>
          )}

          {draft.background.mode === 'gradient' && (
            <div className="duic-card">
              <h3>渐变色</h3>
              <RangeField
                label="渐变角度"
                value={draft.background.gradient.angle}
                min={0}
                max={360}
                suffix="°"
                onChange={(angle) => setGradient({ angle })}
              />
              <div className="duic-grid">
                <ColorField
                  label="浅色 · 起点"
                  value={draft.background.gradient.lightStart}
                  onChange={(lightStart) => setGradient({ lightStart })}
                />
                <ColorField
                  label="浅色 · 终点"
                  value={draft.background.gradient.lightEnd}
                  onChange={(lightEnd) => setGradient({ lightEnd })}
                />
                <ColorField
                  label="深色 · 起点"
                  value={draft.background.gradient.darkStart}
                  onChange={(darkStart) => setGradient({ darkStart })}
                />
                <ColorField
                  label="深色 · 终点"
                  value={draft.background.gradient.darkEnd}
                  onChange={(darkEnd) => setGradient({ darkEnd })}
                />
              </div>
            </div>
          )}

          {draft.background.mode === 'image' && (
            <div className="duic-card">
              <h3>背景图片</h3>
              <ImageUrlField
                label="浅色模式图片"
                value={draft.background.image.light}
                onChange={(light) => setImage({ light })}
              />
              <ImageUrlField
                label="深色模式图片"
                value={draft.background.image.dark}
                onChange={(dark) => setImage({ dark })}
              />
              <p className="duic-muted">
                支持本地上传（PNG / JPEG / WebP / GIF，≤15MB）或粘贴图片 URL；本地图片保存在
                ~/.dsh/plugins/dsh-ui-customizer/images/。
              </p>
              <div className="duic-grid">
                <div className="duic-field">
                  <span className="duic-label">缩放</span>
                  <select
                    className="duic-select"
                    value={draft.background.image.size}
                    onChange={(event) =>
                      setImage({ size: event.target.value as BackgroundImageConfig['size'] })
                    }
                  >
                    {IMAGE_SIZES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="duic-field">
                  <span className="duic-label">位置</span>
                  <select
                    className="duic-select"
                    value={draft.background.image.position}
                    onChange={(event) => setImage({ position: event.target.value })}
                  >
                    {IMAGE_POSITIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="duic-field">
                  <span className="duic-label">重复</span>
                  <select
                    className="duic-select"
                    value={draft.background.image.repeat}
                    onChange={(event) =>
                      setImage({ repeat: event.target.value as BackgroundImageConfig['repeat'] })
                    }
                  >
                    <option value="no-repeat">不重复</option>
                    <option value="repeat">平铺</option>
                  </select>
                </div>
              </div>
              <RangeField
                label="模糊"
                value={draft.background.image.blur}
                min={0}
                max={40}
                suffix="px"
                onChange={(blur) => setImage({ blur })}
              />
              <RangeField
                label="不透明度"
                value={draft.background.image.opacity}
                min={0.05}
                max={1}
                step={0.05}
                onChange={(opacity) => setImage({ opacity })}
              />
            </div>
          )}

          <div className="duic-card">
            <label className="duic-check">
              <input
                type="checkbox"
                checked={draft.background.sidebarBlend}
                onChange={(event) => setBackground({ sidebarBlend: event.target.checked })}
              />
              让侧边栏底色透明，与背景融合
            </label>
          </div>

          <div className="duic-card">
            <div className="duic-row">
              <h3>预览</h3>
              <div className="duic-seg">
                <button
                  type="button"
                  className={previewScheme === 'light' ? 'active' : undefined}
                  onClick={() => setPreviewScheme('light')}
                >
                  浅色
                </button>
                <button
                  type="button"
                  className={previewScheme === 'dark' ? 'active' : undefined}
                  onClick={() => setPreviewScheme('dark')}
                >
                  深色
                </button>
              </div>
            </div>
            <div
              className="duic-preview"
              style={{
                ...backgroundPreviewCss(draft.background, previewScheme),
                colorScheme: previewScheme,
              }}
            >
              <div
                className="duic-preview-sidebar"
                style={{
                  background: draft.background.sidebarBlend
                    ? 'transparent'
                    : undefined,
                }}
              />
              <div className="duic-preview-center">预览</div>
              <span className="duic-preview-tag">{previewScheme === 'light' ? '浅色' : '深色'}</span>
            </div>
          </div>
        </>
      )}

      {tab === 'font' && (
        <>
          <div className="duic-card">
            <h3>界面字体</h3>
            <div className="duic-field">
              <span className="duic-label">预设</span>
              <select
                className="duic-select"
                value={draft.font.family}
                onChange={(event) => setFont({ family: event.target.value })}
              >
                {FONT_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
                {!FONT_PRESETS.some((preset) => preset.value === draft.font.family) && (
                  <option value={draft.font.family}>自定义（当前输入）</option>
                )}
              </select>
            </div>
            <div className="duic-field">
              <span className="duic-label">自定义 CSS font-family</span>
              <input
                type="text"
                className="duic-input"
                placeholder='例如 "LXGW WenKai", "PingFang SC", sans-serif'
                value={draft.font.family}
                spellCheck={false}
                onChange={(event) => setFont({ family: event.target.value })}
              />
            </div>
            <p className="duic-muted">
              留空表示不覆盖；字体需要是本机已安装的字体，否则浏览器会按回退栈渲染。
            </p>
          </div>
          <div className="duic-card">
            <h3>代码字体</h3>
            <div className="duic-field">
              <span className="duic-label">预设</span>
              <select
                className="duic-select"
                value={draft.font.codeFamily}
                onChange={(event) => setFont({ codeFamily: event.target.value })}
              >
                {CODE_FONT_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
                {!CODE_FONT_PRESETS.some((preset) => preset.value === draft.font.codeFamily) && (
                  <option value={draft.font.codeFamily}>自定义（当前输入）</option>
                )}
              </select>
            </div>
            <div className="duic-field">
              <span className="duic-label">自定义 CSS font-family</span>
              <input
                type="text"
                className="duic-input"
                placeholder='例如 "Cascadia Code", Consolas, monospace'
                value={draft.font.codeFamily}
                spellCheck={false}
                onChange={(event) => setFont({ codeFamily: event.target.value })}
              />
            </div>
          </div>
        </>
      )}

      {tab === 'layout' && (
        <>
          <div className="duic-card">
            <label className="duic-check">
              <input
                type="checkbox"
                checked={draft.layout.enabled}
                onChange={(event) => setLayout({ enabled: event.target.checked })}
              />
              启用自定义布局宽度
            </label>
            <p className="duic-muted">
              启用后覆盖 AppFrame 的列宽；拖动分隔条时以拖拽为准，松手后恢复为这里的设置。
            </p>
          </div>
          <div className="duic-card">
            <RangeField
              label="侧边栏宽度"
              value={draft.layout.sidebarWidth}
              min={264}
              max={420}
              suffix="px"
              onChange={(sidebarWidth) => setLayout({ sidebarWidth })}
            />
            <RangeField
              label="详情栏宽度"
              value={draft.layout.detailsWidth}
              min={300}
              max={520}
              suffix="px"
              onChange={(detailsWidth) => setLayout({ detailsWidth })}
            />
            <p className="duic-muted">
              详情栏（右侧栏）默认收起；启用布局覆盖后它会按这里的宽度展开。窗口过窄时 DSH
              仍会按内部规则压缩列宽。
            </p>
          </div>
        </>
      )}

      {tab === 'advanced' && (
        <div className="duic-card">
          <h3>自定义 CSS</h3>
          <textarea
            className="duic-textarea"
            spellCheck={false}
            placeholder={'/* 直接写 CSS，作用于整个 DSH 页面 */\n/* 例如：隐藏某个元素、加大圆角 */\n'}
            value={draft.customCss}
            onChange={(event) => commit((previous) => ({ ...previous, customCss: event.target.value }))}
          />
          <p className="duic-muted">
            自定义 CSS 注入在插件基础样式之后，可用变量例如 var(--dsw-alias-bg-base)、
            var(--dsw-font-family)。改坏了直接清空即可恢复。
          </p>
        </div>
      )}

      <div className="duic-row">
        <span className="duic-muted">所有修改实时预览，并自动保存到本机配置。</span>
        <button type="button" className="duic-btn danger" onClick={resetAll}>
          恢复全部默认
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────────── 实时应用层 ─────────────────────────── */

export const inject = ['slots', 'theme']

export function apply(ctx: ClientContext): void {
  const store = new ConfigStore()
  void store.load()

  let styleEl: HTMLStyleElement | null = null
  let bgLayer: HTMLDivElement | null = null
  let disposeTokens: (() => void) | null = null
  let frameRaf = 0

  const currentConfig = (): CustomizerConfig => store.getSnapshot().config
  const currentScheme = (): 'light' | 'dark' => ctx.theme.getTheme().active.colorScheme

  function ensureDom(): void {
    if (styleEl === null || !document.head.contains(styleEl)) {
      styleEl = document.createElement('style')
      styleEl.id = 'dsh-ui-customizer-styles'
      styleEl.setAttribute('data-plugin', PLUGIN_ID)
      document.head.appendChild(styleEl)
    }
    if (bgLayer === null || !document.body.contains(bgLayer)) {
      bgLayer = document.createElement('div')
      bgLayer.id = 'duic-bg-layer'
      bgLayer.setAttribute('aria-hidden', 'true')
      document.body.appendChild(bgLayer)
    }
  }

  function refreshStyle(): void {
    if (styleEl === null) return
    styleEl.textContent = `${BASE_CSS}\n/* dsh-ui-customizer: user custom css */\n${currentConfig().customCss}`
  }

  function applyTokens(): void {
    const cfg = currentConfig()
    const tokens: ThemeTokenOverrides = {}
    if (cfg.background.mode === 'color') {
      tokens['--dsw-alias-bg-base'] = {
        light: cfg.background.color.light,
        dark: cfg.background.color.dark,
      }
    } else {
      // 渐变 / 图片模式下把主画布底色让给背景层，卡片等仍使用上层 token。
      // 图片模式某配色下没填 URL 时，该配色回落到默认底色，避免整页变透明。
      const hasLightLayer = cfg.background.mode === 'gradient' || cfg.background.image.light.length > 0
      const hasDarkLayer = cfg.background.mode === 'gradient' || cfg.background.image.dark.length > 0
      tokens['--dsw-alias-bg-base'] = {
        light: hasLightLayer ? 'transparent' : DEFAULT_CONFIG.background.color.light,
        dark: hasDarkLayer ? 'transparent' : DEFAULT_CONFIG.background.color.dark,
      }
    }
    if (cfg.background.sidebarBlend) {
      tokens['--dsw-specific-sidebar-fill'] = { light: 'transparent', dark: 'transparent' }
    }
    if (cfg.font.family) {
      tokens['--dsw-font-family'] = { light: cfg.font.family, dark: cfg.font.family }
    }
    if (cfg.font.codeFamily) {
      tokens['--ds-font-family-code'] = {
        light: cfg.font.codeFamily,
        dark: cfg.font.codeFamily,
      }
    }
    const previous = disposeTokens
    disposeTokens = null
    previous?.()
    disposeTokens = ctx.theme.overrideTokens(PLUGIN_ID, tokens)
  }

  function applySurface(): void {
    if (bgLayer === null) return
    const cfg = currentConfig()
    const scheme = currentScheme()

    const reset = (): void => {
      bgLayer!.style.backgroundColor = ''
      bgLayer!.style.backgroundImage = 'none'
      bgLayer!.style.backgroundSize = 'auto'
      bgLayer!.style.backgroundPosition = 'center'
      bgLayer!.style.backgroundRepeat = 'no-repeat'
      bgLayer!.style.opacity = '1'
      bgLayer!.style.filter = 'none'
    }

    reset()
    if (cfg.background.mode === 'color') {
      bgLayer.style.backgroundColor = scheme === 'light' ? cfg.background.color.light : cfg.background.color.dark
      return
    }
    if (cfg.background.mode === 'gradient') {
      const g = cfg.background.gradient
      const start = scheme === 'light' ? g.lightStart : g.darkStart
      const end = scheme === 'light' ? g.lightEnd : g.darkEnd
      bgLayer.style.backgroundImage = `linear-gradient(${g.angle}deg, ${start}, ${end})`
      return
    }
    const image = cfg.background.image
    const url = scheme === 'light' ? image.light : image.dark
    if (!url) {
      // 该配色下没有图片时回落到默认底色，而不是把页面变成全透明。
      bgLayer.style.backgroundColor =
        scheme === 'light' ? DEFAULT_CONFIG.background.color.light : DEFAULT_CONFIG.background.color.dark
      return
    }
    bgLayer.style.backgroundColor = 'transparent'
    bgLayer.style.backgroundImage = cssUrl(url)
    bgLayer.style.backgroundSize = image.size
    bgLayer.style.backgroundPosition = image.position
    bgLayer.style.backgroundRepeat = image.repeat
    bgLayer.style.opacity = String(image.opacity)
    if (image.blur > 0) bgLayer.style.filter = `blur(${image.blur}px)`
  }

  function syncLayout(): void {
    const cfg = currentConfig().layout
    document.body.classList.toggle('duic-layout-on', cfg.enabled)
    if (!cfg.enabled) {
      document.body.style.removeProperty('--duic-sidebar')
      document.body.style.removeProperty('--duic-details')
      return
    }
    const frame = document.querySelector<HTMLElement>('div[data-shell-overlay="true"]')?.parentElement
    const sidebarCollapsed = frame?.hasAttribute('data-sidebar-collapsed') ?? false
    const detailsCollapsed = frame?.hasAttribute('data-details-collapsed') ?? false
    document.body.style.setProperty('--duic-sidebar', sidebarCollapsed ? '56px' : `${cfg.sidebarWidth}px`)
    document.body.style.setProperty('--duic-details', detailsCollapsed ? '0px' : `${cfg.detailsWidth}px`)
  }

  function applyAll(): void {
    ensureDom()
    refreshStyle()
    applyTokens()
    applySurface()
    syncLayout()
  }

  function startFrameLoop(): void {
    const tick = (): void => {
      syncLayout()
      frameRaf = window.requestAnimationFrame(tick)
    }
    frameRaf = window.requestAnimationFrame(tick)
  }

  ctx.effect(() => {
    const offStore = store.subscribe(applyAll)
    const offTheme = ctx.on('theme/change', applySurface)

    applyAll()
    startFrameLoop()

    return () => {
      offStore()
      offTheme()
      window.cancelAnimationFrame(frameRaf)
      disposeTokens?.()
      disposeTokens = null
      document.body.classList.remove('duic-layout-on')
      document.body.style.removeProperty('--duic-sidebar')
      document.body.style.removeProperty('--duic-details')
      styleEl?.remove()
      bgLayer?.remove()
      styleEl = null
      bgLayer = null
    }
  }, `${PLUGIN_ID}: live apply`)

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'ui-customizer',
        order: 20,
        label: () => '自定义背景',
        inject: () => ({ store }),
      },
      CustomizerSection,
    ),
  )
}
