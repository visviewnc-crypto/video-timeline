import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Clip, Project, Track, TrackKind } from '../types'

const PANE = 'video-timeline'
const TITLE = 'Video Timeline'
const STORE_KEY = 'project'

const KINDS: readonly TrackKind[] = ['video', 'image', 'audio', 'text']

const SAMPLE: Project = {
  name: 'ตัวอย่างโปรเจกต์',
  fps: 30,
  width: 1920,
  height: 1080,
  tracks: [
    {
      id: 'T1',
      kind: 'text',
      name: 'ข้อความ',
      clips: [
        { id: 't1', name: 'ชื่อเรื่อง', start: 0, end: 4, text: 'ชื่อเรื่อง', fontSize: 72, color: '#ffffff', position: 'center', opacity: 100, fadeIn: 0.5, fadeOut: 0.5 },
        { id: 't2', name: 'สวัสดีครับ ยินดีต้อนรับ', start: 6, end: 10, text: 'สวัสดีครับ ยินดีต้อนรับ', fontSize: 40, color: '#ffffff', position: 'bottom', opacity: 100 },
      ],
    },
    {
      id: 'I1',
      kind: 'image',
      name: 'ภาพ',
      clips: [{ id: 'i1', name: 'logo.png', start: 12, end: 18, src: 'logo.png', opacity: 80 }],
    },
    {
      id: 'V1',
      kind: 'video',
      name: 'วิดีโอ',
      volume: 0,
      clips: [
        { id: 'v1', name: 'intro.mp4', start: 0, end: 8, src: 'intro.mp4', volume: -6, opacity: 100 },
        { id: 'v2', name: 'main.mp4', start: 8, end: 20, src: 'main.mp4', volume: 0, opacity: 100 },
      ],
    },
    {
      id: 'A1',
      kind: 'audio',
      name: 'พากย์',
      volume: 0,
      clips: [{ id: 'a1', name: 'voiceover.wav', start: 1, end: 19, src: 'voiceover.wav', volume: 0 }],
    },
    {
      id: 'A2',
      kind: 'audio',
      name: 'เพลง',
      volume: -3,
      clips: [{ id: 'a2', name: 'bgm.mp3', start: 0, end: 20, src: 'bgm.mp3', volume: -18, fadeIn: 1, fadeOut: 2 }],
    },
  ],
}

// Change the tag when Project's fields change incompatibly: older stored values are declined.
const project = atom({ plugin: 'video-timeline', key: 'project' } as const, SAMPLE, { shape: 'project-1' })
const selected = atom({ plugin: 'video-timeline', key: 'selected' } as const, null)
const playhead = atom({ plugin: 'video-timeline', key: 'playhead' } as const, 0)
const zoom = atom({ plugin: 'video-timeline', key: 'zoom' } as const, 1)
const files = atom({ plugin: 'video-timeline', key: 'files' } as const, [] as { name: string; mtimeMs: number }[])

// ---------- look ----------

/** Role colours (Final Cut Pro style): light fill + dark text, darker fill when selected. */
const LOOK: Record<TrackKind, { accent: string; bg: string; fg: string; selBg: string; glyph: string; label: string }> = {
  video: { accent: '#378ADD', bg: '#E6F1FB', fg: '#0C447C', selBg: '#185FA5', glyph: '▶', label: 'วิดีโอ' },
  image: { accent: '#1D9E75', bg: '#E1F5EE', fg: '#085041', selBg: '#0F6E56', glyph: '▣', label: 'ภาพ' },
  audio: { accent: '#639922', bg: '#EAF3DE', fg: '#27500A', selBg: '#3B6D11', glyph: '♪', label: 'เสียง' },
  text: { accent: '#7F77DD', bg: '#EEEDFE', fg: '#3C3489', selBg: '#534AB7', glyph: 'T', label: 'ข้อความ' },
}
const RED = '#E24B4A'
const AMBER = '#EF9F27'
const GREEN = '#639922'

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`
}

/** Ruler label: "5s" under a minute, "1:30" above. */
function fmtTick(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = Math.round(s - m * 60)
  return `${m}:${r < 10 ? '0' : ''}${r}`
}

function fmtDb(db: number | undefined): string {
  const v = db ?? 0
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} dB`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clip1(s: string, n: number): string {
  const chars = Array.from(s)
  if (chars.length <= n) return s
  return chars.slice(0, Math.max(0, n - 1)).join('') + '…'
}

function duration(p: Project): number {
  let max = 0
  for (const t of p.tracks) for (const c of t.clips) max = Math.max(max, c.end)
  return max
}

function findClip(p: Project, id: string): { track: Track; clip: Clip } | undefined {
  for (const track of p.tracks) {
    const clip = track.clips.find(c => c.id === id)
    if (clip) return { track, clip }
  }
  return undefined
}

/** Fresh ids with a prefix, never one already in the project or handed out before. */
function idMaker(p: Project, prefix: string): () => string {
  const used = new Set<string>()
  for (const t of p.tracks) {
    used.add(t.id)
    for (const c of t.clips) used.add(c.id)
  }
  let n = 1
  return () => {
    while (used.has(`${prefix}${n}`)) n++
    const id = `${prefix}${n}`
    used.add(id)
    return id
  }
}

const CLIP_PREFIX: Record<TrackKind, string> = { video: 'v', image: 'i', audio: 'a', text: 't' }
const TRACK_PREFIX: Record<TrackKind, string> = { video: 'V', image: 'I', audio: 'A', text: 'T' }

function describeClip(track: Track, clip: Clip): string {
  const parts = [
    `clip ${clip.id}`,
    `${track.kind} track ${track.id} "${track.name}"`,
    `"${clip.name}"`,
    `${fmtTime(clip.start)}–${fmtTime(clip.end)}`,
  ]
  if (track.kind === 'audio' || track.kind === 'video') parts.push(`vol ${fmtDb(clip.volume)}${clip.muted ? ' muted' : ''}`)
  if (track.kind === 'text' && clip.text) parts.push(`text "${clip.text}"`)
  return `[${parts.join(' · ')}]`
}

