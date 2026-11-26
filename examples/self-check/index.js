/**
 * 面板自检 — the reference panel for this workspace.
 *
 * It exercises every part of the panel contract in one screen: React state,
 * DOM events inside a shadow root, the inherited theme, `api.files`, and
 * `api.reload()`. If this panel renders and its counter responds, the panel
 * pipeline (discovery → module import → mount) is healthy.
 */

export function createPanel(api) {
  const { React, h } = api

  function Row({ label, value }) {
    return h('div', { className: 'sc-row' },
      h('span', { className: 'sc-key' }, label),
      h('span', { className: 'sc-val' }, value))
  }

  function Panel() {
    const [count, setCount] = React.useState(0)
    const [entries, setEntries] = React.useState(null)
    const [sample, setSample] = React.useState(null)
    const [error, setError] = React.useState('')

    React.useEffect(() => {
      api.files.listDir('.')
        .then((list) => setEntries(list.slice(0, 12)))
        .catch((reason) => setError(String(reason.message ?? reason)))
      api.files.readText(`.dsh/panels/self-check/data/sample.json`)
        .then((text) => setSample(JSON.parse(text)))
        .catch((reason) => setError(String(reason.message ?? reason)))
    }, [])

    return h('div', { className: 'sc-panel' },
      h('div', { className: 'sc-hero' },
        h('div', { className: 'sc-hero-title' }, '面板运行正常'),
        h('div', { className: 'sc-hero-sub' }, '改完 index.js 后点右上角「重新加载」，改完 panel.json 或新增面板后点「刷新列表」。')),

      error === '' ? null : h('div', { className: 'sc-error' }, error),

      h('div', { className: 'sc-grid' },
        h('div', { className: 'sc-card' },
          h('div', { className: 'sc-card-title' }, '身份'),
          h(Row, { label: '工作区', value: api.workspace.title }),
          h(Row, { label: '工作区路径', value: api.workspace.path }),
          h(Row, { label: '面板 id', value: api.panel.id }),
          h(Row, { label: '面板目录', value: api.panel.dir })),

        h('div', { className: 'sc-card' },
          h('div', { className: 'sc-card-title' }, '交互'),
          h('div', { className: 'sc-actions' },
            h('button', {
              className: 'sc-btn',
              type: 'button',
              onClick: () => setCount((value) => value + 1),
            }, `点一下：${count}`),
            h('button', {
              className: 'sc-btn quiet',
              type: 'button',
              onClick: () => setCount(0),
              disabled: count === 0,
            }, '归零'),
            h('button', {
              className: 'sc-btn quiet',
              type: 'button',
              onClick: () => api.reload(),
            }, '重载模块')),
          h(Row, { label: '主题', value: api.theme.scheme })),

        h('div', { className: 'sc-card' },
          h('div', { className: 'sc-card-title' }, 'api.files.listDir(".")'),
          entries === null
            ? h('div', { className: 'sc-muted' }, '读取中…')
            : h('div', { className: 'sc-list' }, entries.map((entry) => h('div', {
              className: 'sc-list-item',
              key: entry.name,
            }, h('span', { className: 'sc-kind' }, entry.kind === 'dir' ? '▸' : '·'), entry.name)))),

        h('div', { className: 'sc-card' },
          h('div', { className: 'sc-card-title' }, 'api.files.readText(...)'),
          sample === null
            ? h('div', { className: 'sc-muted' }, '读取中…')
            : h(Row, { label: '来自', value: 'data/sample.json' }),
          sample === null ? null : h(Row, { label: 'field', value: String(sample.note ?? '') }))),
    )
  }

  return Panel
}
