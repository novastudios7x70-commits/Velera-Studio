# Velora Studio — pipeline worker

Stateless background worker that processes queued jobs (transcription, audio
analysis, optional visual generation, LLM segment selection, ffmpeg
cutting/captioning/reformatting). Deployed separately from the Next.js app —
see the root `CLAUDE.md` for the overall architecture and why processing
never happens inline in a web request.

## Local development

```bash
cp .env.example .env   # fill in real keys
npm install
npm run dev
```

Requires `ffmpeg` and `python3` (with `pip install -r requirements.txt`) on
`PATH` locally — the Dockerfile installs both for deployed environments.

## Deploying (Railway / Render)

Build with the included `Dockerfile`. Point `REDIS_URL` at the same Redis
instance the Next.js app's `REDIS_URL` uses — that's the only thing
connecting the two processes. Scale by increasing replica count; each
replica is fully stateless (all job state lives in Supabase), so any replica
can pick up any queued job via BullMQ.

## Pipeline stages

See `src/jobRunner.ts` for the orchestration and `jobs.status` in
`supabase/migrations/0001_init.sql` for the state machine it drives:

`queued → analyzing → [generating_visuals] → selecting → cutting → captioning → done | failed`
