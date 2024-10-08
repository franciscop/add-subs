#!/usr/bin/env node

import ora from "ora";
import cmd from "atocha";
import files from "files";
import meow from "meow";

const { input, flags } = meow(
  `
	Usage
	  $ add-subs <mp4/mkv file path>

	Options
	  --lang, -l  The language of the subtitle file, like "English" or "Spanish"

	Examples
	  $ add-subs "~/Movies/file.mp4"
    ⠼  Converting /Users/francisco/Movies/file

	  $ add-subs "~/Movies/file.mkv" --lang Spanish
    ✅ Converting /Users/francisco/Movies/file
  `,
  { flags: { lang: { type: "string", alias: "l", default: "English" } } },
);

(async () => {
  if (!input.length) {
    return console.error("Please specify the file name");
  }

  let file = input[0];
  if (file.slice(0, 2) === "~/") {
    file = await files.home(file.slice(2));
  }
  const ext = file.split(".").pop();
  const name = file.replace(/\.(mp4|avi|mkv|srt)$/, "");

  const video = await files.abs(`${name}.${ext}`);
  if (!(await files.exists(video))) {
    return console.error(`The MKV/MP4 "${video}" doesn't exist`);
  }

  const subs = await files.abs(`${name}.srt`);
  if (!(await files.exists(subs))) {
    return console.error(`The subtitles "${subs}" doesn't exist`);
  }

  const spinner = ora(` Converting ${name}`).start();
  const temp = `${name} Sub.${ext}`;
  if (ext === "mp4") {
    await cmd(
      `ffmpeg -y -i "${video}" -i "${subs}" -c copy -c:s mov_text -metadata:s:s:0 title="${flags.lang}" -disposition:s:0 forced "${temp}"`,
    ).catch((err) => {}); // It outputs normal output to stderr 🤷‍♂️
  } else {
    await cmd(
      `ffmpeg -y -i "${video}" -i "${subs}" -c copy -map 0 -map 1 -metadata:s:s:0 title="${flags.lang}" -disposition:s:0 forced "${temp}"`,
    ).catch((err) => {}); // It outputs normal output to stderr 🤷‍♂️
  }
  await Promise.all([files.remove(video), files.remove(subs)]);
  await files.move(temp, video);
  spinner.stopAndPersist({ symbol: "✅" });
})();
