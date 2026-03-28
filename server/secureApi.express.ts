import express from "express";
import bodyParser from "body-parser";
import { assertSecurityEnv } from "./security/env";
import { requestLogger } from "./security/requestLogging";

// Route Modules
import authRoutes from "./routes/auth.routes";
import gisRoutes from "./routes/gis.routes";
import documentRoutes from "./routes/document.routes";
import propertyRoutes from "./routes/property.routes";
import searchRoutes from "./routes/search.routes";
import projectRoutes from "./routes/project.routes";
import requirementsRoutes from "./routes/requirements.routes";
import organisationRoutes from "./routes/organisation.routes";
import adminRoutes from "./routes/admin.routes";
import geoRoutes from "./routes/geo.routes";
import complianceRoutes from "./routes/compliance.routes";
import logisticsRoutes from "./routes/logistics.routes";
import aiRoutes from "./routes/ai.routes";

// Ensure security environment is valid
assertSecurityEnv();

const router = express.Router();

// Global Middleware
router.use(bodyParser.json({ limit: "2mb" })); // Slightly increased limit for complex project plans/OCR
router.use(requestLogger);

// Register Routes
router.use(authRoutes);
router.use(gisRoutes);
router.use(documentRoutes);
router.use(propertyRoutes);
router.use(searchRoutes);
router.use(projectRoutes);
router.use(requirementsRoutes);
router.use(organisationRoutes);
router.use(adminRoutes);
router.use(geoRoutes);
router.use(complianceRoutes);
router.use(logisticsRoutes);
router.use(aiRoutes);

export default router;
