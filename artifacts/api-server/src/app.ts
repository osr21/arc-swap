import express, { type Express } from "express";
import cors, { type CorsOptions } from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (process.env.NODE_ENV !== "production" && origin.includes("localhost")) {
      return callback(null, true);
    }

    const replitDomains = (process.env.REPLIT_DOMAINS ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);

    if (replitDomains.some((domain) => origin.endsWith(domain))) {
      return callback(null, true);
    }

    callback(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
};

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

app.use(
  pinoHttp({
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
app.use(cors(corsOptions));
app.use(globalLimiter);
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

app.use("/api", router);

export default app;
