declare module "swagger-ui-express" {
  import type { RequestHandler } from "express";
  const serve: RequestHandler;
  function setup(specs: any, options?: any): RequestHandler;
  export { serve, setup };
}

declare module "swagger-jsdoc" {
  export interface Options {
    definition: Record<string, unknown>;
    apis: string[];
  }
  function swaggerJsdoc(options: Options): any;
  export = swaggerJsdoc;
}

declare module "helmet";
declare module "cors";
declare module "express-rate-limit";
