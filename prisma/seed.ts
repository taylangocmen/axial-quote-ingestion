import { PrismaClient } from "@prisma/client";
import { catalog } from "../src/server/catalog";

const db = new PrismaClient();

async function main() {
  await db.$transaction(
    catalog.map((item) =>
      db.catalogItem.upsert({
        where: { sku: item.sku },
        create: item,
        update: { description: item.description },
      }),
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
