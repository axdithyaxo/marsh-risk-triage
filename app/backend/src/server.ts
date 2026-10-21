import express from "express";
import cors from "cors";
import { assessRouter } from "./routes/assess.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

// Express needs this middleware to parse a JSON request body into req.body.
// Without it, req.body is undefined even when the client sends JSON.
app.use(express.json());

// The browser (localhost:5173) and this server (localhost:4000) are
// different origins as far as a browser is concerned, even on the same
// machine — without CORS enabled, the browser blocks the frontend's
// fetch() calls to this backend before they even reach these routes.
app.use(cors({ origin: process.env.ALLOWED_ORIGIN ?? "http://localhost:5173" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", assessRouter);

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
