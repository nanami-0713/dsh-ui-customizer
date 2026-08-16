/**
 * @dsh-external/dsh-ui-customizer — host half。
 *
 * 负责把插件的可视化配置持久化到：
 *   $DSH_HOME/plugins/dsh-ui-customizer/config.json（默认 ~/.dsh/...）
 *
 * 为什么不走 DSH settings API：host apiproxy 对 settings namespace 有显式
 * 白名单，第三方插件注册的新 namespace 不会被暴露给浏览器。因此本插件在
 * webserver 上注册同源 API：
 *   GET  /api/dsh-ui-customizer/config          读取配置（缺失/损坏时返回默认值）
 *   PUT  /api/dsh-ui-customizer/config          保存配置（JSON 全量覆盖，原子写入）
 *   POST /api/dsh-ui-customizer/image           上传本地背景图片（png/jpeg/webp/gif，≤15MB）
 *   GET  /api/dsh-ui-customizer/image/<file>    读取已上传的图片
 *
 * client half（src/client）负责设置页 UI 与实时生效。
 */
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  CONFIG_API_PATH,
  DEFAULT_CONFIG,
  IMAGE_API_PATH,
  MAX_IMAGE_BYTES,
  normalizeConfig,
  type CustomizerConfig,
} from './shared.js'

export const name = '@dsh-external/dsh-ui-customizer'
export const inject = []

/** PUT body 上限：64KB 自定义 CSS + 其余字段，留足余量。 */
const MAX_CONFIG_BODY_BYTES = 128 * 1024

/** 已上传图片文件名：<uuid>.<ext>，拒绝任何其它形状（防路径穿越）。 */
const IMAGE_FILE_PATTERN = /^[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

function pluginDataDir(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'plugins', 'dsh-ui-customizer')
}

function configPath(): string {
  return join(pluginDataDir(), 'config.json')
}

function imageDir(): string {
  return join(pluginDataDir(), 'images')
}

async function loadConfig(): Promise<CustomizerConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const config = normalizeConfig(parsed)
    config.version = 1
    return config
  } catch {
    return normalizeConfig(DEFAULT_CONFIG)
  }
}

async function saveConfig(config: CustomizerConfig): Promise<void> {
  const file = configPath()
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendText(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(message),
    'cache-control': 'no-store',
  })
  res.end(message)
}

function readBodyBuffer(req: IncomingMessage, limit: number, tooLargeMessage: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error(tooLargeMessage))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

interface ImageSignature {
  ext: string
  mediaType: string
}

/** 魔数嗅探：只接受常见位图格式，拒绝把任意文件当图片存进本地目录。 */
function sniffImage(buffer: Buffer): ImageSignature | null {
  if (buffer.length < 12) return null
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return { ext: 'png', mediaType: 'image/png' }
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mediaType: 'image/jpeg' }
  }
  const ascii = (start: number, length: number): string => buffer.subarray(start, start + length).toString('latin1')
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') {
    return { ext: 'gif', mediaType: 'image/gif' }
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    return { ext: 'webp', mediaType: 'image/webp' }
  }
  return null
}

async function handleConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method === 'GET') {
      sendJson(res, 200, await loadConfig())
      return
    }
    if (req.method === 'PUT') {
      let parsed: unknown
      try {
        const body = await readBodyBuffer(req, MAX_CONFIG_BODY_BYTES, '配置请求体超过 128KB 上限')
        parsed = JSON.parse(body.toString('utf8'))
      } catch (error) {
        sendJson(res, 400, {
          error: 'INVALID_JSON',
          message: error instanceof Error ? error.message : '请求体不是合法 JSON',
        })
        return
      }
      const config = normalizeConfig(parsed)
      await saveConfig(config)
      sendJson(res, 200, config)
      return
    }
    res.setHeader('allow', 'GET, PUT')
    sendText(res, 405, 'method not allowed')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 500, { error: 'INTERNAL', message })
  }
}

async function handleImage(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  try {
    if (req.method === 'POST' && pathname === IMAGE_API_PATH) {
      const body = await readBodyBuffer(req, MAX_IMAGE_BYTES, `图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 上限`)
      const signature = sniffImage(body)
      if (signature === null) {
        sendJson(res, 415, { error: 'UNSUPPORTED_IMAGE', message: '只支持 PNG / JPEG / WebP / GIF 图片' })
        return
      }
      await mkdir(imageDir(), { recursive: true })
      const fileName = `${randomUUID()}.${signature.ext}`
      await writeFile(join(imageDir(), fileName), body)
      sendJson(res, 201, {
        url: `${IMAGE_API_PATH}/${fileName}`,
        bytes: body.length,
        mediaType: signature.mediaType,
      })
      return
    }
    if (req.method === 'GET' && pathname.startsWith(`${IMAGE_API_PATH}/`)) {
      const fileName = decodeURIComponent(pathname.slice(IMAGE_API_PATH.length + 1))
      if (!IMAGE_FILE_PATTERN.test(fileName)) {
        sendText(res, 404, 'not found')
        return
      }
      const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
      try {
        const body = await readFile(join(imageDir(), fileName))
        res.writeHead(200, {
          'content-type': IMAGE_MEDIA_TYPES[ext] ?? 'application/octet-stream',
          'content-length': body.byteLength,
          'cache-control': 'public, max-age=31536000, immutable',
        })
        res.end(body)
      } catch {
        sendText(res, 404, 'not found')
      }
      return
    }
    res.setHeader('allow', 'POST')
    sendText(res, 405, 'method not allowed')
  } catch (error) {
    if (res.writableEnded) return
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 500, { error: 'INTERNAL', message })
  }
}

export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (httpCtx) => {
    const web = httpCtx.webServer
    httpCtx.effect(() => {
      const disposeConfig = web.register({
        kind: 'exact',
        path: CONFIG_API_PATH,
        handler: (req, res) => handleConfig(req, res),
      })
      const disposeImage = web.register({
        kind: 'prefix',
        path: IMAGE_API_PATH,
        handler: (req, res) => {
          const pathname = new URL(req.url ?? '/', 'http://dsh-ui-customizer.local').pathname
          return handleImage(req, res, pathname)
        },
      })
      ctx.logger?.info?.(`[${name}] API ready: ${CONFIG_API_PATH} / ${IMAGE_API_PATH}`)
      return () => {
        disposeConfig()
        disposeImage()
      }
    }, `${name}: config and image api`)
  })
}
