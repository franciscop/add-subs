import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "index.js");
const SRT = "1\n00:00:00,500 --> 00:00:01,500\nHello there\n\n";

const run = (...args) => {
  const res = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return { code: res.status, out: res.stdout, err: res.stderr };
};

const has = (cmd) => spawnSync("which", [cmd]).status === 0;

const ffmpeg = (...args) => {
  const res = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
};

const streams = (file) => {
  const res = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:stream_tags", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(res.stdout).streams.map((s) => {
    const tags = Object.fromEntries(Object.entries(s.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { type: s.codec_type, language: tags.language, handler: tags.handler_name };
  });
};

const subtitles = (file) => streams(file).filter((s) => s.type === "subtitle");
const media = (file) => streams(file).filter((s) => s.type !== "subtitle").length;

// Two audio tracks, so tests catch anything that drops streams while rewriting.
const makeVideo = (file) => {
  ffmpeg(
    "-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=660:duration=2",
    "-map", "0", "-map", "1", "-map", "2", "-c:v", "mpeg4", "-c:a", "aac", file,
  );
};

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "add-subs-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("cli", () => {
  it("shows the help", () => {
    const { code, out } = run("--help");
    expect(code).toBe(0);
    expect(out).toContain("add-subs --attach");
  });

  it("shows the help and fails without files", () => {
    expect(run().code).toBe(1);
  });

  it("rejects unknown flags", () => {
    expect(run("--force", "x.mp4").code).toBe(2);
  });

  it("rejects --attach with --remove", () => {
    const { code, err } = run("--attach", "--remove", "x.mp4");
    expect(code).toBe(1);
    expect(err).toContain("cannot be combined");
  });

  it("rejects models that cannot translate", () => {
    expect(run("-t", "-m", "turbo", "x.mp4").err).toContain("cannot translate");
    expect(run("-t", "-m", "small.en", "x.mp4").err).toContain("English only");
  });

  it("reports a missing file", () => {
    const { code, err } = run("--remove", join(dir, "nope.mp4"));
    expect(code).toBe(1);
    expect(err).toContain("no such file");
  });
});

describe("missing tools", () => {
  const node = spawnSync("which", ["node"], { encoding: "utf8" }).stdout.trim();
  const bare = (...args) => {
    const res = spawnSync(node, [CLI, ...args], { encoding: "utf8", env: { PATH: "/nonexistent" } });
    return { code: res.status, err: res.stderr };
  };

  it("lists every missing tool at once", () => {
    const { code, err } = bare("video.mp4");
    expect(code).toBe(1);
    expect(err).toContain("ffmpeg is not installed");
    expect(err).toContain("whisper is not installed");
    expect(err).toContain("https://github.com/franciscop/add-subs#");
  });

  it("does not need whisper to attach or remove", () => {
    expect(bare("--attach", "video.mp4").err).not.toContain("whisper");
    expect(bare("--remove", "video.mp4").err).not.toContain("whisper");
  });
});

describe("--attach", () => {
  it("embeds the srt as a tagged track and deletes it", () => {
    const video = join(dir, "video.mp4");
    makeVideo(video);
    writeFileSync(join(dir, "video.srt"), SRT);

    const { code, out } = run("--attach", video);
    expect(code).toBe(0);
    expect(out.trim()).toBe(video);
    expect(subtitles(video)).toEqual([{ type: "subtitle", language: "eng", handler: "subs" }]);
    expect(media(video)).toBe(3);
    expect(existsSync(join(dir, "video.srt"))).toBe(false);
  });

  it("tags the language from --lang", () => {
    const video = join(dir, "video.mkv");
    makeVideo(video);
    writeFileSync(join(dir, "video.srt"), SRT);

    run("--attach", "-l", "Spanish", video);
    expect(subtitles(video)[0].language).toBe("spa");
  });

  it("accepts --language in any case", () => {
    const video = join(dir, "video.mkv");
    makeVideo(video);
    writeFileSync(join(dir, "video.srt"), SRT);

    run("--attach", "--language", "japanese", video);
    expect(subtitles(video)[0].language).toBe("jpn");
  });

  it("replaces its own track instead of stacking", () => {
    const video = join(dir, "video.mp4");
    makeVideo(video);
    writeFileSync(join(dir, "video.srt"), SRT);
    run("--attach", video);
    writeFileSync(join(dir, "video.srt"), SRT);
    run("--attach", "-l", "fr", video);

    expect(subtitles(video)).toEqual([{ type: "subtitle", language: "fre", handler: "subs" }]);
  });

  it("fails without an srt", () => {
    const video = join(dir, "video.mp4");
    makeVideo(video);
    const { code, err } = run("--attach", video);
    expect(code).toBe(1);
    expect(err).toContain("no video.srt to attach");
  });

  it("refuses containers that cannot hold subtitles", () => {
    const video = join(dir, "video.avi");
    ffmpeg("-f", "lavfi", "-i", "testsrc=duration=1:size=160x120", "-c:v", "mpeg4", video);
    writeFileSync(join(dir, "video.srt"), SRT);
    expect(run("--attach", video).err).toContain("cannot embed subtitles in .avi");
  });

  it("leaves the original untouched when ffmpeg fails", () => {
    const video = join(dir, "video.mkv");
    makeVideo(video);
    const before = readFileSync(video);
    writeFileSync(join(dir, "video.srt"), "not a subtitle file\n");

    expect(run("--attach", video).code).toBe(1);
    expect(readFileSync(video).equals(before)).toBe(true);
    expect(existsSync(join(dir, "video.srt"))).toBe(true);
  });
});

describe("--remove", () => {
  it("removes its own track and keeps the others", () => {
    const foreign = join(dir, "foreign.srt");
    const original = join(dir, "original.mkv");
    const video = join(dir, "video.mkv");
    writeFileSync(foreign, SRT);
    makeVideo(original);
    ffmpeg("-i", original, "-i", foreign, "-map", "0", "-map", "1", "-c", "copy", "-metadata:s:s:0", "language=ger", video);
    writeFileSync(join(dir, "video.srt"), SRT);
    run("--attach", video);
    expect(subtitles(video)).toHaveLength(2);

    const { code } = run("--remove", video);
    expect(code).toBe(0);
    expect(subtitles(video)).toEqual([{ type: "subtitle", language: "ger", handler: undefined }]);
    expect(media(video)).toBe(3);
  });

  it("fails when there is nothing to remove", () => {
    const video = join(dir, "video.mp4");
    makeVideo(video);
    const { code, err } = run("--remove", video);
    expect(code).toBe(1);
    expect(err).toContain("has no subtitles embedded by add-subs");
  });
});

// Needs whisper and macOS speech synthesis, so it only runs on a dev machine.
describe.skipIf(!has("whisper") || !has("say"))("transcription", () => {
  it("transcribes and embeds", () => {
    const speech = join(dir, "speech.aiff");
    const video = join(dir, "video.mp4");
    spawnSync("say", ["-o", speech, "The professor has a plan."]);
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-i", speech, "-shortest", "-c:v", "mpeg4", "-c:a", "aac", video);

    expect(run("--language", "english", video).code).toBe(0);
    expect(subtitles(video)).toEqual([{ type: "subtitle", language: "eng", handler: "subs" }]);
    expect(existsSync(join(dir, "video.srt"))).toBe(false);
    const text = spawnSync("ffmpeg", ["-v", "error", "-i", video, "-map", "0:s:0", "-f", "srt", "-"], { encoding: "utf8" }).stdout;
    expect(text.toLowerCase()).toContain("professor");
  }, 300_000);
});
