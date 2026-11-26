/**
 * Client half of the workspace-panels plugin.
 *
 * One tab type, reached from the right Sidebar's 「开始」 guide:
 *
 *   - a guide card (`sidebar.right.tab.guide.entry`) that opens a dropdown of
 *     the panels this Session's Workspace provides;
 *   - the tab body (`sidebar.right.pane.tab`) that mounts the chosen panel;
 *   - the tab chip (`sidebar.right.pane.tab.title`) that shows its title.
 *
 * The Workspace is resolved on the Host from the Session id, so what the
 * dropdown offers is exactly what that Session's Workspace owns — no other
 * workspace's panels are reachable from here.
 *
 * A panel is loaded as an ES module from the Host's asset route and mounted
 * inside a shadow root: its CSS cannot reach the Harness UI and the Harness
 * UI's CSS cannot reach it, while theme tokens still inherit through.
 */

window.__ModuleLoader__.load({
  id: '@dyapple/dsh-workspace-panels',
  factory(require) {
    const React = require('react')
    const { createRoot } = require('react-dom/client')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    /** Locale namespace of every string this plugin renders. */
    const NS = 'workspace-panels'
    /** Tab-type identity in the right Sidebar's registry. */
    const TYPE_ID = '@dyapple/dsh-workspace-panels/panel'
    /** Page kind the guide card opens; also the params key namespace. */
    const KIND = 'workspace-panels'
    /** Guide entry identity inside this type. */
    const ENTRY_ID = 'workspace-panels'
    /** Host route prefix registered by index.js. */
    const ROUTE = '/dsh-workspace-panels'

    const CARD_CSS = `
.wswp-card{position:relative;box-sizing:border-box;display:flex;align-items:center;gap:14px;width:100%;min-height:56px;padding:14px 20px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsl-guide-entry-radius,20px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.wswp-card:hover{background:var(--dsw-alias-bg-layer-2)}
.wswp-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.wswp-card-icon{flex:none;display:flex;align-items:center;justify-content:center;width:26px;height:26px;color:var(--dsw-alias-label-secondary)}
.wswp-card-text{flex:1 1 auto;display:flex;flex-direction:column;gap:3px;min-width:0}
.wswp-card-title{overflow:hidden;font-size:14px;line-height:1.4;white-space:nowrap;text-overflow:ellipsis}
.wswp-card-desc{overflow:hidden;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis}
.wswp-card-chevron{flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:20px;color:var(--dsw-alias-label-tertiary)}
`

    const BODY_CSS = `
.wswp-tab{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.wswp-tab-head{flex:none;display:flex;align-items:center;gap:6px;padding:6px 8px 6px 12px;min-width:0}
.wswp-tab-title{flex:1 1 auto;min-width:0;font-size:12px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wswp-tab-sub{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.wswp-icon-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:.5px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;cursor:pointer}
.wswp-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.wswp-icon-btn:disabled{opacity:.45;cursor:default}
.wswp-tab-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l1)}
.wswp-host{flex:1 1 auto;min-height:0;display:block;overflow:hidden}
.wswp-note{margin:10px 12px;padding:10px 12px;border-radius:8px;border:.5px dashed var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7;word-break:break-word}
.wswp-note b{color:var(--dsw-alias-label-primary);font-weight:600}
.wswp-note code{padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);font-family:var(--dsh-font-family-code,ui-monospace,monospace);font-size:11px;word-break:break-all}
.wswp-err{margin:8px 12px 0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary);font-size:12px;white-space:pre-wrap;word-break:break-word;font-family:var(--dsh-font-family-code,ui-monospace,monospace)}
.wswp-warn{margin:8px 12px 0;padding:8px 10px;border-radius:8px;border:.5px dashed var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.6}
.wswp-warn ul{margin:4px 0 0;padding-left:16px}
.wswp-picker{display:flex;flex-direction:column;gap:4px;padding:10px 12px;overflow-y:auto}
.wswp-picker-title{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:2px 2px 4px}
.wswp-picker-row{display:flex;align-items:flex-start;gap:8px;width:100%;box-sizing:border-box;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.wswp-picker-row:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.wswp-picker-row[data-active="true"]{border-color:var(--dsw-alias-brand-primary)}
.wswp-picker-foot{display:flex;justify-content:flex-end;padding:2px 2px 4px}
.wswp-link{border:0;background:transparent;color:var(--dsw-alias-link);font:inherit;font-size:11.5px;cursor:pointer;padding:2px 4px;border-radius:4px}
.wswp-link:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wswp-picker-icon{flex:none;display:flex;align-items:center;justify-content:center;width:16px;height:18px;color:var(--dsw-alias-label-secondary)}
.wswp-picker-icon img{width:14px;height:14px;object-fit:contain;display:block}
.wswp-picker-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.wswp-picker-name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wswp-picker-desc{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary);word-break:break-word}
.wswp-mount{height:100%;min-height:0;overflow:auto}
`

    /** Styles every panel gets inside its own shadow root, before its own CSS. */
    const SHADOW_BASE = ':host{display:block;height:100%;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}\n'
      + '*,*::before,*::after{box-sizing:border-box}\n'
      + '.wswp-mount{height:100%;min-height:0;overflow:auto}\n'

    // ── Host API ─────────────────────────────────────────────────────────────

    /**
     * Call one Host API action.
     * @param {string} action - `list`, `file` or `dir`.
     * @param {Record<string, unknown>} payload - request body.
     * @returns {Promise<any>} the response body of a successful call.
     */
    async function call(action, payload) {
      let response
      try {
        response = await fetch(`${ROUTE}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        })
      } catch (error) {
        throw new Error(`无法连接面板接口（${messageOf(error)}）`)
      }
      const text = await response.text()
      let data = null
      try {
        data = text === '' ? null : JSON.parse(text)
      } catch {
        data = null
      }
      if (!response.ok || data === null || data.ok !== true) {
        const detail = data && data.error && data.error.message ? data.error.message : `接口返回 HTTP ${response.status}`
        throw new Error(detail)
      }
      return data
    }

    /**
     * Absolute URL of one file inside one panel directory.
     * @param {string} workspaceId - owning workspace.
     * @param {string} dirName - panel directory name.
     * @param {string} rel - panel-relative path.
     * @param {string} nonce - cache-busting token.
     * @returns {string} same-origin URL.
     */
    function assetUrl(workspaceId, dirName, rel, nonce) {
      const query = new URLSearchParams({ ws: workspaceId, panel: dirName, p: rel, v: nonce })
      return `${ROUTE}/asset?${query.toString()}`
    }

    /** Turn anything thrown into one readable sentence. */
    function messageOf(error) {
      if (error instanceof Error && error.message) return error.message
      if (typeof error === 'string') return error
      return '未知错误'
    }

    // ── Panel module loading ────────────────────────────────────────────────

    /**
     * Build the `api` object handed to a panel module. This is the panel's
     * whole contract with the Harness; `assets/workspace-panels.md` documents it.
     *
     * @param {object} input - identity of the mounted panel.
     * @returns {object} the panel API.
     */
    function panelApi({ workspace, panel, sessionId, reload }) {
      const workspaceId = workspace.id
      return {
        React,
        h,
        workspace: { id: workspaceId, title: workspace.title, path: workspace.path },
        sessionId,
        panel: { id: panel.id, title: panel.title, description: panel.description, dir: panel.dirName },
        files: {
          /**
           * Read one UTF-8 text file inside the workspace.
           * @param {string} path - workspace-relative path.
           * @returns {Promise<string>} file text.
           */
          readText: async (path) => {
            const data = await call('file', { sessionId, workspaceId, path })
            return data.text
          },
          /**
           * List one directory inside the workspace.
           * @param {string} [path] - workspace-relative path; workspace root by default.
           * @returns {Promise<Array<{name: string, kind: 'dir' | 'file'}>>} entries.
           */
          listDir: async (path) => {
            const data = await call('dir', { sessionId, workspaceId, path: path ?? '.' })
            return data.entries
          },
        },
        host: panel.host === null || panel.host === undefined || panel.host === ''
          ? undefined
          : {
            /**
             * Call one method of this panel's Host module (see `panel.json.host`).
             * @param {string} method - exported method name.
             * @param {object} [args] - JSON payload for the handler.
             * @returns {Promise<unknown>} the handler's JSON value.
             */
            call: async (method, args) => {
              const data = await call('host', {
                sessionId,
                workspaceId,
                panel: panel.dirName,
                method,
                args: args ?? {},
              })
              return data.value
            },
          },
        theme: {
          /** @returns {'light' | 'dark'} the color scheme the page is showing. */
          get scheme() {
            return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
          },
        },
        reload,
        log: (...args) => {
          console.log(`[panel:${panel.id}]`, ...args)
        },
        error: (...args) => {
          console.error(`[panel:${panel.id}]`, ...args)
        },
      }
    }

    /**
     * Mount one panel inside an isolated shadow root.
     *
     * The module may export `createPanel(api)` (preferred: returns a React
     * component) or `mount(container, api)` (vanilla, may return a cleanup
     * function). Either way its DOM and CSS stay inside this shadow root.
     *
     * @param {object} props - React props.
     * @returns {any} React node.
     */
    function PanelSurface({ workspace, panel, sessionId, nonce, reload, onFailure }) {
      const hostRef = React.useRef(null)
      const [mountNode, setMountNode] = React.useState(null)
      const [module, setModule] = React.useState(null)
      const [failure, setFailure] = React.useState('')

      // A React root lives inside the shadow root rather than in the page tree:
      // events on panel elements then bubble to a root React can see.
      React.useEffect(() => {
        const host = hostRef.current
        if (host === null) return undefined
        const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
        while (shadow.firstChild !== null) shadow.removeChild(shadow.firstChild)
        const base = document.createElement('style')
        base.textContent = SHADOW_BASE
        shadow.appendChild(base)
        for (const rel of panel.styles) {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = assetUrl(workspace.id, panel.dirName, rel, nonce)
          shadow.appendChild(link)
        }
        const node = document.createElement('div')
        node.className = 'wswp-mount'
        shadow.appendChild(node)
        setMountNode(node)
        return () => {
          setMountNode(null)
        }
      }, [workspace.id, panel.dirName, panel.styles.join('|'), nonce])

      React.useEffect(() => {
        let disposed = false
        setModule(null)
        setFailure('')
        const url = assetUrl(workspace.id, panel.dirName, panel.entry, nonce)
        import(/* @vite-ignore */ url).then(
          (namespace) => {
            if (!disposed) setModule(namespace)
          },
          (error) => {
            if (disposed) return
            const text = `面板模块加载失败：${messageOf(error)}\n${url}`
            setFailure(text)
            onFailure?.(text)
          },
        )
        return () => {
          disposed = true
        }
      }, [workspace.id, panel.dirName, panel.entry, nonce])

      React.useEffect(() => {
        if (mountNode === null || module === null) return undefined
        const api = panelApi({ workspace, panel, sessionId, reload })
        let teardown
        try {
          const Component = typeof module.createPanel === 'function'
            ? module.createPanel(api)
            : typeof module.default === 'function'
              ? module.default
              : undefined
          if (Component !== undefined) {
            if (typeof Component !== 'function') throw new Error('createPanel(api) 需要返回一个 React 组件')
            const root = createRoot(mountNode)
            root.render(h(Component, { api }))
            teardown = () => {
              queueMicrotask(() => {
                try {
                  root.unmount()
                } catch (error) {
                  console.warn('[workspace-panels] 面板卸载失败', error)
                }
              })
            }
          } else if (typeof module.mount === 'function') {
            const result = module.mount(mountNode, api)
            teardown = () => {
              if (typeof result === 'function') result()
            }
          } else {
            throw new Error('入口模块需要导出 createPanel(api)、mount(container, api) 或 default 组件之一')
          }
        } catch (error) {
          const text = `面板启动失败：${messageOf(error)}`
          setFailure(text)
          onFailure?.(text)
          return undefined
        }
        return () => {
          try {
            teardown?.()
          } catch (error) {
            console.warn('[workspace-panels] 面板清理失败', error)
          }
          while (mountNode.firstChild !== null) mountNode.removeChild(mountNode.firstChild)
        }
      }, [mountNode, module, workspace.id, panel.dirName, nonce])

      return h(React.Fragment, null,
        failure === '' ? null : h('div', { className: 'wswp-err' }, failure),
        h('div', { className: 'wswp-host', ref: hostRef }))
    }

    // ── Icons ───────────────────────────────────────────────────────────────

    /**
     * Four panes, the diagonal pair filled: this plugin's mark.
     * @param {{size?: number}} props - pixel edge.
     * @returns {any} React node.
     */
    function PanelsGlyph({ size = 22 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 2, y: 2.5, width: 5.2, height: 4.4, rx: 1.1, fill: 'currentColor' }),
        h('rect', { x: 8.8, y: 2.5, width: 5.2, height: 4.4, rx: 1.1, stroke: 'currentColor', strokeWidth: 1.1 }),
        h('rect', { x: 2, y: 9.1, width: 5.2, height: 4.4, rx: 1.1, stroke: 'currentColor', strokeWidth: 1.1 }),
        h('rect', { x: 8.8, y: 9.1, width: 5.2, height: 4.4, rx: 1.1, fill: 'currentColor', opacity: 0.55 }))
    }

    /**
     * Single card glyph used when a panel registered no icon.
     * @returns {any} React node.
     */
    function GridGlyph() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2, stroke: 'currentColor', strokeWidth: 1.1 }),
        h('path', { d: 'M2.5 6.2h11M6.4 6.2v7.3', stroke: 'currentColor', strokeWidth: 1.1 }))
    }

    /** Downward chevron marking an expandable control. */
    function ChevronGlyph() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M4 6.2 8 10.2l4-4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    // ── Guide card ──────────────────────────────────────────────────────────

    /**
     * The 「开始」 card: one button that opens this workspace's panel list.
     *
     * @param {object} props - guide owner props, locale, and the session inject.
     * @returns {any} React node.
     */
    function GuideCard({ title, description, kind, useTabInfo }) {
      const { tab } = useTabInfo()
      return h(React.Fragment, null,
        h('style', null, CARD_CSS),
        h('button', {
          type: 'button',
          className: 'wswp-card',
          'data-sidebar-right-guide-entry': kind,
          'aria-label': description === undefined ? title : `${title} ${description}`,
          onClick: () => {
            // No `replaceTab`: the guide stays open, so the card can be pressed
            // again for another panel tab.
            tab.actions.openTab(kind)
          },
        },
        h('span', { className: 'wswp-card-icon' }, h(PanelsGlyph, { size: 24 })),
        h('span', { className: 'wswp-card-text' },
          h('span', { className: 'wswp-card-title' }, title),
          description === undefined ? null : h('span', { className: 'wswp-card-desc' }, description))))
    }

    // ── Tab body ────────────────────────────────────────────────────────────

    /**
     * The tab: one panel of this Session's workspace. Its slim header carries a
     * reload button and a picker toggle; opening the tab without a panel (how
     * the 开始 card arrives here) shows the picker list first.
     *
     * @param {object} props - locale, session inject, and the framework tab hook.
     * @returns {any} React node.
     */
    function PanelTabBody({ sessionId, t, useTabInfo }) {
      const { tab } = useTabInfo()
      const params = tab.navigation.params ?? {}
      const panelId = typeof params.panelId === 'string' ? params.panelId : ''
      const revision = tab.navigation.revision
      const [tick, setTick] = React.useState(0)
      const [nonce, setNonce] = React.useState(() => String(Date.now()))
      const [picking, setPicking] = React.useState(panelId === '')
      const [state, setState] = React.useState({ phase: 'idle', panels: [], warnings: [], workspace: null, error: '' })

      React.useEffect(() => {
        let disposed = false
        setState((current) => (current.phase === 'idle' ? { ...current, phase: 'loading' } : current))
        call('list', { sessionId }).then(
          (data) => {
            if (disposed) return
            setState({
              phase: 'ready',
              panels: Array.isArray(data.panels) ? data.panels : [],
              warnings: Array.isArray(data.warnings) ? data.warnings : [],
              workspace: data.workspace ?? null,
              error: '',
            })
          },
          (error) => {
            if (disposed) return
            setState((current) => ({ ...current, phase: 'error', error: messageOf(error) }))
          },
        )
        return () => {
          disposed = true
        }
      }, [sessionId, tick])

      // Navigating this tab to another panel re-imports the module and leaves
      // the picker. The first run only records the arrival, so a tab opened
      // without a panel keeps its picker open.
      const lastNavigation = React.useRef(`${panelId}:${revision}`)
      React.useEffect(() => {
        const key = `${panelId}:${revision}`
        if (lastNavigation.current === key) return
        lastNavigation.current = key
        setNonce(String(Date.now()))
        setPicking(false)
      }, [revision, panelId])

      const panel = state.panels.find((row) => row.id === panelId)
      const workspace = state.workspace
      const title = panel !== undefined && panel.title !== ''
        ? panel.title
        : typeof params.panelTitle === 'string' && params.panelTitle !== ''
          ? params.panelTitle
          : t('tabTitle')

      /**
       * Open one panel in this tab.
       * @param {object} row - panel row from the Host.
       */
      const choose = (row) => {
        setPicking(false)
        tab.actions.openTab(KIND, {
          replaceTab: true,
          params: {
            panelId: row.id,
            panelTitle: row.title,
            iconUrl: row.icon === null || workspace === null ? '' : assetUrl(workspace.id, row.dirName, row.icon, 'icon'),
          },
        })
      }

      /** The chooser shown before a panel is picked, or when the user switches. */
      const pickerBody = () => {
        if (state.panels.length === 0) {
          return h('div', { className: 'wswp-note' },
            h('div', null, h('b', null, t('menuEmpty'))),
            h('div', null, t('menuEmptyHint', { path: `${workspace.path}/${workspace.panelsDir}` })))
        }
        return h(React.Fragment, null,
          h('div', { className: 'wswp-picker' },
            h('div', { className: 'wswp-picker-title' }, t('pickTitle')),
            state.panels.map((row) => h('button', {
              key: row.id,
              type: 'button',
              className: 'wswp-picker-row',
              'data-active': row.id === panelId ? 'true' : 'false',
              onClick: () => choose(row),
            },
            h('span', { className: 'wswp-picker-icon' },
              row.icon === null ? h(GridGlyph, null) : h('img', { src: assetUrl(workspace.id, row.dirName, row.icon, 'icon'), alt: '' })),
            h('span', { className: 'wswp-picker-text' },
              h('span', { className: 'wswp-picker-name' }, row.title),
              row.description === '' ? null : h('span', { className: 'wswp-picker-desc' }, row.description))))),
          panelId === ''
            ? null
            : h('div', { className: 'wswp-picker-foot' },
              h('button', { type: 'button', className: 'wswp-link', onClick: () => setPicking(false) }, t('cancelPick'))))
      }

      let body
      if (state.phase === 'error') {
        body = h('div', { className: 'wswp-note' }, h('b', null, t('menuFailed')), h('div', null, state.error))
      } else if (state.phase !== 'ready') {
        body = h('div', { className: 'wswp-note' }, t('loading'))
      } else if (workspace === null) {
        body = h('div', { className: 'wswp-note' }, t('menuFailed'))
      } else if (picking || panelId === '') {
        // A tab opened without a panel (the 开始 card's arrival) always shows
        // the chooser, whatever the local toggle says.
        body = pickerBody()
      } else if (panel === undefined) {
        body = h('div', { className: 'wswp-note' },
          h('div', null, h('b', null, t('panelGone'))),
          h('div', null, t('panelGoneHint', { path: `${workspace.path}/${workspace.panelsDir}` })))
      } else {
        body = h(React.Fragment, null,
          warningsBlock(state.warnings, t),
          h(PanelSurface, {
            workspace,
            panel,
            sessionId,
            nonce,
            reload: () => setNonce(String(Date.now())),
            onFailure: () => {},
          }))
      }

      return h(React.Fragment, null,
        h('style', null, BODY_CSS),
        h('div', { className: 'wswp-tab' },
          h('div', { className: 'wswp-tab-head' },
            h('span', { className: 'wswp-tab-title', title }, title),
            workspace === null ? null : h('span', { className: 'wswp-tab-sub' }, workspace.title),
            h('button', {
              className: 'wswp-icon-btn',
              type: 'button',
              title: t('reloadHint'),
              'aria-label': t('reload'),
              disabled: panel === undefined || picking,
              onClick: () => setNonce(String(Date.now())),
            }, '⟳'),
            h('button', {
              className: 'wswp-icon-btn',
              type: 'button',
              title: t('switchPanel'),
              'aria-label': t('switchPanel'),
              'aria-pressed': picking ? 'true' : 'false',
              disabled: state.phase !== 'ready' || state.panels.length === 0,
              onClick: () => setPicking((value) => !value),
            }, h(ChevronGlyph, null))),
          h('div', { className: 'wswp-tab-body' }, body)))
    }

    /**
     * The tab chip: the panel's own title.
     * @param {object} props - locale and the framework tab hook.
     * @returns {any} React node.
     */
    function PanelTabTitle({ t, useTabInfo }) {
      const { tab } = useTabInfo()
      const params = tab.navigation.params ?? {}
      const title = typeof params.panelTitle === 'string' && params.panelTitle !== '' ? params.panelTitle : t('tabTitle')
      const icon = typeof params.iconUrl === 'string' && params.iconUrl !== '' ? params.iconUrl : ''
      // The chip lays out its title as one row: a glyph, then the text. The
      // panel's own icon goes there, so two panel tabs are told apart by their
      // logos before their names.
      return h(React.Fragment, null,
        h('span', {
          style: {
            flex: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px',
            color: 'var(--dsw-alias-label-tertiary)',
          },
          'aria-hidden': true,
        }, icon === ''
          ? h(PanelsGlyph, { size: 16 })
          : h('img', { src: icon, alt: '', width: 16, height: 16, style: { display: 'block', objectFit: 'contain' } })),
        title)
    }

    /**
     * Draw the discovery warnings, if any.
     * @param {string[]} warnings - messages from the Host.
     * @param {(key: string, params?: object) => string} t - translator.
     * @returns {any} React node.
     */
    function warningsBlock(warnings, t) {
      if (!Array.isArray(warnings) || warnings.length === 0) return null
      const shown = warnings.slice(0, 5)
      return h('div', { className: 'wswp-warn' },
        t('warnings', { n: warnings.length }),
        h('ul', null, shown.map((line, index) => h('li', { key: `w${index}` }, line))),
        warnings.length > shown.length ? h('div', null, `… ${warnings.length - shown.length}`) : null)
    }

    // ── Dictionaries ────────────────────────────────────────────────────────

    const zh = {
      tabTitle: '工作区视图',
      cardDesc: '打开本工作区的专属视图',
      pickTitle: '选择要打开的视图',
      cancelPick: '取消',
      switchPanel: '切换视图',
      reload: '重新加载',
      reloadHint: '重新导入入口模块并重挂视图',
      loading: '正在读取视图目录…',
      menuEmpty: '这个工作区还没有视图',
      menuEmptyHint: '在 {path} 下建一个视图目录（panel.json + 入口模块）',
      menuFailed: '视图接口调用失败',
      panelGone: '这个视图已经不在了',
      panelGoneHint: '重新打开一次「工作区视图」，或在 {path} 下重新创建它。',
      warnings: '发现 {n} 条提示',
    }

    const en = {
      tabTitle: 'Workspace views',
      cardDesc: 'Open a view defined by this workspace',
      pickTitle: 'Choose a view to open',
      cancelPick: 'Cancel',
      switchPanel: 'Switch view',
      reload: 'Reload',
      reloadHint: 'Re-import the entry module and remount the view',
      loading: 'Reading the view directory…',
      menuEmpty: 'This workspace has no views yet',
      menuEmptyHint: 'Create a view directory under {path} (panel.json + an entry module)',
      menuFailed: 'The view API call failed',
      panelGone: 'This view is gone',
      panelGoneHint: 'Open Workspace views again, or recreate it under {path}.',
      warnings: '{n} notice(s)',
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-panels: dictionaries')
        const t = ctx.locale.bind(NS)

        // One tab type: the card in the guide, and the page it opens. The same
        // declarations are what a stock DSH profile renders as the card with the
        // panel dropdown; a start-page takeover by another plugin lists the same
        // entry with its own card and opens this tab, whose body is the picker.
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TYPE_ID,
          kind: KIND,
          // Every open is its own content, so the card can be used again to put a
          // second panel beside the first one.
          multiple: true,
          // A hidden panel tab stays mounted, so switching between two panels
          // does not throw away their state or restart their work.
          keepMounted: true,
          title: () => t('tabTitle'),
          guide: [{
            id: ENTRY_ID,
            order: 35,
            title: () => t('tabTitle'),
            description: () => t('cardDesc'),
            icon: PanelsGlyph,
          }],
        }), 'workspace-panels: tab type')

        ctx.effect(() => ctx.slots.inject('sidebar.right.tab.guide.entry', () => ctx.slots.register({
          name: 'sidebar.right.tab.guide.entry',
          key: TYPE_ID,
          locale: NS,
          inject: (sessionId) => ({ sessionId }),
        }, GuideCard)), 'workspace-panels: guide card')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TYPE_ID,
          locale: NS,
          inject: (sessionId) => ({ sessionId }),
        }, PanelTabBody)), 'workspace-panels: tab body')

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TYPE_ID,
          locale: NS,
          inject: (sessionId) => ({ sessionId }),
        }, PanelTabTitle)), 'workspace-panels: tab title')
      },
    }
  },
})
