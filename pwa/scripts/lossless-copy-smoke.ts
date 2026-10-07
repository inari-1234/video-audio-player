import { readFile, writeFile } from 'node:fs/promises';
import { extractAudioWithoutReencode, inspectAudio } from '../src/media';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: npm run smoke:copy -- input.mov output.m4a');
}

const bytes = await readFile(inputPath);
const blob = new Blob([bytes], { type: 'video/quicktime' });

const info = await inspectAudio(blob);
if (info.codec !== 'aac') throw new Error(`Expected AAC, got ${info.codec}`);
if (Math.abs(info.sampleRate - 48_000) > 1) throw new Error(`Expected 48000 Hz, got ${info.sampleRate}`);
if (info.channels !== 2) throw new Error(`Expected stereo, got ${info.channels}`);

const output = await extractAudioWithoutReencode(blob);
await writeFile(outputPath, Buffer.from(await output.arrayBuffer()));

console.log('PWA lossless-copy smoke test: PASS');
console.log(JSON.stringify(info));
