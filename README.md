<div align="center">

# Open Wardrobe

Your clothes, extracted and organized with OpenAI.

[![CI](https://img.shields.io/github/actions/workflow/status/tandpfun/open-wardrobe/ci.yml?branch=main&style=flat-square)](../../actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-191919?style=flat-square)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-191919?style=flat-square)](package.json)

[See the original post →](https://x.com/cdngdev/status/2076812846793650485)

</div>

![Wardrobe editor](docs/screenshots/editor.jpg)

<table>
  <tr>
    <td width="72%"><img src="docs/screenshots/modeled-view.jpg" alt="Modeled wardrobe view" /></td>
    <td width="28%"><img src="docs/screenshots/mobile.jpg" alt="Mobile wardrobe view" /></td>
  </tr>
</table>

## Quick start

```bash
git clone https://github.com/tandpfun/open-wardrobe.git
cd open-wardrobe
npm install
cp .env.example .env
npm run dev
```

Open [localhost:5173](http://localhost:5173). Without an API key, the complete approval flow runs in demo mode.

For live imports, add `OPENAI_API_KEY` to `.env` and place a PNG model reference at `data/model-reference.png`.

## What it does

- Detects every garment in a photo with the OpenAI Responses API
- Extracts clean product cutouts with the OpenAI Images API
- Generates an optional modeled editorial preview
- Keeps originals, jobs, generated images, and the JSON database local in `data/`
- Supports drag, drop, paste, editing, review, regeneration, and approval

## Docker

```bash
docker compose up --build
```

Open [localhost:4173](http://localhost:4173). The `data/` directory is mounted into the container and is never committed.

## Configuration

| Variable | Default |
| --- | --- |
| `OPENAI_API_KEY` | Demo mode when empty |
| `OPENAI_VISION_MODEL` | `gpt-5.4-mini` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` |
| `OPENAI_IMAGE_QUALITY` | `high` |
| `WARDROBE_MODEL_REFERENCE` | `data/model-reference.png` |
| `WARDROBE_DATA_DIR` | `data` |

## License

[MIT](LICENSE)
