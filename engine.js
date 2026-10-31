const STORAGE_KEY = "vvngine-html-source-v1";
const DATABASE_NAME = "vvngine-virtual-project";
const DATABASE_VERSION = 1;
const ACTIVE_FILE_KEY = "vvngine-active-file-v1";
const PROJECT_NAME_KEY = "vvngine-project-name-v1";
const HIDDEN_SHARED_FILES_KEY = "vvngine-hidden-shared-files-v1";
const LEGACY_STORAGE_KEY = "fable-html-source-v1";
const LEGACY_DATABASE_NAME = "fable-virtual-project";
const LEGACY_ACTIVE_FILE_KEY = "fable-active-file-v1";

const elements = {
  editor: document.querySelector("#source-editor"),
  lineNumbers: document.querySelector("#line-numbers"),
  lineCount: document.querySelector("#line-count"),
  projectLabel: document.querySelector("#project-label"),
  explorerProjectName: document.querySelector("#explorer-project-name"),
  activeFileLabel: document.querySelector("#active-file-label"),
  editorModeLabel: document.querySelector("#editor-mode-label"),
  fileTree: document.querySelector("#file-tree"),
  newFileButton: document.querySelector("#new-file-button"),
  newFolderButton: document.querySelector("#new-folder-button"),
  renameEntryButton: document.querySelector("#rename-entry-button"),
  deleteEntryButton: document.querySelector("#delete-entry-button"),
  uploadAssetButton: document.querySelector("#upload-asset-button"),
  assetFileInput: document.querySelector("#asset-file-input"),
  entryForm: document.querySelector("#explorer-entry-form"),
  entryName: document.querySelector("#entry-name"),
  entrySaveButton: document.querySelector("#entry-save-button"),
  entryCancelButton: document.querySelector("#entry-cancel-button"),
  assetDetails: document.querySelector("#asset-details"),
  selectedAssetId: document.querySelector("#selected-asset-id"),
  copyAssetId: document.querySelector("#copy-asset-id"),
  assetPreview: document.querySelector("#asset-preview"),
  assetPreviewError: document.querySelector("#asset-preview-error"),
  stageBackground: document.querySelector("#stage-background"),
  novelContent: document.querySelector("#novel-content"),
  sceneProgress: document.querySelector("#scene-progress"),
  activeResourceList: document.querySelector("#active-resource-list"),
  diagnostics: document.querySelector("#diagnostics"),
  openButton: document.querySelector("#open-button"),
  openFile: document.querySelector("#open-file"),
  exportSourceButton: document.querySelector("#export-source-button"),
  restartButton: document.querySelector("#restart-button"),
  topMenuToggle: document.querySelector("#top-menu-toggle"),
  topMenuItems: document.querySelector("#top-menu-items"),
  explorerCollapseToggle: document.querySelector("#explorer-collapse-toggle"),
  explorerPanel: document.querySelector(".explorer-panel"),
  readerCollapseToggle: document.querySelector("#reader-collapse-toggle"),
  readerPanel: document.querySelector(".reader-panel")
};

const ALLOWED_INLINE_TAGS = new Set(["P", "BR", "EM", "STRONG", "I", "B", "SPAN", "SUB", "SUP"]);
let story = null;
let currentSceneId = null;
let lineIndex = 0;
let renderTimer = null;
let projectDatabase;
let projectEntries = [];
let currentFilePath = "";
let previewFilePath = "";
let selectedEntryPath = "";
let selectedDirectory = "assets";
let pendingSave = Promise.resolve();
let entryFormMode = "";
let sceneRenderVersion = 0;
const expandedFolders = new Set(["", "assets", "stories"]);
const objectUrls = new Map();
let sharedLibraryEntries = [];
let sharedLibraryError = "";
let currentFileIsShared = false;
let projectName = "MY PROJECT";

function safeImageUrl(value) {
  if (!value) return "";
  if (/^asset:img-[a-z0-9-]+$/i.test(value)) return value;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "https:" || url.protocol === "http:" ||
      (url.protocol === "file:" && window.location.protocol === "file:") ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeProjectPath(path, basePath = "") {
  const parts = basePath ? parentPath(basePath).split("/").filter(Boolean) : [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("Story links must stay inside the project.");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function resolveStoryChoice(href, sourcePath) {
  if (!href) throw new Error("A choice needs an href pointing to a scene.");
  const hashIndex = href.indexOf("#");
  const pathPart = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const sceneId = hashIndex < 0 ? "" : decodeURIComponent(href.slice(hashIndex + 1));
  if (!sceneId || pathPart.includes("?") || /^[a-z][a-z\d+.-]*:/i.test(pathPart) ||
      pathPart.startsWith("/") || pathPart.startsWith("//")) {
    throw new Error("Choices must point to a scene using #scene-id or a project-relative file.html#scene-id link.");
  }
  const targetPath = pathPart ? normalizeProjectPath(decodeURIComponent(pathPart), sourcePath) : sourcePath;
  if (!/\.html?$/i.test(targetPath)) throw new Error("A cross-file choice must link to an HTML story.");
  return { targetFile: targetPath, target: sceneId };
}

function parseStory(source, sourcePath = currentFilePath) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const roots = parsed.body.querySelectorAll("[data-vn-story]");
  if (roots.length !== 1) throw new Error("Your file needs exactly one element with data-vn-story.");

  const root = roots[0];
  const sceneNodes = [...root.querySelectorAll(":scope > [data-scene]")];
  if (!sceneNodes.length) throw new Error("Add at least one <section data-scene> inside your story.");

  const ids = new Set();
  const scenes = sceneNodes.map((node) => {
    const id = node.getAttribute("id")?.trim();
    if (!id) throw new Error("Every scene needs an id, like <section id=\"start\" data-scene>.");
    if (ids.has(id)) throw new Error(`The scene id "${id}" is used more than once.`);
    ids.add(id);
    return {
      id,
      background: safeImageUrl(node.getAttribute("data-background") || ""),
      lines: [...node.querySelectorAll(":scope > [data-dialogue]")].map((line) => ({
        character: line.getAttribute("data-character")?.trim() || "",
        html: sanitizeMarkup(line.innerHTML)
      })),
      choices: [...node.querySelectorAll(":scope > a[data-choice]")].map((choice) => ({
        ...resolveStoryChoice(choice.getAttribute("href")?.trim() || "", sourcePath),
        text: choice.textContent.trim()
      }))
    };
  });

  for (const scene of scenes) {
    for (const choice of scene.choices) {
      if (choice.targetFile === sourcePath && !ids.has(choice.target)) {
        throw new Error(`A choice in "${scene.id}" points to missing scene "${choice.target}".`);
      }
    }
  }

  return {
    title: root.getAttribute("data-title")?.trim() || "Untitled story",
    scenes
  };
}

function sanitizeMarkup(markup) {
  const parsed = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    if (!ALLOWED_INLINE_TAGS.has(node.tagName)) {
      const fragment = document.createDocumentFragment();
      [...node.childNodes].forEach((child) => fragment.append(cleanNode(child)));
      return fragment;
    }
    const safe = document.createElement(node.tagName.toLowerCase());
    [...node.childNodes].forEach((child) => safe.append(cleanNode(child)));
    return safe;
  };
  const wrapper = document.createElement("div");
  [...parsed.body.childNodes].forEach((node) => wrapper.append(cleanNode(node)));
  return wrapper.innerHTML;
}

function setDiagnostic(message = "", isSuccess = false) {
  elements.diagnostics.textContent = message;
  elements.diagnostics.classList.toggle("visible", Boolean(message));
  elements.diagnostics.classList.toggle("success", Boolean(message) && isSuccess);
}

function openProjectDatabase(databaseName = DATABASE_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("entries", { keyPath: "path" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open project storage."));
  });
}

function getAllEntries(database = projectDatabase) {
  return new Promise((resolve, reject) => {
    const request = database.transaction("entries", "readonly").objectStore("entries").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not read the project files."));
  });
}

function getEntry(path) {
  return new Promise((resolve, reject) => {
    const request = projectDatabase.transaction("entries", "readonly").objectStore("entries").get(path);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error(`Could not read "${path}".`));
  });
}

function putEntries(entries) {
  return new Promise((resolve, reject) => {
    const transaction = projectDatabase.transaction("entries", "readwrite");
    const store = transaction.objectStore("entries");
    entries.forEach((entry) => store.put(entry));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Could not save project files."));
    transaction.onabort = () => reject(transaction.error || new Error("Saving project files was cancelled."));
  });
}

function removeEntries(paths) {
  return new Promise((resolve, reject) => {
    const transaction = projectDatabase.transaction("entries", "readwrite");
    const store = transaction.objectStore("entries");
    paths.forEach((path) => store.delete(path));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Could not delete project files."));
    transaction.onabort = () => reject(transaction.error || new Error("Deleting project files was cancelled."));
  });
}

function replaceProjectEntries(entries) {
  return new Promise((resolve, reject) => {
    const transaction = projectDatabase.transaction("entries", "readwrite");
    const store = transaction.objectStore("entries");
    store.clear();
    entries.forEach((entry) => store.put(entry));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Could not replace the project files."));
    transaction.onabort = () => reject(transaction.error || new Error("Replacing the project was cancelled."));
  });
}

const zipEncoder = new TextEncoder();
const zipDecoder = new TextDecoder();
const zipCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function zipCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = zipCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipUint16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function zipUint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function zipJoin(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    joined.set(part, offset);
    offset += part.length;
  });
  return joined;
}

