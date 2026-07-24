/**
 * `prisma db seed` entrypoint. Loads the mock dataset into the database the
 * connection URL points at.
 */

import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../lib/server/seed";

const prisma = new PrismaClient();

async function main() {
  const counts = await seedDatabase(prisma);
  console.log("Seeded:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
