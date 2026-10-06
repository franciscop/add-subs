#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const HELP = `
  Transcribe a video and embed the subtitles in it

  Usage
    $ add-subs <video...>             transcribe and embed the subtitles
    $ add-subs --attach <video...>    embed the existing <name>.srt instead
    $ add-subs --remove <video...>    take the embedded subtitles back out

  Options
    --lang, -l <name>    Spoken language (default: English, "auto" to detect)
    --model, -m <name>   Whisper model (default: turbo)
    --translate, -t      Write English subtitles for non-English speech
    --attach, -a         Embed the existing <name>.srt, then delete it
    --remove, -r         Remove the subtitles that add-subs embedded
    --help, -h           Show this help

  Files that cannot hold a subtitle track (audio, avi, webm) get a <name>.srt
  beside them instead. Embedding replaces any track add-subs embedded
  earlier and leaves other subtitle tracks alone.

  Models, roughly fastest to most accurate
    tiny        ~75 MB   fastest, visibly worse output
    base       ~145 MB
    small      ~465 MB
    medium      ~1.5 GB
    turbo       ~1.5 GB  the default: close to large accuracy, far faster
    large       ~2.9 GB  best output, slowest

    Append .en for English-only builds (tiny.en, base.en, small.en, medium.en),
    which beat the multilingual versions on English audio.
    Pinned versions: large-v1, large-v2, large-v3 (same as large), and
    large-v3-turbo (same as turbo).
    A model downloads to ~/.cache/whisper the first time it is used.

  With --translate the model defaults to large and the language to auto, since
  turbo and the .en builds cannot translate.

  Examples
    $ add-subs "~/Movies/My Film.mkv"
    $ add-subs --attach -l Spanish episode.mp4
    $ add-subs --translate -m medium -l Spanish movie.mkv
