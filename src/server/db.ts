import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

// Reuse the client across Next.js development reloads.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
