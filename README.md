# Video Timeline

A Claude Code mod that adds a video-editing timeline pane beside the chat. It shows a video, image, audio and text layer for every track, each clip's time, volume (dB with a meter), opacity and text, and a playhead. You can edit clips from the pane's buttons, or tell Claude exactly what to change: Claude reads and edits the same timeline through its own tools.

แผงไทม์ไลน์ตัดต่อวิดีโอสำหรับ Claude Code: เห็นเลเยอร์ภาพ เสียง ข้อความ ค่าเสียง และสั่ง Claude แก้คลิปได้ตรงจุด

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install video-timeline --marketplace visviewnc-crypto/video-timeline
```

Answer `y` to add the marketplace, then press Enter to install for your user.

From a shell:

```
claude plugin install video-timeline --marketplace visviewnc-crypto/video-timeline
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `visviewnc-crypto/video-timeline`, then Add plugin.

## Use

- `/timeline` opens the pane.
- Click a clip to see its controls: move, trim, volume, fades, opacity, font size.
- Text clips can be split: type `|` where to cut, or split by spaces, by word (Thai included), by sentence or at the playhead. "รวมกับคลิปถัดไป" joins them back.
- Track headers: M mute, S solo, H hide, L lock (a locked track refuses edits).
- "สั่ง Claude แก้คลิปนี้" puts a reference to the clip in the prompt so Claude knows exactly which one you mean.
- Projects save to and open from `~/Documents/VideoTimeline/*.json`. Copy that file to another computer to keep working there.

## Tools Claude gets

`timeline_get`, `timeline_edit`, `timeline_set`, `timeline_save`, `timeline_load`.

The timeline is a plan of the edit: this mod does not render video files.

## License

MIT
