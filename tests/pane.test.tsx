import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'video-timeline',
  component: 'Pane',
  requestId: 'video-timeline',
  props: {
    title: 'Video Timeline',
    isFocused: false,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

test('selecting an audio clip shows its controls and volume changes', async ($, on) => {
  on('store.set', () => ({ value: undefined }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reset' })
    expect(await ui.find({ type: 'Text', text: /bgm\.mp3/ })).toBeDefined()
    expect(await ui.find({ key: 'vol-3' })).toBeUndefined()
    await ui.press({ key: 'clip-a2' })
    expect(await ui.find({ key: 'vol-3' })).toBeDefined()
    await ui.press({ key: 'vol-3' })
    expect(await ui.find({ type: 'Text', text: /−21\.0 dB/ })).toBeDefined()
    await ui.press({ key: 'deselect' })
    await ui.unmount()
  }
})

test('a text clip splits at | typed in its field, and merges back', async ($, on) => {
  on('store.set', () => ({ value: undefined }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'reset' })
    await ui.press({ key: 'clip-t2' })
    await ui.input({ key: 'text-edit', text: 'สวัสดีครับ|ยินดีต้อนรับ' })
    expect(await ui.find({ key: 'row-t3' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /“สวัสดีครับ”/ })).toBeDefined()
    await ui.press({ key: 'merge' })
    expect(await ui.find({ key: 'row-t3' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /สวัสดีครับยินดีต้อนรับ/ })).toBeDefined()
    await ui.unmount()
  }
})

test('splitting by spaces and a locked track refusing edits', async ($, on) => {
  on('store.set', () => ({ value: undefined }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'reset' })
  await ui.press({ key: 'clip-t2' })
  await ui.press({ key: 'tsplit-space' })
  expect(await ui.find({ key: 'row-t3' })).toBeDefined()
  await ui.press({ key: 'l-T1' })
  await ui.press({ key: 'merge' })
  expect(await ui.find({ key: 'row-t3' })).toBeDefined()
  await ui.unmount()
})

test('the pane draws on vscode and mobile too', async $ => {
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /voiceover/ })).toBeDefined()
    await ui.unmount()
  }
})

test('saving writes a project file and opening it restores the timeline', async ($, on) => {
  on('store.set', () => ({ value: undefined }))
  const disk = new Map<string, string>()
  on('fs.write', (_$, e) => {
    disk.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => ({ value: disk.get(e.path) ?? '' }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('env.get', () => ({ value: '/Users/test' }))
  on('fs.list', () => ({
    value: [...disk.keys()].map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })),
  }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'reset' })
  await ui.press({ key: 'save-file' })
  expect(toasts.join(' ')).toMatch(/บันทึกแล้ว/)
  expect(disk.size).toBe(1)
  expect([...disk.keys()][0]).toMatch(/Documents\/VideoTimeline\/.+\.json$/)
  const name = [...disk.keys()][0].split('/').pop()!
  await ui.press({ key: 'clip-t1' })
  await ui.press({ key: 'delete' })
  expect(await ui.find({ key: 'row-t1' })).toBeUndefined()
  await ui.press({ key: `open-${name}` })
  expect(await ui.find({ key: 'row-t1' })).toBeDefined()
  await ui.unmount()
})

test('splitting Thai text word by word gives more than the spaces do', async ($, on) => {
  on('store.set', () => ({ value: undefined }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'reset' })
  await ui.press({ key: 'clip-t2' })
  await ui.press({ key: 'tsplit-word' })
  expect(await ui.find({ key: 'row-t4' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /“สวัสดี”/ })).toBeDefined()
  await ui.unmount()
})
