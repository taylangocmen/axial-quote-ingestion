# Axial quote ingestion

Minimal headless Next.js and TypeScript starter for the Axial assignment, using Zod and Prisma 6 with a local SQLite database. Prisma 6 follows the version family already used in Westgate.

Currently implemented:

- `GET /api/health`: application liveness, independent of database readiness.
- `GET /api/catalog`: the stored catalog, ordered by SKU.
- A catalog schema and repeatable seed containing the four supplied products.

Quote ingestion, conversation routing, revisions, audit history, and duplicate delivery handling are not implemented yet. There is no frontend; `/` has no page.

## Local setup

Use Node.js 22.12 or newer within Node 22 and npm. With nvm, run `nvm use` after installing Node 22 if needed.

```sh
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
npm run dev
```

These are setup instructions, not commands already executed. Dependencies have not been installed, a lockfile has not yet been generated, and the schema has not been migrated. Commit the generated package lock and initial migration after setup; subsequent clean installs should use `npm ci`.

The SQLite file lives at `prisma/dev.db` and is ignored by Git. Keep it on persistent local storage. This setup targets a local Node server; an ephemeral serverless filesystem would not provide durable database storage.

Once the server is running:

```sh
curl http://localhost:3000/api/health
curl http://localhost:3000/api/catalog
```

The health response is `{"status":"ok","service":"axial-quote-ingestion"}`. After migration and seeding, the catalog response contains four entries under `items`. A health response alone does not verify database setup.

## Structure

```text
src/app/api/       HTTP route handlers
src/server/        Database client and catalog definitions
prisma/           Schema and catalog seed
PROJECT_PLAN.md    Assignment analysis and roadmap
```

Next milestone: define quotes, messages, audit records, and the many-to-many quote/conversation relationship; then implement structured state transitions before connecting language extraction.

## Verification status

This scaffold has only been inspected statically. Installation, Prisma generation, migrations, typechecking, builds, tests, and server execution have not been run. Available scripts include `npm run typecheck` and `npm run build` for later authorized checks.

AI assistance was used to analyze the assignment and draft this starter. Runtime behavior has not yet been verified.
