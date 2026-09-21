import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import type { IncomingMessage, ServerResponse } from "node:http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

// pino-http publishes a CommonJS `export =` API. With the repository's
// `moduleResolution: "bundler"`, TypeScript can expose that import as a
// namespace instead of the callable middleware factory.
type PinoRequest = IncomingMessage & { id: string };
type PinoHttp = (options: {
  logger: typeof logger;
  serializers: {
    req(req: PinoRequest): { id: string; method?: string; url?: string };
    res(res: ServerResponse): { statusCode: number };
  };
}) => express.RequestHandler;

const createPinoHttp = pinoHttp as unknown as PinoHttp;
const app: Express = express();

app.use(
  createPinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);

export default app;
