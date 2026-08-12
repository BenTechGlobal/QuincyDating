# Quincy Dating Platform (Full Stack)

Production-style intentional dating app:
- Express + TypeScript API
- PostgreSQL + PostGIS (proximity)
- Prisma ORM
- Socket.io (chat, typing, presence)
- Static web client

## Quick local run

```bash
docker compose up -d postgres redis
cd apps/api && npm i && npx prisma migrate dev --name init && npm run dev
# other terminal
cd apps/web && npx serve -l 5173