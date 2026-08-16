# @dsh-external/dsh-ui-customizer

DSH 界面可视化定制插件。安装后，左下角「设置」弹窗中会新增 **「自定义背景」** 入口，让你不用手改配置文件即可自定义 DSH 的界面。

## 功能

- **主题预设**：内置「默认 DSH / 深海蓝调 / 护眼森林 / 樱花粉 / 纸张暖黄 / 赛博紫 / 午夜 OLED」等主题，一键切换整套背景与字体（保留布局和自定义 CSS）。
- **背景**：纯色 / 渐变 / 图片，浅色与深色模式分别配置；支持**上传本地图片**（PNG / JPEG / WebP / GIF，≤15MB）或粘贴图片 URL；支持图片缩放、位置、平铺、模糊、不透明度；可选让侧边栏与背景融合。
- **字体**：界面字体 / 代码字体（提供预设或手写 `font-family`）、**全局字号缩放（80%–150%）**、**主文字颜色**（浅色 / 深色分别配置，覆盖 `--dsw-alias-label-primary`）。
- **布局**：覆盖侧边栏宽度（264–420px）与详情栏宽度（300–520px）。拖动分隔条时以拖拽为准，松手后恢复为配置值。
- **高级 CSS**：直接注入一段自定义 CSS，改坏了清空即可恢复。
- 所有修改实时预览、自动保存，并持久化到：

  ```
  ~/.dsh/plugins/dsh-ui-customizer/config.json
  ```

## 原理

| 能力 | 实现方式 |
| --- | --- |
| 设置入口 | 注册官方 `settings.section` 插槽（id `ui-customizer`） |
| 颜色 / 字体 | 官方 `ctx.theme.overrideTokens` 覆盖 `--dsw-*` token；字号因 DSH 大量硬编码 px，采用对 AppFrame 的 `zoom` 全局缩放（宽高反向补偿，仍铺满视口） |
| 图片 / 渐变背景 | `body` 底部独立背景层（`z-index:-1`），主画布 token 透明让位 |
| 本地图片上传 | `POST /api/dsh-ui-customizer/image`（魔数校验，仅 PNG/JPEG/WebP/GIF）→ 存到插件 `images/` 目录 → `GET /api/dsh-ui-customizer/image/<file>` 读取 |
| 布局宽度 | 用 `:has([data-shell-overlay])` 覆盖 AppFrame 的 grid 列宽，拖动时自动让位 |
| 持久化 | host half 在同源 webserver 注册 `GET/PUT /api/dsh-ui-customizer/config`，原子写入插件配置目录 |

> 为什么不走 DSH settings API：host apiproxy 对 settings namespace 有显式白名单，第三方插件注册的新 namespace 不会暴露给浏览器，因此本插件自带同源配置 API。

## 安装（用户）

从 [GitHub Releases](https://github.com/nanami-0713/dsh-ui-customizer/releases/latest) 下载 `dsh-external-dsh-ui-customizer-<version>.tgz`，然后在你的 DSH profile（如 `~/.dsh/profiles/web/package.json`）中声明：

```json
{
  "dependencies": {
    "@dsh-external/dsh-ui-customizer": "https://github.com/nanami-0713/dsh-ui-customizer/releases/download/v<版本>/dsh-external-dsh-ui-customizer-<版本>.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@dsh-external/dsh-ui-customizer"
      ]
    }
  }
}
```

重新安装依赖并重启 DSH（或使用超级模组注入器热加载）。打开左下角「设置」，即可看到「自定义背景」。

本地开发目录安装：

```json
{
  "dependencies": {
    "@dsh-external/dsh-ui-customizer": "file:/<替换为你的插件目录绝对路径>"
  }
}
```

## 开发

```bash
npm install
npm run typecheck
npm run build:all
```

产物：

- `lib/index.js`：host half（配置 HTTP API）
- `lib/client.js`：web 设置页（ModuleLoader bundle）

### 本地验证 API

```bash
curl http://127.0.0.1:3080/api/dsh-ui-customizer/config
curl -X PUT http://127.0.0.1:3080/api/dsh-ui-customizer/config \
  -H 'content-type: application/json' \
  -d '{"background":{"mode":"gradient"}}'
```

### 打包分发

```bash
npm pack
```

得到 `dsh-external-dsh-ui-customizer-<version>.tgz`，用户安装该 tgz 即可。

## 配置示例（config.json）

```json
{
  "version": 1,
  "background": {
    "mode": "gradient",
    "color": { "light": "#FFFFFF", "dark": "#151517" },
    "gradient": {
      "angle": 135,
      "lightStart": "#EEF2FF",
      "lightEnd": "#DBEAFE",
      "darkStart": "#1E293B",
      "darkEnd": "#0F172A"
    },
    "image": {
      "light": "",
      "dark": "",
      "size": "cover",
      "position": "center",
      "repeat": "no-repeat",
      "blur": 0,
      "opacity": 1
    },
    "sidebarBlend": false
  },
  "font": { "family": "", "codeFamily": "", "size": 100, "color": { "light": "#0F1115", "dark": "#F9FAFB" } },
  "layout": { "enabled": false, "sidebarWidth": 280, "detailsWidth": 360 },
  "customCss": ""
}
```

## 已知限制

- 布局宽度覆盖依赖 CSS `:has()` 选择器（Chrome 105+ / Safari 15.4+ / Firefox 121+）。
- 图片 URL 需要浏览器可访问（支持 http(s)、相对路径与 data URL）；远程浏览器访问 DSH 时，`file://` 路径不可用。
- 字体必须是本机已安装字体，或使用通用回退栈。
