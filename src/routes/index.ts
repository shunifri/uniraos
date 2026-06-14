/**
 * Route aggregator — mounts all API route modules onto the Express app.
 */

import type { Express } from "express";
import { createAuthRoutes } from "./auth-routes.js";
import { createSkillRoutes } from "./skill-routes.js";
import { createConfigRoutes } from "./config-routes.js";
import { createAgentRoutes } from "./agent-routes.js";
import { createMemoryRoutes } from "./memory-routes.js";
import { createEvolutionRoutes } from "./evolution-routes.js";
import { createKnowledgeRoutes } from "./knowledge-routes.js";
import { createFileRoutes } from "./file-routes.js";
import { createGraphRoutes } from "./graph-routes.js";
import { createShareRoutes } from "./share-routes.js";
import { createAdminCompatRoutes } from "./admin-compat-routes.js";
import docsRoutes from "./docs-routes.js";
import inboxRoutes from "../inbox/inbox-routes.js";
import healthRoutes from "./health-routes.js";
import { createAppRoutes } from "./app-routes.js";

export type { RouteDependencies } from "./types.js";
import type { RouteDependencies } from "./types.js";

export function mountRoutes(app: Express, deps: RouteDependencies): void {
  app.use("/api", createAuthRoutes(deps));
  app.use("/api", createSkillRoutes(deps));
  app.use("/api", createConfigRoutes(deps));
  app.use("/api", createAgentRoutes(deps));
  app.use("/api", createMemoryRoutes(deps));
  app.use("/api", createEvolutionRoutes(deps));
  app.use("/api", createKnowledgeRoutes(deps));
  app.use("/api", createFileRoutes(deps));
  app.use("/api", createGraphRoutes(deps));
  if (deps.shareRepository) {
    app.use("/api", createShareRoutes({ ...deps, shareRepository: deps.shareRepository }));
  }
  app.use("/api", createAdminCompatRoutes(deps));
  app.use("/api", docsRoutes);
  app.use("/api", inboxRoutes);
  app.use("/api", healthRoutes);
  app.use("/api", createAppRoutes(deps));
}
