# add-subs

Transcribe a video and embed the subtitles in it:

```sh
npx add-subs "/path/chapter.mp4"
# /path/chapter.mp4 now has an English subtitle track
```

## Install

```sh
npx add-subs video.mp4      # run it without installing
npm install -g add-subs     # or install it, which also adds the shorter `subs` alias
```

It needs [Node](https://nodejs.org) 20+, [ffmpeg](https://ffmpeg.org), and
[whisper](https://github.com/openai/whisper). If they are missing, `add-subs` stops
and prints the commands to install them. The first transcription also downloads the whisper
model, about 1.5 GB.

See the [macOS](#macos), [Linux](#linux), and [Windows](#windows) instructions.

## Usage

```sh
add-subs video.mp4                  # transcribe and embed
add-subs "~/Movies/My Film.mkv"     # quote names with spaces, ~ still works
add-subs *.mkv                      # several files, one after another
add-subs -m large -l Spanish a.mkv  # pick a model and language
add-subs --translate foreign.mkv    # English subtitles for non-English speech
add-subs --attach video.mp4         # embed an existing video.srt instead of transcribing
add-subs --remove video.mp4         # take the embedded subtitles back out
```

| option                          |                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `-l, --lang, --language <name>` | Spoken language, as a name or code like `Japanese` or `ja`. Default `English`, or `auto` to detect. |
| `-m, --model <name>`            | Whisper model. Default `turbo`.                                                                     |
| `-t, --translate`               | Write English subtitles for non-English speech.                                                     |
| `-a, --attach`                  | Embed the existing `<name>.srt` instead of transcribing, then delete it.                            |
| `-r, --remove`                  | Remove the subtitles that `add-subs` embedded.                                                      |
| `-h, --help`                    | Show help.                                                                                          |

## Embedding

`add-subs` embeds into mp4, m4v, mov, and mkv files, as the default track, tagged with its
language. Any other file, such as audio or avi, gets a `<name>.srt` beside it instead.

Embedding copies the video and audio untouched, so it takes seconds rather than re-encoding.
A run replaces the track from any earlier run instead of stacking a second one, and subtitle
tracks that came with the file are never touched, by embedding or by `--remove`.

A sidecar `.srt` is only used with `--attach`. Without it, `add-subs` transcribes from scratch
and leaves an existing `.srt` where it is.

## Models

| model    | size    |                                                    |
| -------- | ------- | -------------------------------------------------- |
| `tiny`   | ~75 MB  | fastest, visibly worse output                      |
| `base`   | ~145 MB |                                                    |
| `small`  | ~465 MB |                                                    |
| `medium` | ~1.5 GB |                                                    |
| `turbo`  | ~1.5 GB | the default: close to `large` accuracy, far faster |
| `large`  | ~2.9 GB | best output, slowest                               |

Append `.en` for English-only builds (`tiny.en` through `medium.en`). They beat their
multilingual counterparts on English audio and cannot read anything else.

Pinned versions are available as `large-v1`, `large-v2`, `large-v3` (the same weights as
`large`) and `large-v3-turbo` (the same weights as `turbo`). A model downloads to
`~/.cache/whisper` the first time you use it.

## Languages

Whisper picks one language per file and keeps it for the whole transcript. With `--lang auto`
it decides from the first 30 seconds, so a film that opens in English stays in English even
where the dialogue switches.

For audio that is mostly one language with passages in another, use `-m large`. It reads those
passages far more reliably than the smaller models. Never use an `.en` build on mixed audio:
those models know only English and will turn anything else into nonsense.

`--translate` writes everything as English, rendering non-English speech as a translation
rather than a transcript. It selects `large` and language detection unless you say otherwise,
and refuses to run on `turbo` or an `.en` model, neither of which can translate:

```sh
add-subs --translate movie.mkv          # detect the source, subtitle it in English
add-subs --translate -m medium -l Spanish movie.mkv
```

With `--attach`, pass `--lang` to tag the track correctly when the `.srt` is not in English.

## Safety

`add-subs` never edits a video in place. It writes a new copy beside the original, checks that
every video and audio track made it across, and only then swaps it in. A crash, a failed run,
or a Ctrl-C leaves the original exactly as it was, and Ctrl-C stops the whole batch rather than
moving on to the next file. Rewriting needs free disk space equal to the size of the video.

## Speed

On a Mac, whisper runs on the CPU, roughly real time: about 45 minutes for a 45 minute episode on
`turbo`. For a serious speedup look at [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
with Core ML, or [faster-whisper](https://github.com/SYSTRAN/faster-whisper).

## Dependencies

### macOS

Install [Homebrew](https://brew.sh) if you don't have it yet, then:

```sh
brew install node ffmpeg pipx
pipx ensurepath
pipx install openai-whisper
```

Open a new terminal and check that both tools are found:

```sh
ffmpeg -version
whisper --help
```

If either says `command not found` even though it installed fine, it's missing from your
PATH. Fix it, then open a new terminal:

```sh
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile   # ffmpeg, from Homebrew
pipx ensurepath                                                   # whisper, from pipx
```

### Linux

On Debian and Ubuntu:

```sh
sudo apt update
sudo apt install ffmpeg pipx
pipx ensurepath
pipx install openai-whisper
```

On Fedora, enable [RPM Fusion](https://rpmfusion.org/Configuration) for the full ffmpeg and run
`sudo dnf install ffmpeg pipx`. On Arch, run `sudo pacman -S ffmpeg python-pipx`. Then finish
with the same two `pipx` commands.

Distribution packages of Node are often older than 20. [nvm](https://github.com/nvm-sh/nvm)
installs a current one.

Open a new terminal and check that both tools are found:

```sh
ffmpeg -version
whisper --help
```

If whisper says `command not found`, run `pipx ensurepath` and open a new terminal. Packaged
ffmpeg lives in `/usr/bin`, which is always on the PATH, so ffmpeg only goes missing when you
built or downloaded it by hand. Add its folder to the PATH:

```sh
echo 'export PATH="/folder/with/ffmpeg:$PATH"' >> ~/.bashrc
```

### Windows

In PowerShell, install Node, ffmpeg, and Python:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
winget install Python.Python.3.12
```

Open a new terminal so they are on the PATH, then install whisper:

```powershell
py -m pip install --user pipx
py -m pipx ensurepath
py -m pipx install openai-whisper
```

Open a new terminal again and check that both tools are found:

```powershell
ffmpeg -version
whisper --help
```

If either says `is not recognized as the name of a cmdlet` even though it installed fine, it's
missing from your PATH. Fix it, then open a new terminal:

```powershell
# ffmpeg, from winget
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:LOCALAPPDATA\Microsoft\WinGet\Links", "User")

# whisper, from pipx
py -m pipx ensurepath
```