// ---------- text splitting ----------

type SplitBy = 'space' | 'word' | 'line' | 'sentence' | 'marker'

const THAI = /[฀-๿]/

/** Words with the spaces and punctuation after each kept on it; Thai is segmented by dictionary where the runtime can. */
function words(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const out: string[] = []
    for (const s of new Intl.Segmenter('th', { granularity: 'word' }).segment(text)) {
      if (s.isWordLike || out.length === 0) out.push(s.segment)
      else out[out.length - 1] += s.segment
    }
    return out
  }
  return text.split(/(?<=\s)/)
}

function segmentText(text: string, by: SplitBy): string[] {
  let parts: string[]
  if (by === 'marker') parts = text.split('|')
  else if (by === 'line') parts = text.split(/\n+/)
  else if (by === 'sentence') parts = text.split(/(?<=[.!?…。！？])\s*|\n+|\s{2,}/)
  else if (by === 'word') parts = words(text)
  else parts = text.split(/\s+/)
  return parts.map(s => s.trim()).filter(s => s.length > 0)
}

/** Splits text in two at the word boundary closest to `frac` of its length. */
function splitTextAt(text: string, frac: number): [string, string] {
  const len = Array.from(text).length
  const target = frac * len
  let best = -1
  let bestDist = Infinity
  let pos = 0
  const ws = words(text)
  for (let i = 0; i < ws.length - 1; i++) {
    pos += Array.from(ws[i] ?? '').length
    const d = Math.abs(pos - target)
    if (d < bestDist) {
      bestDist = d
      best = pos
    }
  }
  if (best <= 0) best = Math.min(len - 1, Math.max(1, Math.round(target)))
  const chars = Array.from(text)
  return [chars.slice(0, best).join('').trim(), chars.slice(best).join('').trim()]
}

function joinText(a: string, b: string): string {
  const last = Array.from(a).pop() ?? ''
  const first = Array.from(b)[0] ?? ''
  return THAI.test(last) && THAI.test(first) ? a + b : `${a} ${b}`
}

// ---------- edits (shared by the pane's buttons and Claude's tool) ----------

type Op =
  | { op: 'update'; id: string; fields: Partial<Clip> }
  | { op: 'add'; trackId: string; clip: Partial<Clip> & { start: number; end: number } }
  | { op: 'remove'; id: string }
  | { op: 'move'; id: string; trackId: string }
  | { op: 'split'; id: string; at: number }
  | { op: 'splitText'; id: string; at?: number; by?: SplitBy; parts?: string[] }
  | { op: 'merge'; id: string }
  | { op: 'addTrack'; kind: TrackKind; name?: string }
  | { op: 'updateTrack'; id: string; fields: Partial<Omit<Track, 'clips' | 'id'>> }
  | { op: 'removeTrack'; id: string }
  | { op: 'project'; fields: Partial<Omit<Project, 'tracks'>> }

function sortClips(t: Track): Track {
  return { ...t, clips: [...t.clips].sort((a, b) => a.start - b.start) }
}

function replaceClip(p: Project, trackId: string, id: string, next: Clip[]): Project {
  return {
    ...p,
    tracks: p.tracks.map(t =>
      t.id === trackId ? sortClips({ ...t, clips: t.clips.flatMap(c => (c.id === id ? next : [c])) }) : t,
    ),
  }
}

function unlocked(p: Project, id: string): { track: Track; clip: Clip } {
  const hit = findClip(p, id)
  if (!hit) throw new Error(`no clip ${id}`)
  if (hit.track.locked) throw new Error(`track ${hit.track.id} is locked`)
  return hit
}

