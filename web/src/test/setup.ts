import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { resetMockDb } from "@/services/mocks/mockDb";

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
  resetMockDb();
});