`;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      lang: { type: "string", short: "l" },
      model: { type: "string", short: "m" },
      translate: { type: "boolean", short: "t" },
      attach: { type: "boolean", short: "a" },
      remove: { type: "boolean", short: "r" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (err) {
  console.error(`add-subs: ${err.message}`);
  process.exit(2);
}

const cli = {
  flags: parsed.values,
  input: parsed.positionals,
  showHelp(code) {
    (code ? console.error : console.log)(HELP);
    process.exit(code);
  },
};

// turbo ignores the translate task and hands back the original language.
const CANNOT_TRANSLATE = new Set(["turbo", "large-v3-turbo"]);

const SUBTITLE_CODECS = {
  ".mp4": "mov_text",
  ".m4v": "mov_text",
  ".mov": "mov_text",
  ".mkv": "srt",
};

// Stored as the track's handler_name, which survives in both mp4 and mkv.
const MARKER = "subs";

const LANGUAGES = [
  ["en", "eng", "English"],
  ["es", "spa", "Spanish"],
  ["fr", "fre", "French"],
  ["de", "ger", "German"],
  ["it", "ita", "Italian"],
  ["pt", "por", "Portuguese"],
  ["ja", "jpn", "Japanese"],
  ["zh", "chi", "Chinese"],
  ["ko", "kor", "Korean"],
  ["ru", "rus", "Russian"],
  ["ar", "ara", "Arabic"],
  ["hi", "hin", "Hindi"],
  ["nl", "dut", "Dutch"],
  ["sv", "swe", "Swedish"],
  ["no", "nor", "Norwegian"],
  ["da", "dan", "Danish"],
  ["fi", "fin", "Finnish"],
  ["pl", "pol", "Polish"],
  ["tr", "tur", "Turkish"],
  ["el", "gre", "Greek"],
  ["he", "heb", "Hebrew"],
  ["cs", "cze", "Czech"],
  ["hu", "hun", "Hungarian"],
  ["ro", "rum", "Romanian"],
  ["uk", "ukr", "Ukrainian"],
  ["ca", "cat", "Catalan"],
  ["vi", "vie", "Vietnamese"],
  ["th", "tha", "Thai"],
  ["id", "ind", "Indonesian"],
  ["ms", "may", "Malay"],
  ["fa", "per", "Persian"],
  ["tl", "tgl", "Tagalog"],
  ["eu", "baq", "Basque"],
  ["gl", "glg", "Galician"],
];

function language(input) {
  const key = input.toLowerCase();
  const hit = LANGUAGES.find(([two, three, name]) =>
    [two, three, name.toLowerCase()].includes(key),
  );
  return hit ? { code: hit[1], name: hit[2] } : { code: "und", name: input };
}

function die(msg) {
  console.error(`add-subs: ${msg}`);
  process.exit(1);
}

// The shell leaves ~ alone inside quotes, which file names with spaces need.
const expandHome = (p) =>
  p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;

const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  );

let interrupted = false;

function exec(cmd, args, { echo = false, env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "inherit"],
      env,
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (echo) process.stderr.write(chunk);
    });

    const forward = (sig) => {
      interrupted = true;
      child.kill(sig);
    };
    process.on("SIGINT", forward).on("SIGTERM", forward);

    child.on("error", (err) => {
      reject(
        err.code === "ENOENT" ? new Error(`${cmd} not found on PATH`) : err,
      );
    });
    child.on("close", (code, signal) => {
      process.off("SIGINT", forward).off("SIGTERM", forward);
      if (interrupted || signal) reject(new Error("interrupted"));
      else if (code !== 0) reject(new Error(`${cmd} exited with code ${code}`));
      else resolvePromise(out);
    });
  });
}

async function runWhisper(input, outDir, opts) {
  const args = [
    input,
    "--output_dir",
    outDir,
    "--output_format",
    "srt",
    "--model",
    opts.model,
    "--word_timestamps",
    "True",
  ];
  if (opts.lang.toLowerCase() !== "auto") args.push("--language", opts.lang);
  if (opts.translate) args.push("--task", "translate");

  const out = await exec("whisper", args, {
    echo: true,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  return out.match(/^Detected language: (.+)$/m)?.[1];
}

async function probe(file) {
  const out = await exec("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=index,codec_type:stream_tags",
    "-of",
    "json",
    file,
  ]);
  return JSON.parse(out).streams ?? [];
}

const isOurs = (s) =>
  s.codec_type === "subtitle" &&
  Object.entries(s.tags ?? {}).some(
    ([k, v]) => k.toLowerCase() === "handler_name" && v === MARKER,
  );

const dropOurs = (streams) =>
  streams.filter(isOurs).flatMap((s) => ["-map", `-0:${s.index}`]);

// Writes a new copy beside the video and swaps it in only once it checks out, so
// a failure or Ctrl-C never damages the original.
async function rewrite(video, before, args, expectOurs) {
  const tmp = join(dirname(video), `.subs-${process.pid}${extname(video)}`);
  try {
    await exec("ffmpeg", ["-v", "error", "-nostdin", "-y", ...args, tmp]);
    const after = await probe(tmp);
    const media = (streams) =>
      streams.filter((s) => s.codec_type !== "subtitle").length;
    if (
      media(after) !== media(before) ||
      after.filter(isOurs).length !== expectOurs
    ) {
      throw new Error(
        "the rewritten file failed verification, original left untouched",
      );
    }
    await rename(tmp, video);
  } finally {
    await rm(tmp, { force: true });
  }
}

async function attach(video, srt, lang) {
  const before = await probe(video);
  const n = before.filter(
    (s) => s.codec_type === "subtitle" && !isOurs(s),
  ).length;
  await rewrite(
    video,
    before,
    [
      "-i",
      video,
      "-i",
      srt,
      "-map",
      "0",
      ...dropOurs(before),
      "-map",
      "1:0",
      "-c",
      "copy",
      `-c:s:${n}`,
      SUBTITLE_CODECS[extname(video).toLowerCase()],
      `-metadata:s:s:${n}`,
      `language=${lang.code}`,
      `-metadata:s:s:${n}`,
      `title=${lang.name}`,
      `-metadata:s:s:${n}`,
      `handler_name=${MARKER}`,
      `-disposition:s:${n}`,
      "default",
    ],
    1,
  );
}

function requireEmbeddable(video) {
  if (!SUBTITLE_CODECS[extname(video).toLowerCase()]) {
    throw new Error(
      `cannot embed subtitles in ${extname(video) || "extensionless"} files, only mp4, m4v, mov and mkv`,
    );
  }
}

async function transcribe(input, opts) {
  const name = basename(input, extname(input));
  const tmp = await mkdtemp(join(dirname(input), ".subs-"));
  try {
    const detected = await runWhisper(input, tmp, opts);
    const srt = join(tmp, `${name}.srt`);
    const text = await readFile(srt, "utf8").catch(() => "");
    if (!/^1\r?\n\d{2}:\d{2}:\d{2},\d{3} --> /.test(text))
      throw new Error("whisper produced no valid SubRip output");

    if (SUBTITLE_CODECS[extname(input).toLowerCase()]) {
      const spoken =
        opts.lang.toLowerCase() === "auto" ? (detected ?? "und") : opts.lang;
      await attach(input, srt, language(opts.translate ? "English" : spoken));
      return input;
    }
    const dest = join(dirname(input), `${name}.srt`);
    await rename(srt, dest);
    return dest;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function attachExisting(video, opts) {
  requireEmbeddable(video);
  const srt = join(dirname(video), `${basename(video, extname(video))}.srt`);
  if (!(await exists(srt))) throw new Error(`no ${basename(srt)} to attach`);
  await attach(
    video,
    srt,
    language(opts.lang.toLowerCase() === "auto" ? "und" : opts.lang),
  );
  await rm(srt);
  return video;
}

async function removeSubs(video) {
  requireEmbeddable(video);
  const before = await probe(video);
  if (!before.some(isOurs))
    throw new Error("has no subtitles embedded by add-subs");
  await rewrite(
    video,
    before,
    ["-i", video, "-map", "0", ...dropOurs(before), "-c", "copy"],
    0,
  );
  return video;
}

function parseOptions({ flags, input }) {
  if (flags.help) cli.showHelp(0);
  if (input.length === 0) cli.showHelp(1);
  if (flags.lang === "" || flags.model === "") die("missing value for option");
  if (flags.attach && flags.remove)
    die("--attach and --remove cannot be combined");
  if (flags.translate && (flags.attach || flags.remove))
    die("--translate only applies when transcribing");

  const opts = {
    lang: flags.lang ?? (flags.translate ? "auto" : "English"),
    model: flags.model ?? (flags.translate ? "large" : "turbo"),
    translate: flags.translate,
    attach: flags.attach,
    remove: flags.remove,
    files: input.map((file) => resolve(expandHome(file))),
  };

  if (opts.translate) {
    if (CANNOT_TRANSLATE.has(opts.model)) {
      die(
        `the ${opts.model} model cannot translate, it returns the original language. Use large or medium.`,
      );
    }
    if (opts.model.endsWith(".en")) {
      die(
        `the ${opts.model} model is English only and cannot translate. Use large or medium.`,
      );
    }
    console.error(
      `add-subs: translating to English with the ${opts.model} model, source language ${opts.lang}`,
    );
  }
  return opts;
}

const SETUP = {
  darwin: {
    docs: "https://github.com/franciscop/add-subs#macos",
    ffmpeg: {
      install: "brew install ffmpeg",
      path: `echo 'eval "$(${process.arch === "arm64" ? "/opt/homebrew" : "/usr/local"}/bin/brew shellenv)"' >> ~/.zprofile`,
    },
    whisper: {
      install: "brew install pipx && pipx install openai-whisper",
      path: "pipx ensurepath",
    },
  },
  linux: {
    docs: "https://github.com/franciscop/add-subs#linux",
    ffmpeg: {
      install: "sudo apt install ffmpeg",
      path: `echo 'export PATH="/folder/with/ffmpeg:$PATH"' >> ~/.bashrc`,
    },
    whisper: {
      install: "sudo apt install pipx && pipx install openai-whisper",
      path: "pipx ensurepath",
    },
  },
  win32: {
    docs: "https://github.com/franciscop/add-subs#windows",
    ffmpeg: {
      install: "winget install Gyan.FFmpeg",
      path: `[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:LOCALAPPDATA\\Microsoft\\WinGet\\Links", "User")`,
    },
    whisper: {
      install: "py -m pip install --user pipx; py -m pipx install openai-whisper",
      path: "py -m pipx ensurepath",
    },
  },
};

