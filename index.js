/**
 * Host half of the workspace-panels plugin.
 *
 * One job: turn "a directory inside one workspace" into a list of panel
 * modules the browser can mount, and serve those modules to this page only.
 *
 * Three guarantees this file is responsible for:
 *
 *   1. Workspace containment. Every file read starts from a Workspace the
 *      Host registry already knows, and every resolved path is re-checked
 *      against that canonical root after `realpath`, so a symlink cannot walk
 *      out of the workspace and a browser cannot name a directory the Host
 *      never registered.
 *   2. Panel discovery. `<workspace>/<panelsDir>/<panel>/panel.json` plus its
 *      entry module; nothing outside that layout is ever listed, so the
 *      sidebar can only offer panels that belong to the workspace in view.
 *   3. Trust. Every route applies the Harness browser-trust fence
 *      (`ctx.connection.requestRejection`) before reading anything.
 *
 * The panel module format, including the `api` object handed to it, is
 * documented in `assets/workspace-panels.md` — the skill this same plugin
 * registers for agents.
 */

import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Route prefix owned by this plugin. Registered as one HTTP prefix route. */
const ROUTE_PREFIX = '/dsh-workspace-panels'

/** Panel-authoring skill shipped with this bundle. */
const SKILL_BODY_URL = new URL('./assets/workspace-panels.md', import.meta.url)

/** Panel directory name and the `id` field must look like this. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Workspace ids arrive from the browser; accept only their transport shape. */
const WORKSPACE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

/** Session ids arrive from the browser; accept only their transport shape. */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

/** Largest number of entries api.files.listDir returns in one call. */
const MAX_DIR_ENTRIES = 500

/** Content types the asset route is allowed to serve. */
const MIME = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
})

/**
 * Normalize the loader row's config, filling every default.
 * @param {unknown} raw - the row config as written in the patch.
 * @returns {{panelsDir: string, maxAssetBytes: number, maxReadBytes: number, skillName: string, allowHostModules: boolean, hostTimeoutMs: number}} resolved config.
 */
function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const panelsDirRaw = typeof source.panelsDir === 'string' ? source.panelsDir.trim() : ''
  const panelsDir = panelsDirRaw === '' ? '.dsh/panels' : panelsDirRaw.replace(/^\.?\//, '').replace(/\/+$/, '')
  const positive = (value, fallback) => (Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback)
  const skillNameRaw = typeof source.skillName === 'string' ? source.skillName.trim() : ''
  return {
    panelsDir,
    maxAssetBytes: positive(source.maxAssetBytes, 2 * 1024 * 1024),
    maxReadBytes: positive(source.maxReadBytes, 512 * 1024),
    skillName: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillNameRaw) ? skillNameRaw : 'workspace-panels',
    // A panel may ship a Host module (`panel.json.host`). That module runs in
    // this process with full Node privileges, so the switch exists to turn the
    // whole extension point off for a deployment that only wants page code.
    allowHostModules: source.allowHostModules === false ? false : true,
    hostTimeoutMs: positive(source.hostTimeoutMs, 120_000),
  }
}

/**
 * Is `candidate` the root itself or inside it?
 * @param {string} root - absolute root.
 * @param {string} candidate - absolute path.
 * @returns {boolean} whether the path stays inside the root.
 */
function within(root, candidate) {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

/**
 * Resolve one workspace-relative path and prove it stays inside `root`, even
 * when the last component is a symlink out of the workspace.
 * @param {string} root - absolute canonical root.
 * @param {string} rel - browser-supplied relative path.
 * @returns {Promise<string | undefined>} absolute real path, or undefined when refused.
 */
async function safeResolve(root, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return undefined
  if (isAbsolute(rel)) return undefined
  const target = resolve(root, rel)
  if (!within(root, target)) return undefined
  let canonicalRoot
  try {
    canonicalRoot = await realpath(root)
  } catch {
    canonicalRoot = root
  }
  let real
  try {
    real = await realpath(target)
  } catch {
    return undefined
  }
  return within(canonicalRoot, real) ? real : undefined
}

/**
 * Write one JSON body.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - status code.
 * @param {unknown} value - JSON payload.
 * @returns {void}
 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Write one failure envelope.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - status code.
 * @param {string} code - machine-readable code.
 * @param {string} message - human message, shown in the panel.
 * @returns {void}
 */
function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } })
}

/**
 * Read and parse a bounded JSON request body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {number} limit - maximum accepted bytes.
 * @returns {Promise<Record<string, unknown>>} parsed body.
 */
