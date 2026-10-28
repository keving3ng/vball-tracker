import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dataDir = process.env.DATA_DIR ?? ".";
    const dbPath = path.join(dataDir, "vball.db");
    const db = new Database(dbPath, { readonly: true, fileMustExist: false });
    
    try {
      const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
      if (!integrity || integrity.length === 0 || integrity[0].integrity_check !== "ok") {
        return NextResponse.json({ status: "error", reason: "integrity_check_failed" }, { status: 503 });
      }

      const fk = db.pragma("foreign_key_check") as any[];
      if (fk && fk.length > 0) {
        return NextResponse.json({ status: "error", reason: "foreign_key_check_failed" }, { status: 503 });
      }

      const tableRow = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number };
      if (!tableRow || tableRow.count === 0) {
        return NextResponse.json({ status: "error", reason: "no_tables" }, { status: 503 });
      }
    } finally {
      db.close();
    }

    const encKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    if (encKey) {
      const buf = Buffer.from(encKey, "base64");
      if (buf.length !== 32) {
        return NextResponse.json({ status: "error", reason: "invalid_encryption_key" }, { status: 503 });
      }
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ status: "error", reason: err?.message || "readiness_failed" }, { status: 503 });
  }
}
