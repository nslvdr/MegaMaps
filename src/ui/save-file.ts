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

/** Native file sharing where supported, else a download. Resolves false if the user cancelled. */
export async function shareOrDownload(file: File, title: string, root?: HTMLElement) {
  if (!navigator.canShare?.({ files: [file] }) || !navigator.share) {
    downloadFile(file, root);
    return "saved";
  }
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    throw error;
  }
}
