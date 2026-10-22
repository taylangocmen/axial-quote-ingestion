import { db } from "../db";
import { QuotePipeline } from "./service";
export const pipeline = new QuotePipeline(db);
