import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

if (process.env.DATABASE_URL) {
	const databaseUrl = new URL(process.env.DATABASE_URL);
	if (!databaseUrl.searchParams.has("schema")) {
		const schema = process.env.DATABASE_SCHEMA || "reachinbox_assignment";
		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
			throw new Error("DATABASE_SCHEMA must be a valid PostgreSQL schema name");
		}
		databaseUrl.searchParams.set("schema", schema);
		process.env.DATABASE_URL = databaseUrl.toString();
	}
}

export const prisma = new PrismaClient();
