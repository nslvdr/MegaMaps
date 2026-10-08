// Await both concurrent startups; release the successful engine if either fails.
export async function startOcrEngines<
  R extends { terminate(): Promise<unknown> },
  D extends { dispose(): Promise<unknown> },
>(recognizer: Promise<R>, detector: Promise<D>) {
  const [reader, finder] = await Promise.allSettled([recognizer, detector]);
  if (reader.status === "fulfilled" && finder.status === "fulfilled")
    return { recognizer: reader.value, detector: finder.value };
  await Promise.allSettled([
    reader.status === "fulfilled" ? reader.value.terminate() : undefined,
    finder.status === "fulfilled" ? finder.value.dispose() : undefined,
  ]);
  throw reader.status === "rejected"
    ? reader.reason
    : finder.status === "rejected"
      ? finder.reason
      : new Error("OCR initialization failed.");
}
