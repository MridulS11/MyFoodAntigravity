import { createHttpServiceRegistry } from "./api/httpServices";
import type { ServiceRegistry } from "./contracts/interfaces";
import { mockServiceRegistry } from "./mocks/mockServices";

const API_MODE = process.env.NEXT_PUBLIC_API_MODE ?? "mock";

/**
 * Phase 1 uses the isolated mock service layer backed by localStorage + BroadcastChannel.
 * In Phases 2–6, NEXT_PUBLIC_API_MODE="live" swaps individual domain services to Go REST/WS clients.
 */
export const services: ServiceRegistry =
  API_MODE === "mock"
    ? mockServiceRegistry
    : createHttpServiceRegistry(mockServiceRegistry);
