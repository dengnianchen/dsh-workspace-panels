# 工作区视图 · @dyapple/dsh-workspace-panels

给每个工作区一份自己的侧栏视图：DSH 右侧栏「开始」页里多一张 **工作区视图** 卡片，点开是当前会话所属工作区自定义的视图列表，选中就在侧栏标签页里渲染它 —— 可以同时开好几个。

> A DeepSeek Harness plugin that adds a **Workspace views** card to the right Sidebar's Start page. It lists the views defined by the session's workspace (`.dsh/panels/<name>/panel.json` + an entry module), opens each in its own sidebar tab — several at once — and ships a `workspace-panels` skill so an agent can write and debug those views. Alpha; see [状态](#状态).

![工作区视图](docs/preview.svg)

## 为什么需要它

DSH 的右侧栏原本是"把某个事实看近一点"的地方：文件、Git、终端、任务。项目里还有一类东西没有位置——这个仓库自己的构建状态、数据集概览、评审看板、实验记录。它们既不是文件树也不是终端，用 Markdown 回答又活不过一个会话。

这个插件把"工作区自己的视图"变成一等公民：视图是工作区里的一段代码（`panel.json` + 一个 ES 模块），插件的唯一职责是**只对当前会话所属工作区**发现它们、在隔离的沙箱里渲染它们，并让 Agent 能直接写新的。

## 安装

DSH 插件页 → **添加插件**，填入：

```
github:dengnianchen/dsh-workspace-panels#v0.1.0-alpha.2
```

或者让 Agent 用 `plugin_manager` 装同一个规格：

```text
plugin_manager action=install_bundle target=github:dengnianchen/dsh-workspace-panels#v0.1.0-alpha.2
```

安装后无需配置。装的是 git tag 快照；升级换 tag 重装即可（见 [开发](#开发)）。

要求：DSH `0.2.2-rc.3` 或其兼容版本，Node ≥ 20。

## 用法

1. 打开任意会话，展开右侧栏，切到 **开始**；
2. 点 **工作区视图**（副标题"打开本工作区的专属视图"）——侧栏里会出现一个同名标签页；
3. 标签页里列出这个工作区的视图，点一个即渲染；标签页头部还能「重新加载」（改完代码按它）和「切换视图」；
4. 想同时看两个视图？回到「开始」再点一次卡片，就有第二个标签页（每个标签页一个视图，切走的保持挂载，状态不丢）。

标签页图标就是该视图 `panel.json` 里的 `icon`，没声明 icon 时显示本插件的四格标记。

> 如果你的 profile 装了会接管「开始」页的插件（例如 `dsh-better-sidebar` 的 `guideTakeover`），卡片由它渲染，点击行为是"开标签页"，插件无法在那张卡片上挂自己的下拉菜单。关掉那个接管开关后，会改由本插件自己的卡片渲染。

## 视图模块

一个视图就是一个目录：

```
<workspace>/.dsh/panels/<视图名>/
  panel.json     元信息（必需）
  index.js       入口模块（默认，可用 panel.json.entry 改）
  panel.css      样式（可选，在 styles 里登记）
  icon.svg       16px 也能认出的方形图标（可选）
  host.js        Node 侧方法（可选，见 Host 模块）
```

`panel.json`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `title` | 目录名 | 卡片与标签页上的名字 |
| `description` | 空 | 卡片上的一行说明 |
| `id` | 目录名 | 稳定标识，`[A-Za-z0-9._-]` |
| `entry` | `index.js` | 入口模块（相对路径，必须在视图目录内） |
| `styles` | `[]` | 要注入 shadow root 的样式文件 |
| `icon` | 无 | 视图图标（卡片、列表、标签页三处都用 16px 渲染） |
| `order` | `0` | 列表排序，小的在前 |
| `host` | 无 | Host 模块文件名（见下文） |

入口模块是纯 ES 模块，**没有构建步骤**，不要写裸 import。三种导出任选其一：

```js
// 首选：返回一个 React 组件
export function createPanel(api) {
  const { React, h } = api
  return function View() {
    const [rows, setRows] = React.useState(null)
    React.useEffect(() => {
      api.files.readText('data/runs.json').then(t => setRows(JSON.parse(t)))
    }, [])
    return h('div', null, rows === null ? '读取中…' : `共 ${rows.length} 条`)
  }
}
```

```js
// 或者：原生 DOM，返回清理函数
export function mount(container, api) {
  const el = document.createElement('div')
  el.textContent = api.workspace.title
  container.append(el)
  return () => el.remove()
}
```

也可以用 `export default` 直接导出一个 React 组件。

### `api`

| 成员 | 说明 |
|---|---|
| `api.React` / `api.h` | React 运行时与 `createElement`（无 JSX） |
| `api.workspace` | `{ id, title, path }` |
| `api.panel` | `{ id, title, description, dir }` |
| `api.sessionId` | 主机解析出的会话身份 |
| `api.files.readText(path)` | 读工作区内 UTF-8 文本（限长、拒二进制、越界拒绝） |
| `api.files.listDir(path?)` | 列工作区内目录（最多 500 项） |
| `api.theme.scheme` | `'light'` \| `'dark'`，每次读都是当前值 |
| `api.reload()` | 重新导入入口模块并重挂视图 |
| `api.log(...)` / `api.error(...)` | 带视图前缀的控制台输出 |
| `api.host.call(method, args)` | 调本视图 Host 模块的方法（仅声明了 `host` 时存在） |

## Host 模块

视图入口跑在浏览器里，读不到宿主机文件系统、起不了进程。需要这类能力时，在同目录放一个 Node 模块并在 `panel.json` 里声明：

```json
{ "host": "host.js" }
```

```js
// host.js —— 运行在 Host 进程里，按请求拿 context
export async function createHandlers(context) {
  // context: { workspace:{id,title,path}, panel:{id,title,dir,root}, sessionId, panelsDir, logger }
  return {
    async statCacheDir() {
      return { ok: true, at: Date.now() }
    },
  }
}
```

面板侧：`const value = await api.host.call('statCacheDir')`。

边界：

- `createHandlers(context)` 每请求调用一次并返回方法表；也接受 `handlers` 对象或默认导出对象。方法名须是标识符，返回值须能 JSON 序列化，单次调用受 `hostTimeoutMs`（默认 120s）限制。
- 方法收到 `(args, context)`；`context.sessionId` 是主机自己解析的可信身份，不要相信浏览器在 `args` 里塞的身份。
- 模块只在文件变更后重新导入（import URL 带 mtime），改完点标签页头的「⟳」即生效；模块级变量跨请求保留，适合放缓存或写锁。
- **信任**：Host 模块带完整 Node 权限，等于工作区里一段可执行代码（与 Agent 的 bash 同级）。插件不做沙箱。不想开这条通路就把 `allowHostModules` 设成 `false`。

## 样式

视图挂在自己的 shadow root 里：视图的 CSS 进不了 Harness，Harness 的 CSS 也进不了视图，而主题变量照常继承，深色模式自动跟随。

| 变量 | 用途 |
|---|---|
| `--dsw-alias-label-primary` / `-secondary` / `-tertiary` | 正文 / 次要 / 最弱文字 |
| `--dsw-alias-border-l1` | 分割线、描边 |
| `--dsw-alias-bg-layer-1` / `-2` | 卡片底色 / 更浅一层 |
| `--dsw-alias-brand-primary` | 强调色：边框、选中态、图标 |
| `--dsw-alias-button-primary-fill` / `-hover` | 实心按钮底色 / 悬停 |
| `--dsw-alias-label-on-color` | 实心按钮上的文字 |
| `--dsw-alias-link` / `--dsw-alias-state-error-primary` | 链接 / 错误文字 |

实心按钮请用 `button-primary-fill` + `label-on-color`：`brand-primary` 在深色主题下可能接近白色，拿它做底色再写白字会看不见。侧栏宽度常常只有 300px 出头，别写死宽度。

图标同时用在「开始」卡片、选择列表和标签页标题上，都是 16px——用正方形 SVG（`viewBox="0 0 64 64"` 加圆角底色块最稳），别放文字和细线细节。

## 配置

`cordis.patch.yml` 的 `config`（整块替换；省略的键用默认值）：

| 键 | 默认 | 说明 |
|---|---|---|
| `panelsDir` | `.dsh/panels` | 工作区相对的视图目录 |
| `maxAssetBytes` | `2097152` | 视图资源（js/css/图片/字体）单文件上限 |
| `maxReadBytes` | `524288` | `api.files.readText` 单文件上限 |
| `skillName` | `workspace-panels` | 随包注册的技能名 |
| `allowHostModules` | `true` | 是否允许视图声明 Host 模块；关掉后 `api.host` 不存在、`/host` 返回 403 |
| `hostTimeoutMs` | `120000` | 单次 `api.host.call` 超时 |

## 路由

一条前缀路由 `/dsh-workspace-panels`，全部请求先过 `ctx.connection.requestRejection`（Host/Origin 栅栏 + 浏览器认证）：

| 路由 | 方法 | 作用 |
|---|---|---|
| `/list` | POST | `{sessionId}`（或 `workspaceId`）→ 视图列表、警告、视图目录 |
| `/file` | POST | `{sessionId\|workspaceId, path}` → 工作区内 UTF-8 文本 |
| `/dir` | POST | `{sessionId\|workspaceId, path}` → 目录项 |
| `/host` | POST | `{sessionId, panel, method, args}` → 调 Host 模块方法 |
| `/asset?ws=&panel=&p=&v=` | GET | 视图目录内的单个文件（按扩展名给 content-type） |

## 安全模型

- **只认已注册的工作区**：浏览器只交 `sessionId`；主机用工作区注册表（会话成员关系，回落到会话工作目录）解析出工作区，再把它给的路径与工作区根做 `realpath` 比对，符号链接也走不出去。
- **不跨工作区**：视图列表永远按当前会话所属工作区计算，别的目录不会被扫描。
- **信任栅栏**：每个请求都过 DSH 的 Host/Origin 栅栏与浏览器认证，没有 Cookie 的一律 401。
- **视图代码 = 工作区代码**：入口模块在页面同源上下文运行（能发同源请求、能读它自己目录下的资源）；Host 模块在 Host 进程里带完整权限。两者都按"工作区里的一段可执行代码"对待，插件不提供沙箱。

## 状态

`0.1.0-alpha.1` 是 alpha：接口（`api`、`panel.json` 字段、配置键）可能还会变。

已实测（DSH `0.2.2-rc.3` + Chromium）：

- 「开始」页出现卡片，点开在侧栏打开视图标签页，选中后标题与图标换成该视图的；
- 同时开两个视图标签页，各自渲染互不影响；
- 标签页图标为视图的 `icon.svg`（16×16），未选视图时显示四格标记；
- `api.files.readText` / `listDir`、`panel.css`、主题变量与 `api.theme.scheme` 正常；
- 切到另一个工作区的会话后，只显示该工作区的视图（空态给出确切路径）。

尚未逐项验证：`keepMounted` 切走再切回的状态保持、「切换视图」回列表、`panel.json` 写坏时的告警行、浅色主题观感、`mount()` 原生分支、Host 模块的超时与并发。

## 开发

双轨分支：

- `main` —— 发布线。只接受从 `dev` 合并的发布提交，`v*` tag 都打在 `main` 上。
- `dev` —— 开发线。日常提交在这里。

发版：

```bash
git checkout main
git merge --no-ff dev
git tag -a v0.1.1 -m "v0.1.1"
git push origin main dev --follow-tags
```

本地调试用 link 安装（改完刷新页面即生效，Host 侧改动需要 recompose）：

```text
plugin_manager action=install_bundle target=/absolute/path/to/dsh-workspace-panels
```

正式安装用 tag 快照（上面[安装](#安装)里的命令）。两者同名，装新的之前先 `remove_bundle`。

仓库里 `examples/` 是可复制的参考视图：`examples/self-check/` 跑通了 `api` 的每一项（React 状态、shadow root 内事件、主题、`api.files`、`reload()`）。复制它作为起点：

```bash
cp -r examples/self-check <workspace>/.dsh/panels/my-view
```

`.dsh/panels/` 已被 gitignore：你自己的视图不会跟着这个仓库提交。

随包注册的技能 `workspace-panels` 会把完整契约交给 Agent——包括"面板跑在浏览器里，需要宿主机能力时用 Host 模块"这条边界。

## 已知限制

- 视图发现是**拉取式**的：没有文件监听。新增视图目录或改 `panel.json` 后，重新点一次卡片（或切换视图再切回）才重新扫描；改入口模块后点标签页头的「⟳」。
- 视图发出的请求受浏览器同源/CORS 约束；读工作区文件只能走 `api.files` 或 Host 模块。
- 同一视图可以同时开在多个标签页里：入口模块会被实例化多份，不要用模块级全局变量存状态（Host 模块的模块级变量则是跨请求共享的，可用作缓存）。
- 标签页切走后视图保持挂载：定时器与轮询继续跑，重任务请自己按 `document.visibilityState` 降频。
- 「开始」页的卡片由谁渲染取决于 profile：装了接管「开始」页的插件时，卡片点击固定是"开标签页"，插件拿不到卡片级菜单。

## License

[MIT](LICENSE)
