/** Save a file through the browser's downloads. */
export function downloadFile(file: File, root: HTMLElement = document.body) {
  const url = URL.createObjectURL(file);
  const link = root.ownerDocument.createElement("a");
  link.href = url;
  link.download = file.name;
  root.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Native file sharing where supported, else a download. Chrome's canShare accepts
 * any file, then share refuses types off its list, which .megamap and .megabackup
 * aren't on, so a refusal downloads too. Resolves how it went.
 */
export async function shareOrDownload(file: File, root?: HTMLElement) {
  if (!navigator.canShare?.({ files: [file] }) || !navigator.share) {
    downloadFile(file, root);
    return "saved";
  }
  try {
    // Only the file: iOS saves a title or text as a second file beside it.
    await navigator.share({ files: [file] });
    return "shared";
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "AbortError") return "cancelled";
    if (name !== "NotAllowedError") throw error;
    downloadFile(file, root);
    return "saved";
  }
}
