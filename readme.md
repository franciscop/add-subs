# Add Subs

You have a `~/Movies/file.mp4`, and a `~/Movies/file.srt`. You want to merge them into one. Easy, just run:

```bash
npx add-subs "~/Movies/file.mp4"
```

add-subs will then merge both into a single `file.mp4` and remove `file.srt`. It assumes the subtitles are in English.

> Warning: interrupting this process might cause `file.mp4` to become corrupt or even be removed!
