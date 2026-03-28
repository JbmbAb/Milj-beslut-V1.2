import { lookupPropertyByDesignation } from "../server/services/lantmaterietService";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// REAL AuthUser for logging to work
const mockUser = {
    id: "cmmpmyhbz0002cuygh50yq0al",
    email: "test@example.com",
    organisationId: "cmmpmyhb50000cuygip862x3d",
    role: "ADMIN" as const,
    name: "System Tester",
    bankidId: "admin:admin"
};

async function run() {
    console.log("Testing Lantmäteriet API integration (Orsa Stackmora 3:12)...");
    try {
        const result = await lookupPropertyByDesignation({
            projectId: "cmmpmyhc90004cuyg57iuzcmo",
            propertyDesignation: "ORSA STACKMORA 3:12",
            purpose: "System test - Orsa Verification"
        }, mockUser);

        console.log("SUCCESS! Data retrieved from Lantmäteriet:");
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("ERROR testing API:");
        console.error(error);
    }
}

run();