function createZipArchive(files) {
  const totalSize = files.reduce((total, file) => total + file.bytes.length, 0);
  if (files.length > 5000 || totalSize > 268435456) {
    throw new Error("Projects must contain no more than 5,000 files and 256 MB of data to export.");
  }
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  files.forEach(({ path, bytes }) => {
    const name = zipEncoder.encode(path);
    const checksum = zipCrc32(bytes);
    const localHeader = zipJoin([
      zipUint32(0x04034b50), zipUint16(20), zipUint16(0x0800), zipUint16(0),
      zipUint16(0), zipUint16(0), zipUint32(checksum), zipUint32(bytes.length),
      zipUint32(bytes.length), zipUint16(name.length), zipUint16(0), name
    ]);
    localRecords.push(localHeader, bytes);
    centralRecords.push(zipJoin([
      zipUint32(0x02014b50), zipUint16(20), zipUint16(20), zipUint16(0x0800),
      zipUint16(0), zipUint16(0), zipUint16(0), zipUint32(checksum),
      zipUint32(bytes.length), zipUint32(bytes.length), zipUint16(name.length),
      zipUint16(0), zipUint16(0), zipUint16(0), zipUint16(0), zipUint32(0),
      zipUint32(localOffset), name
    ]));
    localOffset += localHeader.length + bytes.length;
  });

  const centralDirectory = zipJoin(centralRecords);
  const endRecord = zipJoin([
    zipUint32(0x06054b50), zipUint16(0), zipUint16(0), zipUint16(files.length),
    zipUint16(files.length), zipUint32(centralDirectory.length), zipUint32(localOffset), zipUint16(0)
  ]);
  return new Blob([...localRecords, centralDirectory, endRecord], { type: "application/zip" });
}

