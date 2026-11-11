export type TrackKind = 'video' | 'image' | 'audio' | 'text'

export type Clip = {
  id: string
  name: string
  /** seconds on the timeline */
  start: number
  end: number
  src?: string
  /** clip gain in dB (audio / video with sound) */
  volume?: number
  muted?: boolean
  /** 0–100 (video, image, text) */
  opacity?: number
  fadeIn?: number
  fadeOut?: number
  /** text layers */
  text?: string
  fontSize?: number
  color?: string
  position?: string
  note?: string
}

export type Track = {
  id: string
  kind: TrackKind
  name: string
  /** track gain in dB */
  volume?: number
  muted?: boolean
  solo?: boolean
  locked?: boolean
  hidden?: boolean
  clips: Clip[]
}

export type Project = {
  name: string
  fps: number
  width: number
  height: number
  tracks: Track[]
}

declare module 'claude-code' {
  interface PluginState {
    'video-timeline': {
      project: Shaped<Project>
      selected: string | null
      /** seconds */
      playhead: number
      /** 1, 2, 4 or 8 */
      zoom: number
      /** saved project files in ~/Documents/VideoTimeline, newest first */
      files: { name: string; mtimeMs: number }[]
    }
  }
}
