/**
 * @dsh-external/dsh-ui-customizer — host half。
 *
 * 负责把插件的可视化配置持久化到：
 *   $DSH_HOME/plugins/dsh-ui-customizer/config.json（默认 ~/.dsh/...）
 *
 * 为什么不走 DSH settings API：host apiproxy 对 settings namespace 有显式
 * 白名单，第三方插件注册的新 namespace 不会被暴露给浏览器。因此本插件在
 * webserver 上注册同源 API：
 *   GET /api/dsh-ui-customizer/config   读取配置（缺失/损坏时返回默认值）
 *   PUT /api/dsh-ui-customizer/config   保存配置（JSON 全量覆盖，原子写入）
 *
 * client half（src/client）负责设置页 UI 与实时生效。
 */
import { homedir } from 'node:os'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  CONFIG_API_PATH,
  DEFAULT_CONFIG,
  normalizeConfig,
  type CustomizerConfig,
} from './shared.js'

export const name = '@dsh-external/dsh-ui-customizer'
export const inject = []

/** PUT body 上限：64KB 自定义 CSS + 其余字段，留足余量。 */
const MAX_BODY_BYTES = 128 * 1024

function configPath(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'plugins', 'dsh-ui-customizer', 'config.json')
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

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体超过 128KB 上限'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
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
        parsed = JSON.parse(await readBody(req, MAX_BODY_BYTES))
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

export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (httpCtx) => {
    const web = httpCtx.webServer
    httpCtx.effect(() => {
      const dispose = web.register({
        kind: 'exact',
        path: CONFIG_API_PATH,
        handler: (req, res) => handleConfig(req, res),
      })
      ctx.logger?.info?.(`[${name}] config API ready: ${CONFIG_API_PATH}`)
      return dispose
    }, `${name}: config api`)
  })
}
