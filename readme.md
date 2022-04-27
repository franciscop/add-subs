# Add Subs

You have a `~/Movies/file.mp4`, and a `~/Movies/file.srt`. You want to merge them into one. Easy, just run:

```bash
npx add-subs "~/Movies/file.mp4"
```

> You need to have `ffmpeg` installed in your terminal

add-subs will then merge both into a single `file.mp4` and remove `file.srt`.

By default they will be filled under "English", but just pass a flag to add them in a different language:

```bash
npx add-subs "~/Movies/file.mp4" --lang Spanish
```

> Warning: interrupting this process might cause `file.mp4` to become corrupt or even be removed!
