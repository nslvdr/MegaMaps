/** The step a text scan failed at, sent with its failure to stats: downloading the
 * dictionary or a model's file, starting ONNX Runtime on a downloaded model,
 * reading the map's tiles, or scanning itself. */
export type OcrStage = "dictionary" | "detector" | "recognizer" | "runtime" | "tiles" | "scan";

const LOADING: OcrStage[] = ["dictionary", "detector", "recognizer", "runtime"];

/** A scan worker's error, rebuilt in the page with its own name and the step it failed at. */
export class OcrError extends Error {
  constructor(message: string, name: string, readonly stage: OcrStage) {
    super(message);
    this.name = name;
  }
}

/** An error tagged with the step it failed at; one already tagged keeps its first stage. */
export function tagged(error: unknown, stage: OcrStage) {
  if (error instanceof OcrError) return error;
  return error instanceof Error
    ? new OcrError(error.message, error.name, stage)
    : new OcrError(String(error), "Error", stage);
}

/** Tags a step's failure with its stage. */
export function staged<T>(stage: OcrStage, work: Promise<T>) {
  return work.catch((error: unknown) => {
    throw tagged(error, stage);
  });
}

/** Whether the scan's files failed to load offline: the app downloads them, so this
 * device doesn't hold them yet. */
export function missingOffline(error: unknown, online: boolean) {
  return !online && error instanceof OcrError && LOADING.includes(error.stage);
}
