import { z } from "zod";
import { ActionSchema, DbSchema } from "./mainSchemas";

// Define the database schema type
export type DbSchemaType = z.infer<typeof DbSchema>;
export type ActionType = z.infer<typeof ActionSchema>;
