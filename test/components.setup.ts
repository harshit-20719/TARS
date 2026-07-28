import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Unmount between tests so a component's local state cannot leak into the next
 * one. These tests are specifically about state that survives longer than it
 * should, so a dirty DOM between cases would hide exactly the class of bug they
 * exist to catch.
 */
afterEach(cleanup);
