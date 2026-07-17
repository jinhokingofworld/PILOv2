"use client";

import type { PiloCodeLanguage } from "../engine/shapes/code-block/PiloCodeBlockShapeTypes";

export const PILO_CODE_IMPORT_MAX_FILES = 30;
export const PILO_CODE_IMPORT_MAX_SINGLE_FILE_BYTES = 200 * 1024;
export const PILO_CODE_IMPORT_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const PILO_CODE_IMPORT_MAX_FOLDER_DEPTH = 4;

export type PiloImportedCodeFile = {
  code: string;
  fileName: string;
  language: PiloCodeLanguage;
  relativePath?: string;
  size: number;
};

export type PiloImportedCodeFolder = {
  files: PiloImportedCodeFile[];
  folderName: string;
  folders: PiloImportedCodeFolder[];
  relativePath?: string;
};

export type PiloCodeFileImportSkipped = {
  fileName: string;
  reason: string;
};

export type PiloCodeFileImportResult = {
  folders: PiloImportedCodeFolder[];
  imported: PiloImportedCodeFile[];
  skipped: PiloCodeFileImportSkipped[];
  failed: PiloCodeFileImportSkipped[];
};

type FileSystemEntryLike = {
  fullPath?: string;
  isDirectory?: boolean;
  isFile?: boolean;
  name?: string;
};

type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (
    successCallback: (file: File) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
};

