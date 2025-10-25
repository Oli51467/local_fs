<div style="display:flex; align-items:center; gap:18px; padding:18px 24px; background:#ffffff; border-radius:18px; box-shadow:0 18px 46px rgba(15,23,42,0.08);">
  <div style="flex:0 0 120px;">
    <img src="electron/dist/assets/logo.png" alt="LoFS Logo" width="120" style="display:block; border-radius:24px;">
  </div>
  <div style="flex:1;">
    <h1 style="margin:0 0 12px 0;">🗂️ LoFS · Load once Fast Search</h1>
    <div style="font-size:14px; line-height:1.6; color:#475467;">
      <p style="margin:0 0 6px 0; color:#1f2933;">
        <strong>English</strong> ｜ <a href="README.md">中文</a>
      </p>
      <p style="margin:0; color:#1f2933;">
        LoFS (Load once Fast Search) is a desktop-first knowledge base manager for local files. Mount a directory once and enjoy millisecond hybrid search afterwards.
      </p>
    </div>
  </div>
</div>

## 1. Project Overview
LoFS fuses local file organization with semantic retrieval to deliver an “always up to date” knowledge workspace:
- 🔍 **Multimodal ingestion**: parses `.md`, `.txt`, `.docx`, `.pdf`, `.pptx`, `.json`, and extracts both text and images.
- 📁 **Explorer-style UX**: mount/remount flows, PDF-only parsing, and live progress indicators keep operations transparent.
- 🧠 **Theme-driven retrieval**: augments the Faiss/BM25s/reranker stack with document-level summaries plus semantic/lexical blending so questions land on the right topic before falling back to full-text recall.
- 🤖 **Multi-provider LLM support**: built-in adapters for SiliconFlow, ModelScope, and Alibaba DashScope (Qwen) let you plug in your favorite service, validate connectivity, and use streaming responses with `<think>` reasoning blocks.
- 💬 **Chat experience upgrades**: the chat view remembers your last-selected model across restarts, and thinking traces render as dedicated gray cards for easier auditing.
- 🔒 **Local-first by design**: SQLite and Faiss stay on disk, ensuring data never leaves your machine.
- 🛠️ **Shipping-ready app**: Electron desktop shell plus FastAPI backend, complete with cross-platform packaging scripts.

| PDF Deep Extraction & Markdown Preview | 📑 PDF Viewer | 🔎 PPTX Viewer |
|:--:|:--:|:--:|
| ![extract](img/pdf_extract.png) | ![PDF](img/pdf_viewer.png) | ![PPT](img/ppt_viewer.png) |

| Image Understanding |
|:--:|:--:|:--:|
| ![Image Understanding](img/image_chat.gif) |

## 2. Technical Architecture
- **Electron desktop**: renders the file tree, orchestration panels, and search UI.
- **FastAPI backend**: exposes REST endpoints for mounting, parsing, indexing, and retrieval orchestration.
- **Retrieval pipeline**: Faiss + BM25s + FlagEmbedding (BGE family) power fast semantic/keyword blending, now enhanced with summary vectors for topic-first search, plus CLIP embeddings for images.
- **Model management**: the desktop UI exposes a model library so you can add custom endpoints, run health checks, and manage keys for SiliconFlow, ModelScope, and DashScope in one place.
- **Storage layer**: SQLite for metadata, Faiss for vector indices, and the local filesystem for model caches.

```text
┌─────────────┐      IPC/HTTP      ┌───────────────┐
│ Electron UI │ ─────────────────▶ │ FastAPI Server│
└─────────────┘                   └──────┬────────┘
          │                               │
          ▼                               ▼
   File system watch               Task queue / Model manager
                                        │
                                        ▼
                              SQLite · Faiss · Meta models
```

## 3. Core Workflow
1. 🗂️ **Mount**: select a local folder to register it and trigger first-pass parsing.
2. 📄 **Multimodal parsing**: extract text chunks, capture images, and build CLIP vectors while streaming progress to the UI.
3. 🧮 **Index build**: persist embeddings to Faiss, keyword metadata to BM25s, and structured info to SQLite.
4. 🧾 **Topic summaries (optional)**: when the “Document Theme Summary” setting is on, a chosen LLM produces per-document abstracts that are stored in SQLite and embedded separately.
5. 🔎 **Layered retrieval**: each query first matches against the summary vectors with a semantic (0.6) + lexical (0.4) score fusion; summaries scoring ≥ 0.7 bring their full document chunks and the summary into the LLM prompt. If nothing passes the threshold, the pipeline transparently falls back to classic hybrid retrieval.
6. 💬 **Conversational hand-off**: when a model is selected in the chat panel, LoFS streams replies (including `<think>` reasoning for ModelScope/DashScope) and caches the selection so it’s restored on the next launch.

