const dropArea = document.querySelector("#story-drop-area");
const chooseStoryButton = document.querySelector("#choose-story-button");
const storyFileInput = document.querySelector("#story-file-input");
const storyDropStatus = document.querySelector("#story-drop-status");

const allowedDialogueTags = new Set(["P", "BR", "EM", "STRONG", "I", "B", "SPAN", "SUB", "SUP"]);
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

function cleanDialogueMarkup(markup) {
  const parsed = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    if (!allowedDialogueTags.has(node.tagName)) {
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

function normalizeArchivePath(path, basePath) {
  path = decodeURIComponent(path);
  if (path.startsWith("/") || /^[a-z]:/i.test(path)) throw new Error("Story links must use project-relative paths.");
  const parts = basePath ? basePath.split("/").slice(0, -1) : [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("Story links must stay inside the project ZIP.");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function resolveChoice(href, filePath) {
  if (!href) throw new Error("A choice needs an href pointing to a scene.");
  const hashIndex = href.indexOf("#");
  const path = hashIndex < 0 ? href : href.slice(0, hashIndex);
  const scene = hashIndex < 0 ? "" : decodeURIComponent(href.slice(hashIndex + 1));
  if (!scene || path.includes("?") || path.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new Error("Use href=\"#scene-id\" or a project-relative link such as href=\"ending.html#scene-id\".");
  }
  const targetFile = path ? normalizeArchivePath(path, filePath) : filePath;
  if (!/\.html?$/i.test(targetFile)) throw new Error("Cross-file choices must link to an HTML story.");
  return { targetFile, target: scene };
}

function parsePlayableStory(source, filePath) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const roots = parsed.body.querySelectorAll("[data-vn-story]");
  if (roots.length !== 1) throw new Error(`"${filePath}" must contain exactly one element marked data-vn-story.`);
  const root = roots[0];
  const sceneNodes = [...root.querySelectorAll(":scope > [data-scene]")];
  if (!sceneNodes.length) throw new Error(`Add at least one direct child scene marked data-scene in "${filePath}".`);

  const sceneIds = new Set();
  const scenes = sceneNodes.map((node) => {
    const id = node.getAttribute("id")?.trim();
    if (!id) throw new Error(`Every scene in "${filePath}" needs an id attribute.`);
    if (sceneIds.has(id)) throw new Error(`The scene id "${id}" is used more than once in "${filePath}".`);
    sceneIds.add(id);
    return {
      id,
      background: node.getAttribute("data-background")?.trim() || "",
      lines: [...node.querySelectorAll(":scope > [data-dialogue]")].map((line) => ({
        character: line.getAttribute("data-character")?.trim() || "",
        html: cleanDialogueMarkup(line.innerHTML)
      })),
      choices: [...node.querySelectorAll(":scope > a[data-choice]")].map((choice) => ({
        ...resolveChoice(choice.getAttribute("href")?.trim() || "", filePath),
        text: choice.textContent.trim()
      }))
    };
  });
  return {
    path: filePath,
    title: root.getAttribute("data-title")?.trim() || filePath,
    scenes
  };
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    return ["https:", "http:", "data:"].includes(url.protocol) ||
      (url.protocol === "file:" && window.location.protocol === "file:") ? url.href : "";
  } catch {
    return "";
  }
}

function resolveArchiveAsset(value, storyPath, entries, manifest) {
  if (!value) return "";
  if (/^(https?:|data:)/i.test(value)) return safeExternalUrl(value);
  let assetPath = "";
  if (/^asset:img-[a-z0-9-]+$/i.test(value)) {
    assetPath = Object.keys(manifest.assetIds || {}).find((path) => manifest.assetIds[path] === value.slice(6)) || "";
  } else {
    try {
      assetPath = normalizeArchivePath(value, "");
      if (!entries.has(assetPath)) assetPath = normalizeArchivePath(value, storyPath);
    } catch {
      try {
        assetPath = normalizeArchivePath(value, storyPath);
      } catch {
        return "";
      }
    }
  }
  const asset = entries.get(assetPath);
  if (!asset || !asset.mimeType?.startsWith("image/")) {
    throw new Error(`Could not find image "${value}" used by "${storyPath}".`);
  }
  let binary = "";
  for (const byte of asset.bytes) binary += String.fromCharCode(byte);
  return `data:${asset.mimeType};base64,${btoa(binary)}`;
}

async function readProjectZip(file) {
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
  let offset = view.getUint32(endOffset + 16, true);
  if (view.getUint16(endOffset + 8, true) !== entryCount || entryCount > 5000 || offset + centralSize > endOffset) {
    throw new Error("The project ZIP has an invalid or unsupported directory.");
  }
  const centralStart = offset;
  const files = new Map();
  let totalSize = 0;
  let root = "";
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("The project ZIP contains a damaged directory.");
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    if (flags & 1) throw new Error("Encrypted ZIP files aren't supported.");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("ZIP64 archives aren't supported yet.");
    }
    if (nameStart + nameLength + extraLength + commentLength > offset + centralSize) {
      throw new Error("The project ZIP contains a damaged directory entry.");
    }
    const archivePath = zipDecoder.decode(bytes.subarray(nameStart, nameStart + nameLength)).replace(/\\/g, "/");
    if (archivePath.startsWith("/") || /^[a-z]:/i.test(archivePath) ||
        archivePath.split("/").some((part) => part === "." || part === ".." || part.includes("\0"))) {
      throw new Error(`Unsafe path in project ZIP: "${archivePath}".`);
    }
    const directory = archivePath.endsWith("/");
    const segments = archivePath.replace(/\/+$/, "").split("/");
    if (!segments[0]) throw new Error("The ZIP contains an invalid project path.");
    if (!root) root = segments[0];
    if (segments[0] !== root) {
      throw new Error("The ZIP must contain one top-level project folder.");
    }
    const relativePath = segments.slice(1).join("/");
    if (!directory && relativePath && files.has(relativePath)) throw new Error(`The ZIP contains duplicate path "${relativePath}".`);
    if (uncompressedSize > 268435456 || totalSize + uncompressedSize > 268435456) {
      throw new Error("Project ZIPs must be smaller than 256 MB when unpacked.");
    }
    totalSize += uncompressedSize;
    if (localOffset + 30 > centralStart || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Damaged ZIP entry "${archivePath}".`);
    }
    if (view.getUint16(localOffset + 6, true) & 1 || view.getUint16(localOffset + 8, true) !== method) {
      throw new Error(`ZIP entry "${archivePath}" has inconsistent compression information.`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const localName = zipDecoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)).replace(/\\/g, "/");
    if (localName !== archivePath || dataStart + compressedSize > centralStart) {
      throw new Error(`ZIP entry "${archivePath}" has an invalid local header.`);
    }
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (directory) data = new Uint8Array();
    else if (method === 0) data = compressed.slice();
    else if (method === 8 && typeof DecompressionStream === "function") {
      try {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        throw new Error(`Couldn't decompress ZIP entry "${archivePath}".`);
      }
    } else throw new Error(`Unsupported compression method for "${archivePath}".`);
    if (data.length !== uncompressedSize || zipCrc32(data) !== checksum) {
      throw new Error(`ZIP entry "${archivePath}" is incomplete or corrupted.`);
    }
    if (!directory && relativePath) files.set(relativePath, { bytes: data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!root || ![...files.keys()].some((path) => /\.html?$/i.test(path))) {
    throw new Error("The ZIP must contain one project folder and at least one HTML story.");
  }
  return { files, root };
}

function createPlayerDocument(stories, initialFile) {
  const payload = JSON.stringify({ stories, initialFile }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#11131b"><title>Story player</title>
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{background:#11131b;color:#eeedf4;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}.player{position:relative;display:grid;width:100%;height:100%;height:100dvh;overflow:hidden;background:radial-gradient(ellipse at 50% 30%,#373049 0,#242333 38%,#171923 80%)}.toolbar{position:absolute;z-index:2;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));left:max(12px,env(safe-area-inset-left));display:flex;align-items:center;justify-content:space-between;gap:12px;pointer-events:none}.title{overflow:hidden;color:#ddd9e8;font-size:12px;font-weight:650;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 2px 8px #000}.toolbar button,.choice,.primary{border:1px solid #ffffff38;border-radius:7px;background:#171923e8;color:#eeedf4;font:inherit;cursor:pointer}.toolbar button{min-height:38px;padding:0 12px;font-size:12px;pointer-events:auto}.toolbar-actions{display:flex;gap:8px}.stage{position:relative;display:flex;width:100%;height:100%;align-items:flex-end;justify-content:center;overflow:hidden;background-position:center;background-size:cover}.wash{position:absolute;inset:0;background:linear-gradient(180deg,#11131b66 0%,transparent 35%,#11131b20 50%,#11131bf2 100%)}.content{position:relative;z-index:1;width:min(760px,calc(100% - 40px));max-height:80%;overflow:auto;margin:0 20px max(34px,env(safe-area-inset-bottom));padding:20px;border:1px solid #ffffff38;border-radius:12px;background:#171923eb;box-shadow:0 16px 60px #0006}.speaker{margin:0 0 7px;color:#ffafb3;font-size:13px;font-weight:700}.dialogue{font-size:clamp(16px,2.1vw,21px)}.dialogue p{margin:0 0 9px}.dialogue p:last-child{margin-bottom:0}.primary,.choice{display:block;width:100%;margin-top:14px;padding:12px 15px;text-align:left}.primary{width:auto;margin-left:auto;border:0;background:#ff626b;color:#311013;font-weight:700}.choice:hover,.toolbar button:hover{background:#292c39}.primary:hover{background:#ff858b}.choices{display:grid;gap:2px}.ending{font-size:21px;font-weight:700}.progress{position:absolute;z-index:2;right:20px;bottom:max(12px,env(safe-area-inset-bottom));color:#d7d4e0;font-size:10px;font-weight:700;letter-spacing:1px;text-shadow:0 1px 5px #000}.rotate-prompt{display:none}@media(max-width:800px) and (orientation:portrait){.rotate-prompt{position:fixed;z-index:5;inset:0;display:grid;place-content:center;gap:12px;padding:28px;background:#11131b;color:#eeedf4;text-align:center}.rotate-prompt strong{font-size:22px}.rotate-prompt span{color:#aaa9b6;font-size:14px}}@media(max-width:600px) and (orientation:landscape){.content{width:min(720px,calc(100% - 32px));max-height:66%;margin-bottom:max(25px,env(safe-area-inset-bottom));padding:14px 17px}.dialogue{font-size:16px}.toolbar button{min-height:34px}}
</style></head><body><main class="player"><header class="toolbar"><span class="title"></span><span class="toolbar-actions"><button class="fullscreen" type="button">Full screen</button><button class="close" type="button">Close</button></span></header><section class="stage" aria-label="Story scene"><div class="wash" aria-hidden="true"></div><div class="content" aria-live="polite"></div><span class="progress"></span></section></main><div class="rotate-prompt" role="status"><strong>Rotate your device to play</strong><span>This story is designed for landscape orientation.</span></div>
<script>
const payload=${payload},title=document.querySelector(".title"),content=document.querySelector(".content"),stage=document.querySelector(".stage"),progress=document.querySelector(".progress");let currentFile=payload.initialFile,sceneId=payload.stories[currentFile].scenes[0]?.id||null,lineIndex=0;
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node},findScene=()=>payload.stories[currentFile]?.scenes.find(scene=>scene.id===sceneId),render=()=>{const story=payload.stories[currentFile],scene=findScene();title.textContent=story?.title||"";document.title=(story?.title||"Story")+" — Story player";content.replaceChildren();if(!scene){stage.style.backgroundImage="";progress.textContent="STORY COMPLETE";content.append(element("div","ending","The End"));return}progress.textContent=story.path+" · "+scene.id;stage.style.backgroundImage=scene.background?'linear-gradient(180deg,transparent 10%,#11131b5c 100%),url("'+scene.background.replace(/["\\\\]/g,"")+'")':"";const line=scene.lines[lineIndex];if(line){if(line.character)content.append(element("div","speaker",line.character));const dialogue=element("div","dialogue");dialogue.innerHTML=line.html||"…";content.append(dialogue);const next=element("button","primary",lineIndex<scene.lines.length-1?"Continue →":scene.choices.length?"Choose →":"Finish →");next.onclick=()=>{if(lineIndex<scene.lines.length-1)lineIndex++;else if(scene.choices.length)lineIndex=scene.lines.length;else sceneId=null;render()};content.append(next);return}if(scene.choices.length){const choices=element("div","choices");scene.choices.forEach(choice=>{const button=element("button","choice",choice.text||"Continue");button.onclick=()=>{currentFile=choice.targetFile;sceneId=choice.target;lineIndex=0;render()};choices.append(button)});content.append(choices);return}content.append(element("div","dialogue","The moment lingers. There is nowhere else to go."));const finish=element("button","primary","Finish →");finish.onclick=()=>{sceneId=null;render()};content.append(finish)};
document.querySelector(".fullscreen").onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen()}catch{document.querySelector(".fullscreen").textContent="Full screen unavailable"}};document.querySelector(".close").onclick=()=>window.close();render();
</script></body></html>`;
}

function reportFileError(message) {
  storyDropStatus.textContent = message;
  storyDropStatus.classList.add("error");
}

async function loadStoryBundle(file) {
  if (/\.zip$/i.test(file.name) || /zip/i.test(file.type)) {
    const archive = await readProjectZip(file);
    const manifestEntry = archive.files.get(".vvngine-project.json");
    let manifest = {};
    if (manifestEntry) {
      try {
        manifest = JSON.parse(zipDecoder.decode(manifestEntry.bytes));
      } catch {
        throw new Error("The project ZIP contains invalid Vignalise project information.");
      }
    }
    const entries = archive.files;
    for (const [path, entry] of entries) {
      const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
      entry.mimeType = ({
        ".avif": "image/avif", ".gif": "image/gif", ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp"
      })[extension] || "";
    }
    const htmlPaths = [...entries.keys()].filter((path) => /\.html?$/i.test(path));
    const stories = {};
    htmlPaths.forEach((path) => {
      stories[path] = parsePlayableStory(zipDecoder.decode(entries.get(path).bytes), path);
    });
    for (const story of Object.values(stories)) {
      story.scenes.forEach((scene) => {
        scene.background = resolveArchiveAsset(scene.background, story.path, entries, manifest);
        scene.choices.forEach((choice) => {
          if (!stories[choice.targetFile]) throw new Error(`"${story.path}" links to missing story "${choice.targetFile}".`);
          if (!stories[choice.targetFile].scenes.some((target) => target.id === choice.target)) {
            throw new Error(`"${story.path}" links to missing scene "${choice.target}" in "${choice.targetFile}".`);
          }
        });
      });
    }
    const initialFile = typeof manifest.activeFile === "string" && stories[manifest.activeFile]
      ? manifest.activeFile : htmlPaths[0];
    return { stories, initialFile, title: stories[initialFile].title };
  }
  if (!/\.html?$/i.test(file.name) && file.type !== "text/html") {
    throw new Error("Choose an HTML story file or a Vignalise project ZIP.");
  }
  const story = parsePlayableStory(await file.text(), file.name);
  const stories = { [story.path]: story };
  story.scenes.forEach((scene) => {
    scene.background = safeExternalUrl(scene.background);
    scene.choices.forEach((choice) => {
      if (choice.targetFile !== story.path) throw new Error(`"${story.path}" links to "${choice.targetFile}". Choose the complete project ZIP to play cross-file links.`);
      if (!story.scenes.some((target) => target.id === choice.target)) throw new Error(`"${story.path}" links to missing scene "${choice.target}".`);
    });
  });
  return { stories, initialFile: story.path, title: story.title };
}

async function openStoryFile(file) {
  if (!file) return;
  storyDropStatus.classList.remove("error");
  storyDropStatus.textContent = "";
  const playerWindow = window.open("about:blank", "_blank");
  if (!playerWindow) {
    reportFileError("Your browser blocked the player window. Allow pop-ups for this page and try again.");
    return;
  }
  try {
    const bundle = await loadStoryBundle(file);
    const player = new Blob([createPlayerDocument(bundle.stories, bundle.initialFile)], { type: "text/html" });
    const playerUrl = URL.createObjectURL(player);
    playerWindow.location.replace(playerUrl);
    storyDropStatus.textContent = `Playing "${bundle.title}" in a new full-screen reader.`;
    window.setTimeout(() => URL.revokeObjectURL(playerUrl), 60000);
  } catch (error) {
    playerWindow.close();
    reportFileError(error instanceof Error ? error.message : "That file isn't a playable story.");
  }
}

chooseStoryButton.addEventListener("click", () => storyFileInput.click());
storyFileInput.addEventListener("change", () => {
  void openStoryFile(storyFileInput.files?.[0]);
  storyFileInput.value = "";
});
["dragenter", "dragover"].forEach((eventName) => dropArea.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropArea.classList.add("drag-active");
}));
["dragleave", "drop"].forEach((eventName) => dropArea.addEventListener(eventName, (event) => {
  event.preventDefault();
  dropArea.classList.remove("drag-active");
}));
dropArea.addEventListener("drop", (event) => void openStoryFile(event.dataTransfer?.files?.[0]));
