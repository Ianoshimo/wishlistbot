import { PrismaClient } from "@prisma/client";

// PRISMA_LOG_QUERIES=1 - печатать каждый SQL-запрос (диагностика N+1,
// аудит 2026-10-08, А-47). В проде не выставляется.
export const db = new PrismaClient(process.env.PRISMA_LOG_QUERIES === "1" ? { log: ["query"] } : undefined);