Model assets download lazily the first time a capability is invoked. Prefetch them to warm the cache:

```bash
python -c "from service.model_manager import get_model_manager; manager = get_model_manager(); [manager.get_model_path(key) for key in ('bge_m3', 'bge_reranker_v2_m3', 'clip_vit_b_32', 'clip_vit_b_32_multilingual', 'pdf_extract_kit')]"
```

### 3.1 Theme-centric Retrieval Highlights
- 🎯 **Summary-first recall**: every mounted document can be distilled into a theme summary, enabling question-to-summary alignment before diving into granular chunks.
- ⚖️ **Semantic × lexical fusion**: blend summary embedding scores with BM25 summary matches (default 0.6/0.4) to balance generalization and precision, mitigating pure-embedding pitfalls.
- 🔁 **Graceful fallback**: if no summary clears the threshold, LoFS automatically reverts to the standard hybrid pipeline; matched responses surface a “Reference Theme” card for transparency.
- 🧩 **Prompt enrichment**: selected documents contribute both the full chunk set and their summaries to the LLM context, helping the assistant stay on-topic and cite accurately.

### 3.2 Multi-provider LLM integration
- Configure API keys under **Settings → API Key** (`siliconflwApiKey`, `modelscopeApiKey`, `qwenApiKey`).
- Use the **Model Library** to add endpoints and run connectivity tests; failures return verbose error payloads for troubleshooting.
- During chat, the dropdown retains your last pick even after restarts. Models that emit `<think>` blocks (ModelScope/DashScope) render their reasoning in a separate, gray “Thinking” panel ahead of the final answer.

## 4. Deployment & Usage
### 4.1 Requirements
| Component | Minimum | Recommended |
| --- | --- | --- |
| Python | 3.8 | 3.10+ |
| Node.js | 16 | 18+ |
| npm | 8 | Latest LTS |
| OS | Windows / macOS / Linux | — |

### 4.2 Installation
```bash
# Clone the repository
git@github.com:Oli51467/local_fs.git
cd LocalFS

# Backend dependencies
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

cd server
pip install -r server/requirements.txt

# Frontend dependencies
cd electron
npm install
```

### 4.3 Run the App
```bash
cd electron
npm run dev
```

### 4.4 Packaging & Model Assets
```bash
python package.py        # cross-platform one-click packaging
```

- On startup LoFS creates model directories under `meta` (`embedding/bge-m3`, `embedding/clip`, `embedding/clip-Vit-32B-multilingual`, `reranker/bge-reranker-v3-m3`, `pdf-extract-kit`).
- The first invocation of embeddings, reranking, theme summarization, CLIP, or PDF parsing auto-downloads weights via `huggingface_hub`.
- Deleting `meta` is safe—the app will recreate the structure during the next boot.

## 5. Chat & Vision Walkthrough
- **Model selection**: add `qwen3-vl-plus` or any other vision-capable model in the model library and store the DashScope API key in Settings; the chat view restores the previously selected model on launch.
- **Image uploads**: drag-and-drop or choose images from disk—the moment you send a message the thumbnails disappear from the composer while the conversation keeps responsive previews (click to open the full image).
- **Context persistence**: every message and attachment lands in the local SQLite cache, so reopening a conversation restores previous pictures, the model pick, and retrieval mode.
- **Workflow inspiration**: the demo GIFs above showcase standard search vs. topic search vs. vision Q&A; combine topic retrieval with the reference cards to jump directly to supporting documents.

## 6. FAQ & Tips
| Scenario | Recommendation |
| --- | --- |
| Images remain in the composer after sending | Hit **Stop** to reset the streaming state and resend; also ensure the renderer isn’t blocking `blob:` URLs in the dev tools network panel. |
| DashScope connectivity test fails | Double-check the `qwenApiKey`, confirm `FS_APP_API_HOST/PORT` matches between backend and Electron, and export `HTTPS_PROXY` if a proxy is required. |
| Topic retrieval returns nothing | Verify that “Document Theme Summary” is enabled and the target folder has completed summary generation; inspect logs for `summary_search_applied` to see whether fallback was triggered. |
| `<think>` blocks not rendered | The UI only shows the gray reasoning panel when the SSE stream provides a `reasoning_content` field. Third-party endpoints must follow the OpenAI Chat Completions schema. |
| Packaged build contains heavy model cache | Run `rm -rf meta/*` before packaging to strip cached weights. For offline-friendly bundles, adjust `package.py` to keep only the models you need. |

---
LoFS = Local File System + Load once Fast Search — bringing “mount once, search fast” to your local knowledge base.
