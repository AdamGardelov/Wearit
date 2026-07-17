<div align="center">

# Wearit

A private wardrobe and outfit planner built around your real clothes and a faceless mannequin.

[![License: MIT](https://img.shields.io/badge/license-MIT-191919?style=flat-square)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-191919?style=flat-square)](package.json)

</div>

Wearit is phone-first and works equally well on desktop. It lets one invited owner browse photographed garments, combine them on a neutral mannequin, save outfits with two or more pieces, and record what was worn and when.

## Privacy model

- Supabase Auth protects the app; wardrobe rows and Storage assets are owner-scoped.
- The browser uses only the Supabase URL and publishable key. No secret or service-role key belongs in Git or Vercel client variables.
- Wearit does not need a personal face/body reference and does not generate photos of the owner wearing clothes.
- Purpose-shot source files and Codex working files stay on local disk and outside Git, the app, and the bundle. When requested, their visual content is processed by Codex-managed built-in image tooling; strict on-device-only workflows need a separate local background remover. Only reviewed cutouts, explicitly selected detail derivatives, and metadata enter an import bundle.

## Local development

Requirements: Node.js 22+, npm, Docker, and the Supabase CLI dependency installed by `npm install`.

```bash
git clone https://github.com/AdamGardelov/Wearit.git
cd Wearit
npm install
npx supabase start
cp .env.example .env.local
npm run dev
```

Copy the local publishable/anon key printed by `npx supabase status` into `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. Open [127.0.0.1:5173](http://127.0.0.1:5173). Local passwordless sign-in messages appear in Supabase Mailpit.

## Import clothes with Codex

Take a clear front photo of each garment against a simple background and place the purpose-shot photos in a dedicated local folder. Optional back/detail photos can help recover source-supported construction.

Then ask Codex:

```text
$import-clothes Prepare the purpose-shot clothes in ~/Pictures/wearit-import for Wearit.
```

The bundled skill creates evidence-bound transparent cutouts, keeps uncertain items on hold, and runs the deterministic bundle preparer. The output contains only `manifest.json` and accepted derivative assets. Sign in to Wearit and use the authenticated Admin import screen to align, review, and upload the bundle.

Codex's built-in image capability performs the local preparation workflow; the deployed app does not require an AI API key.

## Checks

```bash
npm run test
npm run test:db
npm run build
```

## Credits

Wearit began from [tandpfun/wardrobe](https://github.com/tandpfun/wardrobe) and is being reshaped into a private mannequin-based wardrobe.

## License

[MIT](LICENSE)
