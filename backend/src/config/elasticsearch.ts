import { Client } from "@elastic/elasticsearch";
import dotenv from "dotenv";

dotenv.config();

const node = process.env.ELASTICSEARCH_NODE || "http://localhost:9200";

export const esClient = new Client({
  node,
  requestTimeout: 3000,
  maxRetries: 1,
});

export const INDEX_NAME = "email_jobs";

export const initElasticsearch = async () => {
  try {
    const exists = await esClient.indices.exists({ index: INDEX_NAME });
    if (!exists) {
      await esClient.indices.create({
        index: INDEX_NAME,
        mappings: {
          properties: {
            id: { type: "keyword" },
            userId: { type: "keyword" },
            recipient: { type: "text" },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
            createdAt: { type: "date" },
          },
        },
      });
      console.log(`[Elasticsearch] Index "${INDEX_NAME}" created successfully.`);
    } else {
      console.log(`[Elasticsearch] Index "${INDEX_NAME}" already exists.`);
    }
  } catch (error: any) {
    console.warn(`[Elasticsearch] Connection skipped/timed out: ${error.message}`);
  }
};