function readJsonBody(req, limit) {
  return new Promise((resolvePromise, rejectPromise) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        rejectPromise(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', rejectPromise)
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') {
        resolvePromise({})
        return
      }
      try {
        const parsed = JSON.parse(text)
        resolvePromise(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        rejectPromise(new Error('请求体不是合法 JSON'))
      }
    })
  })
}

/**
 * Read one optional string field from a parsed request body.
 * @param {Record<string, unknown>} body - request body.
 * @param {string} key - field name.
 * @returns {string | undefined} trimmed value.
 */
function textField(body, key) {
  const value = body[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Discover the panel modules of one workspace.
 *
 * A panel is a directory under `<workspace>/<panelsDir>/` holding a
 * `panel.json` (or, leniently, just an `index.js`) plus its entry module.
 * Broken candidates are reported as warnings rather than thrown, so one bad
 * panel never hides the others.
 *
 * @param {string} workspaceRoot - absolute canonical workspace directory.
 * @param {string} panelsDir - workspace-relative panels directory.
 * @returns {Promise<{exists: boolean, panels: object[], warnings: string[]}>} discovery result.
 */
async function discoverPanels(workspaceRoot, panelsDir) {
  const root = join(workspaceRoot, panelsDir)
  /** @type {object[]} */
  const panels = []
  /** @type {string[]} */
  const warnings = []

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false, panels, warnings }
    return { exists: false, panels, warnings: [`无法读取面板目录 ${panelsDir}：${String(error?.message ?? error)}`] }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dirName = entry.name
    if (!SLUG.test(dirName)) {
      warnings.push(`${panelsDir}/${dirName}：目录名只能包含字母、数字、点、下划线和短横线，已跳过`)
      continue
    }
    const panelRoot = join(root, dirName)
    /** @type {Record<string, unknown>} */
    let meta = {}
    try {
      const raw = await readFile(join(panelRoot, 'panel.json'), 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed
      else warnings.push(`${panelsDir}/${dirName}/panel.json：内容必须是 JSON 对象`)
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code
      if (code === 'ENOENT') warnings.push(`${panelsDir}/${dirName}：缺少 panel.json，已按目录名作为标题`)
      else warnings.push(`${panelsDir}/${dirName}/panel.json：${String(error?.message ?? error)}`)
    }

    const entryRel = typeof meta.entry === 'string' && meta.entry.trim() !== '' ? meta.entry.trim() : 'index.js'
    const entryPath = await safeResolve(panelRoot, entryRel)
    if (entryPath === undefined) {
      warnings.push(`${panelsDir}/${dirName}：入口模块 ${entryRel} 不存在或不在面板目录内，已跳过`)
      continue
    }
    let entryIsFile = false
    try {
      entryIsFile = (await stat(entryPath)).isFile()
    } catch {
      entryIsFile = false
    }
    if (!entryIsFile) {
      warnings.push(`${panelsDir}/${dirName}：入口模块 ${entryRel} 不是文件，已跳过`)
      continue
    }

    const styles = []
    if (Array.isArray(meta.styles)) {
      for (const item of meta.styles) {
        if (typeof item !== 'string' || item.trim() === '') continue
        const styleRel = item.trim()
        const stylePath = await safeResolve(panelRoot, styleRel)
        if (stylePath === undefined) {
          warnings.push(`${panelsDir}/${dirName}：样式文件 ${styleRel} 不存在或不在面板目录内，已忽略`)
          continue
        }
        styles.push(styleRel.split(sep).join('/'))
      }
    }

    // Optional Host module: a Node module that runs in this process and backs
    // `api.host.call()` for this panel. Same containment rules as the entry.
    let host = null
    const hostRel = typeof meta.host === 'string' && meta.host.trim() !== '' ? meta.host.trim() : undefined
    if (hostRel !== undefined) {
      const hostPath = await safeResolve(panelRoot, hostRel)
      if (hostPath === undefined) {
        warnings.push(`${panelsDir}/${dirName}：Host 模块 ${hostRel} 不存在或不在面板目录内，已忽略`)
      } else {
        let hostIsFile = false
        try {
          hostIsFile = (await stat(hostPath)).isFile()
        } catch {
          hostIsFile = false
        }
        if (hostIsFile) host = hostRel.split(sep).join('/')
        else warnings.push(`${panelsDir}/${dirName}：Host 模块 ${hostRel} 不是文件，已忽略`)
      }
    }

    const iconRel = typeof meta.icon === 'string' && meta.icon.trim() !== '' ? meta.icon.trim() : undefined
    let icon = null
    if (iconRel !== undefined) {
      const iconPath = await safeResolve(panelRoot, iconRel)
      if (iconPath === undefined) warnings.push(`${panelsDir}/${dirName}：图标 ${iconRel} 不存在，已忽略`)
      else icon = iconRel.split(sep).join('/')
    }

    const id = typeof meta.id === 'string' && SLUG.test(meta.id) ? meta.id : dirName
    const title = typeof meta.title === 'string' && meta.title.trim() !== '' ? meta.title.trim() : dirName
    const description = typeof meta.description === 'string' ? meta.description.trim() : ''
    const order = Number.isFinite(meta.order) ? Number(meta.order) : 0
    if (typeof meta.id === 'string' && meta.id !== id) warnings.push(`${panelsDir}/${dirName}：id "${meta.id}" 不合法，已改用目录名`)

    panels.push({
      id,
      dirName,
      title,
      description,
      order,
      entry: entryRel.split(sep).join('/'),
      styles,
      icon,
      host,
    })
  }

  panels.sort((a, b) => (a.order === b.order ? a.title.localeCompare(b.title, 'zh-CN') : a.order - b.order))
  const seen = new Set()
  for (const panel of panels) {
    if (!seen.has(panel.id)) {
      seen.add(panel.id)
      continue
    }
    warnings.push(`${panelsDir}/${panel.dirName}：面板 id "${panel.id}" 与其他面板重复`)
  }
  return { exists: true, panels, warnings }
}

/**
 * Register the bundled panel-authoring skill, when the composition has a
 * skill registry. The body is re-read on every load, so editing the shipped
 * markdown is visible without a restart.
 * @param {import('cordis').Context} ctx - plugin context.
 * @param {{panelsDir: string, skillName: string}} config - resolved config.
 * @returns {void}
 */
function registerSkill(ctx, config) {
  const skills = ctx.get('skills')
  if (skills === undefined) {
    ctx.logger?.info?.('workspace-panels: 未挂载 skills 服务，跳过面板技能注册')
    return
  }
  const providerName = 'workspace-panels'
  const description = `为当前工作区编写、修改或排错一个专属视图模块（${config.panelsDir}/<视图名>/panel.json + 入口模块）。它出现在右侧栏「开始」页的「工作区视图」入口里，选中后在右侧栏标签页中渲染，可同时开多个。当用户要求为这个工作区做一个自定义视图、面板、看板、仪表盘，或视图打不开、报错、需要改样式时使用。`
  const resourceBase = { kind: 'directory', path: fileURLToPath(new URL('./assets/', import.meta.url)) }
  ctx.effect(() => skills.registerProvider(() => ({
    name: providerName,
    list: () => [{
      name: config.skillName,
      description,
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      provider: providerName,
      resourceBase,
      rank: 600,
      locator: SKILL_BODY_URL,
    }],
    get: async () => ({
      name: config.skillName,
      description,
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      provider: providerName,
      resourceBase,
      content: (await readFile(SKILL_BODY_URL, 'utf8')).replaceAll('{{panelsDir}}', config.panelsDir),
    }),
  })), 'workspace-panels: skill provider')
}


/**
 * Host half entry point.
 * @param {import('cordis').Context} ctx - plugin Context.
 * @param {unknown} rawConfig - the Loader row's config.
 */
/** Method names a panel Host module may expose. */
const HOST_METHOD_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/

/**
 * Import one panel Host module, reusing the previous import while the file on
 * disk is unchanged. The query string busts Node's ESM cache after an edit, so
 * reloading a panel's Host half never needs a process restart.
 *
 * @param {string} file - absolute path of the Host module.
 * @param {Map<string, {stamp: string, module: object}>} cache - per-plugin cache.
 * @returns {Promise<object>} the imported module namespace.
 */
async function importHostModule(file, cache) {
  const info = await stat(file)
  const stamp = `${info.mtimeMs}:${info.size}`
  const cached = cache.get(file)
  if (cached !== undefined && cached.stamp === stamp) return cached.module
  const module = await import(`${pathToFileURL(file).href}?v=${encodeURIComponent(stamp)}`)
  cache.set(file, { stamp, module })
  return module
}

/**
 * Collect the callable methods a panel Host module exposes.
 *
 * Accepted shapes, in order: `createHandlers(context)` returning an object (the
 * usual form, so handlers can close over the workspace and Session),
 * `handlers`, or a default-exported object.
 *
 * @param {object} module - imported namespace.
 * @param {object} context - `{ workspace, panel, sessionId, root, panelsDir, logger }`.
 * @returns {Promise<Record<string, Function>>} method table.
 */
async function hostHandlersOf(module, context) {
  if (typeof module.createHandlers === 'function') {
    const table = await module.createHandlers(context)
    return table !== null && typeof table === 'object' ? table : {}
  }
  if (module.handlers !== null && typeof module.handlers === 'object') return module.handlers
  if (module.default !== null && typeof module.default === 'object') return module.default
  return {}
}

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)

  /**
   * Resolve one browser-supplied workspace id to its canonical directory.
   * @param {string} workspaceId - Workspace id from the browser.
   * @returns {{id: string, title: string, path: string} | undefined} workspace record.
   */
  const workspaceOf = (workspaceId) => {
    if (typeof workspaceId !== 'string' || !WORKSPACE_ID_RE.test(workspaceId)) return undefined
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) return undefined
    const workspace = registry.get(workspaceId)
    if (workspace === undefined) return undefined
    return { id: String(workspace.id), title: workspace.title, path: workspace.path }
  }

  /**
   * Resolve the Workspace a Session runs in: registry membership first (no I/O),
   * then the Session header's working directory.
   * @param {string} sessionId - Session id from the browser.
   * @returns {Promise<{id: string, title: string, path: string} | undefined>} workspace record.
   */
  const workspaceOfSession = async (sessionId) => {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) return undefined
    let member
    try {
      member = registry.list().find((workspace) => workspace.sessionIds.includes(sessionId))
    } catch {
      member = undefined
    }
    if (member !== undefined) return { id: String(member.id), title: member.title, path: member.path }
    const cwd = ctx.get('sessions')?.get?.(sessionId)?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return undefined
    try {
      const workspace = await registry.resolveByPath(cwd)
      return workspace === undefined ? undefined : { id: String(workspace.id), title: workspace.title, path: workspace.path }
    } catch {
      // A missing directory makes resolveByPath reject; that is "no workspace", not a failure.
      return undefined
    }
  }

  /**
   * Resolve the request's subject: a Session (preferred, what the right Sidebar
   * is scoped to) or an explicit Workspace id.
   * @param {Record<string, unknown>} body - parsed request body.
   * @returns {Promise<{id: string, title: string, path: string} | undefined>} workspace record.
   */
  const workspaceFromBody = async (body) => {
    const sessionId = textField(body, 'sessionId')
    if (sessionId !== undefined && SESSION_ID_RE.test(sessionId)) {
      const resolved = await workspaceOfSession(sessionId)
      if (resolved !== undefined) return resolved
      return undefined
    }
    const workspaceId = textField(body, 'workspaceId')
    return workspaceId === undefined ? undefined : workspaceOf(workspaceId)
  }

  /** Imported Host modules of this plugin run, keyed by absolute path. */
  const hostModules = new Map()

  /**
   * Call one method of a panel's Host module.
   *
   * The panel directory is resolved exactly like `/asset` does (inside the
   * Session's workspace, symlinks re-checked), so a browser can only reach a
   * Host module that discovery would also list.
   *
   * @param {string} sessionId - Session the call belongs to.
   * @param {string} workspace - canonical workspace record.
   * @param {string} panelDirName - panel directory name.
   * @param {string} method - exported method name.
   * @param {unknown} args - JSON argument passed through to the handler.
   * @returns {Promise<unknown>} the handler's JSON value.
   */
  async function callPanelHost(sessionId, workspace, panelDirName, method, args) {
    if (!config.allowHostModules) throw new Error('这个部署关闭了面板的 Host 模块（allowHostModules: false）')
    const panelsRoot = join(workspace.path, config.panelsDir)
    const panelRoot = await safeResolve(panelsRoot, panelDirName)
    if (panelRoot === undefined) throw new Error('面板目录不存在')
    let meta = {}
    try {
      const parsed = JSON.parse(await readFile(join(panelRoot, 'panel.json'), 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed
    } catch (error) {
      throw new Error(`读取 panel.json 失败：${String(error?.message ?? error)}`)
    }
    const hostRel = typeof meta.host === 'string' && meta.host.trim() !== '' ? meta.host.trim() : undefined
    if (hostRel === undefined) throw new Error('这个面板没有声明 Host 模块（panel.json.host）')
    const hostFile = await safeResolve(panelRoot, hostRel)
    if (hostFile === undefined) throw new Error('Host 模块不在面板目录内')
    const module = await importHostModule(hostFile, hostModules)
    const context = {
      workspace: { id: workspace.id, title: workspace.title, path: workspace.path },
      panel: {
        id: typeof meta.id === 'string' && meta.id !== '' ? meta.id : panelDirName,
        title: typeof meta.title === 'string' ? meta.title : panelDirName,
        dir: panelDirName,
        root: panelRoot,
      },
      sessionId,
      panelsDir: config.panelsDir,
      logger: ctx.logger,
    }
    const handlers = await hostHandlersOf(module, context)
    const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined
    if (typeof handler !== 'function') throw new Error(`Host 模块没有提供方法「${method}」`)
    let timer
    const timeout = new Promise((_, rejectPromise) => {
      timer = setTimeout(() => rejectPromise(new Error(`Host 方法「${method}」超过 ${config.hostTimeoutMs}ms 未返回`)), config.hostTimeoutMs)
      timer.unref?.()
    })
    try {
      return await Promise.race([Promise.resolve(handler(args ?? {}, context)), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Apply the browser-trust fence; true when the request was already answered.
   * @param {import('node:http').IncomingMessage} req - request.
   * @param {import('node:http').ServerResponse} res - response.
   * @returns {boolean} whether the request was rejected.
   */
  const rejected = (req, res) => {
    const connection = ctx.get('connection')
    if (connection === undefined) {
      sendError(res, 403, 'no-trust-service', '当前部署没有连接信任服务，面板接口已拒绝')
      return true
    }
    const rejection = connection.requestRejection({ headers: req.headers })
    if (rejection === undefined) return false
    sendError(res, rejection, 'untrusted', '请求未通过浏览器信任校验')
    return true
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      const action = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\//, '')

      // ── GET /asset — one file inside one panel directory ──────────────────
      if (action === 'asset') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendError(res, 405, 'method', '资源只接受 GET')
          return
        }
        const workspace = workspaceOf(url.searchParams.get('ws') ?? '')
        if (workspace === undefined) {
          sendError(res, 404, 'unknown-workspace', '未知的工作区')
          return
        }
        const panelDirName = url.searchParams.get('panel') ?? ''
        if (!SLUG.test(panelDirName)) {
          sendError(res, 404, 'unknown-panel', '面板标识不合法')
          return
        }
        const rel = url.searchParams.get('p') ?? ''
        const panelsRoot = join(workspace.path, config.panelsDir)
        const panelRoot = await safeResolve(panelsRoot, panelDirName)
        if (panelRoot === undefined) {
          sendError(res, 404, 'unknown-panel', '面板目录不存在')
          return
        }
        const file = await safeResolve(panelRoot, rel)
        if (file === undefined) {
          sendError(res, 403, 'outside-panel', '路径不在面板目录内')
          return
        }
        let info
        try {
          info = await stat(file)
        } catch {
          sendError(res, 404, 'not-found', `找不到 ${rel}`)
          return
        }
        if (!info.isFile()) {
          sendError(res, 404, 'not-file', `${rel} 不是文件`)
          return
        }
        if (info.size > config.maxAssetBytes) {
          sendError(res, 413, 'too-large', `${rel} 超过 ${config.maxAssetBytes} 字节上限`)
          return
        }
        let body
        try {
          body = await readFile(file)
        } catch (error) {
          sendError(res, 500, 'read-failed', String(error?.message ?? error))
          return
        }
        res.writeHead(200, {
          'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-store',
          'content-length': body.length,
          'x-content-type-options': 'nosniff',
        })
        if (req.method === 'HEAD') res.end()
        else res.end(body)
        return
      }

      // ── POST routes — JSON in, JSON out ───────────────────────────────────
      if (req.method !== 'POST') {
        sendError(res, 405, 'method', '只接受 POST')
        return
      }
      let body
      try {
        body = await readJsonBody(req, 64 * 1024)
      } catch (error) {
        sendError(res, 400, 'bad-request', String(error?.message ?? error))
        return
      }
      const workspace = await workspaceFromBody(body)
      if (workspace === undefined) {
        sendError(res, 404, 'unknown-workspace', '无法定位这个会话所属的工作区，面板只对该工作区可见')
        return
      }

      if (action === 'list') {
        try {
          const discovery = await discoverPanels(workspace.path, config.panelsDir)
          sendJson(res, 200, {
            ok: true,
            workspace: {
              id: workspace.id,
              title: workspace.title,
              path: workspace.path,
              panelsDir: config.panelsDir,
              exists: discovery.exists,
            },
            panels: discovery.panels,
            warnings: discovery.warnings,
          })
        } catch (error) {
          sendError(res, 500, 'list-failed', String(error?.message ?? error))
        }
        return
      }

      if (action === 'file') {
        const rel = textField(body, 'path')
        if (rel === undefined) {
          sendError(res, 400, 'bad-request', '缺少 path')
          return
        }
        const file = await safeResolve(workspace.path, rel)
        if (file === undefined) {
          sendError(res, 403, 'outside-workspace', '路径不在工作区内')
          return
        }
        let info
        try {
          info = await stat(file)
        } catch {
          sendError(res, 404, 'not-found', `找不到 ${rel}`)
          return
        }
        if (!info.isFile()) {
          sendError(res, 400, 'not-file', `${rel} 不是文件`)
          return
        }
        if (info.size > config.maxReadBytes) {
          sendError(res, 413, 'too-large', `${rel} 有 ${info.size} 字节，超过 ${config.maxReadBytes} 字节上限`)
          return
        }
        let bytes
        try {
          bytes = await readFile(file)
        } catch (error) {
          sendError(res, 500, 'read-failed', String(error?.message ?? error))
          return
        }
        if (bytes.includes(0)) {
          sendError(res, 415, 'binary', `${rel} 是二进制文件，api.files.readText 只能读文本`)
          return
        }
        sendJson(res, 200, { ok: true, path: rel, text: bytes.toString('utf8') })
        return
      }

      if (action === 'dir') {
        const rel = textField(body, 'path') ?? '.'
        const dir = await safeResolve(workspace.path, rel)
        if (dir === undefined) {
          sendError(res, 403, 'outside-workspace', '路径不在工作区内')
          return
        }
        let entries
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch (error) {
          sendError(res, 404, 'not-a-directory', String(error?.message ?? error))
          return
        }
        const items = entries
          .filter(entry => !entry.name.startsWith('.') || rel === '.')
          .map(entry => ({
            name: entry.name,
            kind: entry.isDirectory() ? 'dir' : 'file',
          }))
          .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'zh-CN') : a.kind === 'dir' ? -1 : 1))
        sendJson(res, 200, { ok: true, path: rel, entries: items.slice(0, MAX_DIR_ENTRIES), truncated: items.length > MAX_DIR_ENTRIES })
        return
      }

      if (action === 'host') {
        if (!config.allowHostModules) {
          sendError(res, 403, 'host-disabled', '这个部署关闭了面板的 Host 模块（allowHostModules: false）')
          return
        }
        const sessionId = textField(body, 'sessionId')
        const panelDirName = textField(body, 'panel')
        const method = textField(body, 'method')
        if (sessionId === undefined || !SESSION_ID_RE.test(sessionId)) {
          sendError(res, 400, 'bad-request', '缺少合法的 sessionId')
          return
        }
        if (panelDirName === undefined || !SLUG.test(panelDirName)) {
          sendError(res, 400, 'bad-request', '缺少合法的 panel')
          return
        }
        if (method === undefined || !HOST_METHOD_RE.test(method)) {
          sendError(res, 400, 'bad-request', '缺少合法的 method')
          return
        }
        try {
          const value = await callPanelHost(sessionId, workspace, panelDirName, method, body.args)
          let text
          try {
            text = JSON.stringify({ ok: true, value: value === undefined ? null : value })
          } catch (error) {
            sendError(res, 500, 'not-serializable', `Host 方法的返回值无法序列化为 JSON：${String(error?.message ?? error)}`)
            return
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) })
          res.end(text)
        } catch (error) {
          sendError(res, 500, 'host-failed', String(error?.message ?? error))
        }
        return
      }

      sendError(res, 404, 'not-found', `未知接口 ${action === '' ? '/' : `/${action}`}`)
    },
  }), `workspace-panels: ${ROUTE_PREFIX}`)

  registerSkill(ctx, config)

  ctx.logger?.info?.('workspace-panels: 面板目录 %s，路由 %s', config.panelsDir, ROUTE_PREFIX)
}

export const name = 'workspace-panels'

/** Services this row needs before it can serve anything. */
export const inject = ['webServer', 'workspaceRegistry']