type FileSystemDirectoryReaderLike = {
  readEntries: (
    successCallback: (entries: FileSystemEntryLike[]) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
};

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => FileSystemDirectoryReaderLike;
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

type QueuedFile = {
  file: File;
  folder?: PiloImportedCodeFolder;
  relativePath?: string;
};

type ImportLimits = {
  importedCount: number;
  totalBytes: number;
};

const ignoredFolderNames = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const extensionLanguageMap = new Map<string, PiloCodeLanguage>([
  ["c", "c"],
  ["cc", "c"],
  ["cpp", "c"],
  ["css", "css"],
  ["cts", "ts"],
  ["cxx", "c"],
  ["h", "c"],
  ["hpp", "c"],
  ["html", "html"],
  ["htm", "html"],
  ["js", "js"],
  ["jsx", "jsx"],
  ["json", "json"],
  ["md", "md"],
  ["markdown", "md"],
  ["mjs", "js"],
  ["mts", "ts"],
  ["py", "py"],
  ["pyw", "py"],
  ["sql", "sql"],
  ["ts", "ts"],
  ["tsx", "tsx"],
]);

const mimeLanguageMap = new Map<string, PiloCodeLanguage>([
  ["application/javascript", "js"],
  ["application/json", "json"],
  ["application/sql", "sql"],
  ["application/typescript", "ts"],
  ["application/x-javascript", "js"],
  ["application/x-python-code", "py"],
  ["text/css", "css"],
  ["text/html", "html"],
  ["text/javascript", "js"],
  ["text/jsx", "jsx"],
  ["text/markdown", "md"],
  ["text/plain", "md"],
  ["text/x-c", "c"],
  ["text/x-c++src", "c"],
  ["text/x-python", "py"],
  ["text/x-sql", "sql"],
  ["text/x-typescript", "ts"],
]);

function getFileExtension(fileName: string) {
  const lastNamePart = fileName.split(/[\\/]/).pop() ?? fileName;
  const extensionStart = lastNamePart.lastIndexOf(".");

  if (extensionStart <= 0 || extensionStart === lastNamePart.length - 1) {
    return "";
  }

  return lastNamePart.slice(extensionStart + 1).toLowerCase();
}

function inferLanguageFromNameAndMime(fileName: string, mimeType: string) {
  const extensionLanguage = extensionLanguageMap.get(getFileExtension(fileName));

  if (extensionLanguage) return extensionLanguage;

  return mimeLanguageMap.get(mimeType.toLowerCase()) ?? null;
}

function inferLanguageFromShebang(code: string): PiloCodeLanguage | null {
  const firstLine = code.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";

  if (!firstLine.startsWith("#!")) return null;
  if (firstLine.includes("python")) return "py";
  if (firstLine.includes("ts-node") || firstLine.includes("tsx")) return "ts";
  if (
    firstLine.includes("node") ||
    firstLine.includes("bun") ||
    firstLine.includes("deno")
  ) {
    return "js";
  }

  return null;
}

function canCheckShebang(file: File) {
  return getFileExtension(file.name) === "";
}

function isProbablyBinary(bytes: Uint8Array) {
  if (bytes.includes(0)) return true;

  const sampleSize = Math.min(bytes.length, 4096);
  if (sampleSize === 0) return false;

  let suspiciousControlBytes = 0;

  for (let index = 0; index < sampleSize; index += 1) {
    const byte = bytes[index];
    const isAllowedControlByte = byte === 9 || byte === 10 || byte === 13;

    if (byte < 32 && !isAllowedControlByte) {
      suspiciousControlBytes += 1;
    }
  }

  return suspiciousControlBytes / sampleSize > 0.02;
}

function cleanText(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isFileEntry(entry: FileSystemEntryLike): entry is FileSystemFileEntryLike {
  return Boolean(entry.isFile && "file" in entry);
}

function isDirectoryEntry(
  entry: FileSystemEntryLike,
): entry is FileSystemDirectoryEntryLike {
  return Boolean(entry.isDirectory && "createReader" in entry);
}

function readFileEntry(entry: FileSystemFileEntryLike) {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readDirectoryEntries(reader: FileSystemDirectoryReaderLike) {
  return new Promise<FileSystemEntryLike[]>((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function readAllDirectoryEntries(entry: FileSystemDirectoryEntryLike) {
  const reader = entry.createReader();
  const entries: FileSystemEntryLike[] = [];

  while (true) {
    const batch = await readDirectoryEntries(reader);

    if (!batch.length) break;

    entries.push(...batch);
  }

  return entries;
}

function getEntryPathName(entry: FileSystemEntryLike, fallback: string) {
  return (entry.fullPath ?? entry.name ?? fallback).replace(/^\/+/, "");
}

function createImportedCodeFolderNode({
  folderName,
  relativePath,
}: {
  folderName: string;
  relativePath?: string;
}): PiloImportedCodeFolder {
  return {
    files: [],
    folderName,
    folders: [],
    relativePath,
  };
}

async function collectDirectoryFiles({
  depth,
  entry,
  failed,
  folder,
  queuedFiles,
  relativeBasePath,
  skipped,
}: {
  depth: number;
  entry: FileSystemDirectoryEntryLike;
  failed: PiloCodeFileImportSkipped[];
  folder: PiloImportedCodeFolder;
  queuedFiles: QueuedFile[];
  relativeBasePath: string;
  skipped: PiloCodeFileImportSkipped[];
}) {
  if (depth > PILO_CODE_IMPORT_MAX_FOLDER_DEPTH) {
    skipped.push({
      fileName: relativeBasePath || entry.name || folder.folderName,
      reason: "폴더 depth 제한을 초과했습니다.",
    });
    return;
  }

  try {
    const entries = await readAllDirectoryEntries(entry);

    for (const childEntry of entries) {
      const childName = childEntry.name ?? "이름 없는 항목";
      const childPath = relativeBasePath
        ? `${relativeBasePath}/${childName}`
        : childName;

      if (isDirectoryEntry(childEntry)) {
        if (ignoredFolderNames.has(childName)) {
          skipped.push({
            fileName: childPath,
            reason: "제외 폴더입니다.",
          });
          continue;
        }

        const childFolder = createImportedCodeFolderNode({
          folderName: childName,
          relativePath: childPath,
        });

        folder.folders.push(childFolder);
        await collectDirectoryFiles({
          depth: depth + 1,
          entry: childEntry,
          failed,
          folder: childFolder,
          queuedFiles,
          relativeBasePath: childPath,
          skipped,
        });
        continue;
      }

      if (!isFileEntry(childEntry)) {
        skipped.push({
          fileName: childPath,
          reason: "지원하지 않는 항목입니다.",
        });
        continue;
      }

      try {
        const file = await readFileEntry(childEntry);

        queuedFiles.push({
          file,
          folder,
          relativePath: childPath,
        });
      } catch {
        failed.push({
          fileName: childPath,
          reason: "파일을 읽지 못했습니다.",
        });
      }
    }
  } catch {
    failed.push({
      fileName: relativeBasePath || entry.name || folder.folderName,
      reason: "폴더를 읽지 못했습니다.",
    });
  }
}

async function getDataTransferFiles(dataTransfer: DataTransfer) {
  const folders: PiloImportedCodeFolder[] = [];
  const queuedFiles: QueuedFile[] = [];
  const skipped: PiloCodeFileImportSkipped[] = [];
  const failed: PiloCodeFileImportSkipped[] = [];

  if (dataTransfer.items.length) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== "file") continue;

      const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.();

      if (entry && isDirectoryEntry(entry)) {
        const folderName = entry.name ?? "폴더";

        if (ignoredFolderNames.has(folderName)) {
          skipped.push({
            fileName: folderName,
            reason: "제외 폴더입니다.",
          });
          continue;
        }

        const folder = createImportedCodeFolderNode({ folderName });

        folders.push(folder);
        await collectDirectoryFiles({
          depth: 1,
          entry,
          failed,
          folder,
          queuedFiles,
          relativeBasePath: "",
          skipped,
        });
        continue;
      }

      if (entry && isFileEntry(entry)) {
        try {
          const file = await readFileEntry(entry);

          queuedFiles.push({
            file,
            relativePath: getEntryPathName(entry, file.name),
          });
        } catch {
          failed.push({
            fileName: entry.name ?? "파일",
            reason: "파일을 읽지 못했습니다.",
          });
        }
        continue;
      }

      const file = item.getAsFile();
      if (file) {
        queuedFiles.push({ file });
      }
    }

    return { failed, folders, queuedFiles, skipped };
  }

  return {
    failed,
    folders,
    queuedFiles: Array.from(dataTransfer.files).map((file) => ({ file })),
    skipped,
  };
}

function uniqueFiles(files: QueuedFile[]) {
  const seen = new Set<string>();

  return files.filter(({ file, folder, relativePath }) => {
    const key = [file.name, file.size, file.lastModified].join("|");
    const scopedKey = [folder?.relativePath ?? "", relativePath ?? "", key].join(
      "|",
    );

    if (seen.has(scopedKey)) return false;

    seen.add(scopedKey);
    return true;
  });
}

async function readCodeFile(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (isProbablyBinary(bytes)) {
    return {
      code: "",
      binary: true,
    };
  }

  return {
    code: cleanText(new TextDecoder("utf-8").decode(bytes)),
    binary: false,
  };
}

export function hasCodeFileDrag(
  dataTransfer: DataTransfer | null,
): dataTransfer is DataTransfer {
  return Boolean(dataTransfer?.types.includes("Files"));
}

async function readImportableQueuedFile({
  failed,
  limits,
  queuedFile,
  skipped,
}: {
  failed: PiloCodeFileImportSkipped[];
  limits: ImportLimits;
  queuedFile: QueuedFile;
  skipped: PiloCodeFileImportSkipped[];
}) {
  const { file, relativePath } = queuedFile;
  const displayName = relativePath ?? file.name;

  if (limits.importedCount >= PILO_CODE_IMPORT_MAX_FILES) {
    skipped.push({
      fileName: displayName,
      reason: "최대 파일 수를 초과했습니다.",
    });
    return null;
  }

  if (file.size > PILO_CODE_IMPORT_MAX_SINGLE_FILE_BYTES) {
    skipped.push({
      fileName: displayName,
      reason: "단일 파일 크기 제한을 초과했습니다.",
    });
    return null;
  }

  if (limits.totalBytes + file.size > PILO_CODE_IMPORT_MAX_TOTAL_BYTES) {
    skipped.push({
      fileName: displayName,
      reason: "전체 import 크기 제한을 초과했습니다.",
    });
    return null;
  }

  let language = inferLanguageFromNameAndMime(file.name, file.type);

  if (!language && !canCheckShebang(file)) {
    skipped.push({
      fileName: displayName,
      reason: "지원하지 않는 파일 형식입니다.",
    });
    return null;
  }

  try {
    const result = await readCodeFile(file);

    if (result.binary) {
      skipped.push({
        fileName: displayName,
        reason: "바이너리 파일은 제외했습니다.",
      });
      return null;
    }

    language = language ?? inferLanguageFromShebang(result.code);

    if (!language) {
      skipped.push({
        fileName: displayName,
        reason: "지원 언어를 추론하지 못했습니다.",
      });
      return null;
    }

    limits.importedCount += 1;
    limits.totalBytes += file.size;

    return {
      code: result.code,
      fileName: displayName,
      language,
      relativePath,
      size: file.size,
    };
  } catch {
    failed.push({
      fileName: displayName,
      reason: "파일을 읽지 못했습니다.",
    });
    return null;
  }
}

function pruneImportedCodeFolder(
  folder: PiloImportedCodeFolder,
): PiloImportedCodeFolder | null {
  const folders = folder.folders.flatMap((childFolder) => {
    const prunedFolder = pruneImportedCodeFolder(childFolder);

    return prunedFolder ? [prunedFolder] : [];
  });

  if (!folder.files.length && !folders.length) return null;

  return {
    ...folder,
    folders,
  };
}

export async function importCodeFilesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<PiloCodeFileImportResult> {
  const collectedFiles = await getDataTransferFiles(dataTransfer);
  const { failed, folders, queuedFiles, skipped } = collectedFiles;
  const files = uniqueFiles(queuedFiles);
  const limits: ImportLimits = {
    importedCount: 0,
    totalBytes: 0,
  };
  const imported: PiloImportedCodeFile[] = [];

  for (const queuedFile of files) {
    const codeFile = await readImportableQueuedFile({
      failed,
      limits,
      queuedFile,
      skipped,
    });

    if (!codeFile) continue;

    if (queuedFile.folder) {
      queuedFile.folder.files.push(codeFile);
    } else {
      imported.push(codeFile);
    }
  }

  return {
    folders: folders.flatMap((folder) => {
      const prunedFolder = pruneImportedCodeFolder(folder);

      return prunedFolder ? [prunedFolder] : [];
    }),
    imported,
    skipped,
    failed,
  };
}
