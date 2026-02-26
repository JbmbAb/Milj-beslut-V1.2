import express from "express";
import secureApiRouter from "./secureApi.express";
import geminiRouter from "./geminiApi.express";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(secureApiRouter);
app.use(geminiRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "riskguard-secure-backend" });
});

app.listen(port, () => {
  console.info(`RiskGuard backend listening on port ${port}`);
});
