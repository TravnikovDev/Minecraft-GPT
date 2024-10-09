import { z } from "zod";
import { ActionSchema, DbSchema, TaskSchema } from "./mainSchemas";

// Define the database schema type
export type DbSchemaType = z.infer<typeof DbSchema>;
export type ActionType = z.infer<typeof ActionSchema>;
export type TaskType = z.infer<typeof TaskSchema>;
