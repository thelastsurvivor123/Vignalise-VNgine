# Vignalise VNgine

**Project status:** In development (Alpha)

It's a Visual Novel Making Web Engine, one that requires no download and is accessible on any device. It features basic functionality and due to its simplicity, it's easy to learn and pickup, especially because it runs entirely on HTML.

## Table of contents

- [About](#about)
- [Features](#features)
- [Try the engine](#try-the-engine)
- [Run it locally](#run-it-locally)
- [Write a story](#write-a-story)
- [Link separate story files](#link-separate-story-files)
- [Add images](#add-images)
- [Save, import, export, and play projects](#save-import-export-and-play-projects)
- [Shared stories and assets](#shared-stories-and-assets)
- [Project structure](#project-structure)
- [Browser support and limitations](#browser-support-and-limitations)
- [Contributing](#contributing)
- [Credits](#credits)
- [License](#license)
- [Contact](#contact)

## About

Vignalise VNgine (VVN) is a lightweight, browser-based visual novel editor. Stories are authored in regular HTML rather than a custom scripting language. The editor provides a live reader preview, a project explorer, local project storage, image assets, and project ZIP import/export.

The standalone player can play an HTML story file. To play a project with stories that link to one another, use the project's ZIP archive.

## Features

- Author scenes, dialogue, and choices in HTML.
- Preview a story as you edit it.
- Organize multiple HTML stories and image assets in the project explorer.
- Link choices to scenes in the same file or to scenes in other project HTML files.
- Save a project in the current browser profile using browser storage.
- Export and import a complete project as a ZIP archive.
- Play an HTML file or a complete project ZIP in a separate reader.
- Browse the engine's shared starter stories and images.

## Try the engine

- **Live site:** Not published yet.
- **Demo story:** Open `stories/example.html` in the editor or use it as a starting point.

## Run it locally

The engine is a static web application and does not require a package install or build step.

1. Download or clone this repository.
2. Open the project folder in a code editor.
3. Serve the folder using a local web server. For example, with Python installed:

   ```powershell
   python -m http.server 8000
   ```

4. Open `http://localhost:8000/` in a browser.

Opening `index.html` directly with a `file://` URL may work for basic use, but browsers restrict some local-file requests. Use a local web server when shared stories, assets, or other network-loaded resources do not appear.

There are no third-party runtime packages to install. The browser provides the APIs used for project storage, file selection, ZIP reading, and ZIP export.

## Write a story

Each story is an HTML file with exactly one `data-vn-story` wrapper and at least one direct-child scene. Give every scene a unique `id`.

```html
<main data-vn-story data-title="A Small Beginning">
  <section id="start" data-scene>
    <p data-character="Mira" data-dialogue>
      The rain has finally stopped.
    </p>
    <a data-choice href="#home">Walk home</a>
  </section>

  <section id="home" data-scene>
    <p data-dialogue>
      The lights in your apartment are still on.
    </p>
  </section>
</main>
```

### Story markup

- `data-vn-story` marks the one story wrapper.
- `data-title` sets the story title shown by the reader.
- `data-scene` marks a scene. It must be a direct child of the story wrapper.
- `id` uniquely identifies a scene within its HTML file.
- `data-dialogue` marks each dialogue or narration step. Put dialogue elements directly inside the scene.
- `data-character` optionally names the speaker.
- `data-choice` marks a choice link. Put choices directly inside the scene; they appear after that scene's dialogue.
- A scene without choices ends that path.

The reader allows basic inline dialogue formatting, including `<p>`, `<br>`, `<em>`, `<strong>`, `<i>`, `<b>`, `<span>`, `<sub>`, and `<sup>`. Other markup inside dialogue is reduced to its text and safe child content.

For more examples and authoring details, open the in-app [HTML guide](guide.html).

## Link separate story files

Use a fragment-only link to move to a scene in the same file:

```html
<a data-choice href="#market">Follow the music</a>
```

To move into another HTML file, use a project-relative path followed by `#` and the target scene ID. The path is relative to the file containing the link.

For example, with this project layout:

```text
stories/
  chapter-one.html
  endings/
    reunion.html
```

From `stories/chapter-one.html`, link to a scene in `stories/endings/reunion.html` like this:

```html
<a data-choice href="endings/reunion.html#reunion">
  Choose the reunion ending
</a>
```

The target file must be part of the project, and the target scene ID must exist in that file. Keep links within the project. The editor's live preview can follow links to stories available in the Explorer. For standalone playback of cross-file branches, export the project and drop or choose the complete ZIP on the home page. Selecting a single HTML file only provides that file, so it cannot load other project stories.

## Add images

Add image assets in the project explorer, then refer to them from a scene with `data-background`.

```html
<section id="garden" data-scene data-background="asset:img-your-image-id">
  <p data-dialogue>The garden is quiet.</p>
</section>
```

Replace `img-your-image-id` with the image's asset ID shown by the explorer. The project ZIP preserves asset IDs, so these references continue working after importing the ZIP.

Shared repository images can also be referenced by their project path, for example:

```html
<section id="platform" data-scene data-background="assets/your-background.jpg">
  ...
</section>
```

Use image files the browser supports, such as PNG, JPEG, GIF, SVG, WebP, or AVIF. External backgrounds should use an accessible `https://` or `http://` URL.

## Save, import, export, and play projects

- The editor automatically saves project files and uploaded assets in the current browser profile on the current device.
- Browser storage is not a cloud sync or a backup. Clearing browser/site data can remove the project.
- **Export project** downloads a ZIP containing project folders, HTML stories, images, project metadata, and the shared stories/assets currently visible in the explorer. You can choose the top-level folder name.
- **Import project** validates a VVN project ZIP and, after confirmation, replaces the current browser project. Export a backup first if you need to keep the current project.
- On the home page, choose or drop one `.html`/`.htm` file to play that story, or choose/drop a project `.zip` to play a project with multiple linked HTML stories.
- ZIP playback supports the VVN project ZIP format, including ZIP files using stored or deflate compression. Encrypted and ZIP64 archives are not supported.

## Shared stories and assets

The repository's `stories/` and `assets/` directories provide shared source material in the editor. Shared files are read-only in the browser; editing or publishing them means changing the repository files.

When adding or removing shared stories or images:

1. Add HTML stories under `stories/` and supported images under `assets/`.
2. Regenerate the shared library index and embedded local bundle:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\build-library-index.ps1
   ```

3. Publish the changed stories/assets together with `library-index.json`, `library-data.js`, and `library-revision.js`.

This workspace may start a VS Code watcher that regenerates the library files when `stories/` or `assets/` change. If the watcher is not running, run the command above manually.

## Project structure

```text
.
├── index.html                 # Home page and story drop/play area
├── editor.html                # Browser-based HTML editor
├── engine.js                  # Editor, preview, project storage, and ZIP import/export
├── play-story.js              # Standalone HTML and project ZIP player
├── guide.html                 # In-app HTML authoring guide
├── style.css                  # Application styles
├── theme.js                   # Theme preference
├── stories/                   # Shared example stories
├── assets/                    # Shared images
├── build-library-index.ps1    # Rebuilds the shared library metadata and bundle
├── watch-library.ps1          # Watches shared story and asset files
├── library-index.json         # Generated shared-library index
├── library-data.js            # Generated embedded shared-library data
└── library-revision.js        # Generated revision marker for local refresh
```

## Browser support and limitations

- Use a modern browser with IndexedDB, the File API, Blob URLs, and the browser ZIP decompression APIs for the complete experience.
- Projects are local to the browser profile and device. Export a ZIP to back up or move a project.
- Browser security controls whether a new player window can open. If playback is blocked, allow pop-ups for the site and try again.
- A project ZIP is a VVN project archive; it is not a general-purpose game installer.
- [Add any known browser/device compatibility notes or known issues.]

## Contributing

Contributions, bug reports, and suggestions are welcome. (I cannot guarantee improvements due to my skill level.)

Before submitting a change:

1. Describe the problem or improvement.
2. Keep changes focused and test the affected editor, preview, import/export, or player flow.
3. If you add or rename shared stories/assets, regenerate the shared library files.

- **Bug reports:** xuavren@gmail.com
- **Feature requests:** @vignalise on x/instagram.
- **Contribution guidelines:** Not yet available.

## Credits

- **Created by:** Vignalise
- **Inspired by:** Ren'Py (Not affiliated with or endorsed by Ren'Py or its developers)
- **Art and other assets:** @vignalise , @mistlvv

## License

Vignalise VNgine is open-source and free for non-commercial use under the [PolyForm Noncommercial License 1.0.0](license.md)

If the engine, stories, and images use different licenses, describe each separately here and add the relevant license files. Do not assume third-party assets are covered by the engine's license.

## Contact

- **Website:** [vignalise.com](vignalise.com)
- **Email:** xuavren@gmail.com
