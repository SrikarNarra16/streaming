import { db } from "./db";
import { logs } from "@/schema";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogDetails {
  [key: string]: any;
}

export async function logAction(
  action: string,
  level: LogLevel = "info",
  details: LogDetails = {},
  userId?: string
) {
  try {
    await db.insert(logs).values({
      userId: userId || null,
      action,
      details,
      level,
    });
  } catch (error) {
    console.error("Failed to log action:", error);
  }
}

// Convenience functions for different log levels
export const logger = {
  debug: (action: string, details?: LogDetails, userId?: string) =>
    logAction(action, "debug", details, userId),
  
  info: (action: string, details?: LogDetails, userId?: string) =>
    logAction(action, "info", details, userId),
  
  warn: (action: string, details?: LogDetails, userId?: string) =>
    logAction(action, "warn", details, userId),
  
  error: (action: string, details?: LogDetails, userId?: string) =>
    logAction(action, "error", details, userId),
};