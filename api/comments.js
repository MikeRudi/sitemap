import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;
// Vercel injects this through the Neon/Postgres integration.
const sql = databaseUrl ? neon(databaseUrl) : null;

function send(response, status, payload) {
  response.status(status).json(payload);
}

function cleanString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS sitemap_comments (
      id text PRIMARY KEY,
      share_path text NOT NULL,
      x integer NOT NULL,
      y integer NOT NULL,
      name text NOT NULL,
      comment text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS sitemap_comments_share_path_created_at_idx
    ON sitemap_comments (share_path, created_at)
  `;
}

export default async function handler(request, response) {
  if (!sql) {
    send(response, 503, { error: "DATABASE_URL is not configured" });
    return;
  }

  try {
    await ensureTable();

    if (request.method === "GET") {
      const sharePath = cleanString(request.query.share, 240);
      if (!sharePath) {
        send(response, 400, { error: "share is required" });
        return;
      }
      const comments = await sql`
        SELECT id, x, y, name, comment AS text, created_at AS "createdAt"
        FROM sitemap_comments
        WHERE share_path = ${sharePath}
        ORDER BY created_at ASC
      `;
      send(response, 200, { comments });
      return;
    }

    if (request.method === "POST") {
      const sharePath = cleanString(request.body?.share, 240);
      const name = cleanString(request.body?.name, 80);
      const text = cleanString(request.body?.text, 2000);
      const x = Math.round(Number(request.body?.x));
      const y = Math.round(Number(request.body?.y));

      if (!sharePath || !name || !text || !Number.isFinite(x) || !Number.isFinite(y)) {
        send(response, 400, { error: "share, x, y, name, and text are required" });
        return;
      }

      const id = randomUUID();
      const [comment] = await sql`
        INSERT INTO sitemap_comments (id, share_path, x, y, name, comment)
        VALUES (${id}, ${sharePath}, ${x}, ${y}, ${name}, ${text})
        RETURNING id, x, y, name, comment AS text, created_at AS "createdAt"
      `;
      send(response, 200, { comment });
      return;
    }

    send(response, 405, { error: "Method not allowed" });
  } catch (error) {
    send(response, 500, { error: error.message || "Comment API failed" });
  }
}
