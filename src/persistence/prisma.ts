import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function databaseHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
