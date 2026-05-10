/**
 * API Documentation (Swagger/OpenAPI)
 */

import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "RAOS API",
      version: "2.0.0",
      description: "RAOS (Recursive Agent Operating System) API Documentation",
    },
    servers: [
      {
        url: "/api",
        description: "Current server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: ["src/routes/*.ts"],
};

const specs = swaggerJsdoc(options);

const router = Router();

router.use("/docs", swaggerUi.serve, swaggerUi.setup(specs, { explorer: true }));
router.get("/docs.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(specs);
});

export default router;
