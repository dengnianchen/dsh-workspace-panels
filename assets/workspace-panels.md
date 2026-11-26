# 工作区面板（workspace panels）

为**当前工作区**写一个视图模块（UI 里叫「工作区视图」）。用户在右侧栏「开始」页点这张卡片，右侧栏会打开一个标签页并列出本工作区的视图；选中一个即在该标签页里渲染它（标签页头部还能随时切换视图、重新加载）。卡片可以点多次，每个页签一个面板，**同一个面板也可能同时开在两个页签里**；所以入口模块会被实例化多份，不要用模块级全局变量存状态，状态放进组件或 `createPanel(api)` 的闭包里。面板只属于这个工作区，别的工作区看不到它。

## 什么时候用

- 用户要「给这个项目做个面板 / 看板 / 仪表盘 / 视图 / 小工具」，并把数据长期留在工作区里。
- 已有面板打不开、报错、样式串味或需要加功能。

不需要新页面的一次性展示，用普通回答即可，不要建面板。

## 文件放哪里

每个面板是工作区里的一个目录 `{{panelsDir}}/<面板名>/`（`{{panelsDir}}` 默认为 `.dsh/panels`，可在插件配置里改）：

```
{{panelsDir}}/<面板名>/
  panel.json     元信息（必需）
  index.js       入口模块（必需，或用 panel.json 的 entry 指定）
  panel.css      样式（可选，在 panel.json 的 styles 里登记）
  icon.svg       卡片图标（可选，在 panel.json 的 icon 里登记）
```

`<面板名>` 与 `panel.json.id` 只能含字母、数字、`.`、`_`、`-`，且不以符号开头。

## panel.json

```json
{
  "id": "build-status",
  "title": "构建状态",
  "description": "最近一次构建的用例通过率与耗时",
  "entry": "index.js",
  "styles": ["panel.css"],
  "icon": "icon.svg",
  "order": 10,
  "host": "host.js"
}
```

只有 `title` 值得认真写，其余可省略：`entry` 默认 `index.js`，`styles` 默认空，`order` 默认 0（小的排前面），`id` 默认目录名。`description` 会显示在卡片上，一两句即可。

## 入口模块

纯 ES 模块，**没有构建步骤、不能写裸 import**（`import x from 'some-package'` 会失败）。两种导出任选其一：

### 首选：`createPanel(api)` 返回 React 组件

```js
export function createPanel(api) {
  const { React, h } = api

  function Panel() {
    const [rows, setRows] = React.useState(null)
    const [error, setError] = React.useState('')

    React.useEffect(() => {
      api.files.readText('data/runs.json')
        .then((text) => setRows(JSON.parse(text)))
        .catch((reason) => setError(String(reason.message ?? reason)))
    }, [])

    if (error !== '') return h('div', { className: 'my-panel-empty' }, error)
    if (rows === null) return h('div', { className: 'my-panel-empty' }, '读取中…')

    return h('div', { className: 'my-panel' },
      h('h2', { className: 'my-panel-title' }, `共 ${rows.length} 条`),
      ...rows.map((row) => h('div', { className: 'my-panel-row', key: row.id }, row.name)))
  }

  return Panel
}
```

组件自带的 hooks 都可用（`useState`/`useEffect`/`useMemo`…）。`createPanel` 里可以放闭包状态，但**不要**在组件外部直接操作 DOM。

### 备选：`mount(container, api)`

```js
export function mount(container, api) {
  const box = document.createElement('div')
  box.textContent = `工作区：${api.workspace.title}`
  container.appendChild(box)
  return () => box.remove()   // 卸载时清理定时器、监听器
}
```

`mount` 也可以返回 `Promise`。也可以用 `export default` 导出一个 React 组件，效果与 `createPanel` 相同。

## api 速查

| 成员 | 说明 |
|---|---|
| `api.React` / `api.h` | React 运行时与 `createElement`（无 JSX，写 `h('div', props, …children)`） |
| `api.workspace` | `{ id, title, path }`，`path` 是工作区绝对路径 |
| `api.panel` | `{ id, title, description, dir }` |
| `api.files.readText(path)` | 读工作区内的 UTF-8 文本，返回 `Promise<string>`；路径相对工作区根，越界会被拒绝，上限 512 KiB |
| `api.files.listDir(path?)` | 列工作区内的目录，返回 `Promise<[{ name, kind: 'dir' \| 'file' }]>`，默认根目录，最多 500 项 |
| `api.theme.scheme` | `'light'` 或 `'dark'`，每次读取都是当前值 |
| `api.reload()` | 重新导入入口模块并重挂面板 |
| `api.log(...)` / `api.error(...)` | 带面板前缀的控制台输出 |
| `api.sessionId` | 面板所属的 Session id（主机解析，可信） |
| `api.host.call(method, args)` | 调本面板 Host 模块的方法；**只有 `panel.json` 声明了 `host` 才存在** |

面板里**不能**直接读宿主机文件系统：数据一律走 `api.files`（工作区相对路径），或者由用户把数据放进工作区。

## Host 模块（面板要跑本地命令 / 读宿主机时）

浏览器里的面板读不了宿主机、起不了进程。把这类逻辑放进同目录的 Node 模块，并在 `panel.json` 写 `"host": "host.js"`：