function applyOp(p: Project, raw: unknown): Project {
  if (typeof raw !== 'object' || raw === null) throw new Error('op must be an object')
  const op = raw as Op
  switch (op.op) {
    case 'update': {
      const hit = unlocked(p, op.id)
      const { id: _ignored, ...fields } = op.fields ?? {}
      const next = { ...hit.clip, ...fields }
      if (next.end <= next.start) throw new Error(`clip ${op.id}: end must be after start`)
      if (next.start < 0) throw new Error(`clip ${op.id}: start must be 0 or later`)
      return replaceClip(p, hit.track.id, op.id, [next])
    }
    case 'add': {
      const track = p.tracks.find(t => t.id === op.trackId)
      if (!track) throw new Error(`no track ${op.trackId}`)
      if (track.locked) throw new Error(`track ${track.id} is locked`)
      const id = op.clip.id && !findClip(p, op.clip.id) ? op.clip.id : idMaker(p, CLIP_PREFIX[track.kind])()
      const clip: Clip = { name: op.clip.name ?? op.clip.text ?? op.clip.src ?? id, ...op.clip, id } as Clip
      if (clip.end <= clip.start) throw new Error('end must be after start')
      return { ...p, tracks: p.tracks.map(t => (t.id === track.id ? sortClips({ ...t, clips: [...t.clips, clip] }) : t)) }
    }
    case 'remove': {
      const hit = unlocked(p, op.id)
      return replaceClip(p, hit.track.id, op.id, [])
    }
    case 'move': {
      const hit = unlocked(p, op.id)
      const dest = p.tracks.find(t => t.id === op.trackId)
      if (!dest) throw new Error(`no track ${op.trackId}`)
      if (dest.locked) throw new Error(`track ${dest.id} is locked`)
      const without = replaceClip(p, hit.track.id, op.id, [])
      return {
        ...without,
        tracks: without.tracks.map(t => (t.id === dest.id ? sortClips({ ...t, clips: [...t.clips, hit.clip] }) : t)),
      }
    }
    case 'split': {
      const hit = unlocked(p, op.id)
      if (hit.track.kind === 'text') return applyOp(p, { op: 'splitText', id: op.id, at: op.at })
      if (op.at <= hit.clip.start || op.at >= hit.clip.end) throw new Error('split point must be inside the clip')
      const second: Clip = { ...hit.clip, id: idMaker(p, CLIP_PREFIX[hit.track.kind])(), start: op.at, fadeIn: undefined }
      const first: Clip = { ...hit.clip, end: op.at, fadeOut: undefined }
      return replaceClip(p, hit.track.id, op.id, [first, second])
    }
    case 'splitText': {
      const hit = unlocked(p, op.id)
      const c = hit.clip
      const text = c.text ?? c.name
      const fresh = idMaker(p, CLIP_PREFIX[hit.track.kind])
      if (op.at !== undefined && !op.parts && !op.by) {
        if (op.at <= c.start || op.at >= c.end) throw new Error('split point must be inside the clip')
        const [a, b] = splitTextAt(text, (op.at - c.start) / (c.end - c.start))
        if (!a || !b) throw new Error('the text is too short to split there')
        return replaceClip(p, hit.track.id, c.id, [
          { ...c, end: op.at, text: a, name: a, fadeOut: undefined },
          { ...c, id: fresh(), start: op.at, text: b, name: b, fadeIn: undefined },
        ])
      }
      const parts = (op.parts ?? segmentText(text, op.by ?? 'space')).map(s => String(s).trim()).filter(Boolean)
      if (parts.length < 2) throw new Error('nothing to split: the text gives fewer than two parts')
      const weights = parts.map(s => Math.max(1, Array.from(s).length))
      const total = weights.reduce((a, b) => a + b, 0)
      const span = c.end - c.start
      let acc = 0
      const clips = parts.map((s, i) => {
        const start = round2(c.start + (span * acc) / total)
        acc += weights[i] ?? 1
        const end = i === parts.length - 1 ? c.end : round2(c.start + (span * acc) / total)
        return {
          ...c,
          id: i === 0 ? c.id : fresh(),
          start,
          end,
          text: s,
          name: s,
          fadeIn: i === 0 ? c.fadeIn : undefined,
          fadeOut: i === parts.length - 1 ? c.fadeOut : undefined,
        }
      })
      return replaceClip(p, hit.track.id, c.id, clips)
    }
    case 'merge': {
      const hit = unlocked(p, op.id)
      const sorted = [...hit.track.clips].sort((a, b) => a.start - b.start)
      const i = sorted.findIndex(c => c.id === op.id)
      const a = sorted[i]
      const b = sorted[i + 1]
      if (!a || !b) throw new Error(`clip ${op.id} has no next clip on track ${hit.track.id} to merge with`)
      const merged: Clip = {
        ...a,
        end: b.end,
        fadeOut: b.fadeOut,
        ...(hit.track.kind === 'text'
          ? { text: joinText(a.text ?? a.name, b.text ?? b.name), name: joinText(a.name, b.name) }
          : {}),
      }
      const without = replaceClip(p, hit.track.id, b.id, [])
      return replaceClip(without, hit.track.id, a.id, [merged])
    }
    case 'addTrack': {
      if (!KINDS.includes(op.kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`)
      const id = idMaker(p, TRACK_PREFIX[op.kind])()
      const track: Track = { id, kind: op.kind, name: op.name ?? LOOK[op.kind].label, clips: [] }
      return { ...p, tracks: [...p.tracks, track] }
    }
    case 'updateTrack': {
      if (!p.tracks.some(t => t.id === op.id)) throw new Error(`no track ${op.id}`)
      return { ...p, tracks: p.tracks.map(t => (t.id === op.id ? { ...t, ...op.fields, id: t.id, clips: t.clips } : t)) }
    }
    case 'removeTrack': {
      const t = p.tracks.find(x => x.id === op.id)
      if (!t) throw new Error(`no track ${op.id}`)
      if (t.locked) throw new Error(`track ${t.id} is locked`)
      return { ...p, tracks: p.tracks.filter(x => x.id !== op.id) }
    }
    case 'project':
      return { ...p, ...op.fields, tracks: p.tracks }
    default:
      throw new Error(`unknown op ${(op as { op?: unknown }).op}`)
  }
}

function isProject(v: unknown): v is Project {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Project
  return Array.isArray(p.tracks) && p.tracks.every(t => Array.isArray(t.clips) && KINDS.includes(t.kind))
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function commit($: EngineInterface, fn: (p: Project) => Project): Promise<Project> {
  let out: Project = SAMPLE
  await update($, project, p => {
    out = fn(p ?? SAMPLE)
    return out
  })
  await $.store.set(STORE_KEY, out)
  return out
}

/** An edit from a pane button: a refusal (a locked track, a bad split) shows as a toast. */
async function edit($: EngineInterface, op: Op): Promise<void> {
  try {
    await commit($, cur => applyOp(cur, op))
  } catch (err) {
    $.ui.toast(`แก้ไม่ได้: ${errText(err)}`)
  }
}

// ---------- project files ----------

const FILE_FORMAT = 'video-timeline'

function safeFileName(name: string): string {
  const s = name.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim()
  return (s || 'Untitled').slice(0, 80)
}

/** ~/Documents/VideoTimeline, the default folder for saved projects. */
async function projectDir($: EngineInterface): Promise<string> {
  const home = await $.env.get('HOME')
  return home ? `${home}/Documents/VideoTimeline` : 'VideoTimeline'
}

async function resolvePath($: EngineInterface, path: string | undefined, p: Project): Promise<string> {
  const dir = await projectDir($)
  if (!path) return `${dir}/${safeFileName(p.name)}.json`
  const withExt = /\.json$/i.test(path) ? path : `${path}.json`
  return withExt.includes('/') ? withExt : `${dir}/${withExt}`
}

async function refreshFiles($: EngineInterface): Promise<void> {
  const dir = await projectDir($)
  const entries = await $.fs.list(dir).catch(() => [])
  const list = entries
    .filter(f => f.kind === 'file' && /\.json$/i.test(f.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map(f => ({ name: f.name, mtimeMs: f.mtimeMs }))
  await update($, files, () => list)
}

async function saveProject($: EngineInterface, path?: string): Promise<string> {
  const p = await read($, project)
  const target = await resolvePath($, path, p)
  const body = { format: FILE_FORMAT, version: 1, savedAt: new Date().toISOString(), project: p }
  await $.fs.write(target, JSON.stringify(body, null, 2))
  await refreshFiles($)
  return target
}

async function loadProject($: EngineInterface, path: string): Promise<Project> {
  const p0 = await read($, project)
  const target = await resolvePath($, path, p0)
  const raw = JSON.parse(await $.fs.read(target)) as { project?: unknown }
  const body = raw && typeof raw === 'object' && 'project' in raw ? raw.project : raw
  if (!isProject(body)) throw new Error('ไฟล์นี้ไม่ใช่โปรเจกต์ video-timeline')
  const p: Project = { name: 'Untitled', fps: 30, width: 1920, height: 1080, ...body }
  await commit($, () => p)
  await update($, selected, () => null)
  await update($, playhead, () => 0)
  return p
}

async function saveFromPane($: EngineInterface): Promise<void> {
  try {
    const at = await saveProject($)
    $.ui.toast(`บันทึกแล้ว: ${at}`)
  } catch (err) {
    $.ui.toast(`บันทึกไม่ได้: ${errText(err)}`)
  }
}

async function loadFromPane($: EngineInterface, name: string): Promise<void> {
  try {
    const p = await loadProject($, name)
    $.ui.toast(`เปิดโปรเจกต์ “${p.name}” แล้ว`)
  } catch (err) {
    $.ui.toast(`เปิดไม่ได้: ${errText(err)}`)
  }
}

// ---------- module ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(STORE_KEY)
    if (isProject(stored)) await update($, project, () => stored)

    await $.command.register({ name: 'timeline', description: 'Open the video timeline pane' })

    await $.tool.register({
      name: 'timeline_get',
      description:
        'Read the video-editing timeline shown in the Video Timeline pane: project settings, tracks (video, image, audio, text; with muted/solo/locked/hidden) and every clip with its id, start/end seconds, volume (dB), opacity, fades and text. Also returns the selected clip and the playhead position. Call this before editing when the user refers to a clip like [clip a2 ...] or to "the playhead".',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'timeline_edit',
      description:
        'Edit the video timeline in the Video Timeline pane with a list of ops, applied in order (all or nothing). Ops: ' +
        '{op:"update",id,fields} change a clip (start,end,name,src,volume dB,muted,opacity 0-100,fadeIn,fadeOut,text,fontSize,color,position,note); ' +
        '{op:"add",trackId,clip:{start,end,...}}; {op:"remove",id}; {op:"move",id,trackId}; {op:"split",id,at} cut a clip in two at a time; ' +
        '{op:"splitText",id,parts?:string[],by?:"space"|"word"|"line"|"sentence"|"marker",at?:number} split a text clip into several clips: give parts for exact wording, or by to segment automatically ("word" segments Thai by dictionary, "marker" splits at |), or at to cut in two at a time on the nearest word; time is shared in proportion to text length, adjust with update afterwards if needed; ' +
        '{op:"merge",id} join a clip with the next clip on its track (text is joined); ' +
        '{op:"addTrack",kind:"video"|"image"|"audio"|"text",name?}; {op:"updateTrack",id,fields:{name,volume,muted,solo,locked,hidden}}; {op:"removeTrack",id}; ' +
        '{op:"project",fields:{name,fps,width,height}}. Clips on locked tracks cannot be edited. Times are seconds. Optional select: clip id to highlight; optional playhead: seconds.',
      inputSchema: {
        type: 'object',
        properties: {
          ops: { type: 'array', items: { type: 'object' } },
          select: { type: 'string' },
          playhead: { type: 'number' },
        },
        required: ['ops'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'timeline_set',
      description:
        'Replace the whole timeline in the Video Timeline pane (for loading a project or building a new edit). project = {name,fps,width,height,tracks:[{id,kind,name,volume?,muted?,solo?,locked?,hidden?,clips:[{id,name,start,end,src?,volume?,opacity?,text?,...}]}]}. Tracks are listed top to bottom.',
      inputSchema: {
        type: 'object',
        properties: { project: { type: 'object' } },
        required: ['project'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'timeline_save',
      description:
        'Save the current Video Timeline project to a JSON file so it can be reopened later or on another computer. path is optional: a bare name goes to ~/Documents/VideoTimeline/<name>.json; omitted, the project name is used. Returns the absolute path written.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'timeline_load',
      description:
        'Open a saved Video Timeline project file (made by timeline_save or the pane), replacing the timeline. path: a bare name in ~/Documents/VideoTimeline, or a full path to a .json file.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      isDeferred: false,
    })

    void refreshFiles($)
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'timeline' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Video Timeline pane opened.' }
  })

  on('tool.call', { tool: 'mcp__video-timeline__timeline_get' }, async $ => {
    const p = await read($, project)
    const sel = await read($, selected)
    const hit = sel ? findClip(p, sel) : undefined
    return {
      result: JSON.stringify(
        {
          durationSeconds: duration(p),
          playheadSeconds: await read($, playhead),
          selected: hit ? describeClip(hit.track, hit.clip) : null,
          project: p,
        },
        null,
        2,
      ),
    }
  }).catch(() => ({ deny: 'timeline_get failed' }))

  on('tool.call', { tool: 'mcp__video-timeline__timeline_edit' }, async ($, e) => {
    const ops = (e as { ops?: unknown }).ops
    const select = (e as { select?: unknown }).select
    const at = (e as { playhead?: unknown }).playhead
    if (!Array.isArray(ops)) return { deny: 'ops must be an array' }
    try {
      const before = await read($, project)
      // Validate the whole batch before writing anything.
      ops.reduce<Project>(applyOp, before)
      const after = await commit($, p => ops.reduce<Project>(applyOp, p))
      if (typeof select === 'string') await update($, selected, () => select)
      if (typeof at === 'number') await update($, playhead, () => Math.max(0, at))
      await $.ui.open({ id: PANE, title: TITLE })
      return { result: `Applied ${ops.length} op(s). Duration now ${fmtTime(duration(after))}.` }
    } catch (err) {
      return { deny: `timeline_edit failed, nothing changed: ${errText(err)}` }
    }
  }).catch(() => ({ deny: 'timeline_edit failed' }))

  on('tool.call', { tool: 'mcp__video-timeline__timeline_set' }, async ($, e) => {
    const next = (e as { project?: unknown }).project
    if (!isProject(next)) return { deny: 'project must have tracks[] each with kind and clips[]' }
    const p: Project = { name: 'Untitled', fps: 30, width: 1920, height: 1080, ...next }
    await commit($, () => p)
    await update($, selected, () => null)
    await $.ui.open({ id: PANE, title: TITLE })
    return { result: `Timeline replaced: ${p.tracks.length} tracks, ${fmtTime(duration(p))}.` }
  }).catch(() => ({ deny: 'timeline_set failed' }))

  on('tool.call', { tool: 'mcp__video-timeline__timeline_save' }, async ($, e) => {
    const path = (e as { path?: unknown }).path
    try {
      const at = await saveProject($, typeof path === 'string' && path ? path : undefined)
      return { result: `Saved to ${at}` }
    } catch (err) {
      return { deny: `timeline_save failed: ${errText(err)}` }
    }
  }).catch(() => ({ deny: 'timeline_save failed' }))

  on('tool.call', { tool: 'mcp__video-timeline__timeline_load' }, async ($, e) => {
    const path = (e as { path?: unknown }).path
    if (typeof path !== 'string' || !path) return { deny: 'path is required' }
    try {
      const p = await loadProject($, path)
      await $.ui.open({ id: PANE, title: TITLE })
      return { result: `Opened "${p.name}": ${p.tracks.length} tracks, ${fmtTime(duration(p))}.` }
    } catch (err) {
      return { deny: `timeline_load failed: ${errText(err)}` }
    }
  }).catch(() => ({ deny: 'timeline_load failed' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : undefined

    const p = await read($, project)
    const sel = await read($, selected)
    const head = await read($, playhead)
    const z = await read($, zoom)
    const saved = await read($, files)
    const hit = sel ? findClip(p, sel) : undefined
    const anySolo = p.tracks.some(t => t.solo)

    const cols = Math.max(44, e.props.bodyColumns ?? 60)
    const HEAD = 18
    const W = Math.max(20, cols - HEAD - 1)
    const total = Math.max(1, Math.ceil(duration(p)))
    const viewLen = total / z
    const viewStart = Math.min(Math.max(0, head - viewLen / 2), Math.max(0, total - viewLen))
    const viewEnd = viewStart + viewLen
    const toCol = (s: number) => Math.round(((s - viewStart) / viewLen) * W)
    const headCol = toCol(head)

    const pick = (id: string | null) => update($, selected, () => id)
    const seek = (s: number) => update($, playhead, () => round2(Math.min(total, Math.max(0, s))))
    const ask = (text: string) => $.prompt.fill({ text, mode: 'insert' })

    // ---- top bar ----
    const topBar = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text weight="bold">{p.name}</Text>
          <Text dimColor>
            {p.width}×{p.height} · {p.fps} fps
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Button key="seek-start" plain onPress={() => seek(0)}>⏮</Button>
          <Button key="seek-1" plain onPress={() => seek(head - 1)}>◀◀</Button>
          <Button key="seek-.1" plain onPress={() => seek(head - 0.1)}>◀</Button>
          <Text mono tabular weight="bold">
            {fmtTime(head)}
          </Text>
          <Text dimColor mono tabular>
            / {fmtTime(duration(p))}
          </Text>
          <Button key="seek+.1" plain onPress={() => seek(head + 0.1)}>▶</Button>
          <Button key="seek+1" plain onPress={() => seek(head + 1)}>▶▶</Button>
          <Text dimColor>│ ซูม</Text>
          <Button key="zoom-" plain onPress={() => update($, zoom, n => Math.max(1, (n ?? 1) / 2))}>−</Button>
          <Text tabular>{z}×</Text>
          <Button key="zoom+" plain onPress={() => update($, zoom, n => Math.min(8, (n ?? 1) * 2))}>+</Button>
        </Box>
      </Box>
    )

    // ---- ruler: each label seeks the playhead ----
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => (viewLen / s) * 6 <= W) ?? 1200
    const ticks: RenderChildren[] = []
    let rc = 0
    for (let s = Math.ceil(viewStart / step) * step; s <= viewEnd; s += step) {
      const at = toCol(s)
      if (at < rc) continue
      const label = `|${fmtTick(s)}`
      if (at > rc) ticks.push(<Text>{' '.repeat(at - rc)}</Text>)
      ticks.push(
        <Button key={`tick-${s}`} plain dimColor onPress={() => seek(s)}>
          {label}
        </Button>,
      )
      rc = at + label.length
    }
    const ruler = (
      <Box flexDirection="row">
        <Box width={HEAD} flexShrink={0}>
          <Text dimColor>เลเยอร์</Text>
        </Box>
        <Box flexDirection="row" width={W} flexShrink={0}>
          {ticks}
        </Box>
      </Box>
    )

    // ---- one track: header with controls, then its lane ----
    const trackRow = (t: Track) => {
      const look = LOOK[t.kind]
      const quiet = t.hidden || t.muted || (anySolo && !t.solo && (t.kind === 'audio' || t.kind === 'video'))
      const cells: RenderChildren[] = []
      let cursor = 0
      for (const c of t.clips) {
        if (c.end <= viewStart || c.start >= viewEnd) continue
        const from = Math.max(cursor, toCol(Math.max(c.start, viewStart)))
        const to = Math.min(W, Math.max(from + 1, toCol(Math.min(c.end, viewEnd))))
        if (from >= W) break
        if (from > cursor) cells.push(<Text>{' '.repeat(from - cursor)}</Text>)
        const w = to - from
        const isSel = c.id === sel
        const body =
          t.kind === 'text'
            ? `“${c.text ?? c.name}”`
            : t.kind === 'image'
              ? `${c.name} ${c.opacity ?? 100}%`
              : `${c.name} ${c.muted ? 'MUTE' : fmtDb(c.volume)}`
        const label = (isSel ? '▌' : ' ') + clip1(body, Math.max(0, w - 1))
        cells.push(
          <Box width={w} flexShrink={0}>
            <Button key={`clip-${c.id}`} plain onPress={() => pick(isSel ? null : c.id)}>
              <Text
                backgroundColor={isSel ? look.selBg : look.bg}
                color={isSel ? '#ffffff' : look.fg}
                weight={isSel ? 'bold' : 'regular'}
                dimColor={quiet || c.muted}
              >
                {(label + ' '.repeat(w)).slice(0, Math.max(label.length, w))}
              </Text>
            </Button>
          </Box>,
        )
        cursor = to
      }
      const hasSound = t.kind === 'audio' || t.kind === 'video'
      return (
        <Box flexDirection="row">
          <Box width={HEAD} flexShrink={0} flexDirection="row">
            <Text color={look.accent} dimColor={quiet}>
              {look.glyph} {clip1(`${t.id} ${t.name}`, HEAD - 10).padEnd(HEAD - 9, ' ')}
            </Text>
            {hasSound ? (
              <Button key={`m-${t.id}`} plain dimColor={!t.muted} onPress={() => edit($, { op: 'updateTrack', id: t.id, fields: { muted: !t.muted } })}>
                <Text color={t.muted ? RED : undefined}>M</Text>
              </Button>
            ) : (
              <Button key={`h-${t.id}`} plain dimColor={!t.hidden} onPress={() => edit($, { op: 'updateTrack', id: t.id, fields: { hidden: !t.hidden } })}>
                <Text color={t.hidden ? RED : undefined}>H</Text>
              </Button>
            )}
            <Text> </Text>
            {hasSound ? (
              <Button key={`s-${t.id}`} plain dimColor={!t.solo} onPress={() => edit($, { op: 'updateTrack', id: t.id, fields: { solo: !t.solo } })}>
                <Text color={t.solo ? AMBER : undefined}>S</Text>
              </Button>
            ) : (
              <Text> </Text>
            )}
            <Text> </Text>
            <Button key={`l-${t.id}`} plain dimColor={!t.locked} onPress={() => edit($, { op: 'updateTrack', id: t.id, fields: { locked: !t.locked } })}>
              <Text color={t.locked ? AMBER : undefined}>{t.locked ? 'L' : 'l'}</Text>
            </Button>
          </Box>
          <Box flexDirection="row" width={W} flexShrink={0}>
            {cells}
            {headCol >= 0 && headCol < W ? (
              <Box position="absolute" left={headCol} top={0}>
                <Text color={RED}>│</Text>
              </Box>
            ) : null}
          </Box>
        </Box>
      )
    }

    // ---- level meter: green to -12, amber to -6, red above ----
    const meter = (db: number | undefined, muted?: boolean) => {
      if (muted) return <Text dimColor mono>{'░'.repeat(12)} MUTE</Text>
      const v = Math.max(-48, Math.min(12, db ?? 0))
      const filled = Math.round(((v + 48) / 60) * 12)
      const runs: RenderChildren[] = []
      for (let i = 0; i < 12; i++) {
        const cellDb = -48 + (i + 1) * 5
        const color = cellDb <= -12 ? GREEN : cellDb <= -6 ? AMBER : RED
        runs.push(i < filled ? <Text color={color}>█</Text> : <Text dimColor>░</Text>)
      }
      return <Text mono>{runs}</Text>
    }

    const row = (label: string, ...content: RenderChildren[]) => (
      <Box flexDirection="row">
        <Box width={11} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap" flexShrink={1}>
          {content}
        </Box>
      </Box>
    )

    // ---- inspector ----
    const inspector = () => {
      if (!hit) {
        return <Text dimColor>คลิกคลิปบนไทม์ไลน์หรือในรายการด้านล่าง เพื่อดูและปรับค่า</Text>
      }
      const { track: t, clip: c } = hit
      const look = LOOK[t.kind]
      const hasSound = t.kind === 'audio' || t.kind === 'video'
      const hasPicture = t.kind !== 'audio'
      const headInside = head > c.start && head < c.end
      const splitAtHead = () =>
        headInside ? edit($, { op: 'split', id: c.id, at: head }) : $.ui.toast('เลื่อนหัวอ่านเข้าไปในคลิปก่อน แล้วค่อยกดแบ่ง')
      return (
        <Box flexDirection="column" borderStyle="round" paddingX={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={look.accent} weight="bold">
              {look.glyph}
            </Text>
            <Text weight="bold">{clip1(c.name, 28)}</Text>
            <Text backgroundColor={look.bg} color={look.fg}>
              {` ${c.id} · ${t.id} ${t.name} `}
            </Text>
            {t.locked ? <Text color={AMBER}>ล็อกอยู่</Text> : null}
          </Box>

          {row(
            'เวลา',
            <Text mono tabular>
              {fmtTime(c.start)} → {fmtTime(c.end)}
            </Text>,
            <Text dimColor>({(c.end - c.start).toFixed(1)} วิ)</Text>,
            c.src ? <Text dimColor>{c.src}</Text> : null,
          )}
          {row(
            '',
            <Button key="nudge-l" onPress={() => edit($, { op: 'update', id: c.id, fields: { start: Math.max(0, c.start - 0.5), end: c.end - Math.min(0.5, c.start) } })}>◀ 0.5 วิ</Button>,
            <Button key="nudge-r" onPress={() => edit($, { op: 'update', id: c.id, fields: { start: c.start + 0.5, end: c.end + 0.5 } })}>0.5 วิ ▶</Button>,
            <Button key="trim-end-" onPress={() => edit($, { op: 'update', id: c.id, fields: { end: Math.max(c.start + 0.1, c.end - 0.5) } })}>ตัดท้าย</Button>,
            <Button key="trim-end+" onPress={() => edit($, { op: 'update', id: c.id, fields: { end: c.end + 0.5 } })}>ยืดท้าย</Button>,
            <Button key="split-head" onPress={splitAtHead}>แบ่งที่หัวอ่าน</Button>,
            <Button key="go-start" dimColor onPress={() => seek(c.start)}>หัวอ่านไปต้นคลิป</Button>,
          )}

          {hasSound
            ? row(
                'เสียง',
                meter(c.volume, c.muted),
                <Text mono tabular>
                  {fmtDb(c.volume)}
                </Text>,
                <Button key="vol-3" onPress={() => edit($, { op: 'update', id: c.id, fields: { volume: (c.volume ?? 0) - 3 } })}>−3 dB</Button>,
                <Button key="vol+3" onPress={() => edit($, { op: 'update', id: c.id, fields: { volume: (c.volume ?? 0) + 3 } })}>+3 dB</Button>,
                <Button key="vol0" onPress={() => edit($, { op: 'update', id: c.id, fields: { volume: 0 } })}>0 dB</Button>,
                <Button key="mute" onPress={() => edit($, { op: 'update', id: c.id, fields: { muted: !c.muted } })}>{c.muted ? 'เปิดเสียง' : 'ปิดเสียง'}</Button>,
              )
            : null}
          {hasSound && (c.fadeIn || c.fadeOut)
            ? row('เฟด', <Text>เข้า {c.fadeIn ?? 0} วิ · ออก {c.fadeOut ?? 0} วิ</Text>)
            : null}

          {hasPicture
            ? row(
                'ภาพ',
                <Text tabular>ความทึบ {c.opacity ?? 100}%</Text>,
                <Button key="op-" onPress={() => edit($, { op: 'update', id: c.id, fields: { opacity: Math.max(0, (c.opacity ?? 100) - 10) } })}>−10%</Button>,
                <Button key="op+" onPress={() => edit($, { op: 'update', id: c.id, fields: { opacity: Math.min(100, (c.opacity ?? 100) + 10) } })}>+10%</Button>,
              )
            : null}

          {t.kind === 'text'
            ? row(
                'ข้อความ',
                <Text>“{c.text ?? ''}”</Text>,
                <Text dimColor>
                  {c.fontSize ?? 48}px · {c.color ?? '#ffffff'} · {c.position ?? 'center'}
                </Text>,
                <Button key="fs-" onPress={() => edit($, { op: 'update', id: c.id, fields: { fontSize: Math.max(8, (c.fontSize ?? 48) - 4) } })}>A−</Button>,
                <Button key="fs+" onPress={() => edit($, { op: 'update', id: c.id, fields: { fontSize: (c.fontSize ?? 48) + 4 } })}>A+</Button>,
              )
            : null}
          {t.kind === 'text' && Input ? (
            <Box flexDirection="column">
              <Input
                key="text-edit"
                label="แก้ข้อความ (ใส่ | ตรงที่ต้องการตัดแบ่ง)"
                value={c.text ?? ''}
                placeholder="สวัสดีครับ|ยินดีต้อนรับ"
                submitLabel="บันทึก"
                onSubmit={value =>
                  value.includes('|')
                    ? edit($, { op: 'splitText', id: c.id, by: 'marker', parts: value.split('|') })
                    : edit($, { op: 'update', id: c.id, fields: { text: value, name: value } })
                }
              />
            </Box>
          ) : null}
          {t.kind === 'text'
            ? row(
                'ตัดแบ่ง',
                <Button key="tsplit-head" onPress={splitAtHead}>ที่หัวอ่าน</Button>,
                <Button key="tsplit-space" onPress={() => edit($, { op: 'splitText', id: c.id, by: 'space' })}>ตามเว้นวรรค</Button>,
                <Button key="tsplit-word" onPress={() => edit($, { op: 'splitText', id: c.id, by: 'word' })}>ทีละคำ</Button>,
                <Button key="tsplit-line" onPress={() => edit($, { op: 'splitText', id: c.id, by: 'sentence' })}>ตามประโยค</Button>,
                <Button key="merge" onPress={() => edit($, { op: 'merge', id: c.id })}>รวมกับคลิปถัดไป</Button>,
              )
            : row('', <Button key="merge" dimColor onPress={() => edit($, { op: 'merge', id: c.id })}>รวมกับคลิปถัดไป</Button>)}

          {c.note ? row('โน้ต', <Text dimColor>{c.note}</Text>) : null}

          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button key="ask" variant="primary" onPress={() => ask(`${describeClip(t, c)} `)}>
              สั่ง Claude แก้คลิปนี้
            </Button>
            <Button key="deselect" dimColor onPress={() => pick(null)}>
              ยกเลิกเลือก
            </Button>
            <Box flexGrow={1} />
            <Button
              key="delete"
              dimColor
              onPress={async () => {
                await edit($, { op: 'remove', id: c.id })
                await pick(null)
              }}
            >
              <Text color={RED}>ลบคลิป</Text>
            </Button>
          </Box>
        </Box>
      )
    }

    // ---- mixer ----
    const mixer = p.tracks
      .filter(t => t.kind === 'audio' || t.kind === 'video')
      .map(t => (
        <Box flexDirection="row" gap={1}>
          <Box width={HEAD - 2} flexShrink={0}>
            <Text color={LOOK[t.kind].accent} dimColor={t.muted}>
              {LOOK[t.kind].glyph} {clip1(`${t.id} ${t.name}`, HEAD - 5)}
            </Text>
          </Box>
          {meter(t.volume, t.muted)}
          <Text mono tabular>
            {fmtDb(t.volume).padStart(9, ' ')}
          </Text>
          <Button key={`tv-${t.id}`} plain onPress={() => edit($, { op: 'updateTrack', id: t.id, fields: { volume: (t.volume ?? 0) - 1 } })}>
            −
          </Button>
          <Button key={`tv+${t.id}`} plain onPress={() => edit($, { op: 'updateTrack', id: t.id, fields: { volume: (t.volume ?? 0) + 1 } })}>
            +
          </Button>
          <Button
            key={`ask-${t.id}`}
            plain
            dimColor
            onPress={() => ask(`[track ${t.id} ${t.kind} "${t.name}" vol ${fmtDb(t.volume)}${t.muted ? ' muted' : ''}${t.solo ? ' solo' : ''}] `)}
          >
            ถาม Claude
          </Button>
        </Box>
      ))

    // ---- clip list ----
    const list = p.tracks.map(t => (
      <Box flexDirection="column">
        <Text color={LOOK[t.kind].accent}>
          {LOOK[t.kind].glyph} {t.id} {t.name}
          <Text dimColor>
            {t.hidden ? ' · ซ่อน' : ''}
            {t.muted ? ' · ปิดเสียง' : ''}
            {t.solo ? ' · solo' : ''}
            {t.locked ? ' · ล็อก' : ''}
          </Text>
        </Text>
        {t.clips.length === 0 ? <Text dimColor>   (ว่าง)</Text> : null}
        {t.clips.map(c => (
          <Button key={`row-${c.id}`} plain onPress={() => pick(c.id === sel ? null : c.id)}>
            {c.id === sel ? ' ▌ ' : '   '}
            {c.id} {t.kind === 'text' ? `“${clip1(c.text ?? c.name, 30)}”` : clip1(c.name, 30)}{' '}
            <Text dimColor>
              {fmtTime(c.start)}–{fmtTime(c.end)}
              {t.kind === 'audio' || t.kind === 'video' ? ` · ${c.muted ? 'mute' : fmtDb(c.volume)}` : ''}
              {t.kind === 'image' && c.opacity !== undefined ? ` · ${c.opacity}%` : ''}
            </Text>
          </Button>
        ))}
      </Box>
    ))

    return (
      <Box flexDirection="column" gap={1}>
        {topBar}
        <Box flexDirection="column">
          {ruler}
          {p.tracks.map(trackRow)}
          <Text dimColor>
            M ปิดเสียง · S ฟังเดี่ยว · H ซ่อน · L ล็อก · <Text color={RED}>│</Text> หัวอ่าน (คลิกตัวเลขเวลาเพื่อย้าย)
          </Text>
        </Box>

        {inspector()}

        <Box flexDirection="column">
          <Text weight="bold">มิกเซอร์เสียง</Text>
          {mixer.length ? mixer : <Text dimColor>ยังไม่มีแทร็กเสียง</Text>}
        </Box>

        <Box flexDirection="column">
          <Text weight="bold">รายการคลิป</Text>
          {list}
          <Box flexDirection="row" gap={1} marginTop={1}>
            {KINDS.map(k => (
              <Button key={`add-${k}`} onPress={() => edit($, { op: 'addTrack', kind: k })}>
                + เลเยอร์{LOOK[k].label}
              </Button>
            ))}
            <Button
              key="reset"
              dimColor
              onPress={async () => {
                await commit($, () => SAMPLE)
                await pick(null)
                await seek(0)
              }}
            >
              โหลดตัวอย่าง
            </Button>
          </Box>
        </Box>

        <Box flexDirection="column">
          <Text weight="bold">ไฟล์โปรเจกต์</Text>
          <Text dimColor>เก็บไว้ที่ ~/Documents/VideoTimeline · ก๊อปไฟล์ไปเครื่องอื่นแล้วเปิดต่อได้</Text>
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button key="save-file" onPress={() => saveFromPane($)}>
              บันทึก “{clip1(p.name, 24)}”
            </Button>
            <Button key="refresh-files" dimColor onPress={() => refreshFiles($)}>
              รีเฟรชรายการ
            </Button>
          </Box>
          {saved.length === 0 ? <Text dimColor>   ยังไม่มีไฟล์ที่บันทึก</Text> : null}
          {saved.slice(0, 8).map(f => (
            <Button key={`open-${f.name}`} plain onPress={() => loadFromPane($, f.name)}>
              {'   ↺ '}
              {clip1(f.name.replace(/\.json$/i, ''), 40)}{' '}
              <Text dimColor>{new Date(f.mtimeMs).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</Text>
            </Button>
          ))}
        </Box>
      </Box>
    )
  })
}
