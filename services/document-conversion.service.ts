import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { AppError, ValidationError } from "../api/middlewares/error.middleware.js";

const execFileAsync = promisify(execFile);

const WORD_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function wordExtension(fileName: string, mimeType: string): ".doc" | ".docx" {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".doc" || extension === ".docx") return extension;
  if (mimeType === "application/msword") return ".doc";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
  throw new ValidationError("Choose a DOC or DOCX file.");
}

export function isSupportedWordDocument(fileName: string, mimeType: string): boolean {
  const extension = path.extname(fileName).toLowerCase();
  return WORD_MIME_TYPES.has(mimeType) || extension === ".doc" || extension === ".docx";
}

export async function convertWordDocumentToPdf(input: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}): Promise<Buffer> {
  if (!input.buffer.length) throw new ValidationError("The selected document is empty.");
  if (!isSupportedWordDocument(input.originalName, input.mimeType)) {
    throw new ValidationError("Choose a DOC or DOCX file.");
  }

  const extension = wordExtension(input.originalName, input.mimeType);
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), "zupiq-document-"));
  const inputPath = path.join(workDirectory, `source${extension}`);

  try {
    await writeFile(inputPath, input.buffer);
    try {
      await execFileAsync(
        env.LIBREOFFICE_BIN,
        [
          `-env:UserInstallation=${pathToFileURL(path.join(workDirectory, "libreoffice-profile")).href}`,
          "--headless",
          "--nologo",
          "--nodefault",
          "--nofirststartwizard",
          "--convert-to",
          "pdf",
          "--outdir",
          workDirectory,
          inputPath,
        ],
        {
          timeout: env.DOCUMENT_CONVERSION_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        },
      );
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        throw new AppError(
          "Document conversion is temporarily unavailable.",
          503,
          true,
          "DOCUMENT_CONVERTER_UNAVAILABLE",
        );
      }
      if (error?.killed || error?.signal === "SIGTERM") {
        throw new AppError("Document conversion timed out.", 504, true, "DOCUMENT_CONVERSION_TIMEOUT");
      }
      throw new AppError("This Word document could not be converted.", 422, true, "DOCUMENT_CONVERSION_FAILED");
    }

    const files = await readdir(workDirectory);
    const pdfName = files.find(file => file.toLowerCase().endsWith(".pdf"));
    if (!pdfName) {
      throw new AppError("This Word document could not be converted.", 422, true, "DOCUMENT_CONVERSION_FAILED");
    }
    return await readFile(path.join(workDirectory, pdfName));
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}