```js
// host.js
export async function createHandlers(context) {
  // context: { workspace:{id,title,path}, panel:{id,title,dir,root}, sessionId, panelsDir, logger }
  return {
    async ping(args) { return { echo: args, session: context.sessionId } },
  }
}
```

```js
// index.js
export function createPanel(api) {
  const { React, h } = api
  return function Panel() {
    const [value, setValue] = React.useState(null)
    React.useEffect(() => {
      api.host.call('ping', { hello: 1 }).then(setValue).catch((reason) => api.error(reason))
    }, [])
    return h('div', null, value === null ? '…' : JSON.stringify(value))
  }
}
```

要点：

- `createHandlers(context)` 每请求调用一次；也可以直接 `export const handlers = {...}` 或默认导出对象。方法名须是标识符，返回值须能 JSON 序列化，超时默认 120s。
- 每次调用都先过主机的浏览器信任栅栏，并重新解析「这个会话属于哪个工作区」，再按 `panel.json` 找到 Host 模块——所以 Host 模块只能被本工作区的面板调到。
- 改 `host.js` 后点页签头的「⟳」即可生效（模块按 mtime 重新导入）。模块级变量跨请求保留，适合放缓存与写入锁。
- Host 模块有完整 Node 权限（与 Agent 的 bash 同级信任），插件不沙箱。部署方可用 `allowHostModules: false` 整体关掉。

## 样式

面板挂在一个 shadow root 里：宿主的样式进不来，面板的样式也出不去。所以：

- **图标**：`panel.json` 的 `icon` 会同时用在「开始」卡片、选择列表和**页签标题**上，三处都按 16px 渲染。用正方形 SVG（`viewBox="0 0 64 64"` 配一个圆角底色块最稳），不要放文字或细线细节，16px 下会糊。没有 icon 时页签显示本插件的四格标记。
- 自己写类名（建议 `my-panel-*`），不要在 `panel.css` 里重置 `html`/`body`/`*`——虽然影响不到宿主，但会让你自己的布局难调。
- 用宿主的主题变量，深色模式自动跟着变：

  | 变量 | 用途 |
  |---|---|
  | `--dsw-alias-label-primary` | 正文文字 |
  | `--dsw-alias-label-secondary` | 次要文字、说明 |
  | `--dsw-alias-border-l1` | 分割线、描边 |
  | `--dsw-alias-bg-layer-1` / `-2` | 卡片底色 / 更浅一层 |
  | `--dsw-alias-brand-primary` | 强调色：边框、选中态、图标 |
  | `--dsw-alias-button-primary-fill` / `-hover` | 实心按钮底色 / 悬停 |
  | `--dsw-alias-label-on-color` | 实心按钮上的文字 |
  | `--dsw-alias-link` | 链接 |
  | `--dsw-alias-state-error-primary` | 错误文字 |

  **实心按钮必须用 `button-primary-fill` + `label-on-color`**：`brand-primary` 在深色主题里可能是接近白色（本机就是 `#f3f8ff`），拿它做底色再写白字会看不见。除此之外不要写字面颜色。
- 面板容器高度是满的、宽度通常是 300~45% 视口，自己决定内部滚动（例如外层 `height:100%; overflow:auto`）；窄宽度下优先用单列或自适应网格，不要写死 `width`。
- 页签切走后面板**保持挂载**（只是隐藏）：定时器、轮询会继续跑，切回来状态还在。如果你的面板有较重的定时任务，记得在用户看不见时降频——`api` 目前没有提供可见性信号，需要就在组件里用 `document.visibilityState` 或自己记一个 `visible` 变量，也可以在卸载时清掉所有定时器。
- 不要引用外部 CDN 或别的插件的文件；需要图片就放进面板目录，用相对路径 `<img src="logo.svg">` 即可（同目录资源由宿主路由提供）。

## 交付前自检

1. `panel.json` 是合法 JSON，`title` 写清楚了。
2. 入口模块用 `node --check` 能过语法；没有裸 import。
3. `panel.json` 里的 `icon` 在 16px 下能认出来（页签、卡片、选择列表都用它）。
4. 面板在空数据、出错时都有可读的提示，不是白屏。
5. 在右侧栏「开始」页点「工作区视图」→ 侧栏标签页里列出该面板 → 选中 → 渲染正确；改入口模块后点标签页头的「⟳」看新版本；改 `panel.json` 或新增面板目录后，重新点一次卡片（或切换面板再切回来）刷新列表。
6. 侧栏宽度可能只有 300px 出头，别写死宽度；深色与浅色都看一眼文字对比度。

## 常见故障

| 现象 | 原因 |
|---|---|
| 选择列表里没有这个视图 | 目录不在 `{{panelsDir}}/` 下、目录名不合法、缺少入口模块；重新点一次卡片刷新列表；关闭面板时会显示具体原因。 |
| 卡片出现但打开报「模块加载失败」 | 入口模块有语法错误，或用了裸 import / 顶层 await 之外的宿主 API。控制台有原始错误。 |
| 「需要导出 createPanel(api)、mount(container, api) 或 default 组件之一」 | 导出名写错，或写成了 CommonJS（`module.exports`）。 |
| 样式不生效 | `panel.css` 没在 `panel.json.styles` 里登记，或类名写错。侧栏很窄，先从响应式布局查起。 |
| 读文件被拒绝 | 路径用了绝对路径或 `..`；面板只能读工作区内的相对路径。 |
