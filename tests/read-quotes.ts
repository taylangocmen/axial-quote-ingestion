import { PrismaClient } from '@prisma/client';
import { QuotePipeline } from '../src/server/pipeline/service';
const db = new PrismaClient();
new QuotePipeline(db).quotes('C-10029').then(value => process.stdout.write(JSON.stringify(value))).finally(() => db.$disconnect());