const isInstalled = (cmd) =>
  new Promise((done) => {
    const args = cmd === "whisper" ? ["--help"] : ["-version"];
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });

// Checks run in parallel since whisper alone takes about a second to start.
async function checkTools(tools) {
  const found = await Promise.all(tools.map(isInstalled));
  const missing = tools.filter((_, i) => !found[i]);
  if (missing.length === 0) return;

  const setup = SETUP[process.platform] ?? SETUP.linux;
  for (const tool of missing) {
    console.error(`${tool} is not installed, please install it with:`);
    console.error(`  ${setup[tool].install}`);
    console.error("If it was already installed, add it to the PATH with:");
    console.error(`  ${setup[tool].path}`);
    console.error("");
  }
  console.error(`More details: ${setup.docs}`);
  process.exit(1);
}

const opts = parseOptions(cli);

await checkTools(opts.attach || opts.remove ? ["ffmpeg"] : ["ffmpeg", "whisper"]);

let failed = 0;
for (const file of opts.files) {
  try {
    if (!(await exists(file))) throw new Error("no such file");
    const run = opts.remove
      ? removeSubs
      : opts.attach
        ? attachExisting
        : transcribe;
    console.log(await run(file, opts));
  } catch (err) {
    failed++;
    console.error(`add-subs: ${basename(file)}: ${err.message}`);
    if (interrupted) break;
  }
}
process.exit(failed > 0 ? 1 : 0);
