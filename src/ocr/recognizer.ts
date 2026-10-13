import { InferenceSession, Tensor } from "onnxruntime-web/wasm";
import { sessionOptions } from "./detector";

export const LINE_HEIGHT = 48;
const ORIENTATION_WIDTH = 160,
  ORIENTATION_HEIGHT = 80;

export interface LineImage {
  pixels: Uint8ClampedArray;
  width: number;
}
export interface LineReading {
  text: string;
  confidence: number;
  /** Words with their horizontal span in line-image pixels. */
  words: { text: string; x0: number; x1: number }[];
}

// A height-48 BGR line scaled to [-1, 1]. Lines are read one at a time: the
// recognizer costs the same per pixel in a batch, and a batch pads every line.
// A blank square after the text lets it finish the last character.
export function recognizerInput(line: LineImage) {
  const width = line.width + LINE_HEIGHT,
    plane = LINE_HEIGHT * width;
  const data = new Float32Array(3 * plane);
  for (let y = 0; y < LINE_HEIGHT; y++)
    for (let x = 0; x < line.width; x++)
      for (let channel = 0; channel < 3; channel++)
        data[channel * plane + y * width + x] =
          line.pixels[(y * line.width + x) * 4 + 2 - channel]! / 127.5 - 1;
  return new Tensor("float32", data, [1, 3, LINE_HEIGHT, width]);
}

// Greedy CTC: index 0 is blank, the last class is a space. Each character keeps
// the time steps it spans so words can be placed back on the map.
export function ctcDecode(
  probabilities: Float32Array,
  steps: number,
  classes: number,
  dictionary: string[],
  stepWidth: number,
): LineReading {
  let previous = 0,
    text = "",
    total = 0,
    count = 0;
  const words: LineReading["words"] = [];
  let word: LineReading["words"][number] | undefined;
  for (let t = 0; t < steps; t++) {
    const base = t * classes;
    let best = 0,
      score = probabilities[base]!;
    for (let c = 1; c < classes; c++)
      if (probabilities[base + c]! > score) {
        best = c;
        score = probabilities[base + c]!;
      }
    if (best !== 0 && best !== previous) {
      const char = best === classes - 1 ? " " : (dictionary[best - 1] ?? "");
      text += char;
      total += score;
      count++;
      if (char === " ") word = undefined;
      else {
        if (!word) words.push((word = { text: "", x0: t * stepWidth, x1: 0 }));
        word.text += char;
      }
    }
    if (best !== 0 && word && best !== classes - 1) word.x1 = (t + 1) * stepWidth;
    previous = best;
  }
  return { text: text.trim(), confidence: count ? total / count : 0, words };
}

// ImageNet-normalized BGR, squeezed to 160×80 like PaddleOCR's text-line classifier.
function orientationInput(lines: LineImage[]) {
  const plane = ORIENTATION_WIDTH * ORIENTATION_HEIGHT;
  const data = new Float32Array(lines.length * 3 * plane);
  const means = [0.485, 0.456, 0.406],
    stds = [0.229, 0.224, 0.225];
  lines.forEach((line, n) => {
    for (let y = 0; y < ORIENTATION_HEIGHT; y++) {
      const sy = Math.min(
        LINE_HEIGHT - 1,
        Math.floor(((y + 0.5) * LINE_HEIGHT) / ORIENTATION_HEIGHT),
      );
      for (let x = 0; x < ORIENTATION_WIDTH; x++) {
        const sx = Math.min(
          line.width - 1,
          Math.floor(((x + 0.5) * line.width) / ORIENTATION_WIDTH),
        );
        const source = (sy * line.width + sx) * 4;
        for (let channel = 0; channel < 3; channel++)
          data[n * 3 * plane + channel * plane + y * ORIENTATION_WIDTH + x] =
            (line.pixels[source + 2 - channel]! / 255 - means[channel]!) /
            stds[channel]!;
      }
    }
  });
  return new Tensor("float32", data, [
    lines.length,
    3,
    ORIENTATION_HEIGHT,
    ORIENTATION_WIDTH,
  ]);
}

async function run(session: InferenceSession, input: Tensor) {
  let outputs: InferenceSession.ReturnType | undefined;
  try {
    outputs = await session.run({ [session.inputNames[0]!]: input });
    const output = outputs[session.outputNames[0]!]!;
    if (!(output.data instanceof Float32Array))
      throw new Error("Unexpected text recognizer output.");
    return { data: output.data.slice(), dims: output.dims };
  } finally {
    input.dispose();
    if (outputs) for (const output of Object.values(outputs)) output.dispose();
  }
}

export async function createTextRecognizer(
  model: string | Uint8Array,
  orientationModel: string | Uint8Array,
  dictionary: string[],
) {
  const create = (source: string | Uint8Array) =>
    typeof source === "string"
      ? InferenceSession.create(source, sessionOptions)
      : InferenceSession.create(source, sessionOptions);
  const [reader, orienter] = await Promise.all([
    create(model),
    create(orientationModel),
  ]);
  return {
    async recognize(line: LineImage) {
      const { data, dims } = await run(reader, recognizerInput(line));
      const steps = dims[1]!,
        classes = dims[2]!;
      if (classes !== dictionary.length + 2)
        throw new Error("Text recognizer and dictionary do not match.");
      return ctcDecode(
        data,
        steps,
        classes,
        dictionary,
        (line.width + LINE_HEIGHT) / steps,
      );
    },
    /** How likely each line is to read upside down, from 0 to 1. */
    async upsideDown(lines: LineImage[]) {
      if (!lines.length) return [];
      const { data } = await run(orienter, orientationInput(lines));
      return lines.map((_, n) => data[n * 2 + 1]!);
    },
    async dispose() {
      await Promise.all([reader.release(), orienter.release()]);
    },
  };
}