async function readZipArchive(file) {
  if (file.size > 268435456) throw new Error("Project ZIPs must be smaller than 256 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumOffset = Math.max(0, bytes.length - 65557);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("That file isn't a valid project ZIP.");
  if (view.getUint16(endOffset + 4, true) || view.getUint16(endOffset + 6, true)) {
    throw new Error("Multi-disk ZIP archives aren't supported.");
  }
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  if (view.getUint16(endOffset + 8, true) !== entryCount ||
      entryCount > 5000 || centralOffset + centralSize > endOffset) {
    throw new Error("The project ZIP has an invalid or unsupported directory.");
  }

  const centralDirectoryStart = centralOffset;
  const files = [];
  let totalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error("The project ZIP contains a damaged directory.");
    const flags = view.getUint16(centralOffset + 8, true);
    const method = view.getUint16(centralOffset + 10, true);
    const checksum = view.getUint32(centralOffset + 16, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const uncompressedSize = view.getUint32(centralOffset + 24, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    if (flags & 1) throw new Error("Encrypted ZIP files aren't supported.");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("ZIP64 archives aren't supported yet.");
    }
    if (uncompressedSize > 268435456 || totalSize + uncompressedSize > 268435456) {
      throw new Error("Project ZIPs must be smaller than 256 MB when unpacked.");
    }
    totalSize += uncompressedSize;

    const nameStart = centralOffset + 46;
    if (nameStart + nameLength + extraLength + commentLength > centralOffset + centralSize) {
      throw new Error("The project ZIP contains a damaged directory entry.");
    }
    const path = zipDecoder.decode(bytes.subarray(nameStart, nameStart + nameLength)).replace(/\\/g, "/");
    if (path.startsWith("/") || /^[a-z]:/i.test(path) ||
        path.split("/").some((part) => part === "." || part === ".." || part.includes("\0"))) {
      throw new Error(`Unsafe path in project ZIP: "${path}".`);
    }
    const directory = path.endsWith("/");
    if (localOffset + 30 > centralDirectoryStart ||
        view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Damaged ZIP entry "${path}".`);
    }
    if (view.getUint16(localOffset + 6, true) & 1 ||
        view.getUint16(localOffset + 8, true) !== method) {
      throw new Error(`ZIP entry "${path}" has inconsistent compression information.`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const localPath = zipDecoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength))
      .replace(/\\/g, "/");
    if (localPath !== path || dataStart + compressedSize > centralDirectoryStart) {
      throw new Error(`ZIP entry "${path}" has an invalid local header.`);
    }
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (directory) {
      data = new Uint8Array();
    } else if (method === 0) {
      data = compressed.slice();
    } else if (method === 8 && typeof DecompressionStream === "function") {
      try {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        throw new Error(`Couldn't decompress ZIP entry "${path}".`);
      }
    } else {
      throw new Error(`Unsupported compression method for "${path}".`);
    }
    if (data.length !== uncompressedSize || zipCrc32(data) !== checksum) {
      throw new Error(`ZIP entry "${path}" is incomplete or corrupted.`);
    }
    files.push({ path, directory, bytes: data });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function normalizeProjectName(name) {
  return safeFileName(name.replace(/[\u0000-\u001f]/g, "")).replace(/\s+/g, " ").trim();
}

function setProjectName(name) {
  projectName = name || "MY PROJECT";
  elements.explorerProjectName.textContent = projectName;
  localStorage.setItem(PROJECT_NAME_KEY, projectName);
}

function getHiddenSharedFiles() {
  const saved = localStorage.getItem(HIDDEN_SHARED_FILES_KEY);
  if (!saved) return new Set();
  try {
    const paths = JSON.parse(saved);
    return Array.isArray(paths) ? new Set(paths.filter((path) => typeof path === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function hideSharedFile(path) {
  const hidden = getHiddenSharedFiles();
  hidden.add(path);
  localStorage.setItem(HIDDEN_SHARED_FILES_KEY, JSON.stringify([...hidden]));
}

function isProtectedProjectAsset(entry) {
  return entry.kind === "asset" && (
    entry.protected === true ||
    sharedLibraryEntries.some((shared) => shared.kind === "asset" && shared.path === entry.path)
  );
}

async function createProjectArchive(name) {
  const entries = getExplorerEntries();
  const files = new Map();
  const assetIds = {};
  const assetMimeTypes = {};
  const protectedAssets = [];
  const includedDirectories = new Set([""]);
  const addDirectory = (path) => {
    if (!path) return;
    const parts = path.split("/");
    let current = "";
    parts.forEach((part) => {
      current = current ? `${current}/${part}` : part;
      includedDirectories.add(current);
    });
  };

  entries.forEach((entry) => {
    addDirectory(entry.kind === "folder" ? entry.path : parentPath(entry.path));
  });
  for (const entry of entries) {
    if (entry.kind === "folder") continue;
    let bytes;
    if (entry.shared) {
      if (typeof entry.content === "string") {
        bytes = zipEncoder.encode(entry.content);
      } else if (entry.blob instanceof Blob) {
        bytes = new Uint8Array(await entry.blob.arrayBuffer());
      } else {
        const response = await fetchRepositoryFile(entry.path);
        if (!response.ok) throw new Error(`Could not include "${entry.path}" (${response.status}).`);
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      if (entry.kind === "asset") {
        protectedAssets.push(entry.path);
        if (entry.mimeType) assetMimeTypes[entry.path] = entry.mimeType;
      }
    } else if (entry.kind === "html") {
      bytes = zipEncoder.encode(entry.content || "");
    } else if (entry.kind === "asset" && entry.blob instanceof Blob) {
      bytes = new Uint8Array(await entry.blob.arrayBuffer());
      if (entry.assetId) assetIds[entry.path] = entry.assetId;
      if (entry.mimeType) assetMimeTypes[entry.path] = entry.mimeType;
      if (isProtectedProjectAsset(entry)) protectedAssets.push(entry.path);
    } else {
      throw new Error(`Could not export "${entry.path}" because its file data is missing.`);
    }
    files.set(entry.path, bytes);
  }

  const activeFile = currentFilePath && files.has(currentFilePath) ? currentFilePath : "";
  if (!currentFileIsShared && currentFilePath && files.has(currentFilePath)) {
    files.set(currentFilePath, zipEncoder.encode(elements.editor.value));
  }
  const manifest = {
    format: "vvngine-project",
    version: 1,
    projectName: name,
    activeFile,
    assetIds,
    assetMimeTypes,
    protectedAssets
  };
  const root = `${name}/`;
  const archiveFiles = [
    { path: `${root}.vvngine-project.json`, bytes: zipEncoder.encode(JSON.stringify(manifest, null, 2)) }
  ];
  [...includedDirectories].filter(Boolean).sort().forEach((path) => {
    archiveFiles.push({ path: `${root}${path}/`, bytes: new Uint8Array() });
  });
  files.forEach((bytes, path) => archiveFiles.push({ path: `${root}${path}`, bytes }));
  return createZipArchive(archiveFiles);
}

function getImportedAssetMimeType(path) {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return ({
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
  })[extension] || "";
}

async function importProjectArchive(file) {
  const archiveEntries = await readZipArchive(file);
  const filesByPath = new Map();
  let rootName = "";
  for (const item of archiveEntries) {
    const normalizedPath = item.path.replace(/\/+$/, "");
    if (!normalizedPath) continue;
    const segments = normalizedPath.split("/");
    if (segments.some((segment) => !segment)) throw new Error(`Invalid path in project ZIP: "${item.path}".`);
    if (!rootName) rootName = segments[0];
    if (segments[0] !== rootName || (segments.length < 2 && !(segments.length === 1 && item.directory))) {
      throw new Error("The ZIP must contain one top-level project folder.");
    }
    if (filesByPath.has(normalizedPath)) throw new Error(`The ZIP contains duplicate path "${normalizedPath}".`);
    filesByPath.set(normalizedPath, item);
  }
  if (!rootName || rootName === "." || rootName === "..") throw new Error("The ZIP doesn't contain a project folder.");
  const cleanRootName = normalizeProjectName(rootName);
  if (!cleanRootName || cleanRootName !== rootName || zipEncoder.encode(rootName).length > 255) {
    throw new Error("The project folder name is invalid or too long.");
  }

  const manifestPath = `${rootName}/.vvngine-project.json`;
  const manifestEntry = filesByPath.get(manifestPath);
  if (!manifestEntry || manifestEntry.directory) throw new Error("This ZIP is missing its Vignalise project information.");
  let manifest;
  try {
    manifest = JSON.parse(zipDecoder.decode(manifestEntry.bytes));
  } catch {
    throw new Error("The project information file is invalid.");
  }
  if (manifest?.format !== "vvngine-project" || manifest.version !== 1 ||
      typeof manifest.projectName !== "string" || manifest.projectName !== rootName ||
      typeof manifest.assetIds !== "object" || !manifest.assetIds || Array.isArray(manifest.assetIds) ||
      typeof manifest.assetMimeTypes !== "object" || !manifest.assetMimeTypes || Array.isArray(manifest.assetMimeTypes) ||
      (manifest.protectedAssets !== undefined &&
        (!Array.isArray(manifest.protectedAssets) || manifest.protectedAssets.some((path) => typeof path !== "string")))) {
    throw new Error("This ZIP has unsupported or invalid Vignalise project information.");
  }

  const importedEntries = new Map();
  const importedAssetIds = new Set();
  const addFolder = (path) => {
    if (!path) return;
    if (importedEntries.has(path)) {
      if (importedEntries.get(path).kind !== "folder") {
        throw new Error(`The ZIP uses "${path}" as both a file and a folder.`);
      }
      return;
    }
    importedEntries.set(path, { path, name: path.slice(path.lastIndexOf("/") + 1), kind: "folder" });
  };
  for (const item of archiveEntries) {
    let path = item.path.replace(/\/+$/, "").slice(rootName.length).replace(/^\/+/, "");
    if (!path || path === ".vvngine-project.json") continue;
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) addFolder(parts.slice(0, index).join("/"));
    if (item.directory) {
      addFolder(path);
      continue;
    }
    if (importedEntries.has(path)) throw new Error(`The ZIP contains duplicate path "${path}".`);
    const name = parts[parts.length - 1];
    if (/\.html?$/i.test(name)) {
      const content = zipDecoder.decode(item.bytes);
      importedEntries.set(path, { path, name, kind: "html", content });
    } else {
      const mimeType = manifest.assetMimeTypes[path] || getImportedAssetMimeType(path);
      if (!mimeType) throw new Error(`Unsupported file type in the project ZIP: "${path}".`);
      const assetId = manifest.assetIds[path];
      if (assetId !== undefined && (typeof assetId !== "string" || !/^img-[a-z0-9-]+$/i.test(assetId))) {
        throw new Error(`Invalid image asset ID for "${path}".`);
      }
      const restoredAssetId = assetId || makeAssetId();
      if (importedAssetIds.has(restoredAssetId)) throw new Error(`Image asset ID "${restoredAssetId}" is duplicated in the project.`);
      importedAssetIds.add(restoredAssetId);
      importedEntries.set(path, {
        path,
        name,
        kind: "asset",
        assetId: restoredAssetId,
        mimeType,
        blob: new Blob([item.bytes], { type: mimeType }),
        protected: manifest.protectedAssets?.includes(path) || false
      });
    }
  }
  const validAssetPaths = new Set([...importedEntries.values()]
    .filter((entry) => entry.kind === "asset").map((entry) => entry.path));
  for (const path of Object.keys(manifest.assetIds)) {
    if (!validAssetPaths.has(path)) throw new Error(`The project information references missing image "${path}".`);
  }
  for (const [path, mimeType] of Object.entries(manifest.assetMimeTypes)) {
    if (!validAssetPaths.has(path) || typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
      throw new Error(`The project information contains an invalid image type for "${path}".`);
    }
    for (const path of manifest.protectedAssets || []) {
      if (!validAssetPaths.has(path)) throw new Error(`The project information marks missing image "${path}" as protected.`);
    }
  }
  const entries = [...importedEntries.values()];
  const storyEntries = entries.filter((entry) => entry.kind === "html");
  const activeFile = typeof manifest.activeFile === "string" &&
    storyEntries.some((entry) => entry.path === manifest.activeFile) ? manifest.activeFile : storyEntries[0]?.path || "";
  return { entries, projectName: rootName, activeFile };
}

function refreshProjectEntries() {
  return getAllEntries().then((entries) => {
    projectEntries = entries.sort((left, right) => left.path.localeCompare(right.path));
    renderFileTree();
  });
}

function parentPath(path) {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function safeFileName(name) {
  return name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+|\.+$/g, "");
}

async function setSceneBackground(background, version) {
  if (!background) {
    elements.stageBackground.removeAttribute("src");
    return;
  }
  let url = background;
  if (background.startsWith("asset:")) {
    const assetId = background.slice("asset:".length);
    const entry = projectEntries.find((candidate) => candidate.kind === "asset" && candidate.assetId === assetId);
    if (!entry) {
      elements.stageBackground.removeAttribute("src");
      setDiagnostic(`Image asset "${assetId}" wasn't found in this project.`);
      return;
    }
    if (!objectUrls.has(entry.path)) objectUrls.set(entry.path, URL.createObjectURL(entry.blob));
    url = objectUrls.get(entry.path);
  } else {
    let projectPath = "";
    try {
      projectPath = normalizeProjectPath(background, previewFilePath);
    } catch {
      projectPath = "";
    }
    const entry = projectEntries.find((candidate) => candidate.kind === "asset" && candidate.path === projectPath);
    if (entry) {
      if (!objectUrls.has(entry.path)) objectUrls.set(entry.path, URL.createObjectURL(entry.blob));
      url = objectUrls.get(entry.path);
    }
  }
  if (version === sceneRenderVersion) elements.stageBackground.src = url;
}

function renderFileTree() {
  elements.fileTree.replaceChildren();
  const entries = getExplorerEntries();
  const selected = entries.find((entry) => entry.path === selectedEntryPath);
  const selectedSharedAsset = selected?.kind === "asset" && selected.shared;
  elements.assetDetails.hidden = selected?.kind !== "asset";
  if (selected?.kind === "asset") {
    showAssetPreview(selected);
    const title = document.querySelector(".asset-details-title");
    const usage = document.querySelector(".asset-usage");
    title.textContent = selectedSharedAsset ? "REPOSITORY ASSET" : "IMAGE ASSET ID";
    elements.selectedAssetId.textContent = selectedSharedAsset ? selected.path : selected.assetId;
    elements.copyAssetId.hidden = selectedSharedAsset;
    usage.replaceChildren(document.createTextNode(selectedSharedAsset ? "Use in HTML: " : "Use it in HTML: "));
    const example = document.createElement("code");
    example.textContent = selectedSharedAsset
      ? `data-background="${selected.path}"`
      : 'data-background="asset:ID"';
    usage.append(example);
  } else {
    elements.assetPreview.removeAttribute("src");
    elements.assetPreview.alt = "";
    elements.assetPreview.hidden = true;
    elements.assetPreviewError.hidden = true;
  }

  const entriesByParent = new Map();
  entries.forEach((entry) => {
    const parent = parentPath(entry.path);
    if (!entriesByParent.has(parent)) entriesByParent.set(parent, []);
    entriesByParent.get(parent).push(entry);
  });
  const appendChildren = (parent, depth) => {
    const entries = entriesByParent.get(parent) || [];
    entries.sort((left, right) => {
      if (left.kind === "folder" && right.kind !== "folder") return -1;
      if (left.kind !== "folder" && right.kind === "folder") return 1;
      return left.path.localeCompare(right.path);
    });
    entries.forEach((entry) => {
      const isFolder = entry.kind === "folder";
      const row = document.createElement("button");
      row.type = "button";
      row.className = `tree-row${isFolder ? " folder-row" : ""}${entry.path === selectedEntryPath ? " selected" : ""}`;
      row.style.paddingLeft = `${6 + depth * 12}px`;
      row.setAttribute("aria-label", isFolder ? `Folder ${entry.name}` : `${entry.kind === "asset" ? "Image asset" : "HTML file"} ${entry.name}`);
      if (entry.path === currentFilePath) row.setAttribute("aria-current", "page");
      const chevron = document.createElement("span");
      chevron.className = "tree-chevron";
      chevron.textContent = isFolder ? expandedFolders.has(entry.path) ? "⌄" : "›" : "";
      const icon = document.createElement("span");
      icon.className = `tree-icon ${entry.kind === "html" ? "html-icon" : entry.kind === "asset" ? "image-icon" : ""}`;
      icon.textContent = isFolder ? "▰" : entry.kind === "asset" ? "▧" : "</>";
      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = entry.name;
      row.append(chevron, icon, name);
      if (entry.shared) {
        row.classList.add("shared-tree-row");
        const badge = document.createElement("span");
        badge.className = "shared-tree-badge";
        badge.textContent = "SOURCE";
        row.append(badge);
      } else if (entry.kind === "asset") {
        const id = document.createElement("span");
        id.className = "tree-asset-id";
        id.textContent = entry.assetId;
        row.append(id);
      }
      row.addEventListener("click", () => {
        selectedEntryPath = entry.path;
        if (isFolder) {
          selectedDirectory = entry.path;
          if (expandedFolders.has(entry.path)) expandedFolders.delete(entry.path);
          else expandedFolders.add(entry.path);
          elements.assetDetails.hidden = true;
          renderFileTree();
        } else if (entry.kind === "html") {
          if (entry.shared) openSharedStory(entry);
          else openProjectFile(entry.path);
        } else {
          selectedDirectory = parentPath(entry.path);
          renderFileTree();
        }
      });
      elements.fileTree.append(row);
      if (isFolder && expandedFolders.has(entry.path)) appendChildren(entry.path, depth + 1);
    });
  };
  appendChildren("", 0);
  if (sharedLibraryError) elements.fileTree.append(el("p", "tree-library-error", sharedLibraryError));
}

function showAssetPreview(entry) {
  elements.assetPreview.hidden = true;
  elements.assetPreviewError.hidden = true;
  elements.assetPreview.alt = `Preview of ${entry.name}`;
  let previewUrl = "";
  const showError = () => {
    if (elements.assetPreview.src !== previewUrl) return;
    elements.assetPreview.hidden = true;
    elements.assetPreviewError.hidden = false;
  };
  const showImage = () => {
    if (elements.assetPreview.src !== previewUrl) return;
    elements.assetPreview.hidden = false;
    elements.assetPreviewError.hidden = true;
  };
  if (entry.shared) {
    previewUrl = new URL(entry.path, window.location.href).href;
  } else if (entry.blob instanceof Blob) {
    if (!objectUrls.has(entry.path)) objectUrls.set(entry.path, URL.createObjectURL(entry.blob));
    previewUrl = objectUrls.get(entry.path);
  } else {
    elements.assetPreview.removeAttribute("src");
    elements.assetPreviewError.hidden = false;
    return;
  }

  elements.assetPreview.onload = showImage;
  elements.assetPreview.onerror = showError;
  if (elements.assetPreview.src === previewUrl && elements.assetPreview.complete) {
    if (elements.assetPreview.naturalWidth) showImage();
    else showError();
    return;
  }
  elements.assetPreview.src = previewUrl;
}

function getExplorerEntries() {
  const localPaths = new Set(projectEntries.map((entry) => entry.path));
  const hiddenSharedFiles = getHiddenSharedFiles();
  const sharedFiles = sharedLibraryEntries
    .filter((entry) => !localPaths.has(entry.path) && !hiddenSharedFiles.has(entry.path))
    .map((entry) => ({ ...entry, shared: true }));
  const sharedDirectories = new Set();
  sharedFiles.forEach((entry) => {
    for (let directory = parentPath(entry.path); directory; directory = parentPath(directory)) {
      sharedDirectories.add(directory);
    }
  });
  const localDirectories = new Set(projectEntries.filter((entry) => entry.kind === "folder").map((entry) => entry.path));
  const virtualFolders = [...sharedDirectories]
    .filter((path) => !localPaths.has(path))
    .map((path) => ({
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      kind: "folder",
      shared: !localDirectories.has(path)
    }));
  return [...projectEntries, ...virtualFolders, ...sharedFiles];
}

async function fetchRepositoryFile(path) {
  try {
    return await fetch(new URL(path, window.location.href), { cache: "no-cache" });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Couldn't fetch "${path}". Check that the hosted site is available; repository files cannot load from file://.`);
    }
    throw error;
  }
}

function parseBundledLibraryFiles(bundledFiles) {
  if (!bundledFiles || typeof bundledFiles !== "object") {
    throw new Error("Local source files aren't available. Run build-library-index.ps1 to rebuild the library files.");
  }
  return Object.values(bundledFiles).filter((entry) =>
    entry && typeof entry.path === "string" &&
    (entry.path.startsWith("stories/") || entry.path.startsWith("assets/")) &&
    !entry.path.split("/").some((part) => part === "." || part === ".." || part === "") &&
    !entry.path.includes("\\") &&
    typeof entry.name === "string" &&
    (entry.kind === "html" || (entry.kind === "asset" && typeof entry.mimeType === "string" && entry.mimeType.startsWith("image/"))) &&
    typeof entry.base64 === "string"
  ).map((entry) => {
    const binary = atob(entry.base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (entry.kind === "html") return { ...entry, content: zipDecoder.decode(bytes) };
    return {
      ...entry,
      blob: new Blob([bytes], { type: entry.mimeType }),
      protected: true
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function startLocalLibraryWatcher() {
  let loadedRevision = window.VNVngineLibraryRevision || "";
  let checking = false;
  window.setInterval(() => {
    if (checking) return;
    checking = true;
    const revisionScript = document.createElement("script");
    revisionScript.src = `library-revision.js?check=${Date.now()}`;
    revisionScript.onload = () => {
      revisionScript.remove();
      const nextRevision = window.VNVngineLibraryRevision || "";
      if (!nextRevision || nextRevision === loadedRevision) {
        checking = false;
        return;
      }

      const dataScript = document.createElement("script");
      dataScript.src = `library-data.js?revision=${encodeURIComponent(nextRevision)}`;
      dataScript.onload = async () => {
        dataScript.remove();
        try {
          const nextEntries = parseBundledLibraryFiles(window.VNVngineLibraryFiles);
          const activeSharedPath = currentFileIsShared ? currentFilePath : "";
          const nextActiveSharedEntry = nextEntries.find((entry) => entry.path === activeSharedPath && entry.kind === "html");
          sharedLibraryEntries = nextEntries;
          loadedRevision = nextRevision;
          renderFileTree();
          if (nextActiveSharedEntry) await openSharedStory(nextActiveSharedEntry);
          else if (activeSharedPath) showEmptyEditor();
          setDiagnostic("Shared source files updated from the VS Code project.", true);
        } catch (error) {
          setDiagnostic(error instanceof Error ? error.message : "Could not reload updated source files.");
        } finally {
          checking = false;
        }
      };
      dataScript.onerror = () => {
        dataScript.remove();
        checking = false;
        setDiagnostic("Couldn't reload the updated local library bundle.");
      };
      document.head.append(dataScript);
    };
    revisionScript.onerror = () => {
      revisionScript.remove();
      checking = false;
    };
    document.head.append(revisionScript);
  }, 2000);
}

async function loadSharedLibrary() {
  if (window.location.protocol === "file:") {
    sharedLibraryEntries = parseBundledLibraryFiles(window.VNVngineLibraryFiles);
    sharedLibraryError = "";
    renderFileTree();
    startLocalLibraryWatcher();
    return;
  }
  const response = await fetchRepositoryFile("library-index.json");
  if (!response.ok) throw new Error(`Could not load the shared library index (${response.status}).`);
  const entries = await response.json();
  if (!Array.isArray(entries)) throw new Error("The shared library index has an invalid format.");
  sharedLibraryEntries = entries.filter((entry) =>
    entry && typeof entry.path === "string" &&
    (entry.path.startsWith("stories/") || entry.path.startsWith("assets/")) &&
    !entry.path.split("/").some((part) => part === "." || part === ".." || part === "") &&
    !entry.path.includes("\\") &&
    typeof entry.name === "string" &&
    (entry.kind === "html" || (entry.kind === "asset" && typeof entry.mimeType === "string" && entry.mimeType.startsWith("image/")))
  ).sort((left, right) => left.path.localeCompare(right.path));
  sharedLibraryError = "";
  renderFileTree();
}

async function openSharedStory(entry) {
  try {
    let content = entry.content;
    if (typeof content !== "string") {
      const response = await fetchRepositoryFile(entry.path);
      if (!response.ok) throw new Error(`Could not load "${entry.path}" (${response.status}).`);
      content = await response.text();
    }
    parseStory(content, entry.path);
    currentFilePath = entry.path;
    currentFileIsShared = true;
    selectedEntryPath = entry.path;
    selectedDirectory = parentPath(entry.path);
    localStorage.setItem(ACTIVE_FILE_KEY, entry.path);
    window.clearTimeout(renderTimer);
    elements.editor.value = content;
    elements.editor.readOnly = true;
    elements.editorModeLabel.textContent = "Repository file · read-only";
    elements.activeFileLabel.textContent = entry.path;
    renderFileTree();
    renderStory(true);
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Could not open that repository story.");
  }
}

function isGeneratedPlaceholder(entry) {
  if (entry.path !== "stories/main.html" || entry.kind !== "html") return false;
  const parsed = new DOMParser().parseFromString(entry.content || "", "text/html");
  const storyRoot = parsed.body.querySelector("[data-vn-story]");
  const scenes = storyRoot?.querySelectorAll(":scope > [data-scene]");
  const dialogue = scenes?.[0]?.querySelectorAll(":scope > [data-dialogue]");
  return storyRoot?.getAttribute("data-title") === "My story" &&
    scenes?.length === 1 &&
    scenes[0].id === "start" &&
    dialogue?.length === 1 &&
    dialogue[0].getAttribute("data-character") === "Narrator" &&
    ["Write your story here.", "Write your story here, or copy a story from the shared library."]
      .includes(dialogue[0].textContent.trim());
}

function areSameStarterStory(first, second) {
  const normalize = (content) => {
    const parsed = new DOMParser().parseFromString(content || "", "text/html");
    const root = parsed.body.querySelector("[data-vn-story]");
    if (!root) return "";
    root.querySelectorAll("[data-background]").forEach((scene) => scene.removeAttribute("data-background"));
    return root.outerHTML;
  };
  return normalize(first.content) !== "" && normalize(first.content) === normalize(second.content);
}

async function normalizeProjectLayout(entries = projectEntries) {
  const sourceEntries = entries.filter((entry) => entry.path === "source" || entry.path.startsWith("source/"));
  const sourceRoot = sourceEntries.find((entry) => entry.path === "source");
  const supportedSourcePath = (path) =>
    path === "source" || path === "source/assets" || path === "source/stories" ||
    path.startsWith("source/assets/") || path.startsWith("source/stories/");
  let canFlattenSource = sourceRoot?.kind === "folder" &&
    sourceEntries.every((entry) => supportedSourcePath(entry.path));
  const destinations = new Map(entries.filter((entry) => !entry.path.startsWith("source/") && entry.path !== "source")
    .map((entry) => [entry.path, entry]));
  const moves = [];
  const deletes = [];
  const pathReplacements = new Map();

  if (canFlattenSource) {
    for (const entry of sourceEntries) {
      if (entry.path === "source") {
        deletes.push(entry.path);
        continue;
      }
      const path = entry.path.slice("source/".length);
      const existing = destinations.get(path);
      pathReplacements.set(entry.path, path);
      if (existing) {
        let isDuplicate = existing.kind === "folder" && entry.kind === "folder";
        if (existing.kind === "html" && entry.kind === "html") {
          isDuplicate = existing.content === entry.content;
        } else if (existing.kind === "asset" && entry.kind === "asset" &&
                   existing.assetId === entry.assetId &&
                   existing.mimeType === entry.mimeType &&
                   existing.blob instanceof Blob && entry.blob instanceof Blob &&
                   existing.blob.size === entry.blob.size) {
          const [existingBytes, sourceBytes] = await Promise.all([
            existing.blob.arrayBuffer(), entry.blob.arrayBuffer()
          ]);
          const existingData = new Uint8Array(existingBytes);
          const sourceData = new Uint8Array(sourceBytes);
          isDuplicate = existingData.every((byte, index) => byte === sourceData[index]);
        }
        if (!isDuplicate) {
          canFlattenSource = false;
          break;
        }
        if (entry.kind === "asset") existing.protected = true;
        deletes.push(entry.path);
      } else {
        const moved = {
          ...entry,
          path,
          name: path.slice(path.lastIndexOf("/") + 1),
          ...(entry.kind === "asset" ? { protected: true } : {})
        };
        moves.push(moved);
        destinations.set(path, moved);
        deletes.push(entry.path);
      }
    }
    if (!canFlattenSource) {
      moves.length = 0;
      deletes.length = 0;
      pathReplacements.clear();
    }
  }

  const normalizedEntries = entries.filter((entry) => !deletes.includes(entry.path)).concat(moves);
  const mainStory = normalizedEntries.find((entry) => entry.path === "stories/main.html" && entry.kind === "html");
  const exampleStory = normalizedEntries.find((entry) => entry.path === "stories/example.html" && entry.kind === "html");
  if (mainStory && exampleStory && areSameStarterStory(mainStory, exampleStory)) {
    deletes.push(mainStory.path);
    const mainIndex = normalizedEntries.findIndex((entry) => entry.path === mainStory.path);
    normalizedEntries.splice(mainIndex, 1);
    pathReplacements.set(mainStory.path, exampleStory.path);
  }

  if (deletes.length) {
    await new Promise((resolve, reject) => {
      const transaction = projectDatabase.transaction("entries", "readwrite");
      const store = transaction.objectStore("entries");
      moves.forEach((entry) => store.put(entry));
      deletes.forEach((path) => store.delete(path));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not normalize project folders."));
      transaction.onabort = () => reject(transaction.error || new Error("Project folder normalization was cancelled."));
    });
  }
  for (const key of [ACTIVE_FILE_KEY, LEGACY_ACTIVE_FILE_KEY]) {
    const savedPath = localStorage.getItem(key);
    if (pathReplacements.has(savedPath)) localStorage.setItem(key, pathReplacements.get(savedPath));
  }
  return { entries: normalizedEntries, pathReplacements };
}

function showEntryForm(mode, initialName = "") {
  entryFormMode = mode;
  elements.entryForm.hidden = false;
  elements.entryName.value = initialName;
  elements.entryName.placeholder = mode === "folder" ? "folder-name" : "story.html";
  elements.entrySaveButton.textContent = mode === "rename" ? "Save" : "Add";
  elements.entryName.focus();
  elements.entryName.select();
}

function hideEntryForm() {
  entryFormMode = "";
  elements.entryForm.hidden = true;
  elements.entryName.value = "";
}

function insertPath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

async function submitEntryForm() {
  const mode = entryFormMode;
  const name = safeFileName(elements.entryName.value);
  if (!name) {
    setDiagnostic("Enter a name for the new project item.");
    return;
  }
  const selected = projectEntries.find((entry) => entry.path === selectedEntryPath);
  if (mode === "rename" && !selected && getExplorerEntries().some((entry) => entry.path === selectedEntryPath && entry.shared)) {
    setDiagnostic("Repository files are read-only. Edit them in the engine's stories/ or assets/ folder.");
    return;
  }
  if (entryFormMode === "rename" && !selected) {
    hideEntryForm();
    return;
  }
  let newName = name;
  if (entryFormMode === "file" && !/\.html?$/i.test(newName)) newName += ".html";
  if (entryFormMode === "rename" && selected?.kind === "html" && !/\.html?$/i.test(newName)) newName += ".html";
  const parent = entryFormMode === "rename" ? parentPath(selected.path) : selectedDirectory;
  const newPath = insertPath(parent, newName);
  const exists = getExplorerEntries().some((entry) => entry.path === newPath && entry.path !== selected?.path);
  if (exists) {
    setDiagnostic(`"${newName}" already exists in this folder, including repository files.`);
    return;
  }
  try {
    if (entryFormMode === "folder") {
      await putEntries([{ path: newPath, name: newName, kind: "folder" }]);
      expandedFolders.add(newPath);
    } else if (entryFormMode === "file") {
      const title = newName.replace(/\.html?$/i, "").replace(/[-_]/g, " ");
      const source = `<main data-vn-story data-title="${title.replace(/["&<>]/g, "")}">
  <section id="start" data-scene>
    <p data-character="Narrator" data-dialogue>Write your story here.</p>
  </section>
</main>`;
      await putEntries([{ path: newPath, name: newName, kind: "html", content: source }]);
    } else {
      const renamed = selected.kind === "folder"
        ? projectEntries.filter((entry) => entry.path === selected.path || entry.path.startsWith(`${selected.path}/`))
        : [selected];
      renamed.forEach((entry) => {
        const objectUrl = objectUrls.get(entry.path);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrls.delete(entry.path);
      });
      await putEntries(renamed.map((entry) => {
        const path = entry.path === selected.path ? newPath : `${newPath}${entry.path.slice(selected.path.length)}`;
        return { ...entry, path, name: entry.path === selected.path ? newName : entry.name };
      }));
      await removeEntries(renamed.map((entry) => entry.path));
      selectedEntryPath = newPath;
      if (selected.kind === "folder") {
        expandedFolders.delete(selected.path);
        expandedFolders.add(newPath);
      }
      const activePathBeforeRename = currentFilePath;
      if (selected.kind === "folder" && currentFilePath.startsWith(`${selected.path}/`)) {
        currentFilePath = `${newPath}${currentFilePath.slice(selected.path.length)}`;
      } else if (selected.kind === "html" && currentFilePath === selected.path) {
        currentFilePath = newPath;
      }
      if (currentFilePath !== activePathBeforeRename) {
        localStorage.setItem(ACTIVE_FILE_KEY, currentFilePath);
      }
      selectedEntryPath = newPath;
    }
    hideEntryForm();
    await refreshProjectEntries();
    setDiagnostic(mode === "rename" ? "Project item renamed." : "Project item created.", true);
    if (mode === "file") await openProjectFile(newPath);
    if (mode === "rename" && currentFilePath !== elements.activeFileLabel.textContent) {
      await openProjectFile(currentFilePath);
    } else if (mode === "rename") {
      renderStory();
    }
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Could not update the project.");
  }
}

async function openProjectFile(path) {
  try {
    const entry = await getEntry(path);
    if (!entry || entry.kind !== "html") throw new Error(`Could not find HTML file "${path}".`);
    currentFilePath = path;
    currentFileIsShared = false;
    selectedEntryPath = path;
    selectedDirectory = parentPath(path);
    localStorage.setItem(ACTIVE_FILE_KEY, path);
    window.clearTimeout(renderTimer);
    elements.editor.value = entry.content || "";
    elements.editor.readOnly = false;
    elements.editorModeLabel.textContent = "Changes are saved automatically in this browser.";
    elements.activeFileLabel.textContent = path;
    await refreshProjectEntries();
    renderStory(true);
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Could not open that HTML file.");
  }
}

async function deleteSelectedEntry() {
  const entry = getExplorerEntries().find((candidate) => candidate.path === selectedEntryPath);
  if (!entry) {
    setDiagnostic("Select a file, asset, or folder to delete.");
    return;
  }
  const isExampleStory = entry.kind === "html" && entry.path === "stories/example.html";
  if (entry.shared && !isExampleStory) {
    setDiagnostic("Repository files are read-only. Remove them from the engine's stories/ or assets/ folder.");
    return;
  }
  const deleted = entry.shared ? [] : entry.kind === "folder"
    ? projectEntries.filter((candidate) => candidate.path === entry.path || candidate.path.startsWith(`${entry.path}/`))
    : [entry];
  if (deleted.some(isProtectedProjectAsset)) {
    setDiagnostic("Engine-provided images cannot be deleted from the project.");
    return;
  }
  const deletedPaths = new Set(deleted.map((candidate) => candidate.path));
  deletedPaths.add(entry.path);
  const remainingLocalStory = projectEntries.some((candidate) =>
    candidate.kind === "html" && !deletedPaths.has(candidate.path)
  );
  const hiddenSharedFiles = getHiddenSharedFiles();
  const remainingSharedStory = sharedLibraryEntries.some((candidate) =>
    candidate.kind === "html" &&
    !hiddenSharedFiles.has(candidate.path) &&
    (!projectEntries.some((projectEntry) => projectEntry.path === candidate.path) || deletedPaths.has(candidate.path))
  );
  if (!remainingLocalStory && !remainingSharedStory && !isExampleStory) {
    setDiagnostic("Keep at least one HTML story in the project or repository before deleting this file.");
    return;
  }
  if (!window.confirm(`Delete "${entry.name}"${entry.kind === "folder" ? " and everything inside it" : ""}?`)) return;
  try {
    await removeEntries(deleted.map((candidate) => candidate.path));
    if (isExampleStory) hideSharedFile(entry.path);
    deleted.forEach((candidate) => {
      const objectUrl = objectUrls.get(candidate.path);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrls.delete(candidate.path);
    });
    if (deletedPaths.has(currentFilePath)) {
      const next = projectEntries.find((candidate) => candidate.kind === "html" && !deleted.includes(candidate));
      const nextShared = sharedLibraryEntries.find((candidate) =>
        candidate.kind === "html" &&
        !getHiddenSharedFiles().has(candidate.path) &&
        !projectEntries.some((projectEntry) => projectEntry.path === candidate.path)
      );
      selectedEntryPath = next?.path || nextShared?.path || "";
      if (next) await openProjectFile(next.path);
      else if (nextShared) await openSharedStory(nextShared);
      else showEmptyEditor();
    }
    if (deleted.some((candidate) => candidate.path === selectedEntryPath)) selectedEntryPath = "";
    await refreshProjectEntries();
    setDiagnostic("Project item deleted.", true);
    renderStory();
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Could not delete that project item.");
  }
}

function makeAssetId() {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 10) ||
    Math.random().toString(36).slice(2, 12);
  return `img-${random}`;
}

async function uploadAssets() {
  const files = [...(elements.assetFileInput.files || [])];
  if (!files.length) return;
  try {
    const additions = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) throw new Error(`"${file.name}" isn't an image file.`);
      const name = safeFileName(file.name);
      const path = insertPath(selectedDirectory, name);
      if (getExplorerEntries().some((entry) => entry.path === path) || additions.some((entry) => entry.path === path)) {
        throw new Error(`"${name}" already exists in this folder.`);
      }
      additions.push({ path, name, kind: "asset", assetId: makeAssetId(), mimeType: file.type, blob: file });
    }
    await putEntries(additions);
    await refreshProjectEntries();
    selectedEntryPath = additions[0].path;
    selectedDirectory = parentPath(additions[0].path);
    for (let folder = selectedDirectory; folder; folder = parentPath(folder)) expandedFolders.add(folder);
    renderFileTree();
    setDiagnostic(`Uploaded ${additions.length} image${additions.length === 1 ? "" : "s"}. Select an image to see its asset ID.`, true);
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Could not upload those assets.");
  } finally {
    elements.assetFileInput.value = "";
  }
}

async function initializeProject() {
  try {
    projectName = localStorage.getItem(PROJECT_NAME_KEY) || "MY PROJECT";
    elements.explorerProjectName.textContent = projectName;
    projectDatabase = await openProjectDatabase();
    projectEntries = await getAllEntries();
    if (!projectEntries.length) {
      const legacyDatabase = await openProjectDatabase(LEGACY_DATABASE_NAME);
      const legacyEntries = await getAllEntries(legacyDatabase);
      legacyDatabase.close();
      if (legacyEntries.length) {
        await putEntries(legacyEntries);
      } else {
        const legacySource = localStorage.getItem(LEGACY_STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
        const initialEntries = [
          { path: "stories", name: "stories", kind: "folder" },
          { path: "assets", name: "assets", kind: "folder" }
        ];
        if (legacySource) {
          initialEntries.push({ path: "stories/main.html", name: "main.html", kind: "html", content: legacySource });
        }
        await putEntries(initialEntries);
      }
      projectEntries = await getAllEntries();
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY);
    }
    projectEntries = await getAllEntries();
    const retiredSharedAssets = projectEntries
      .filter((entry) => entry.kind === "asset" && entry.assetId === "img-vvngine-platform");
    const retiredAssetReference = /\sdata-background\s*=\s*(?:"asset:img-vvngine-platform"|'asset:img-vvngine-platform'|asset:img-vvngine-platform)(?=\s|>)/i;
    const storiesWithoutRetiredBackground = projectEntries
      .filter((entry) => entry.kind === "html" && retiredAssetReference.test(entry.content || ""))
      .map((entry) => ({
        ...entry,
        content: (entry.content || "").replace(new RegExp(retiredAssetReference.source, "gi"), "")
      }));
    if (retiredSharedAssets.length) {
      await removeEntries(retiredSharedAssets.map((entry) => entry.path));
    }
    if (storiesWithoutRetiredBackground.length) {
      await putEntries(storiesWithoutRetiredBackground);
    }
    if (retiredSharedAssets.length || storiesWithoutRetiredBackground.length) {
      projectEntries = await getAllEntries();
    }
    const normalized = await normalizeProjectLayout(projectEntries);
    projectEntries = normalized.entries.sort((left, right) => left.path.localeCompare(right.path));
    const generatedPlaceholder = projectEntries.find(isGeneratedPlaceholder);
    if (generatedPlaceholder) {
      await removeEntries([generatedPlaceholder.path]);
      projectEntries = await getAllEntries();
    }
    try {
      await loadSharedLibrary();
    } catch (error) {
      sharedLibraryError = error instanceof Error ? error.message : "Could not load repository files.";
      renderFileTree();
    }
    const savedPath = localStorage.getItem(ACTIVE_FILE_KEY) || localStorage.getItem(LEGACY_ACTIVE_FILE_KEY);
    const savedLocalEntry = projectEntries.find((entry) => entry.path === savedPath && entry.kind === "html");
    const activeEntry = savedLocalEntry || projectEntries.find((entry) => entry.kind === "html");
    const hiddenSharedFiles = getHiddenSharedFiles();
    const savedSharedEntry = sharedLibraryEntries.find((entry) =>
      entry.path === savedPath && entry.kind === "html" && !hiddenSharedFiles.has(entry.path)
    );
    const sharedActiveEntry = savedSharedEntry || (!activeEntry ? sharedLibraryEntries.find((entry) =>
      entry.kind === "html" && !hiddenSharedFiles.has(entry.path)
    ) : null);
    if (!activeEntry && !sharedActiveEntry) {
      localStorage.removeItem(ACTIVE_FILE_KEY);
      localStorage.removeItem(LEGACY_ACTIVE_FILE_KEY);
      elements.explorerProjectName.textContent = projectName;
      selectedEntryPath = "";
      selectedDirectory = "stories";
      expandedFolders.add("stories");
      showEmptyEditor();
      return;
    }
    const activePath = activeEntry?.path || sharedActiveEntry.path;
    localStorage.setItem(ACTIVE_FILE_KEY, activePath);
    localStorage.removeItem(LEGACY_ACTIVE_FILE_KEY);
    currentFilePath = activePath;
    selectedEntryPath = activePath;
    selectedDirectory = parentPath(activePath);
    expandedFolders.add(selectedDirectory);
    elements.explorerProjectName.textContent = projectName;
    if (!activeEntry && sharedActiveEntry) await openSharedStory(sharedActiveEntry);
    else await openProjectFile(currentFilePath);
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Could not open project storage.");
    console.error("Unable to initialize the project workspace:", error);
  }
}

function showEmptyEditor() {
  currentFilePath = "";
  currentFileIsShared = false;
  localStorage.removeItem(ACTIVE_FILE_KEY);
  elements.activeFileLabel.textContent = "No story selected";
  elements.editorModeLabel.textContent = "Create an HTML file from the Explorer to start writing.";
  elements.editor.value = "";
  elements.editor.readOnly = true;
  setLineNumbers();
  renderFileTree();
  story = null;
  currentSceneId = null;
  sceneRenderVersion += 1;
  elements.stageBackground.removeAttribute("src");
  elements.novelContent.replaceChildren();
  elements.sceneProgress.textContent = "NO STORY";
  const prompt = el("div", "empty-stage");
  prompt.append(el("h2", "", "Ready to write?"));
  prompt.append(el("p", "", "Create an HTML file from the Explorer to start your story."));
  elements.novelContent.append(prompt);
  renderActiveResources(null);
  setDiagnostic("Create an HTML file from the Explorer to start writing.");
}

function setLineNumbers() {
  const count = elements.editor.value.split("\n").length;
  elements.lineCount.textContent = String(count);
  elements.lineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
  elements.lineNumbers.scrollTop = elements.editor.scrollTop;
}

function findScene(id) {
  return story?.scenes.find((scene) => scene.id === id) || null;
}

function renderActiveResources(scene) {
  const list = elements.activeResourceList;
  list.replaceChildren();

  const appendResource = (label, value, description = "") => {
    const item = el("li", "active-resource");
    const name = el("span", "active-resource-name", label);
    const path = el("code", "active-resource-path", value);
    item.append(name, path);
    if (description) item.append(el("span", "active-resource-description", description));
    list.append(item);
  };

  if (currentFilePath) appendResource("Story source", currentFilePath);
  if (!scene) {
    appendResource("Scene", "No active scene");
    return;
  }
  if (!scene.background) {
    appendResource("Scene background", "None");
    return;
  }

  if (scene.background.startsWith("asset:")) {
    const assetId = scene.background.slice("asset:".length);
    const asset = projectEntries.find((entry) => entry.kind === "asset" && entry.assetId === assetId);
    appendResource(
      "Scene background",
      asset?.path || `Missing asset: ${assetId}`,
      asset ? `Asset ID: ${assetId}` : "This image asset is not in the project."
    );
    return;
  }

  const sharedAsset = sharedLibraryEntries.find((entry) =>
    entry.kind === "asset" &&
    !projectEntries.some((projectEntry) => projectEntry.path === entry.path) &&
    new URL(entry.path, window.location.href).href === scene.background
  );
  appendResource(sharedAsset ? "Scene background" : "External scene background", sharedAsset?.path || scene.background);
}

function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showCurrentLine() {
  const renderVersion = ++sceneRenderVersion;
  const scene = findScene(currentSceneId);
  renderActiveResources(scene);
  elements.novelContent.replaceChildren();
  if (!scene) {
    elements.stageBackground.removeAttribute("src");
    elements.sceneProgress.textContent = "STORY COMPLETE";
    const end = el("div", "empty-stage");
    end.append(el("h2", "", "The End"));
    end.append(el("p", "", "You've reached the end of this path."));
    elements.novelContent.append(end);
    return;
  }

  elements.sceneProgress.textContent = `SCENE ${String(story.scenes.indexOf(scene) + 1).padStart(2, "0")} · ${scene.id}`;
  void setSceneBackground(scene.background, renderVersion);

  const line = scene.lines[lineIndex];
  if (line) {
    if (line.character) elements.novelContent.append(el("div", "novel-speaker", line.character));
    const dialogue = el("div", "novel-dialogue");
    dialogue.innerHTML = line.html || "…";
    elements.novelContent.append(dialogue);
    const controls = el("div", "novel-controls");
    const next = el("button", "button button-primary", lineIndex < scene.lines.length - 1 ? "Continue →" : scene.choices.length ? "Choose →" : "Finish →");
    next.type = "button";
    next.addEventListener("click", advance);
    controls.append(next);
    elements.novelContent.append(controls);
    return;
  }

  if (scene.choices.length) {
    const choices = el("div", "novel-choices");
    scene.choices.forEach((choice) => {
      const button = el("button", "novel-choice", choice.text || "Continue");
      button.type = "button";
      button.addEventListener("click", () => {
        void navigatePreviewChoice(choice);
      });
      choices.append(button);
    });
    elements.novelContent.append(choices);
    return;
  }

  const controls = el("div", "novel-controls");
  const finish = el("button", "button button-primary", "Finish →");
  finish.type = "button";
  finish.addEventListener("click", () => {
    currentSceneId = null;
    showCurrentLine();
  });
  controls.append(finish);
  elements.novelContent.append(el("div", "novel-dialogue", "The moment lingers. There is nowhere else to go."));
  elements.novelContent.append(controls);
}

async function navigatePreviewChoice(choice) {
  try {
    await pendingSave;
    let targetStory = story;
    if (choice.targetFile !== previewFilePath) {
      const entry = getExplorerEntries().find((candidate) =>
        candidate.path === choice.targetFile && candidate.kind === "html"
      );
      if (!entry) throw new Error(`Could not find linked story "${choice.targetFile}".`);
      let source = entry.content;
      if (typeof source !== "string") {
        const response = await fetchRepositoryFile(entry.path);
        if (!response.ok) throw new Error(`Could not load "${entry.path}" (${response.status}).`);
        source = await response.text();
      }
      targetStory = parseStory(source, entry.path);
    }
    if (!targetStory.scenes.some((scene) => scene.id === choice.target)) {
      throw new Error(`Story "${choice.targetFile}" has no scene "${choice.target}".`);
    }
    story = targetStory;
    previewFilePath = choice.targetFile;
    currentSceneId = choice.target;
    lineIndex = 0;
    showCurrentLine();
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Could not follow that story link.");
  }
}

function advance() {
  const scene = findScene(currentSceneId);
  if (!scene) return;
  if (lineIndex < scene.lines.length - 1) {
    lineIndex += 1;
  } else if (scene.choices.length) {
    lineIndex = scene.lines.length;
  } else {
    currentSceneId = null;
  }
  showCurrentLine();
}

function startStory(startId) {
  currentSceneId = startId || story?.scenes[0]?.id || null;
  lineIndex = 0;
  showCurrentLine();
}

function renderStory(reset = false) {
  setLineNumbers();
  try {
    story = parseStory(elements.editor.value, currentFilePath);
    previewFilePath = currentFilePath;
    elements.projectLabel.textContent = story.title;
    setDiagnostic("Story markup looks good.", true);
    if (reset || !findScene(currentSceneId)) startStory(story.scenes[0].id);
    else showCurrentLine();
  } catch (error) {
    story = null;
    sceneRenderVersion += 1;
    elements.projectLabel.textContent = "story.html";
    elements.stageBackground.removeAttribute("src");
    elements.novelContent.replaceChildren();
    elements.sceneProgress.textContent = "FIX MARKUP";
    const message = error instanceof Error ? error.message : "Something is wrong with this story.";
    setDiagnostic(message);
    const problem = el("div", "empty-stage");
    problem.append(el("h2", "", "Let's fix that"));
    problem.append(el("p", "", message));
    elements.novelContent.append(problem);
  }
}

function saveSource() {
  if (currentFileIsShared) return Promise.resolve();
  const path = currentFilePath;
  const content = elements.editor.value;
  pendingSave = getEntry(path).then((entry) => {
    if (!entry || entry.kind !== "html") throw new Error(`Could not save "${path}": the file no longer exists.`);
    return putEntries([{ ...entry, content }]);
  }).then(() => {
    const index = projectEntries.findIndex((entry) => entry.path === path);
    if (index >= 0) projectEntries[index] = { ...projectEntries[index], content };
  }).catch((error) => {
    setDiagnostic(error instanceof Error ? error.message : "Could not save this HTML file.");
    console.error("Unable to save story source:", error);
  });
  return pendingSave;
}

function exportPlayerRuntime() {
  const embeddedSource = JSON.stringify(elements.editor.value).replace(/</g, "\\u003c");
  const runtime = function standalonePlayer() {
    const source = EMBEDDED_SOURCE;
    const doc = new DOMParser().parseFromString(source, "text/html");
    const root = doc.body.querySelector("[data-vn-story]");
    const stage = document.querySelector("#stage");
    const content = document.querySelector("#content");
    const progress = document.querySelector("#progress");
    const clean = (html) => {
      const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
      const allowed = new Set(["P", "BR", "EM", "STRONG", "I", "B", "SPAN", "SUB", "SUP"]);
      const visit = (node) => {
        if (node.nodeType === 3) return document.createTextNode(node.textContent || "");
        if (node.nodeType !== 1) return document.createDocumentFragment();
        if (!allowed.has(node.tagName)) {
          const fragment = document.createDocumentFragment();
          [...node.childNodes].forEach((child) => fragment.append(visit(child)));
          return fragment;
        }
        const element = document.createElement(node.tagName.toLowerCase());
        [...node.childNodes].forEach((child) => element.append(visit(child)));
        return element;
      };
      const wrapper = document.createElement("div");
      [...parsed.body.childNodes].forEach((node) => wrapper.append(visit(node)));
      return wrapper.innerHTML;
    };
    const scenes = [...(root?.querySelectorAll(":scope > [data-scene]") || [])].map((scene) => ({
      id: scene.id,
      background: scene.getAttribute("data-background") || "",
      lines: [...scene.querySelectorAll(":scope > [data-dialogue]")].map((line) => ({
        character: line.getAttribute("data-character") || "",
        html: clean(line.innerHTML)
      })),
      choices: [...scene.querySelectorAll(":scope > a[data-choice]")].map((choice) => ({
        target: (choice.getAttribute("href") || "").replace(/^#/, ""),
        text: choice.textContent.trim()
      }))
    }));
    let sceneId = scenes[0]?.id || null;
    let lineIndex = 0;
    const find = () => scenes.find((scene) => scene.id === sceneId);
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const render = () => {
      content.replaceChildren();
      const scene = find();
      if (!scene) {
        progress.textContent = "STORY COMPLETE";
        content.append(element("div", "end", "The End"));
        return;
      }
      progress.textContent = `SCENE ${String(scenes.indexOf(scene) + 1).padStart(2, "0")} · ${scene.id}`;
      const background = scene.background;
      if (background) {
        try {
          const url = new URL(background, location.href);
          const safeProtocol = url.protocol === "https:" || url.protocol === "http:" ||
            (url.protocol === "file:" && location.protocol === "file:");
          stage.style.backgroundImage = safeProtocol ? `linear-gradient(180deg, transparent 10%, #11131beF 100%), url("${url.href.replace(/["\\]/g, "")}")` : "";
        } catch { stage.style.backgroundImage = ""; }
      } else {
        stage.style.backgroundImage = "";
      }
      const line = scene.lines[lineIndex];
      if (line) {
        if (line.character) content.append(element("div", "speaker", line.character));
        const dialogue = element("div", "dialogue");
        dialogue.innerHTML = line.html || "…";
        content.append(dialogue);
        const next = element("button", "primary", lineIndex < scene.lines.length - 1 ? "Continue →" : scene.choices.length ? "Choose →" : "Finish →");
        next.onclick = () => {
          if (lineIndex < scene.lines.length - 1) lineIndex += 1;
          else if (scene.choices.length) lineIndex = scene.lines.length;
          else sceneId = null;
          render();
        };
        content.append(next);
      } else if (scene.choices.length) {
        scene.choices.forEach((choice) => {
          const button = element("button", "choice", choice.text || "Continue");
          button.onclick = () => { sceneId = choice.target; lineIndex = 0; render(); };
          content.append(button);
        });
      } else {
        const end = element("div", "dialogue", "The moment lingers. There is nowhere else to go.");
        const button = element("button", "primary", "Finish →");
        button.onclick = () => { sceneId = null; render(); };
        content.append(end, button);
      }
    };
    document.querySelector("#restart").onclick = () => { sceneId = scenes[0]?.id || null; lineIndex = 0; render(); };
    render();
  };
  const runtimeSource = runtime.toString().replace("EMBEDDED_SOURCE", embeddedSource);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(story.title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#11131b;color:#eeedf4;font:16px/1.7 system-ui,sans-serif;display:grid;place-items:center;padding:24px}.game{position:relative;display:flex;width:min(100%,1000px);min-height:min(76vh,700px);align-items:flex-end;justify-content:center;overflow:hidden;border:1px solid #343543;border-radius:12px;background:radial-gradient(ellipse at 50% 32%,#373049 0,#242333 38%,#171923 80%);background-size:cover;background-position:center}.content{position:relative;width:min(720px,calc(100% - 32px));margin-bottom:28px}.speaker{display:table;margin:0 0 -1px 12px;border:1px solid #ed727a66;border-radius:7px 7px 0 0;padding:8px 14px;background:#302027ed;color:#ffdadd;font-size:14px;font-weight:650}.dialogue{min-height:110px;border:1px solid #ffffff25;border-radius:8px;padding:18px 20px;background:#171923ed;font-size:16px}.dialogue p{margin:0 0 9px}.dialogue p:last-child{margin:0}.content button{display:block;width:100%;margin-top:10px;border:1px solid #c7616988;border-radius:7px;padding:12px 15px;background:#291d22ed;color:#ffe4e6;font-size:14px;text-align:left;cursor:pointer}.content button:hover{background:#42242a}.content .primary{width:auto;margin-left:auto;background:#ff626b;color:#311013;text-align:center}.progress{position:fixed;top:18px;left:50%;transform:translateX(-50%);color:#aaa7b7;font-size:11px;letter-spacing:1px}.restart{position:fixed;top:14px;right:18px;width:auto!important;margin:0!important;padding:7px 10px!important;font-size:12px!important}.end{padding:24px;text-align:center;font-size:28px}
</style></head><body><span class="progress" id="progress"></span><button class="restart" id="restart">Restart ↺</button><main class="game" id="stage"><div class="content" id="content"></div></main><script>(${runtimeSource})();</script></body></html>`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

elements.editor.addEventListener("input", () => {
  if (currentFileIsShared) return;
  setLineNumbers();
  saveSource();
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => renderStory(), 120);
});
document.querySelector("#storage-warning button").addEventListener("click", () => {
  document.querySelector("#storage-warning").hidden = true;
});
elements.topMenuToggle.addEventListener("click", () => {
  const isOpen = elements.topMenuItems.classList.toggle("open");
  elements.topMenuToggle.setAttribute("aria-expanded", String(isOpen));
  elements.topMenuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
});
elements.topMenuItems.addEventListener("click", (event) => {
  if (event.target.closest("button, a")) {
    elements.topMenuItems.classList.remove("open");
    elements.topMenuToggle.setAttribute("aria-expanded", "false");
    elements.topMenuToggle.setAttribute("aria-label", "Open menu");
  }
});
elements.explorerCollapseToggle.addEventListener("click", () => {
  const isExpanded = elements.explorerCollapseToggle.getAttribute("aria-expanded") !== "true";
  elements.explorerPanel.classList.toggle("collapsed", !isExpanded);
  elements.explorerCollapseToggle.setAttribute("aria-expanded", String(isExpanded));
  elements.explorerCollapseToggle.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} project explorer`);
  elements.explorerCollapseToggle.textContent = isExpanded ? "−" : "+";
});
elements.readerCollapseToggle.addEventListener("click", () => {
  const isExpanded = elements.readerCollapseToggle.getAttribute("aria-expanded") !== "true";
  elements.readerPanel.classList.toggle("collapsed", !isExpanded);
  elements.readerCollapseToggle.setAttribute("aria-expanded", String(isExpanded));
  elements.readerCollapseToggle.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} reader preview`);
  elements.readerCollapseToggle.textContent = isExpanded ? "−" : "+";
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.topMenuItems.classList.contains("open")) {
    elements.topMenuItems.classList.remove("open");
    elements.topMenuToggle.setAttribute("aria-expanded", "false");
    elements.topMenuToggle.setAttribute("aria-label", "Open menu");
    elements.topMenuToggle.focus();
  }
});
elements.editor.addEventListener("scroll", () => {
  elements.lineNumbers.scrollTop = elements.editor.scrollTop;
});
elements.editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab" && !elements.editor.readOnly) {
    event.preventDefault();
    const start = elements.editor.selectionStart;
    const end = elements.editor.selectionEnd;
    elements.editor.setRangeText("  ", start, end, "end");
    elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
elements.restartButton.addEventListener("click", () => {
  if (story) startStory(story.scenes[0].id);
});
elements.openButton.addEventListener("click", () => elements.openFile.click());
elements.openFile.addEventListener("change", async () => {
  const [file] = elements.openFile.files || [];
  if (!file) return;
  try {
    const imported = await importProjectArchive(file);
    if (!window.confirm(`Import "${imported.projectName}" and replace the current browser project? This cannot be undone.`)) return;
    await pendingSave;
    await replaceProjectEntries(imported.entries);
    window.clearTimeout(renderTimer);
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
    const normalized = await normalizeProjectLayout(imported.entries);
    projectEntries = normalized.entries.sort((left, right) => left.path.localeCompare(right.path));
    setProjectName(imported.projectName);
    const importedActiveFile = normalized.pathReplacements.get(imported.activeFile) || imported.activeFile;
    const activeStory = projectEntries.find((entry) => entry.path === importedActiveFile && entry.kind === "html") ||
      projectEntries.find((entry) => entry.kind === "html");
    const activeFile = activeStory?.path || "";
    selectedEntryPath = activeFile;
    selectedDirectory = parentPath(activeFile) || "stories";
    expandedFolders.clear();
    expandedFolders.add("");
    projectEntries.filter((entry) => entry.kind === "folder").forEach((entry) => {
      for (let folder = entry.path; folder; folder = parentPath(folder)) expandedFolders.add(folder);
    });
    if (activeFile) localStorage.setItem(ACTIVE_FILE_KEY, activeFile);
    else localStorage.removeItem(ACTIVE_FILE_KEY);
    sharedLibraryError = "";
    renderFileTree();
    if (activeFile) {
      currentFilePath = activeFile;
      currentFileIsShared = false;
      await openProjectFile(activeFile);
    } else {
      localStorage.removeItem(ACTIVE_FILE_KEY);
      showEmptyEditor();
    }
    setDiagnostic(`Imported project "${imported.projectName}".`, true);
  } catch (error) {
    setDiagnostic(`Couldn't import that project: ${error instanceof Error ? error.message : "unknown error"}`);
  } finally {
    elements.openFile.value = "";
  }
});
elements.newFileButton.addEventListener("click", () => showEntryForm("file"));
elements.newFolderButton.addEventListener("click", () => showEntryForm("folder"));
elements.renameEntryButton.addEventListener("click", () => {
  const entry = projectEntries.find((candidate) => candidate.path === selectedEntryPath);
  if (!entry) {
    setDiagnostic("Select a project item to rename.");
    return;
  }
  showEntryForm("rename", entry.name);
});
elements.deleteEntryButton.addEventListener("click", deleteSelectedEntry);
elements.uploadAssetButton.addEventListener("click", () => elements.assetFileInput.click());
elements.assetFileInput.addEventListener("change", uploadAssets);
elements.entrySaveButton.addEventListener("click", submitEntryForm);
elements.entryCancelButton.addEventListener("click", hideEntryForm);
elements.entryName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitEntryForm();
  } else if (event.key === "Escape") {
    hideEntryForm();
  }
});
elements.copyAssetId.addEventListener("click", async () => {
  const assetId = elements.selectedAssetId.textContent;
  try {
    await navigator.clipboard.writeText(assetId);
    setDiagnostic(`Copied asset ID "${assetId}".`, true);
  } catch (error) {
    setDiagnostic(`Couldn't copy the asset ID: ${error instanceof Error ? error.message : "clipboard unavailable"}`);
  }
});
elements.exportSourceButton.addEventListener("click", async () => {
  const requestedName = window.prompt("Choose a name for the exported project folder:", projectName);
  if (requestedName === null) return;
  const name = normalizeProjectName(requestedName);
  if (!name) {
    setDiagnostic("Enter a project folder name using at least one letter or number.");
    return;
  }
  if (zipEncoder.encode(name).length > 255) {
    setDiagnostic("Project folder names must be no longer than 255 bytes.");
    return;
  }
  try {
    const archive = await createProjectArchive(name);
    const url = URL.createObjectURL(archive);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.zip`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setProjectName(name);
    setDiagnostic(`Exported the complete "${name}" project.`, true);
  } catch (error) {
    setDiagnostic(`Couldn't export the project: ${error instanceof Error ? error.message : "unknown error"}`);
  }
});
void initializeProject();
