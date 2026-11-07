// Hands a CSV file to the phone (GDA-50). On an iPhone this opens the normal Share /
// Save to Files panel. Where sharing files is not available (a computer), the file is
// downloaded instead. Throws if the file cannot be made or handed over, so the caller
// can say so; closing the share panel without choosing anything is not an error.

export async function shareCsv(text, fileName) {
  const type = "text/csv";
  const file = new File([text], fileName, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
    } catch (error) {
      if (error?.name !== "AbortError") {
        throw error;
      }
    }
    return;
  }
  // Fallback: an ordinary download.
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
